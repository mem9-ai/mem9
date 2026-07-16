package tidb

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

var searchInferenceStatusPattern = regexp.MustCompile(
	`(?i)\btidb cloud inference:\s*(?:status code|status|http status|http)\s*:?\s*([1-5][0-9]{2})\b`,
)

const (
	searchErrorClassDatabaseClosed       = "database_closed"
	searchErrorClassDatabaseError        = "database_error"
	searchErrorClassInferenceHTTPError   = "inference_http_error"
	searchErrorClassInferenceUpstream5xx = "inference_upstream_5xx"
	searchErrorClassContextCanceled      = "context_canceled"
	searchErrorClassContextDeadline      = "context_deadline_exceeded"
	searchErrorClassTiFlashMemoryLimit   = "tiflash_memory_limit"

	searchErrorSourceInference      = "inference"
	searchErrorSourceRequest        = "request_context"
	searchErrorSourceTenantDatabase = "tenant_database"
	searchErrorSourceTiFlash        = "tiflash"
)

type searchErrorDetails struct {
	class          string
	source         string
	retryable      bool
	dbErrorCode    int
	upstreamStatus int
}

func logSearchError(ctx context.Context, message, resource, queryType, clusterID string, duration time.Duration, err error) {
	slog.LogAttrs(ctx, slog.LevelError, message, searchErrorLogAttrs(resource, queryType, clusterID, duration, err)...)
}

func logSearchResultError(
	ctx context.Context,
	message, resource, queryType, clusterID string,
	start time.Time,
	resultErr *error,
) {
	if *resultErr != nil {
		logSearchError(ctx, message, resource, queryType, clusterID, time.Since(start), *resultErr)
	}
}

func searchErrorLogAttrs(resource, queryType, clusterID string, duration time.Duration, err error) []slog.Attr {
	details := classifySearchError(err)
	attrs := []slog.Attr{
		slog.String("cluster_id", clusterID),
		slog.String("resource", resource),
		slog.String("query_type", queryType),
		slog.String("error_role", "dependency_attempt"),
		slog.String("error_class", details.class),
		slog.String("error_source", details.source),
		slog.Bool("retryable", details.retryable),
		slog.Int64("duration_ms", duration.Milliseconds()),
	}
	if details.dbErrorCode != 0 {
		attrs = append(attrs, slog.Int("db_error_code", details.dbErrorCode))
	}
	if details.upstreamStatus != 0 {
		attrs = append(attrs, slog.Int("upstream_status", details.upstreamStatus))
	}
	return append(attrs, slog.Any("err", err))
}

func classifySearchError(err error) searchErrorDetails {
	details := searchErrorDetails{
		class:  searchErrorClassDatabaseError,
		source: searchErrorSourceTenantDatabase,
	}
	if errors.Is(err, context.Canceled) {
		details.class = searchErrorClassContextCanceled
		details.source = searchErrorSourceRequest
		return details
	}
	if errors.Is(err, context.DeadlineExceeded) {
		details.class = searchErrorClassContextDeadline
		details.source = searchErrorSourceRequest
		details.retryable = true
		return details
	}
	if errors.Is(err, sql.ErrConnDone) {
		details.class = searchErrorClassDatabaseClosed
		details.retryable = true
		return details
	}

	message := strings.ToLower(err.Error())
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		details.dbErrorCode = int(mysqlErr.Number)
		message = strings.ToLower(mysqlErr.Message)
	}
	if strings.Contains(message, "memory limit") && strings.Contains(message, "exceeded") &&
		(strings.Contains(message, "tiflash") || strings.Contains(message, "[flash:")) {
		details.class = searchErrorClassTiFlashMemoryLimit
		details.source = searchErrorSourceTiFlash
		details.retryable = true
		return details
	}
	if status := inferenceStatus(message); status != 0 {
		details.class = searchErrorClassInferenceHTTPError
		if status >= 500 && status < 600 {
			details.class = searchErrorClassInferenceUpstream5xx
		}
		details.source = searchErrorSourceInference
		details.retryable = status == 429 || status >= 500 && status < 600
		details.upstreamStatus = status
		return details
	}
	if strings.Contains(message, "database is closed") {
		details.class = searchErrorClassDatabaseClosed
		details.retryable = true
		return details
	}
	if strings.Contains(message, "operation was canceled") {
		details.retryable = true
		return details
	}
	return details
}

func inferenceStatus(message string) int {
	match := searchInferenceStatusPattern.FindStringSubmatch(message)
	if len(match) != 2 {
		return 0
	}
	status, _ := strconv.Atoi(match[1])
	return status
}
