package handler

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-sql-driver/mysql"

	"github.com/qiffang/mnemos/server/internal/llm"
)

var tidbCloudInferenceStatusPattern = regexp.MustCompile(
	`(?i)\btidb cloud inference:\s*(?:status code|status|http status|http)\s*:?\s*([1-5][0-9]{2})\b`,
)

type internalErrorClassification struct {
	class          string
	source         string
	retryable      bool
	dbErrorCode    uint16
	upstreamStatus int
}

func classifyInternalError(err error) internalErrorClassification {
	classification := internalErrorClassification{
		class:  "unknown",
		source: "internal",
	}

	var dbErr *mysql.MySQLError
	if errors.As(err, &dbErr) {
		classification.dbErrorCode = dbErr.Number
	}

	var llmErr *llm.HTTPStatusError
	isLLMError := errors.As(err, &llmErr)
	if isLLMError {
		classification.upstreamStatus = llmErr.Code
	}

	isInferenceError := false
	if !isLLMError {
		if status, ok := tidbCloudInferenceStatus(err); ok {
			isInferenceError = true
			classification.upstreamStatus = status
		}
	}
	message := strings.ToLower(err.Error())

	switch {
	case isLLMError && classification.upstreamStatus >= http.StatusInternalServerError &&
		classification.upstreamStatus < 600:
		classification.class = "llm_upstream_5xx"
		classification.source = "llm_provider"
		classification.retryable = true
	case isLLMError:
		classification.class = "llm_http_error"
		classification.source = "llm_provider"
		classification.retryable = classification.upstreamStatus == http.StatusTooManyRequests
	case isTiFlashMemoryLimit(message):
		classification.class = "tiflash_memory_limit"
		classification.source = "tiflash"
		classification.retryable = true
	case isInferenceError && classification.upstreamStatus >= http.StatusInternalServerError &&
		classification.upstreamStatus < 600:
		classification.class = "inference_upstream_5xx"
		classification.source = "inference"
		classification.retryable = true
	case isInferenceError:
		classification.class = "inference_http_error"
		classification.source = "inference"
		classification.retryable = classification.upstreamStatus == http.StatusTooManyRequests
	case errors.Is(err, context.Canceled):
		classification.class = "context_canceled"
		classification.source = "request_context"
	case errors.Is(err, context.DeadlineExceeded):
		classification.class = "context_deadline_exceeded"
		classification.source = "request_context"
		classification.retryable = true
	case errors.Is(err, sql.ErrConnDone) || strings.Contains(message, "database is closed"):
		classification.class = "database_closed"
		classification.source = "tenant_database"
		classification.retryable = true
	case strings.Contains(message, "operation was canceled"):
		classification.class = "database_error"
		classification.source = "tenant_database"
		classification.retryable = true
	case dbErr != nil:
		classification.class = "database_error"
		classification.source = "tenant_database"
	}

	return classification
}

func tidbCloudInferenceStatus(err error) (int, bool) {
	match := tidbCloudInferenceStatusPattern.FindStringSubmatch(err.Error())
	if len(match) != 2 {
		return 0, false
	}
	status, parseErr := strconv.Atoi(match[1])
	if parseErr != nil {
		return 0, false
	}
	return status, true
}

func isTiFlashMemoryLimit(message string) bool {
	return strings.Contains(message, "memory limit") &&
		strings.Contains(message, "exceeded") &&
		(strings.Contains(message, "tiflash") || strings.Contains(message, "[flash:"))
}
