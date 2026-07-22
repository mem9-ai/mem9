package tidb

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/reqid"
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
			name: "TiFlash flash error",
			err:  errors.New("[FLASH:Coprocessor:Memory limit exceeded for instance]"),
			want: searchErrorDetails{
				class:     searchErrorClassTiFlashMemoryLimit,
				source:    searchErrorSourceTiFlash,
				retryable: true,
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
			name: "inference HTTP status error",
			err:  errors.New("TiDB Cloud Inference: HTTP status 504"),
			want: searchErrorDetails{
				class:          searchErrorClassInferenceUpstream5xx,
				source:         searchErrorSourceInference,
				retryable:      true,
				upstreamStatus: 504,
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

func TestSearchMethodsLogRowIterationErrors(t *testing.T) {
	previousLogger := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previousLogger) })

	tests := []struct {
		name      string
		columns   []string
		resource  string
		queryType string
		run       func(*sql.DB) error
	}{
		{
			name:      "memory keyword search",
			columns:   memorySearchColumns(),
			resource:  "memory",
			queryType: "keyword",
			run: func(db *sql.DB) error {
				repo := NewMemoryRepo(db, "", false, "cluster-row-error")
				_, err := repo.KeywordSearch(context.Background(), "", domain.MemoryFilter{}, 1)
				return err
			},
		},
		{
			name:      "session keyword search",
			columns:   sessionColumns(),
			resource:  "session",
			queryType: "keyword",
			run: func(db *sql.DB) error {
				repo := NewSessionRepo(db, "", false, "cluster-row-error")
				_, err := repo.KeywordSearch(context.Background(), "", domain.MemoryFilter{}, 1)
				return err
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rowErr := &mysql.MySQLError{
				Number:  1105,
				Message: "TiDB Cloud Inference: status code 503",
			}
			db := newScriptedTestDB(t, []*queryExpectation{{
				wantArgs: []any{1},
				rows: &searchFailingRows{
					columns: tt.columns,
					err:     rowErr,
				},
			}})
			defer db.Close()

			var logBuf bytes.Buffer
			slog.SetDefault(slog.New(slog.NewJSONHandler(&logBuf, nil)))
			if err := tt.run(db); !errors.Is(err, rowErr) {
				t.Fatalf("search error = %v, want %v", err, rowErr)
			}

			var entry map[string]any
			if err := json.Unmarshal(bytes.TrimSpace(logBuf.Bytes()), &entry); err != nil {
				t.Fatalf("decode search log: %v; log = %s", err, logBuf.String())
			}
			if got := entry["resource"]; got != tt.resource {
				t.Fatalf("resource = %v, want %q", got, tt.resource)
			}
			if got := entry["query_type"]; got != tt.queryType {
				t.Fatalf("query_type = %v, want %q", got, tt.queryType)
			}
			if got := entry["error_class"]; got != searchErrorClassInferenceUpstream5xx {
				t.Fatalf("error_class = %v, want %q", got, searchErrorClassInferenceUpstream5xx)
			}
		})
	}
}

func TestListMethodsPreserveRequestIDInFailureLogs(t *testing.T) {
	previousLogger := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previousLogger) })

	tests := []struct {
		name string
		run  func(context.Context, *sql.DB) error
	}{
		{
			name: "memory list",
			run: func(ctx context.Context, db *sql.DB) error {
				_, _, err := NewMemoryRepo(db, "", false, "cluster-list").List(ctx, domain.MemoryFilter{})
				return err
			},
		},
		{
			name: "session list",
			run: func(ctx context.Context, db *sql.DB) error {
				_, _, err := NewSessionRepo(db, "", false, "cluster-list").List(ctx, domain.MemoryFilter{})
				return err
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dbErr := errors.New("count unavailable")
			db := newScriptedTestDB(t, []*queryExpectation{{err: dbErr}})
			defer db.Close()

			var logBuf bytes.Buffer
			slog.SetDefault(slog.New(reqid.NewHandler(slog.NewJSONHandler(&logBuf, nil))))
			ctx := reqid.NewContext(context.Background(), "request-list-repository")
			if err := tt.run(ctx, db); !errors.Is(err, dbErr) {
				t.Fatalf("list error = %v, want %v", err, dbErr)
			}

			var entry map[string]any
			if err := json.Unmarshal(bytes.TrimSpace(logBuf.Bytes()), &entry); err != nil {
				t.Fatalf("decode list log: %v; log = %s", err, logBuf.String())
			}
			if got := entry["request_id"]; got != "request-list-repository" {
				t.Fatalf("request_id = %v, want request-list-repository", got)
			}
		})
	}
}

type searchFailingRows struct {
	columns []string
	err     error
}

func (r *searchFailingRows) Columns() []string { return r.columns }

func (r *searchFailingRows) Close() error { return nil }

func (r *searchFailingRows) Next([]driver.Value) error { return r.err }

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
