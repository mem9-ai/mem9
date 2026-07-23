package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	dto "github.com/prometheus/client_model/go"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/reqid"
)

func TestMemoryListMode(t *testing.T) {
	tests := []struct {
		name                 string
		auth                 *domain.AuthInfo
		filter               domain.MemoryFilter
		contentKeywordSearch bool
		want                 string
	}{
		{name: "chain", auth: &domain.AuthInfo{Chain: &domain.ChainAuth{ChainID: "chain-1"}}, want: "chain"},
		{name: "content keyword", filter: domain.MemoryFilter{Query: "term"}, contentKeywordSearch: true, want: "content_keyword"},
		{name: "scan all", filter: domain.MemoryFilter{Query: "term", ScanAll: true}, want: "scan_all"},
		{name: "default recall", filter: domain.MemoryFilter{Query: "term"}, want: "default_recall"},
		{name: "single pool recall", filter: domain.MemoryFilter{Query: "term", MemoryType: string(domain.TypeInsight)}, want: "single_pool_recall"},
		{name: "session list", filter: domain.MemoryFilter{MemoryType: string(domain.TypeSession)}, want: "session_list"},
		{name: "all types list", filter: domain.MemoryFilter{}, want: "all_types_list"},
		{name: "durable list", filter: domain.MemoryFilter{MemoryType: string(domain.TypeInsight)}, want: "durable_list"},
		{name: "unknown recall pool", filter: domain.MemoryFilter{Query: "term", MemoryType: "future"}, want: "other"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := memoryListMode(tt.auth, tt.filter, tt.contentKeywordSearch); got != tt.want {
				t.Fatalf("memoryListMode() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestListMemories_RecordsMemoryListMetrics(t *testing.T) {
	tests := []struct {
		name       string
		listErr    error
		wantStatus string
	}{
		{name: "success", wantStatus: "ok"},
		{name: "failure", listErr: errors.New("query failed"), wantStatus: "error"},
		{name: "canceled", listErr: context.Canceled, wantStatus: "canceled"},
		{name: "timeout", listErr: context.DeadlineExceeded, wantStatus: "timeout"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resetMemoryListMetrics()
			memRepo := &testMemoryRepo{
				listResults: []domain.Memory{{ID: "insight-1", MemoryType: domain.TypeInsight}},
				listTotal:   1,
				listErr:     tt.listErr,
			}
			srv := newTestServer(memRepo, &testSessionRepo{})
			req := makeRequest(t, http.MethodGet, "/memories?limit=1", nil)
			rr := httptest.NewRecorder()

			srv.listMemories(rr, req)

			if got := memoryListRequestCount(t, "all_types_list", tt.wantStatus); got != 1 {
				t.Fatalf("memory list request count = %v, want 1", got)
			}
			if got := memoryListDurationCount(t, "all_types_list", tt.wantStatus); got != 1 {
				t.Fatalf("memory list duration count = %d, want 1", got)
			}
		})
	}
}

func TestListMemories_RecordsValidationMetrics(t *testing.T) {
	tests := []struct {
		name string
		path string
		mode string
	}{
		{
			name: "oversized app ID",
			path: "/memories?appId=" + strings.Repeat("a", maxAppIDLen+1),
			mode: "all_types_list",
		},
		{
			name: "malformed timestamp",
			path: "/memories?created_after=not-a-time",
			mode: "all_types_list",
		},
		{
			name: "inverted session range",
			path: "/memories?memory_type=session&created_after=2026-07-23T02:00:00Z&created_before=2026-07-23T01:00:00Z",
			mode: "session_list",
		},
		{
			name: "range on durable pool",
			path: "/memories?created_after=2026-07-23T01:00:00Z",
			mode: "all_types_list",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resetMemoryListMetrics()
			srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})
			req := makeRequest(t, http.MethodGet, tt.path, nil)
			rr := httptest.NewRecorder()

			srv.listMemories(rr, req)

			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", rr.Code, rr.Body.String())
			}
			if got := memoryListRequestCount(t, tt.mode, "error"); got != 1 {
				t.Fatalf("memory list request count = %v, want 1", got)
			}
			if got := memoryListDurationCount(t, tt.mode, "error"); got != 1 {
				t.Fatalf("memory list duration count = %d, want 1", got)
			}
		})
	}
}

func TestMemoryListObservation_LogsSlowSummary(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(reqid.NewHandler(slog.NewJSONHandler(&logBuf, nil)))
	auth := &domain.AuthInfo{ClusterID: "cluster-list"}
	observation := newMemoryListObservation(logger, auth, domain.MemoryFilter{
		Query:   "term",
		Limit:   1,
		Offset:  2,
		ScanAll: true,
	}, false)
	observation.startedAt = time.Now().Add(-2100 * time.Millisecond)
	observation.queryDuration = 1500 * time.Millisecond
	observation.overlayDuration = 100 * time.Millisecond
	observation.memoryCountDuration = 20 * time.Millisecond
	observation.sessionCountDuration = 30 * time.Millisecond
	observation.memoryQueryDuration = 900 * time.Millisecond
	observation.sessionQueryDuration = 500 * time.Millisecond
	observation.mergeDuration = 80 * time.Millisecond
	observation.memoryPages = 2
	observation.memoryRows = 250
	observation.sessionPages = 1
	observation.sessionRows = 40
	ctx := reqid.NewContext(context.Background(), "request-list-slow")

	observation.finish(ctx, nil, 1, 290)

	entry := findMemoryListLogEntry(t, &logBuf, "memory list completed")
	assertMemoryListLogField(t, entry, "request_id", "request-list-slow")
	assertMemoryListLogField(t, entry, "cluster_id", "cluster-list")
	assertMemoryListLogField(t, entry, "mode", "scan_all")
	assertMemoryListLogField(t, entry, "memory_type", "all")
	assertMemoryListLogField(t, entry, "scan_all", true)
	assertMemoryListLogField(t, entry, "limit", float64(1))
	assertMemoryListLogField(t, entry, "offset", float64(2))
	assertMemoryListLogField(t, entry, "returned", float64(1))
	assertMemoryListLogField(t, entry, "total", float64(290))
	assertMemoryListLogField(t, entry, "pages", float64(3))
	assertMemoryListLogField(t, entry, "rows", float64(290))
	assertMemoryListLogField(t, entry, "memory_pages", float64(2))
	assertMemoryListLogField(t, entry, "memory_rows", float64(250))
	assertMemoryListLogField(t, entry, "session_pages", float64(1))
	assertMemoryListLogField(t, entry, "session_rows", float64(40))
	assertMemoryListLogField(t, entry, "memory_count_ms", float64(20))
	assertMemoryListLogField(t, entry, "session_count_ms", float64(30))
	assertMemoryListLogField(t, entry, "memory_query_ms", float64(900))
	assertMemoryListLogField(t, entry, "session_query_ms", float64(500))
	assertMemoryListLogField(t, entry, "query_ms", float64(1500))
	assertMemoryListLogField(t, entry, "merge_ms", float64(80))
	assertMemoryListLogField(t, entry, "overlay_ms", float64(100))
	assertMemoryListLogField(t, entry, "outcome", "ok")
	assertMemoryListLogField(t, entry, "cancel_origin", "none")
	if got, ok := entry["duration_ms"].(float64); !ok || got < 2000 {
		t.Fatalf("duration_ms = %#v, want at least 2000", entry["duration_ms"])
	}
}

func TestMemoryListObservation_RecordsBoundedPhaseMetrics(t *testing.T) {
	resetMemoryListMetrics()
	observation := newMemoryListObservation(slog.Default(), &domain.AuthInfo{}, domain.MemoryFilter{}, false)
	observation.memoryCountDuration = 20 * time.Millisecond
	observation.sessionCountDuration = 30 * time.Millisecond
	observation.memoryQueryDuration = 40 * time.Millisecond
	observation.sessionQueryDuration = 50 * time.Millisecond
	observation.mergeDuration = 10 * time.Millisecond

	observation.finish(context.Background(), nil, 1, 2)

	for _, phase := range []string{"count", "page_read", "merge"} {
		if got := memoryListPhaseDurationCount(t, "all_types_list", phase); got != 1 {
			t.Fatalf("%s phase sample count = %d, want 1", phase, got)
		}
	}
}

func TestMemoryListObservation_RecordsConcurrentChainWork(t *testing.T) {
	observation := newMemoryListObservation(slog.Default(), &domain.AuthInfo{
		Chain: &domain.ChainAuth{ChainID: "chain-1"},
	}, domain.MemoryFilter{}, false)

	var group sync.WaitGroup
	for range 10 {
		group.Add(3)
		go func() {
			defer group.Done()
			observation.recordCount("memory", time.Millisecond)
			observation.recordPage("memory", 2, time.Millisecond)
			observation.recordMerge(time.Millisecond)
		}()
		go func() {
			defer group.Done()
			observation.recordCount("session", time.Millisecond)
			observation.recordPage("session", 3, time.Millisecond)
		}()
		go func() {
			defer group.Done()
			observation.recordPage("chain", 4, time.Millisecond)
		}()
	}
	group.Wait()

	if observation.memoryPages != 10 || observation.memoryRows != 20 {
		t.Fatalf("memory work = %d pages/%d rows, want 10/20", observation.memoryPages, observation.memoryRows)
	}
	if observation.sessionPages != 10 || observation.sessionRows != 30 {
		t.Fatalf("session work = %d pages/%d rows, want 10/30", observation.sessionPages, observation.sessionRows)
	}
	if observation.chainPages != 10 || observation.chainRows != 40 {
		t.Fatalf("chain work = %d pages/%d rows, want 10/40", observation.chainPages, observation.chainRows)
	}
	if observation.chainQueryDuration != 10*time.Millisecond {
		t.Fatalf("chain query duration = %s, want 10ms", observation.chainQueryDuration)
	}
	if observation.mergeDuration != 10*time.Millisecond {
		t.Fatalf("merge duration = %s, want 10ms", observation.mergeDuration)
	}
	if observation.memoryCountDuration != 10*time.Millisecond || observation.sessionCountDuration != 10*time.Millisecond {
		t.Fatalf("count durations = memory:%s session:%s, want 10ms each", observation.memoryCountDuration, observation.sessionCountDuration)
	}
}

func TestListChainMemories_RecordsNodeWork(t *testing.T) {
	sessionRepo := &testSessionRepo{
		listResults: []domain.Memory{{ID: "session-1", MemoryType: domain.TypeSession}},
		listTotal:   1,
	}
	srv := newTestServer(&testMemoryRepo{}, sessionRepo)
	req := makeChainRequestWithNodes(t, http.MethodGet, "/memories", nil, 2)
	auth := authInfo(req)
	observation := newMemoryListObservation(slog.Default(), auth, domain.MemoryFilter{
		MemoryType: string(domain.TypeSession),
		Limit:      10,
	}, false)
	ctx := withMemoryListObservation(req.Context(), observation)

	memories, total, err := srv.listChainMemories(ctx, auth, domain.MemoryFilter{
		MemoryType: string(domain.TypeSession),
		Limit:      10,
	})
	if err != nil {
		t.Fatalf("list chain memories: %v", err)
	}
	if len(memories) != 1 || total != 1 {
		t.Fatalf("result = %d memories/%d total, want 1/1", len(memories), total)
	}
	if observation.chainPages != 2 || observation.chainRows != 2 {
		t.Fatalf("chain work = %d pages/%d rows, want 2/2", observation.chainPages, observation.chainRows)
	}
}

func TestListMemories_LogsFailureAndCancellationOrigin(t *testing.T) {
	tests := []struct {
		name       string
		listErr    error
		cancel     bool
		deadline   bool
		wantStatus string
		wantOrigin string
	}{
		{name: "dependency failure", listErr: errors.New("database unavailable"), wantStatus: "error", wantOrigin: "none"},
		{name: "dependency cancellation", listErr: context.Canceled, wantStatus: "canceled", wantOrigin: "downstream"},
		{name: "dependency timeout", listErr: context.DeadlineExceeded, wantStatus: "timeout", wantOrigin: "downstream"},
		{name: "client cancellation", listErr: context.Canceled, cancel: true, wantStatus: "canceled", wantOrigin: "client"},
		{name: "request deadline", listErr: context.DeadlineExceeded, deadline: true, wantStatus: "timeout", wantOrigin: "deadline"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logBuf bytes.Buffer
			logger := slog.New(reqid.NewHandler(slog.NewJSONHandler(&logBuf, nil)))
			srv := newTestServer(&testMemoryRepo{listErr: tt.listErr}, &testSessionRepo{})
			srv.logger = logger
			req := makeRequest(t, http.MethodGet, "/memories?limit=1", nil)
			ctx := middleware.WithAuthContext(reqid.NewContext(req.Context(), "request-list-failure"), &domain.AuthInfo{
				AgentName: "test-agent",
				ClusterID: "cluster-list-failure",
			})
			var cancel context.CancelFunc
			switch {
			case tt.cancel:
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			case tt.deadline:
				ctx, cancel = context.WithDeadline(ctx, time.Unix(0, 0))
				defer cancel()
			}
			req = req.WithContext(ctx)
			rr := httptest.NewRecorder()

			srv.listMemories(rr, req)

			entry := findMemoryListLogEntry(t, &logBuf, "memory list failed")
			assertMemoryListLogField(t, entry, "request_id", "request-list-failure")
			assertMemoryListLogField(t, entry, "cluster_id", "cluster-list-failure")
			assertMemoryListLogField(t, entry, "mode", "all_types_list")
			assertMemoryListLogField(t, entry, "outcome", tt.wantStatus)
			assertMemoryListLogField(t, entry, "cancel_origin", tt.wantOrigin)
		})
	}
}

func resetMemoryListMetrics() {
	metrics.MemoryListRequestsTotal.Reset()
	metrics.MemoryListDuration.Reset()
	metrics.MemoryListPhaseDuration.Reset()
}

func memoryListRequestCount(t *testing.T, mode, status string) float64 {
	t.Helper()
	counter, err := metrics.MemoryListRequestsTotal.GetMetricWithLabelValues(mode, status)
	if err != nil {
		t.Fatalf("get memory list request metric: %v", err)
	}
	metric, ok := counter.(interface{ Write(*dto.Metric) error })
	if !ok {
		t.Fatal("memory list request metric does not implement Write")
	}
	var pb dto.Metric
	if err := metric.Write(&pb); err != nil {
		t.Fatalf("write memory list request metric: %v", err)
	}
	if pb.Counter == nil {
		return 0
	}
	return pb.Counter.GetValue()
}

func memoryListDurationCount(t *testing.T, mode, status string) uint64 {
	t.Helper()
	observer, err := metrics.MemoryListDuration.GetMetricWithLabelValues(mode, status)
	if err != nil {
		t.Fatalf("get memory list duration metric: %v", err)
	}
	metric, ok := observer.(interface{ Write(*dto.Metric) error })
	if !ok {
		t.Fatal("memory list duration metric does not implement Write")
	}
	var pb dto.Metric
	if err := metric.Write(&pb); err != nil {
		t.Fatalf("write memory list duration metric: %v", err)
	}
	if pb.Histogram == nil {
		return 0
	}
	return pb.Histogram.GetSampleCount()
}

func memoryListPhaseDurationCount(t *testing.T, mode, phase string) uint64 {
	t.Helper()
	observer, err := metrics.MemoryListPhaseDuration.GetMetricWithLabelValues(mode, phase)
	if err != nil {
		t.Fatalf("get memory list phase metric: %v", err)
	}
	metric, ok := observer.(interface{ Write(*dto.Metric) error })
	if !ok {
		t.Fatal("memory list phase metric does not implement Write")
	}
	var pb dto.Metric
	if err := metric.Write(&pb); err != nil {
		t.Fatalf("write memory list phase metric: %v", err)
	}
	if pb.Histogram == nil {
		return 0
	}
	return pb.Histogram.GetSampleCount()
}

func findMemoryListLogEntry(t *testing.T, logBuf *bytes.Buffer, message string) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(logBuf.Bytes()))
	for decoder.More() {
		var entry map[string]any
		if err := decoder.Decode(&entry); err != nil {
			t.Fatalf("decode memory list log: %v; logs = %s", err, logBuf.String())
		}
		if entry["msg"] == message {
			return entry
		}
	}
	t.Fatalf("log message %q missing; logs = %s", message, logBuf.String())
	return nil
}

func assertMemoryListLogField(t *testing.T, entry map[string]any, key string, want any) {
	t.Helper()
	if got := entry[key]; got != want {
		t.Fatalf("%s = %#v, want %#v", key, got, want)
	}
}
