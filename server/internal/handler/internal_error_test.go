package handler

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-sql-driver/mysql"

	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/reqid"
)

func TestHandleError_LogsStructuredIncidentClassification(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name               string
		err                error
		wantClass          string
		wantSource         string
		wantRetryable      bool
		wantDBErrorCode    float64
		wantUpstreamStatus float64
	}{
		{
			name: "TiFlash memory limit",
			err: &mysql.MySQLError{
				Number:  1105,
				Message: "[FLASH:Coprocessor:Memory limit exceeded for instance]",
			},
			wantClass:       "tiflash_memory_limit",
			wantSource:      "tiflash",
			wantRetryable:   true,
			wantDBErrorCode: 1105,
		},
		{
			name: "TiDB Cloud Inference through MySQL",
			err: fmt.Errorf("auto vector search: %w", &mysql.MySQLError{
				Number:  1105,
				Message: "TiDB Cloud Inference: status code 503, service unavailable",
			}),
			wantClass:          "inference_upstream_5xx",
			wantSource:         "inference",
			wantRetryable:      true,
			wantDBErrorCode:    1105,
			wantUpstreamStatus: http.StatusServiceUnavailable,
		},
		{
			name:               "typed inference upstream unavailable",
			err:                &llm.HTTPStatusError{Code: http.StatusServiceUnavailable, Body: "upstream unavailable"},
			wantClass:          "inference_upstream_5xx",
			wantSource:         "inference",
			wantRetryable:      true,
			wantUpstreamStatus: http.StatusServiceUnavailable,
		},
		{
			name:               "inference rate limited",
			err:                errors.New("TiDB Cloud Inference: HTTP status 429"),
			wantClass:          "inference_http_error",
			wantSource:         "inference",
			wantRetryable:      true,
			wantUpstreamStatus: http.StatusTooManyRequests,
		},
		{
			name:          "context canceled",
			err:           context.Canceled,
			wantClass:     "context_canceled",
			wantSource:    "request_context",
			wantRetryable: false,
		},
		{
			name:          "context deadline exceeded",
			err:           context.DeadlineExceeded,
			wantClass:     "context_deadline_exceeded",
			wantSource:    "request_context",
			wantRetryable: true,
		},
		{
			name:          "database closed",
			err:           errors.New("sql: database is closed"),
			wantClass:     "database_closed",
			wantSource:    "tenant_database",
			wantRetryable: true,
		},
		{
			name:            "generic MySQL error",
			err:             &mysql.MySQLError{Number: 1064, Message: "syntax error"},
			wantClass:       "database_error",
			wantSource:      "tenant_database",
			wantRetryable:   false,
			wantDBErrorCode: 1064,
		},
		{
			name:          "unknown",
			err:           errors.New("unexpected failure"),
			wantClass:     "unknown",
			wantSource:    "internal",
			wantRetryable: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var logBuf bytes.Buffer
			logger := slog.New(reqid.NewHandler(slog.NewJSONHandler(&logBuf, nil)))
			srv := &Server{logger: logger}
			ctx := reqid.NewContext(context.Background(), "request-123")
			recorder := httptest.NewRecorder()
			err := fmt.Errorf("recall failed: %w", tt.err)

			srv.handleError(ctx, recorder, err)

			if recorder.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
			}
			if got := recorder.Body.String(); got != "{\"error\":\"internal server error\"}\n" {
				t.Fatalf("body = %q, want internal server error response", got)
			}

			entry := findHandlerLogEntry(t, decodeHandlerLogs(t, &logBuf), "internal error")
			assertHandlerLogField(t, entry, "request_id", "request-123")
			assertHandlerLogField(t, entry, "error_role", "final")
			assertHandlerLogField(t, entry, "error_class", tt.wantClass)
			assertHandlerLogField(t, entry, "error_source", tt.wantSource)
			assertHandlerLogField(t, entry, "retryable", tt.wantRetryable)
			assertHandlerLogField(t, entry, "err", err.Error())
			assertOptionalHandlerLogField(t, entry, "db_error_code", tt.wantDBErrorCode)
			assertOptionalHandlerLogField(t, entry, "upstream_status", tt.wantUpstreamStatus)
		})
	}
}

func assertHandlerLogField(t *testing.T, entry map[string]any, key string, want any) {
	t.Helper()
	if got := entry[key]; got != want {
		t.Fatalf("%s = %#v, want %#v", key, got, want)
	}
}

func assertOptionalHandlerLogField(t *testing.T, entry map[string]any, key string, want float64) {
	t.Helper()
	got, ok := entry[key]
	if want == 0 {
		if ok {
			t.Fatalf("%s = %#v, want field omitted", key, got)
		}
		return
	}
	if !ok || got != want {
		t.Fatalf("%s = %#v, want %#v", key, got, want)
	}
}
