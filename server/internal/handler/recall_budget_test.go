package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync"
	"testing"
	"time"

	dto "github.com/prometheus/client_model/go"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/middleware"
)

type failingJSONResponseWriter struct {
	header http.Header
	status int
}

type deadlineResponseWriter struct {
	*httptest.ResponseRecorder
	deadlines []time.Time
}

func (w *deadlineResponseWriter) SetWriteDeadline(deadline time.Time) error {
	w.deadlines = append(w.deadlines, deadline)
	return nil
}

func identityMiddleware(next http.Handler) http.Handler {
	return next
}

func TestRecallRequestBudgetStartsBeforeGlobalRateLimitMiddleware(t *testing.T) {
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{}).WithRecallRequestBudget(time.Minute, 5*time.Second)
	var budget *recallBudgetContext
	var found bool
	rateLimit := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			budget, found = recallBudgetFromContext(r.Context())
			w.WriteHeader(http.StatusNoContent)
		})
	}
	handler := srv.Router(identityMiddleware, rateLimit, identityMiddleware, identityMiddleware)
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories?q=project", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rr.Code)
	}
	if !found {
		t.Fatal("Recall budget missing in global rate-limit middleware")
	}
	if budget == nil || budget.total != time.Minute || budget.responseReserve != 5*time.Second {
		t.Fatalf("budget = %+v, want total=1m reserve=5s", budget)
	}
	if got := budget.workDeadline.Sub(budget.startedAt); got < 54*time.Second || got > 56*time.Second {
		t.Fatalf("work deadline offset = %s, want approximately 55s", got)
	}
}

func TestRecallRequestBudgetMapsServerDeadlinesToSame504Contract(t *testing.T) {
	metrics.HTTPRequestsTotal.Reset()
	var preHandlerLogBuf bytes.Buffer
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{}).WithRecallRequestBudget(120*time.Millisecond, 60*time.Millisecond)
	srv.logger = slog.New(slog.NewJSONHandler(&preHandlerLogBuf, nil))
	rateLimit := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			<-r.Context().Done()
			http.Error(w, "rate limit dependency timed out", http.StatusServiceUnavailable)
		})
	}
	handler := srv.Router(identityMiddleware, rateLimit, identityMiddleware, identityMiddleware)
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories?q=project", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	preHandlerResponse := assertRecallDeadlineResponse(t, rr)
	assertRecallHTTPMetric(t, "unmatched", http.StatusGatewayTimeout)
	assertRecallRequestLog(t, &preHandlerLogBuf, http.StatusGatewayTimeout, "ERROR")

	metrics.HTTPRequestsTotal.Reset()
	waitForDeadline := func(ctx context.Context) ([]domain.Memory, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return waitForDeadline(ctx)
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return waitForDeadline(ctx)
		},
	}
	var handlerLogBuf bytes.Buffer
	srv = newTestServer(memRepo, sessRepo).WithRecallRequestBudget(120*time.Millisecond, 60*time.Millisecond)
	srv.logger = slog.New(slog.NewJSONHandler(&handlerLogBuf, nil))
	apiKey := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := middleware.WithAuthContext(r.Context(), &domain.AuthInfo{AgentName: "test-agent"})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
	handler = srv.Router(identityMiddleware, identityMiddleware, apiKey, identityMiddleware)
	req = httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories?q=project", nil)
	rr = httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	handlerResponse := assertRecallDeadlineResponse(t, rr)
	assertRecallHTTPMetric(t, "/v1alpha2/mem9s/memories", http.StatusGatewayTimeout)
	assertRecallRequestLog(t, &handlerLogBuf, http.StatusGatewayTimeout, "ERROR")
	if handlerResponse != preHandlerResponse {
		t.Fatalf("handler response = %#v, want pre-handler response %#v", handlerResponse, preHandlerResponse)
	}
}

func TestRecallRequestBudgetRecordsPreHandlerDeadlineWriteFailure(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logBuf, nil))
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{}).WithRecallRequestBudget(120*time.Millisecond, 60*time.Millisecond)
	srv.logger = logger
	rateLimit := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			<-r.Context().Done()
			http.Error(w, "rate limit dependency timed out", http.StatusServiceUnavailable)
		})
	}
	handler := srv.Router(identityMiddleware, rateLimit, identityMiddleware, identityMiddleware)
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories?q=project", nil)
	w := &failingJSONResponseWriter{header: make(http.Header)}

	handler.ServeHTTP(w, req)

	if w.status != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504", w.status)
	}
	entry := findHandlerLogEntry(t, decodeHandlerLogs(t, &logBuf), "recall request deadline exceeded before handler")
	assertHandlerLogField(t, entry, "response_write_outcome", "failed")
}

func TestRecallRequestBudgetMapsPreHandlerClientCancellationTo499(t *testing.T) {
	metrics.HTTPRequestsTotal.Reset()
	var logBuf bytes.Buffer
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})
	srv.logger = slog.New(slog.NewJSONHandler(&logBuf, nil))
	rateLimit := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			<-r.Context().Done()
			http.Error(w, "dependency canceled", http.StatusServiceUnavailable)
		})
	}
	handler := srv.Router(identityMiddleware, rateLimit, identityMiddleware, identityMiddleware)
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories?q=project", nil)
	ctx, cancel := context.WithCancel(req.Context())
	cancel()
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != statusClientClosedRequest {
		t.Fatalf("status = %d, want 499: %s", rr.Code, rr.Body.String())
	}
	assertRecallHTTPMetric(t, "unmatched", statusClientClosedRequest)
	assertRecallRequestLog(t, &logBuf, statusClientClosedRequest, "INFO")
}

func TestRecallRequestBudgetPreservesCommitted500AfterClientCancellation(t *testing.T) {
	metrics.HTTPRequestsTotal.Reset()
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logBuf, nil))
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})
	srv.logger = logger

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories?q=project", nil)
	ctx, cancel := context.WithCancel(req.Context())
	req = req.WithContext(ctx)
	rateLimit := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			respondError(w, http.StatusInternalServerError, "dependency failed")
			cancel()
		})
	}
	handler := srv.Router(identityMiddleware, rateLimit, identityMiddleware, identityMiddleware)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500: %s", rr.Code, rr.Body.String())
	}
	if got := rr.Body.String(); got != "{\"error\":\"dependency failed\"}\n" {
		t.Fatalf("body = %q, want committed 500 response", got)
	}
	assertRecallHTTPMetric(t, "unmatched", http.StatusInternalServerError)
	entries := decodeHandlerLogs(t, &logBuf)
	for _, entry := range entries {
		if entry["msg"] == "recall request canceled before handler" {
			t.Fatal("logged synthetic 499 after response was committed")
		}
	}
	entry := findHandlerLogEntry(t, entries, "handle request done")
	assertHandlerLogField(t, entry, "status", float64(http.StatusInternalServerError))
	assertHandlerLogField(t, entry, "level", "ERROR")
}

func assertRecallDeadlineResponse(t *testing.T, rr *httptest.ResponseRecorder) [2]string {
	t.Helper()
	if rr.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504: %s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
	var response map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response) != 2 {
		t.Fatalf("response = %#v, want code and error", response)
	}
	if response["code"] != recallServerDeadlineCode {
		t.Fatalf("code = %q, want %q", response["code"], recallServerDeadlineCode)
	}
	if response["error"] != recallServerDeadlineMessage {
		t.Fatalf("error = %q, want %q", response["error"], recallServerDeadlineMessage)
	}
	return [2]string{response["code"], response["error"]}
}

func assertRecallHTTPMetric(t *testing.T, route string, status int) {
	t.Helper()
	counter, err := metrics.HTTPRequestsTotal.GetMetricWithLabelValues(http.MethodGet, route, strconv.Itoa(status))
	if err != nil {
		t.Fatalf("get HTTP request metric: %v", err)
	}
	metric, ok := counter.(interface{ Write(*dto.Metric) error })
	if !ok {
		t.Fatal("HTTP request metric does not implement Write")
	}
	var pb dto.Metric
	if err := metric.Write(&pb); err != nil {
		t.Fatalf("write HTTP request metric: %v", err)
	}
	if pb.Counter == nil || pb.Counter.GetValue() != 1 {
		t.Fatalf("HTTP %d request metric = %#v, want 1", status, pb.Counter)
	}
}

func assertRecallRequestLog(t *testing.T, logBuf *bytes.Buffer, status int, level string) {
	t.Helper()
	entry := findHandlerLogEntry(t, decodeHandlerLogs(t, logBuf), "handle request done")
	assertHandlerLogField(t, entry, "status", float64(status))
	assertHandlerLogField(t, entry, "level", level)
}

func TestRecallRequestBudgetMiddlewareSkipsKeywordSearch(t *testing.T) {
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})
	var found bool
	handler := srv.recallRequestBudgetMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, found = recallBudgetFromContext(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories?q=project&search_mode=keyword", nil)

	handler.ServeHTTP(httptest.NewRecorder(), req)

	if found {
		t.Fatal("keyword search received Recall budget")
	}
}

func (w *failingJSONResponseWriter) Header() http.Header {
	return w.header
}

func (w *failingJSONResponseWriter) WriteHeader(status int) {
	w.status = status
}

func (*failingJSONResponseWriter) Write([]byte) (int, error) {
	return 0, errors.New("client connection closed")
}

func TestListMemories_RecallServerDeadlineReturns504(t *testing.T) {
	var logBuf bytes.Buffer
	var mu sync.Mutex
	canceledBranches := 0
	waitForDeadline := func(ctx context.Context) ([]domain.Memory, error) {
		<-ctx.Done()
		mu.Lock()
		canceledBranches++
		mu.Unlock()
		return nil, ctx.Err()
	}
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return waitForDeadline(ctx)
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return waitForDeadline(ctx)
		},
	}
	srv := newTestServer(memRepo, sessRepo).WithRecallRequestBudget(500*time.Millisecond, 400*time.Millisecond)
	srv.logger = slog.New(slog.NewJSONHandler(&logBuf, nil))
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("what happened"), nil)
	rr := httptest.NewRecorder()
	startedAt := time.Now()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504: %s", rr.Code, rr.Body.String())
	}
	var response map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response["code"] != recallServerDeadlineCode {
		t.Fatalf("code = %q, want %q", response["code"], recallServerDeadlineCode)
	}
	if elapsed := time.Since(startedAt); elapsed >= 350*time.Millisecond {
		t.Fatalf("elapsed = %s, want response before total request budget", elapsed)
	}
	mu.Lock()
	gotCanceled := canceledBranches
	mu.Unlock()
	if gotCanceled != 3 {
		t.Fatalf("canceled branches = %d, want 3", gotCanceled)
	}
	entry := findMemoryListLogEntry(t, &logBuf, "memory list failed")
	assertMemoryListLogField(t, entry, "budget_ms", float64(500))
	assertMemoryListLogField(t, entry, "response_reserve_ms", float64(400))
	assertMemoryListLogField(t, entry, "cancel_origin", "server_deadline")
	assertMemoryListLogField(t, entry, "cancel_cause", "server_budget_exhausted")
	assertMemoryListLogField(t, entry, "response_write_outcome", "success")
	assertMemoryListLogField(t, entry, "pinned_outcome", "deadline_exceeded")
	assertMemoryListLogField(t, entry, "insight_outcome", "deadline_exceeded")
	assertMemoryListLogField(t, entry, "session_outcome", "deadline_exceeded")
}

func TestListMemories_RecallDeadlinePreservesCompletedBranches(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(ctx context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			if filter.MemoryType == string(domain.TypeInsight) {
				return []domain.Memory{{
					ID:         "insight-1",
					Content:    "project-1234",
					MemoryType: domain.TypeInsight,
					State:      domain.StateActive,
					UpdatedAt:  now,
				}}, nil
			}
			<-ctx.Done()
			return nil, ctx.Err()
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		},
	}
	srv := newTestServer(memRepo, sessRepo).WithRecallRequestBudget(100*time.Millisecond, 50*time.Millisecond)
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("project-1234"), nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	var response listResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Partial {
		t.Fatal("partial = false, want true")
	}
	if len(response.Memories) != 1 || response.Memories[0].ID != "insight-1" {
		t.Fatalf("memories = %+v, want completed insight branch", response.Memories)
	}
	if len(response.Warnings) != 2 {
		t.Fatalf("warnings = %+v, want two deadline warnings", response.Warnings)
	}
	for _, warning := range response.Warnings {
		if warning.Code != recallBranchDeadlineCode {
			t.Fatalf("warning code = %q, want %q", warning.Code, recallBranchDeadlineCode)
		}
	}
}

func TestListMemories_FTSCandidateBudgetPreservesAcceptedResults(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(ctx context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			if filter.MemoryType != string(domain.TypeInsight) {
				return nil, nil
			}
			domain.RecordRecallWarning(ctx, domain.RecallWarning{
				Code:   domain.RecallWarningFTSCandidateBudgetExhausted,
				Branch: string(domain.TypeInsight),
			})
			return []domain.Memory{{
				ID:         "insight-1",
				Content:    "project-1234",
				MemoryType: domain.TypeInsight,
				State:      domain.StateActive,
				UpdatedAt:  now,
			}}, nil
		},
	}
	srv := newTestServer(memRepo, &testSessionRepo{})
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("project-1234"), nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	var response listResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Partial {
		t.Fatal("partial = false, want true")
	}
	if len(response.Memories) != 1 || response.Memories[0].ID != "insight-1" {
		t.Fatalf("memories = %+v, want accepted insight result", response.Memories)
	}
	if len(response.Warnings) != 1 || response.Warnings[0].Code != domain.RecallWarningFTSCandidateBudgetExhausted || response.Warnings[0].Branch != string(domain.TypeInsight) {
		t.Fatalf("warnings = %+v, want insight FTS candidate budget warning", response.Warnings)
	}
}

func TestDefaultConfidenceRecallSearch_PropagatesBranchDeadlineToRepositories(t *testing.T) {
	deadlines := make(chan time.Time, 16)
	recordDeadline := func(ctx context.Context) ([]domain.Memory, error) {
		deadline, ok := ctx.Deadline()
		if !ok {
			return nil, errors.New("branch deadline missing")
		}
		deadlines <- deadline
		return nil, nil
	}
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return recordDeadline(ctx)
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return recordDeadline(ctx)
		},
	}
	srv := newTestServer(memRepo, sessRepo).WithRecallRequestBudget(time.Second, 250*time.Millisecond)
	requestCtx, workCtx, cancel := newRecallRequestBudget(context.Background(), srv.recallRequestTimeout, srv.recallResponseReserve)
	defer cancel()
	_ = requestCtx

	_, _, err := srv.defaultConfidenceRecallSearch(workCtx, &domain.AuthInfo{}, srv.resolveServices(&domain.AuthInfo{}), domain.MemoryFilter{
		Query: "what happened",
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("defaultConfidenceRecallSearch: %v", err)
	}
	first := <-deadlines
	for range 2 {
		if got := <-deadlines; got.Sub(first).Abs() > 5*time.Millisecond {
			t.Fatalf("branch deadlines differ: first=%s got=%s", first, got)
		}
	}
}

func TestNewRecallRequestBudget_ReservesResponseTimeInsideParentDeadline(t *testing.T) {
	parent, cancelParent := context.WithTimeout(context.Background(), time.Second)
	defer cancelParent()
	parentDeadline, _ := parent.Deadline()

	_, workCtx, cancelBudget := newRecallRequestBudget(parent, 2*time.Second, 200*time.Millisecond)
	defer cancelBudget()
	workDeadline, ok := workCtx.Deadline()
	if !ok {
		t.Fatal("work deadline missing")
	}
	reserve := parentDeadline.Sub(workDeadline)
	if reserve < 190*time.Millisecond || reserve > 210*time.Millisecond {
		t.Fatalf("response reserve = %s, want approximately 200ms", reserve)
	}
}

func TestListMemories_RecallDependencyFailureRemains500(t *testing.T) {
	dependencyErr := errors.New("database unavailable")
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			if filter.MemoryType == string(domain.TypePinned) {
				return nil, dependencyErr
			}
			return nil, nil
		},
	}
	srv := newTestServer(memRepo, &testSessionRepo{})
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("what happened"), nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500: %s", rr.Code, rr.Body.String())
	}
}

func TestListMemories_SinglePoolRecallServerDeadlineReturns504(t *testing.T) {
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		},
	}
	srv := newTestServer(memRepo, &testSessionRepo{}).WithRecallRequestBudget(100*time.Millisecond, 50*time.Millisecond)
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("what happened")+"&memory_type=insight", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504: %s", rr.Code, rr.Body.String())
	}
}

func TestListMemories_RecallCompletionRecordsResponseWriteFailure(t *testing.T) {
	var logBuf bytes.Buffer
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})
	srv.logger = slog.New(slog.NewJSONHandler(&logBuf, nil))
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("what happened"), nil)
	w := &failingJSONResponseWriter{header: make(http.Header)}

	srv.listMemories(w, req)

	if w.status != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.status)
	}
	entry := findMemoryListLogEntry(t, &logBuf, "memory list completed")
	assertMemoryListLogField(t, entry, "level", "INFO")
	assertMemoryListLogField(t, entry, "response_write_outcome", "failed")
}

func TestListMemories_RecallSetsTotalResponseWriteDeadline(t *testing.T) {
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{}).WithRecallRequestBudget(time.Second, 200*time.Millisecond)
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("what happened"), nil)
	w := &deadlineResponseWriter{ResponseRecorder: httptest.NewRecorder()}
	startedAt := time.Now()

	srv.listMemories(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	if len(w.deadlines) != 2 {
		t.Fatalf("write deadline calls = %d, want set and clear", len(w.deadlines))
	}
	if got := w.deadlines[0].Sub(startedAt); got < 900*time.Millisecond || got > 1100*time.Millisecond {
		t.Fatalf("write deadline offset = %s, want approximately 1s", got)
	}
	if !w.deadlines[1].IsZero() {
		t.Fatalf("cleared write deadline = %s, want zero", w.deadlines[1])
	}
}

func TestListMemories_RecallRuntimeFinalizationUsesResponseBudget(t *testing.T) {
	runtimeUsage := &captureRuntimeUsageManager{
		enabled: true,
		afterRecallSuccessHook: func(ctx context.Context) error {
			<-ctx.Done()
			return ctx.Err()
		},
	}
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{}).
		WithRuntimeUsage(runtimeUsage).
		WithRecallRequestBudget(160*time.Millisecond, 80*time.Millisecond)
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("what happened"), nil)
	rr := httptest.NewRecorder()
	startedAt := time.Now()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504: %s", rr.Code, rr.Body.String())
	}
	if elapsed := time.Since(startedAt); elapsed >= 150*time.Millisecond {
		t.Fatalf("elapsed = %s, want response before total budget", elapsed)
	}
}

func TestListMemories_RecallRuntimeNoticeUsesResponseBudget(t *testing.T) {
	runtimeUsage := &captureRuntimeUsageManager{
		enabled:    true,
		providerID: runtimeNoticeProviderID,
		noticeStateHook: func(ctx context.Context) error {
			<-ctx.Done()
			return ctx.Err()
		},
	}
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{}).
		WithRuntimeUsage(runtimeUsage).
		WithRecallRequestBudget(160*time.Millisecond, 80*time.Millisecond)
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("what happened"), nil)
	rr := httptest.NewRecorder()
	startedAt := time.Now()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504: %s", rr.Code, rr.Body.String())
	}
	if elapsed := time.Since(startedAt); elapsed >= 150*time.Millisecond {
		t.Fatalf("elapsed = %s, want response before total budget", elapsed)
	}
}

func TestListMemories_ClientCancellationDuringRuntimeFinalizationReturnsImmediately(t *testing.T) {
	started := make(chan struct{})
	finished := make(chan struct{})
	runtimeUsage := &captureRuntimeUsageManager{
		enabled: true,
		afterRecallSuccessHook: func(ctx context.Context) error {
			close(started)
			<-ctx.Done()
			close(finished)
			return ctx.Err()
		},
	}
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{}).
		WithRuntimeUsage(runtimeUsage).
		WithRecallRequestBudget(300*time.Millisecond, 100*time.Millisecond)
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("what happened"), nil)
	ctx, cancel := context.WithCancel(req.Context())
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		srv.listMemories(rr, req)
		close(done)
	}()

	<-started
	cancel()
	select {
	case <-done:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("handler did not return promptly after client cancellation")
	}
	if rr.Code != statusClientClosedRequest {
		t.Fatalf("status = %d, want 499: %s", rr.Code, rr.Body.String())
	}
	select {
	case <-finished:
	case <-time.After(300 * time.Millisecond):
		t.Fatal("background finalization did not stop at its deadline")
	}
}

func TestListMemories_ClientCancellationDoesNotWaitForRuntimeFailureFinalization(t *testing.T) {
	started := make(chan struct{})
	finished := make(chan struct{})
	runtimeUsage := &captureRuntimeUsageManager{
		enabled: true,
		afterRecallFailureHook: func(ctx context.Context) {
			close(started)
			<-ctx.Done()
			close(finished)
		},
	}
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		},
	}
	srv := newTestServer(memRepo, &testSessionRepo{}).
		WithRuntimeUsage(runtimeUsage).
		WithRecallRequestBudget(300*time.Millisecond, 100*time.Millisecond)
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("what happened")+"&memory_type=insight", nil)
	ctx, cancel := context.WithCancel(req.Context())
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		srv.listMemories(rr, req)
		close(done)
	}()
	cancel()

	select {
	case <-done:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("handler waited for Recall failure finalization")
	}
	if rr.Code != statusClientClosedRequest {
		t.Fatalf("status = %d, want 499: %s", rr.Code, rr.Body.String())
	}
	select {
	case <-started:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("Recall failure finalization was not handed off")
	}
	select {
	case <-finished:
	case <-time.After(300 * time.Millisecond):
		t.Fatal("Recall failure finalization did not stop at its deadline")
	}
}

func TestRecallDeadlineWarningsExcludeDownstreamCancellation(t *testing.T) {
	branches := [3]recallBranchResult{
		{name: "pinned", err: &recallServerDeadlineError{}},
		{name: "insight", err: context.Canceled},
		{name: "session"},
	}
	warnings := recallDeadlineWarnings(branches)
	if len(warnings) != 1 || warnings[0].Branch != "pinned" {
		t.Fatalf("warnings = %+v, want only pinned server deadline", warnings)
	}
	if err := recallNonServerCancellationFailure(branches); !errors.Is(err, context.Canceled) {
		t.Fatalf("non-server cancellation = %v, want context.Canceled", err)
	}
}
