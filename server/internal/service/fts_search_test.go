package service

import (
	"context"
	"errors"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestResolveFTSSearchResultAcceptsTruncationForRecall(t *testing.T) {
	want := []domain.Memory{{ID: "memory-1"}}
	var warnings []domain.RecallWarning
	ctx := domain.WithRecallWarningRecorder(context.Background(), func(warning domain.RecallWarning) {
		warnings = append(warnings, warning)
	})

	got, err := resolveFTSSearchResult(ctx, want, domain.ErrFTSSearchTruncated, string(domain.TypeInsight))
	if err != nil {
		t.Fatalf("resolveFTSSearchResult() error = %v", err)
	}
	if len(got) != 1 || got[0].ID != "memory-1" {
		t.Fatalf("results = %+v, want memory-1", got)
	}
	if len(warnings) != 1 || warnings[0].Code != domain.RecallWarningFTSCandidateBudgetExhausted || warnings[0].Branch != string(domain.TypeInsight) {
		t.Fatalf("warnings = %+v, want insight FTS candidate budget warning", warnings)
	}
}

func TestResolveFTSSearchResultPropagatesTruncationWithoutRecall(t *testing.T) {
	want := []domain.Memory{{ID: "memory-1"}}

	got, err := resolveFTSSearchResult(context.Background(), want, domain.ErrFTSSearchTruncated, string(domain.TypeInsight))
	if !errors.Is(err, domain.ErrFTSSearchTruncated) {
		t.Fatalf("resolveFTSSearchResult() error = %v, want ErrFTSSearchTruncated", err)
	}
	if len(got) != 1 || got[0].ID != "memory-1" {
		t.Fatalf("results = %+v, want memory-1", got)
	}
}
