package tidb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

func TestClassifySearchError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want searchErrorDetails
	}{
		{
			name: "TiFlash memory limit",
			err: &mysql.MySQLError{
				Number:  1105,
				Message: "TiFlashException: Memory limit (total) exceeded",
			},
			want: searchErrorDetails{
				class:       searchErrorClassTiFlashMemoryLimit,
				source:      searchErrorSourceTiFlash,
				retryable:   true,
				dbErrorCode: 1105,
			},
		},
		{
			name: "inference service error",
			err: fmt.Errorf("auto vector search: %w", &mysql.MySQLError{
				Number:  1105,
				Message: "TiDB Cloud Inference: status code 503, service unavailable",
			}),
			want: searchErrorDetails{
				class:          searchErrorClassInferenceUpstream5xx,
				source:         searchErrorSourceInference,
				retryable:      true,
				dbErrorCode:    1105,
				upstreamStatus: 503,
			},
		},
		{
			name: "inference request error",
			err:  errors.New("TiDB Cloud Inference: status code 429: rate limited"),
			want: searchErrorDetails{
				class:          searchErrorClassInferenceHTTPError,
				source:         searchErrorSourceInference,
				retryable:      true,
				upstreamStatus: 429,
			},
		},
		{
			name: "request canceled",
			err:  fmt.Errorf("query: %w", context.Canceled),
			want: searchErrorDetails{
				class:  searchErrorClassContextCanceled,
				source: searchErrorSourceRequest,
			},
		},
		{
			name: "request deadline",
			err:  fmt.Errorf("query: %w", context.DeadlineExceeded),
			want: searchErrorDetails{
				class:     searchErrorClassContextDeadline,
				source:    searchErrorSourceRequest,
				retryable: true,
			},
		},
		{
			name: "connection closed",
			err:  fmt.Errorf("query: %w", sql.ErrConnDone),
			want: searchErrorDetails{
				class:     searchErrorClassDatabaseClosed,
				source:    searchErrorSourceTenantDatabase,
				retryable: true,
			},
		},
		{
			name: "database closed",
			err:  errors.New("sql: database is closed"),
			want: searchErrorDetails{
				class:     searchErrorClassDatabaseClosed,
				source:    searchErrorSourceTenantDatabase,
				retryable: true,
			},
		},
		{
			name: "operation canceled",
			err:  errors.New("dial tcp 192.0.2.1:4000: operation was canceled"),
			want: searchErrorDetails{
				class:     searchErrorClassDatabaseError,
				source:    searchErrorSourceTenantDatabase,
				retryable: true,
			},
		},
		{
			name: "database query failure",
			err:  &mysql.MySQLError{Number: 1064, Message: "syntax error"},
			want: searchErrorDetails{
				class:       searchErrorClassDatabaseError,
				source:      searchErrorSourceTenantDatabase,
				dbErrorCode: 1064,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifySearchError(tt.err)
			if got != tt.want {
				t.Fatalf("classifySearchError() = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestSearchErrorLogAttrs(t *testing.T) {
	err := &mysql.MySQLError{
		Number:  1105,
		Message: "TiDB Cloud Inference: status code 503, service unavailable",
	}
	attrs := attrsByKey(searchErrorLogAttrs("memory", "auto_vector", "cluster-1", 1250*time.Millisecond, err))

	assertStringAttr(t, attrs, "cluster_id", "cluster-1")
	assertStringAttr(t, attrs, "resource", "memory")
	assertStringAttr(t, attrs, "query_type", "auto_vector")
	assertStringAttr(t, attrs, "error_role", "dependency_attempt")
	assertStringAttr(t, attrs, "error_class", searchErrorClassInferenceUpstream5xx)
	assertStringAttr(t, attrs, "error_source", searchErrorSourceInference)
	if got := attrs["retryable"].Bool(); !got {
		t.Fatal("retryable = false, want true")
	}
	assertIntAttr(t, attrs, "duration_ms", 1250)
	assertIntAttr(t, attrs, "db_error_code", 1105)
	assertIntAttr(t, attrs, "upstream_status", 503)
	if got := attrs["err"].Any(); got != err {
		t.Fatalf("err = %v, want %v", got, err)
	}
}

func attrsByKey(attrs []slog.Attr) map[string]slog.Value {
	result := make(map[string]slog.Value, len(attrs))
	for _, attr := range attrs {
		result[attr.Key] = attr.Value
	}
	return result
}

func assertStringAttr(t *testing.T, attrs map[string]slog.Value, key, want string) {
	t.Helper()
	value, ok := attrs[key]
	if !ok {
		t.Fatalf("attribute %q missing", key)
	}
	if got := value.String(); got != want {
		t.Fatalf("%s = %q, want %q", key, got, want)
	}
}

func assertIntAttr(t *testing.T, attrs map[string]slog.Value, key string, want int64) {
	t.Helper()
	value, ok := attrs[key]
	if !ok {
		t.Fatalf("attribute %q missing", key)
	}
	if got := value.Int64(); got != want {
		t.Fatalf("%s = %d, want %d", key, got, want)
	}
}
