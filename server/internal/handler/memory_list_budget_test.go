package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/reqid"
)

func TestCollectLocalListPagesStopsAtMemoryRowBudget(t *testing.T) {
	observation := newMemoryListObservation(slog.Default(), &domain.AuthInfo{}, domain.MemoryFilter{
		Query:   "term",
		ScanAll: true,
	}, false)
	parent := withMemoryListObservation(context.Background(), observation)
	ctx, budget, cancel := newLocalListBudget(parent, localListBudgetLimits{
		maxPages:   10,
		maxRows:    2,
		maxElapsed: time.Second,
		pageSize:   2,
	})
	defer cancel()
	calls := 0

	_, err := collectLocalListPages(ctx, domain.MemoryFilter{}, "memory", budget, func(_ context.Context, filter domain.MemoryFilter) ([]domain.Memory, int, error) {
		calls++
		return makeBudgetTestMemories(filter.Limit), 3, nil
	})

	assertMemoryListBudgetError(t, err, "rows", "memory")
	if calls != 1 {
		t.Fatalf("repository calls = %d, want 1", calls)
	}
	if observation.memoryPages != 1 || observation.memoryRows != 2 {
		t.Fatalf("observed memory work = %d pages/%d rows, want 1/2", observation.memoryPages, observation.memoryRows)
	}
}

func TestCollectLocalListPagesAllowsEmptySecondSourceAtExactRowBudget(t *testing.T) {
	ctx, budget, cancel := newLocalListBudget(context.Background(), localListBudgetLimits{
		maxPages:   3,
		maxRows:    3,
		maxElapsed: time.Second,
		pageSize:   3,
	})
	defer cancel()

	memoryRows, err := collectLocalListPages(ctx, domain.MemoryFilter{}, "memory", budget, func(_ context.Context, filter domain.MemoryFilter) ([]domain.Memory, int, error) {
		if filter.Limit != 3 {
			t.Fatalf("memory limit = %d, want 3", filter.Limit)
		}
		return makeBudgetTestMemories(3), 3, nil
	})
	if err != nil {
		t.Fatalf("memory collection: %v", err)
	}
	sessionCalls := 0
	sessionRows, err := collectLocalListPages(ctx, domain.MemoryFilter{}, "session", budget, func(_ context.Context, filter domain.MemoryFilter) ([]domain.Memory, int, error) {
		sessionCalls++
		if filter.Limit != 1 {
			t.Fatalf("session probe limit = %d, want 1", filter.Limit)
		}
		return nil, 0, nil
	})
	if err != nil {
		t.Fatalf("empty session collection: %v", err)
	}
	if len(memoryRows) != 3 || len(sessionRows) != 0 || sessionCalls != 1 {
		t.Fatalf("results = memory:%d session:%d calls:%d, want 3/0/1", len(memoryRows), len(sessionRows), sessionCalls)
	}
}

func TestCollectLocalListPagesRejectsNonemptySecondSourceAtExactRowBudget(t *testing.T) {
	ctx, budget, cancel := newLocalListBudget(context.Background(), localListBudgetLimits{
		maxPages:   3,
		maxRows:    3,
		maxElapsed: time.Second,
		pageSize:   3,
	})
	defer cancel()

	_, err := collectLocalListPages(ctx, domain.MemoryFilter{}, "memory", budget, func(context.Context, domain.MemoryFilter) ([]domain.Memory, int, error) {
		return makeBudgetTestMemories(3), 3, nil
	})
	if err != nil {
		t.Fatalf("memory collection: %v", err)
	}
	_, err = collectLocalListPages(ctx, domain.MemoryFilter{}, "session", budget, func(context.Context, domain.MemoryFilter) ([]domain.Memory, int, error) {
		return makeBudgetTestMemories(1), 1, nil
	})

	assertMemoryListBudgetError(t, err, "rows", "session")
}

func TestCollectLocalListPagesStopsAtSessionPageBudget(t *testing.T) {
	ctx, budget, cancel := newLocalListBudget(context.Background(), localListBudgetLimits{
		maxPages:   2,
		maxRows:    100,
		maxElapsed: time.Second,
		pageSize:   1,
	})
	defer cancel()
	memoryCalls := 0
	sessionCalls := 0

	_, err := collectLocalListPages(ctx, domain.MemoryFilter{}, "memory", budget, func(context.Context, domain.MemoryFilter) ([]domain.Memory, int, error) {
		memoryCalls++
		return makeBudgetTestMemories(1), 1, nil
	})
	if err != nil {
		t.Fatalf("memory collection: %v", err)
	}
	_, err = collectLocalListPages(ctx, domain.MemoryFilter{}, "session", budget, func(context.Context, domain.MemoryFilter) ([]domain.Memory, int, error) {
		sessionCalls++
		return makeBudgetTestMemories(1), 3, nil
	})

	assertMemoryListBudgetError(t, err, "pages", "session")
	if memoryCalls != 1 || sessionCalls != 1 {
		t.Fatalf("repository calls = memory:%d session:%d, want 1/1", memoryCalls, sessionCalls)
	}
}

func TestCollectLocalListPagesStopsAtElapsedBudget(t *testing.T) {
	ctx, budget, cancel := newLocalListBudget(context.Background(), localListBudgetLimits{
		maxPages:   10,
		maxRows:    100,
		maxElapsed: 10 * time.Millisecond,
		pageSize:   1,
	})
	defer cancel()
	calls := 0

	_, err := collectLocalListPages(ctx, domain.MemoryFilter{}, "memory", budget, func(ctx context.Context, _ domain.MemoryFilter) ([]domain.Memory, int, error) {
		calls++
		<-ctx.Done()
		return nil, 0, ctx.Err()
	})

	assertMemoryListBudgetError(t, err, "elapsed", "memory")
	if calls != 1 {
		t.Fatalf("repository calls = %d, want 1", calls)
	}
}

func TestCollectLocalListPagesPreservesRequestCancellation(t *testing.T) {
	tests := []struct {
		name       string
		newContext func() (context.Context, context.CancelFunc)
		want       error
	}{
		{
			name: "canceled",
			newContext: func() (context.Context, context.CancelFunc) {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx, cancel
			},
			want: context.Canceled,
		},
		{
			name: "deadline",
			newContext: func() (context.Context, context.CancelFunc) {
				return context.WithDeadline(context.Background(), time.Unix(0, 0))
			},
			want: context.DeadlineExceeded,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parent, cancelParent := tt.newContext()
			defer cancelParent()
			ctx, budget, cancelBudget := newLocalListBudget(parent, localListBudgetLimits{
				maxPages:   10,
				maxRows:    100,
				maxElapsed: time.Second,
				pageSize:   1,
			})
			defer cancelBudget()
			calls := 0

			_, err := collectLocalListPages(ctx, domain.MemoryFilter{}, "memory", budget, func(context.Context, domain.MemoryFilter) ([]domain.Memory, int, error) {
				calls++
				return nil, 0, nil
			})

			if !errors.Is(err, tt.want) {
				t.Fatalf("error = %v, want %v", err, tt.want)
			}
			var budgetErr *memoryListBudgetExceededError
			if errors.As(err, &budgetErr) {
				t.Fatalf("error = %v, want request context classification", err)
			}
			if calls != 0 {
				t.Fatalf("repository calls = %d, want 0", calls)
			}
		})
	}
}

func TestCollectLocalListPagesWithinBudgetPreservesPagination(t *testing.T) {
	ctx, budget, cancel := newLocalListBudget(context.Background(), localListBudgetLimits{
		maxPages:   4,
		maxRows:    4,
		maxElapsed: time.Second,
		pageSize:   2,
	})
	defer cancel()
	all := makeBudgetTestMemories(3)
	var filters []domain.MemoryFilter
	filter := domain.MemoryFilter{
		Query:   "term",
		Tags:    []string{"important"},
		SortBy:  "updated_at",
		SortDir: "desc",
	}

	got, err := collectLocalListPages(ctx, filter, "memory", budget, func(_ context.Context, pageFilter domain.MemoryFilter) ([]domain.Memory, int, error) {
		filters = append(filters, pageFilter)
		end := min(pageFilter.Offset+pageFilter.Limit, len(all))
		return append([]domain.Memory(nil), all[pageFilter.Offset:end]...), len(all), nil
	})
	if err != nil {
		t.Fatalf("collect pages: %v", err)
	}
	if !reflect.DeepEqual(got, all) {
		t.Fatalf("memories = %+v, want %+v", got, all)
	}
	if len(filters) != 2 || filters[0].Offset != 0 || filters[1].Offset != 2 {
		t.Fatalf("page filters = %+v, want offsets 0 and 2", filters)
	}
	for _, gotFilter := range filters {
		if gotFilter.Query != filter.Query || !reflect.DeepEqual(gotFilter.Tags, filter.Tags) ||
			gotFilter.SortBy != filter.SortBy || gotFilter.SortDir != filter.SortDir {
			t.Fatalf("filter fields changed: %+v", gotFilter)
		}
	}
}

func TestMemoryListBudgetErrorResponseReturnsCanonicalRequestID(t *testing.T) {
	srv := &Server{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	handler := reqid.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		srv.handleError(r.Context(), w, &memoryListBudgetExceededError{dimension: "rows", source: "memory"})
	}))
	req := httptest.NewRequest(http.MethodGet, "/memories", nil)
	req.Header.Set(reqid.Header, "req_AAAAAAAAAAAAAAAAAAAAAA")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusUnprocessableEntity)
	}
	if rr.Header().Get(reqid.Header) != "req_AAAAAAAAAAAAAAAAAAAAAA" {
		t.Fatalf("request ID = %q, want canonical inbound ID", rr.Header().Get(reqid.Header))
	}
	var response map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response["error"] != memoryListBudgetErrorMessage || response["code"] != memoryListBudgetErrorCode {
		t.Fatalf("response = %#v, want stable budget error", response)
	}
}

func TestMemoryListObservationRecordsBudgetExceededOutcome(t *testing.T) {
	resetMemoryListMetrics()
	var logBuf bytes.Buffer
	logger := slog.New(reqid.NewHandler(slog.NewJSONHandler(&logBuf, nil)))
	observation := newMemoryListObservation(logger, &domain.AuthInfo{ClusterID: "cluster-budget"}, domain.MemoryFilter{
		Query:   "term",
		ScanAll: true,
		Limit:   10,
	}, false)
	observation.memoryPages = 2
	observation.memoryRows = 400
	err := &memoryListBudgetExceededError{dimension: "rows", source: "memory"}
	ctx := reqid.NewContext(context.Background(), "request-budget")

	observation.finish(ctx, err, 0, 0)

	if got := memoryListRequestCount(t, "scan_all", "budget_exceeded"); got != 1 {
		t.Fatalf("budget-exceeded request metric = %v, want 1", got)
	}
	if got := memoryListDurationCount(t, "scan_all", "budget_exceeded"); got != 1 {
		t.Fatalf("budget-exceeded duration count = %d, want 1", got)
	}
	entry := findMemoryListLogEntry(t, &logBuf, "memory list failed")
	assertMemoryListLogField(t, entry, "request_id", "request-budget")
	assertMemoryListLogField(t, entry, "outcome", "budget_exceeded")
	assertMemoryListLogField(t, entry, "pages", float64(2))
	assertMemoryListLogField(t, entry, "rows", float64(400))
	assertMemoryListLogField(t, entry, "budget_dimension", "rows")
	assertMemoryListLogField(t, entry, "budget_source", "memory")
	if _, ok := entry["duration_ms"]; !ok {
		t.Fatal("budget-exceeded operation log missing duration_ms")
	}
}

func assertMemoryListBudgetError(t *testing.T, err error, dimension, source string) {
	t.Helper()
	var budgetErr *memoryListBudgetExceededError
	if !errors.As(err, &budgetErr) {
		t.Fatalf("error = %v, want memoryListBudgetExceededError", err)
	}
	if budgetErr.dimension != dimension || budgetErr.source != source {
		t.Fatalf("budget error = dimension:%q source:%q, want %q/%q", budgetErr.dimension, budgetErr.source, dimension, source)
	}
}

func makeBudgetTestMemories(count int) []domain.Memory {
	memories := make([]domain.Memory, count)
	for i := range memories {
		memories[i] = domain.Memory{ID: string(rune('a' + i)), MemoryType: domain.TypeInsight}
	}
	return memories
}
