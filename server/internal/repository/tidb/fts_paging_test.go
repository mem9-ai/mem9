package tidb

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestFTSCandidatePagerUsesObservedPassRatio(t *testing.T) {
	startedAt := time.Now()
	pager := newFTSCandidatePager(10, startedAt)

	pageSize, sizeReason, stopReason := pager.nextPage(startedAt)
	if pageSize != 10 || sizeReason != ftsPageSizeInitial || stopReason != "" {
		t.Fatalf("initial page = (%d, %q, %q), want (10, %q, empty)", pageSize, sizeReason, stopReason, ftsPageSizeInitial)
	}
	pager.recordPage(pageSize, pageSize, pageSize, 2)

	pageSize, sizeReason, stopReason = pager.nextPage(startedAt)
	if pageSize != 40 || sizeReason != ftsPageSizePassRatio || stopReason != "" {
		t.Fatalf("adaptive page = (%d, %q, %q), want (40, %q, empty)", pageSize, sizeReason, stopReason, ftsPageSizePassRatio)
	}
}

func TestFTSCandidatePagerGrowsGraduallyWithNoAcceptedCandidates(t *testing.T) {
	startedAt := time.Now()
	pager := newFTSCandidatePager(10, startedAt)

	pageSize, _, _ := pager.nextPage(startedAt)
	pager.recordPage(pageSize, pageSize, pageSize, 0)

	pageSize, sizeReason, stopReason := pager.nextPage(startedAt)
	if pageSize != 20 || sizeReason != ftsPageSizeZeroPass || stopReason != "" {
		t.Fatalf("zero-pass page = (%d, %q, %q), want (20, %q, empty)", pageSize, sizeReason, stopReason, ftsPageSizeZeroPass)
	}
}

func TestFTSCandidatePagerStopsAtTotalCandidateBudget(t *testing.T) {
	startedAt := time.Now()
	pager := newFTSCandidatePager(600, startedAt)
	wantPageSizes := []int{600, 1200, 2000, 2000, 2000, 2000, 200}

	for page, want := range wantPageSizes {
		pageSize, _, stopReason := pager.nextPage(startedAt)
		if stopReason != "" || pageSize != want {
			t.Fatalf("page %d = (%d, %q), want (%d, empty)", page, pageSize, stopReason, want)
		}
		pager.recordPage(pageSize, pageSize, pageSize, 0)
	}

	pageSize, _, stopReason := pager.nextPage(startedAt)
	if pageSize != 0 || stopReason != ftsStopCandidateLimit {
		t.Fatalf("after candidate budget = (%d, %q), want (0, %q)", pageSize, stopReason, ftsStopCandidateLimit)
	}
}

func TestFTSCandidatePagerStopsAtPageBudget(t *testing.T) {
	startedAt := time.Now()
	pager := newFTSCandidatePager(1, startedAt)
	wantPageSizes := []int{1, 2, 4, 8, 16, 32, 64, 128}

	for page, want := range wantPageSizes {
		pageSize, _, stopReason := pager.nextPage(startedAt)
		if stopReason != "" || pageSize != want {
			t.Fatalf("page %d = (%d, %q), want (%d, empty)", page, pageSize, stopReason, want)
		}
		pager.recordPage(pageSize, pageSize, pageSize, 0)
	}

	pageSize, _, stopReason := pager.nextPage(startedAt)
	if pageSize != 0 || stopReason != ftsStopPageLimit {
		t.Fatalf("after page budget = (%d, %q), want (0, %q)", pageSize, stopReason, ftsStopPageLimit)
	}
}

func TestFTSCandidatePagerStopsAtElapsedBudget(t *testing.T) {
	startedAt := time.Now()
	pager := newFTSCandidatePager(10, startedAt)

	pageSize, _, _ := pager.nextPage(startedAt)
	pager.recordPage(pageSize, pageSize, pageSize, 0)

	pageSize, _, stopReason := pager.nextPage(startedAt.Add(maxFTSPagingElapsed))
	if pageSize != 0 || stopReason != ftsStopElapsedLimit {
		t.Fatalf("after elapsed budget = (%d, %q), want (0, %q)", pageSize, stopReason, ftsStopElapsedLimit)
	}
}

func TestAdaptiveFTSSearchPreservesAcceptedResultsAtPageBudget(t *testing.T) {
	type candidate struct{ id string }

	results, stats, err := runAdaptiveFTSSearch(
		context.Background(),
		2,
		func(candidate candidate) string { return candidate.id },
		func(_ context.Context, pageSize, offset int) ([]candidate, error) {
			page := make([]candidate, pageSize)
			for i := range page {
				page[i].id = fmt.Sprintf("candidate-%d", offset+i)
			}
			return page, nil
		},
		func(_ context.Context, candidates []candidate) ([]domain.Memory, error) {
			if candidates[0].id == "candidate-0" {
				return []domain.Memory{{ID: candidates[0].id}}, nil
			}
			return nil, nil
		},
	)
	if err != nil {
		t.Fatalf("runAdaptiveFTSSearch: %v", err)
	}
	if len(results) != 1 || results[0].ID != "candidate-0" {
		t.Fatalf("results = %+v, want accepted candidate-0", results)
	}
	if stats.stopReason != ftsStopPageLimit {
		t.Fatalf("stop reason = %q, want %q", stats.stopReason, ftsStopPageLimit)
	}
	if budgetErr := ftsCandidateBudgetError(stats); !errors.Is(budgetErr, domain.ErrFTSSearchTruncated) {
		t.Fatalf("budget error = %v, want ErrFTSSearchTruncated", budgetErr)
	}
}

func TestAdaptiveFTSSearchPropagatesCallerCancellation(t *testing.T) {
	type candidate struct{ id string }
	ctx, cancel := context.WithCancel(context.Background())
	page := 0

	results, stats, err := runAdaptiveFTSSearch(
		ctx,
		2,
		func(candidate candidate) string { return candidate.id },
		func(_ context.Context, pageSize, offset int) ([]candidate, error) {
			if page > 0 {
				cancel()
				return nil, context.Canceled
			}
			page++
			return []candidate{{id: "candidate-0"}, {id: "candidate-1"}}, nil
		},
		func(_ context.Context, candidates []candidate) ([]domain.Memory, error) {
			return []domain.Memory{{ID: candidates[0].id}}, nil
		},
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	if len(results) != 1 || results[0].ID != "candidate-0" {
		t.Fatalf("results = %+v, want accepted candidate-0", results)
	}
	if stats.stopReason != ftsStopError {
		t.Fatalf("stop reason = %q, want %q", stats.stopReason, ftsStopError)
	}
}

func TestLogFTSSearchStatsIncludesAdaptivePagingFields(t *testing.T) {
	previousLogger := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previousLogger) })
	var logBuf bytes.Buffer
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logBuf, nil)))

	logFTSSearchStats(context.Background(), "fts search done", "memory", "cluster-1", 1250*time.Millisecond, ftsSearchStats{
		requested:          10,
		candidates:         40,
		accepted:           4,
		pages:              3,
		maxPageSize:        20,
		maxPageSizeReason:  ftsPageSizePassRatio,
		repeatedCandidates: 2,
		stopReason:         ftsStopCandidateLimit,
		passRatio:          0.1,
	})

	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(logBuf.Bytes()), &entry); err != nil {
		t.Fatalf("decode FTS stats log: %v; log = %s", err, logBuf.String())
	}
	want := map[string]any{
		"resource":             "memory",
		"requested_results":    float64(10),
		"candidates":           float64(40),
		"accepted":             float64(4),
		"pages":                float64(3),
		"pass_ratio":           0.1,
		"duration_ms":          float64(1250),
		"stop_reason":          ftsStopCandidateLimit,
		"max_page_size":        float64(20),
		"max_page_size_reason": ftsPageSizePassRatio,
		"repeated_candidates":  float64(2),
	}
	for key, wantValue := range want {
		if got := entry[key]; got != wantValue {
			t.Fatalf("%s = %#v, want %#v", key, got, wantValue)
		}
	}
}
