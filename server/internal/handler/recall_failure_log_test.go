package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/reqid"
)

func TestDefaultConfidenceRecallSearch_LogsPrimaryFailureAndSiblingCancellation(t *testing.T) {
	primaryErr := errors.New("TiFlashException: Memory limit (total) exceeded")
	allStarted := make(chan struct{})
	var started atomic.Int32
	startBranch := func() {
		if started.Add(1) == 3 {
			close(allStarted)
		}
		<-allStarted
	}

	memRepo := &testMemoryRepo{
		keywordSearchHook: func(ctx context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			startBranch()
			if filter.MemoryType == string(domain.TypePinned) {
				return nil, primaryErr
			}
			<-ctx.Done()
			return nil, ctx.Err()
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			startBranch()
			<-ctx.Done()
			return nil, ctx.Err()
		},
	}
	srv, logBuf := newRecallFailureLogTestServer(memRepo, sessRepo)
	auth := &domain.AuthInfo{ClusterID: "cluster-recall"}
	ctx := reqid.NewContext(context.Background(), "request-recall")

	_, _, err := srv.defaultConfidenceRecallSearch(ctx, auth, srv.resolveServices(auth), domain.MemoryFilter{
		Query: "what happened",
		Limit: 10,
	})
	if !errors.Is(err, primaryErr) {
		t.Fatalf("error = %v, want wrapped primary error", err)
	}
	if errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want primary branch error; got sibling cancellation", err)
	}

	entry := decodeRecallFailureLog(t, logBuf)
	assertRecallLogField(t, entry, "msg", "confidence recall search failed")
	assertRecallLogField(t, entry, "request_id", "request-recall")
	assertRecallLogField(t, entry, "cluster_id", "cluster-recall")
	assertRecallLogField(t, entry, "primary_branch", "pinned")
	assertRecallLogField(t, entry, "primary_error_class", "tiflash_memory_limit")
	assertRecallLogField(t, entry, "primary_error_source", "tiflash")
	assertRecallLogField(t, entry, "primary_retryable", true)
	assertRecallLogField(t, entry, "cancel_origin", "sibling_failure")
	assertRecallLogField(t, entry, "pinned_outcome", "failed")
	assertRecallLogField(t, entry, "insight_outcome", "canceled")
	assertRecallLogField(t, entry, "session_outcome", "canceled")
	assertRecallLogStrings(t, entry, "canceled_branches", []string{"insight", "session"})
	assertRecallLogDurations(t, entry)
}

func TestDefaultConfidenceRecallSearch_LogsRequestCancellationOrigin(t *testing.T) {
	tests := []struct {
		name          string
		newContext    func(context.Context) (context.Context, context.CancelFunc)
		wantErr       error
		wantClass     string
		wantOrigin    string
		wantOutcome   string
		wantRetryable bool
	}{
		{
			name: "client cancellation",
			newContext: func(parent context.Context) (context.Context, context.CancelFunc) {
				ctx, cancel := context.WithCancel(parent)
				cancel()
				return ctx, cancel
			},
			wantErr:     context.Canceled,
			wantClass:   "context_canceled",
			wantOrigin:  "client",
			wantOutcome: "canceled",
		},
		{
			name: "request deadline",
			newContext: func(parent context.Context) (context.Context, context.CancelFunc) {
				return context.WithDeadline(parent, time.Unix(0, 0))
			},
			wantErr:       context.DeadlineExceeded,
			wantClass:     "context_deadline_exceeded",
			wantOrigin:    "deadline",
			wantOutcome:   "deadline_exceeded",
			wantRetryable: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			search := func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
				return nil, ctx.Err()
			}
			memRepo := &testMemoryRepo{keywordSearchHook: search}
			sessRepo := &testSessionRepo{keywordSearchHook: search}
			srv, logBuf := newRecallFailureLogTestServer(memRepo, sessRepo)
			auth := &domain.AuthInfo{ClusterID: "cluster-request"}
			baseCtx := reqid.NewContext(context.Background(), "request-context")
			ctx, cancel := tt.newContext(baseCtx)
			defer cancel()

			_, _, err := srv.defaultConfidenceRecallSearch(ctx, auth, srv.resolveServices(auth), domain.MemoryFilter{
				Query: "what happened",
				Limit: 10,
			})
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, want %v", err, tt.wantErr)
			}

			entry := decodeRecallFailureLog(t, logBuf)
			assertRecallLogField(t, entry, "request_id", "request-context")
			assertRecallLogField(t, entry, "primary_branch", "request")
			assertRecallLogField(t, entry, "primary_error_class", tt.wantClass)
			assertRecallLogField(t, entry, "primary_error_source", "request_context")
			assertRecallLogField(t, entry, "primary_retryable", tt.wantRetryable)
			assertRecallLogField(t, entry, "cancel_origin", tt.wantOrigin)
			assertRecallLogField(t, entry, "pinned_outcome", tt.wantOutcome)
			assertRecallLogField(t, entry, "insight_outcome", tt.wantOutcome)
			assertRecallLogField(t, entry, "session_outcome", tt.wantOutcome)
			assertRecallLogStrings(t, entry, "canceled_branches", []string{"pinned", "insight", "session"})
			assertRecallLogDurations(t, entry)
		})
	}
}

func TestClassifyRecallError(t *testing.T) {
	tests := []struct {
		name               string
		err                error
		wantClass          string
		wantSource         string
		wantRetryable      bool
		wantUpstreamStatus int
	}{
		{
			name:          "TiFlash memory limit",
			err:           errors.New("TiFlashException: Memory limit (total) exceeded"),
			wantClass:     "tiflash_memory_limit",
			wantSource:    "tiflash",
			wantRetryable: true,
		},
		{
			name:          "TiFlash flash error",
			err:           errors.New("[FLASH:Coprocessor:Memory limit exceeded for instance]"),
			wantClass:     "tiflash_memory_limit",
			wantSource:    "tiflash",
			wantRetryable: true,
		},
		{
			name:               "inference upstream 503",
			err:                errors.New("TiDB Cloud Inference: status code 503"),
			wantClass:          "inference_upstream_5xx",
			wantSource:         "inference",
			wantRetryable:      true,
			wantUpstreamStatus: 503,
		},
		{
			name:               "inference rate limited",
			err:                errors.New("TiDB Cloud Inference: status code 429"),
			wantClass:          "inference_http_error",
			wantSource:         "inference",
			wantRetryable:      true,
			wantUpstreamStatus: 429,
		},
		{
			name:               "inference HTTP status 504",
			err:                errors.New("TiDB Cloud Inference: HTTP status 504"),
			wantClass:          "inference_upstream_5xx",
			wantSource:         "inference",
			wantRetryable:      true,
			wantUpstreamStatus: 504,
		},
		{
			name:          "database closed",
			err:           errors.New("sql: database is closed"),
			wantClass:     "database_closed",
			wantSource:    "tenant_database",
			wantRetryable: true,
		},
		{
			name:       "database error",
			err:        &mysql.MySQLError{Number: 1064, Message: "syntax error"},
			wantClass:  "database_error",
			wantSource: "tenant_database",
		},
		{
			name:          "database operation canceled",
			err:           errors.New("dial tcp 192.0.2.1:4000: operation was canceled"),
			wantClass:     "database_error",
			wantSource:    "tenant_database",
			wantRetryable: true,
		},
		{
			name:       "unknown",
			err:        errors.New("unexpected dependency failure"),
			wantClass:  "unknown",
			wantSource: "internal",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRecallError(tt.err)
			if got.class != tt.wantClass {
				t.Fatalf("class = %q, want %q", got.class, tt.wantClass)
			}
			if got.source != tt.wantSource {
				t.Fatalf("source = %q, want %q", got.source, tt.wantSource)
			}
			if got.retryable != tt.wantRetryable {
				t.Fatalf("retryable = %t, want %t", got.retryable, tt.wantRetryable)
			}
			if got.upstreamStatus != tt.wantUpstreamStatus {
				t.Fatalf("upstream status = %d, want %d", got.upstreamStatus, tt.wantUpstreamStatus)
			}
		})
	}
}

func newRecallFailureLogTestServer(memRepo *testMemoryRepo, sessRepo *testSessionRepo) (*Server, *bytes.Buffer) {
	srv := newTestServer(memRepo, sessRepo)
	logBuf := &bytes.Buffer{}
	srv.logger = slog.New(reqid.NewHandler(slog.NewJSONHandler(logBuf, nil)))
	return srv, logBuf
}

func decodeRecallFailureLog(t *testing.T, logBuf *bytes.Buffer) map[string]any {
	t.Helper()
	lines := bytes.Split(bytes.TrimSpace(logBuf.Bytes()), []byte("\n"))
	if len(lines) != 1 {
		t.Fatalf("log lines = %d, want 1: %s", len(lines), logBuf.String())
	}
	var entry map[string]any
	if err := json.Unmarshal(lines[0], &entry); err != nil {
		t.Fatalf("decode log: %v", err)
	}
	return entry
}

func assertRecallLogField(t *testing.T, entry map[string]any, key string, want any) {
	t.Helper()
	if got := entry[key]; got != want {
		t.Fatalf("%s = %#v, want %#v", key, got, want)
	}
}

func assertRecallLogStrings(t *testing.T, entry map[string]any, key string, want []string) {
	t.Helper()
	values, ok := entry[key].([]any)
	if !ok {
		t.Fatalf("%s = %#v, want string array", key, entry[key])
	}
	got := make([]string, len(values))
	for i, value := range values {
		got[i], ok = value.(string)
		if !ok {
			t.Fatalf("%s[%d] = %#v, want string", key, i, value)
		}
	}
	if !slices.Equal(got, want) {
		t.Fatalf("%s = %v, want %v", key, got, want)
	}
}

func assertRecallLogDurations(t *testing.T, entry map[string]any) {
	t.Helper()
	for _, key := range []string{"pinned_ms", "insight_ms", "session_ms", "total_ms"} {
		value, ok := entry[key].(float64)
		if !ok || value < 0 {
			t.Fatalf("%s = %#v, want non-negative number", key, entry[key])
		}
	}
}
