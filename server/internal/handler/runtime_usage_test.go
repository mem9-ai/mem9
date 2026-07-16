package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/reqid"
	"github.com/qiffang/mnemos/server/internal/runtimeusage"
)

func TestNormalizeRuntimeQuotaErrorBodyAssemblesPublicRuntimeQuotaFields(t *testing.T) {
	body := normalizeRuntimeQuotaErrorBody(http.StatusPaymentRequired, []byte(`{
		"code":"quota_exhausted",
		"error":"provider error should be ignored",
		"message":"Included quota is exhausted.",
		"details":{
			"meter":"memory_recall_requests",
			"retryable":false,
			"limitType":"includedQuota",
			"mem9Code":"runtime_quota_denied",
			"mem9_code":"runtime_quota_denied",
			"mem9Category":"runtime_quota_denied",
			"upgradeAction":"upgradePlan",
			"upgradeUrl":"https://example.com/provider/legacy-plan",
			"recommendedAction":{
				"bindingState":"claimed",
				"type":"openUrl",
				"providerActionCode":"upgradePlan",
				"severity":"blocking",
				"url":"https://example.com/provider/billing/plan"
			},
			"quotaGateResult":{
				"outcome":"blocked",
				"mode":"includedQuota",
				"reason":"includedQuotaExhausted",
				"providerExtension":"kept"
			}
		},
		"mem9_code":"runtime_quota_denied"
	}`))

	got := decodeRuntimeQuotaErrorBody(t, body)
	if got["error"] != "Included quota is exhausted." {
		t.Fatalf("unexpected envelope: %#v", got)
	}
	for _, key := range []string{"code", "message", "mem9_code"} {
		if _, ok := got[key]; ok {
			t.Fatalf("%q should not be exposed at the top level: %#v", key, got)
		}
	}
	if quotaErrorCategory(t, got) != "runtime_quota_denied" {
		t.Fatalf("details.errorCategory should include stable runtime quota category: %#v", got)
	}

	runtimeQuota := runtimeQuotaDetails(t, got)
	recommendedAction := runtimeQuota["recommendedAction"].(map[string]any)
	quotaGateResult := runtimeQuota["quotaGateResult"].(map[string]any)
	if runtimeQuota["meter"] != "memory_recall_requests" ||
		recommendedAction["type"] != "openUrl" ||
		recommendedAction["providerActionCode"] != "upgradePlan" ||
		recommendedAction["severity"] != "blocking" ||
		recommendedAction["url"] != "https://example.com/provider/billing/plan" ||
		quotaGateResult["outcome"] != "blocked" ||
		quotaGateResult["mode"] != "includedQuota" ||
		quotaGateResult["reason"] != "includedQuotaExhausted" ||
		quotaGateResult["providerExtension"] != "kept" {
		t.Fatalf("unexpected runtime quota details: %#v", runtimeQuota)
	}
	for _, key := range []string{"retryable", "limitType", "upgradeAction", "bindingState", "upgradeUrl", "mem9Code", "mem9_code", "mem9Category"} {
		if _, ok := runtimeQuota[key]; ok {
			t.Fatalf("non-public runtime quota field %q should be absent: %#v", key, runtimeQuota)
		}
	}
	if _, ok := recommendedAction["bindingState"]; ok {
		t.Fatalf("non-public action field should be absent: %#v", recommendedAction)
	}
}

func TestNormalizeRuntimeQuotaErrorBodyIgnoresNonContractActionShapes(t *testing.T) {
	body := normalizeRuntimeQuotaErrorBody(http.StatusPaymentRequired, []byte(`{
		"code":"runtime_access_blocked",
		"message":"Runtime access is blocked.",
		"details":{
			"meter":"memory_recall_requests",
			"recommendedAction":{
				"type":"claimApiKey",
				"url":"https://example.com/provider/claim"
			}
		}
	}`))

	got := decodeRuntimeQuotaErrorBody(t, body)
	runtimeQuota := runtimeQuotaDetails(t, got)
	if _, ok := runtimeQuota["recommendedAction"]; ok {
		t.Fatalf("non-contract recommendedAction should be absent: %#v", runtimeQuota)
	}
	if runtimeQuota["meter"] != "memory_recall_requests" {
		t.Fatalf("unexpected runtime quota details: %#v", runtimeQuota)
	}
}

func TestNormalizeRuntimeQuotaErrorBodyDoesNotSynthesizeActionURL(t *testing.T) {
	body := normalizeRuntimeQuotaErrorBody(http.StatusPaymentRequired, []byte(`{
		"code":"runtime_access_blocked",
		"message":"Runtime access is blocked.",
		"details":{
			"recommendedAction":{
				"type":"openUrl",
				"providerActionCode":"claimApiKey"
			}
		}
	}`))

	got := decodeRuntimeQuotaErrorBody(t, body)
	runtimeQuota := runtimeQuotaDetails(t, got)
	recommendedAction := runtimeQuota["recommendedAction"].(map[string]any)
	if recommendedAction["type"] != "openUrl" || recommendedAction["providerActionCode"] != "claimApiKey" {
		t.Fatalf("unexpected recommended action: %#v", recommendedAction)
	}
	if _, ok := recommendedAction["url"]; ok {
		t.Fatalf("url should only be present when supplied: %#v", recommendedAction)
	}
}

func TestNormalizeRuntimeQuotaErrorBodyUsesFallbackByStatus(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		body    []byte
		message string
	}{
		{
			name:    "runtime access blocked",
			status:  http.StatusPaymentRequired,
			message: "Runtime access is blocked.",
		},
		{
			name:    "post quota rate limited",
			status:  http.StatusTooManyRequests,
			body:    []byte("not-json"),
			message: "Post-quota rate limit exceeded.",
		},
		{
			name:    "json without contract fields",
			status:  http.StatusPaymentRequired,
			body:    []byte(`{"code":"runtime_access_blocked"}`),
			message: "Runtime access is blocked.",
		},
		{
			name:    "json without message",
			status:  http.StatusTooManyRequests,
			body:    []byte(`{"code":"post_quota_rate_limited"}`),
			message: "Post-quota rate limit exceeded.",
		},
		{
			name:    "json without details",
			status:  http.StatusPaymentRequired,
			body:    []byte(`{"code":"runtime_access_blocked","message":"Provider message should be ignored."}`),
			message: "Provider message should be ignored.",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := normalizeRuntimeQuotaErrorBody(tt.status, tt.body)

			got := decodeRuntimeQuotaErrorBody(t, body)
			if got["error"] != tt.message {
				t.Fatalf("unexpected fallback envelope: %#v", got)
			}
			for _, key := range []string{"code", "message"} {
				if _, ok := got[key]; ok {
					t.Fatalf("%q should not be exposed at the top level: %#v", key, got)
				}
			}
			if quotaErrorCategory(t, got) != "runtime_quota_denied" {
				t.Fatalf("fallback should include stable runtime quota error category: %#v", got)
			}
			details := quotaEnvelopeDetails(t, got)
			if _, ok := details["runtimeQuota"]; ok {
				t.Fatalf("fallback without contract details should not synthesize runtimeQuota: %#v", got)
			}
		})
	}
}

func TestNormalizeRuntimeQuotaErrorBodyUsesStatusMessageFallbackWithDetails(t *testing.T) {
	body := normalizeRuntimeQuotaErrorBody(http.StatusTooManyRequests, []byte(`{
		"code":"post_quota_rate_limited",
		"details":{
			"meter":"memory_recall_requests",
			"quotaGateResult":{
				"outcome":"rateLimited",
				"reason":"postQuotaRateLimitExceeded"
			}
		}
	}`))

	got := decodeRuntimeQuotaErrorBody(t, body)
	if got["error"] != "Post-quota rate limit exceeded." {
		t.Fatalf("unexpected fallback envelope: %#v", got)
	}
	if quotaErrorCategory(t, got) != "runtime_quota_denied" {
		t.Fatalf("fallback should include stable runtime quota error category: %#v", got)
	}
	runtimeQuota := runtimeQuotaDetails(t, got)
	if runtimeQuota["meter"] != "memory_recall_requests" {
		t.Fatalf("unexpected runtime quota details: %#v", runtimeQuota)
	}
}

func TestHandleRuntimeUsageErrorLogsStableClassification(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		err            error
		details        runtimeUsageErrorDetails
		wantStatus     int
		wantClass      string
		wantRetryable  bool
		wantStage      string
		wantClusterID  string
		wantMeter      string
		wantOperation  string
		wantMessage    string
		wantRetryAfter string
	}{
		{
			name: "quota rate limit during reserve",
			err: &runtimeusage.QuotaDeniedError{
				StatusCode: http.StatusTooManyRequests,
				RetryAfter: "20",
				Body: []byte(`{
					"code":"post_quota_rate_limited",
					"message":"Post-quota rate limit exceeded.",
					"details":{"meter":"memory_recall_requests"}
				}`),
			},
			details: runtimeUsageReserveErrorDetails(&domain.AuthInfo{
				ClusterID:     "cluster-reserve",
				APIKeySubject: "secret-api-key-subject",
			}, runtimeusage.MeterMemoryRecallRequests),
			wantStatus:     http.StatusTooManyRequests,
			wantClass:      "quota_denied",
			wantRetryable:  true,
			wantStage:      runtimeUsageStageReserve,
			wantClusterID:  "cluster-reserve",
			wantMeter:      runtimeusage.MeterMemoryRecallRequests,
			wantMessage:    "Post-quota rate limit exceeded.",
			wantRetryAfter: "20",
		},
		{
			name: "quota denied during reserve",
			err:  &runtimeusage.QuotaDeniedError{StatusCode: http.StatusPaymentRequired},
			details: runtimeUsageReserveErrorDetails(&domain.AuthInfo{
				ClusterID: "cluster-denied",
			}, runtimeusage.MeterMemoryWriteRequests),
			wantStatus:    http.StatusPaymentRequired,
			wantClass:     "quota_denied",
			wantRetryable: false,
			wantStage:     runtimeUsageStageReserve,
			wantClusterID: "cluster-denied",
			wantMeter:     runtimeusage.MeterMemoryWriteRequests,
			wantMessage:   "Runtime access is blocked.",
		},
		{
			name: "provider unavailable during finalize",
			err:  &runtimeusage.UnavailableError{Err: errors.New("provider timeout")},
			details: runtimeUsageFinalizeErrorDetails(&runtimeusage.OperationLease{
				OperationID: "operation-unavailable",
				Subject: runtimeusage.Subject{
					ClusterID:     "cluster-finalize",
					APIKeySubject: "secret-api-key-subject",
				},
				Meter: runtimeusage.MeterMemoryWriteRequests,
			}),
			wantStatus:    http.StatusServiceUnavailable,
			wantClass:     "unavailable",
			wantRetryable: true,
			wantStage:     runtimeUsageStageFinalize,
			wantClusterID: "cluster-finalize",
			wantMeter:     runtimeusage.MeterMemoryWriteRequests,
			wantOperation: "operation-unavailable",
			wantMessage:   "runtime usage unavailable",
		},
		{
			name: "operation conflict during finalize",
			err:  &runtimeusage.ConflictError{StatusCode: http.StatusConflict},
			details: runtimeUsageFinalizeErrorDetails(&runtimeusage.OperationLease{
				OperationID: "operation-conflict",
				Subject:     runtimeusage.Subject{ClusterID: "cluster-conflict"},
				Meter:       runtimeusage.MeterMemoryWriteRequests,
			}),
			wantStatus:    http.StatusBadGateway,
			wantClass:     "conflict",
			wantRetryable: true,
			wantStage:     runtimeUsageStageFinalize,
			wantClusterID: "cluster-conflict",
			wantMeter:     runtimeusage.MeterMemoryWriteRequests,
			wantOperation: "operation-conflict",
			wantMessage:   "runtime usage conflict",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var logBuf bytes.Buffer
			logger := slog.New(reqid.NewHandler(slog.NewJSONHandler(&logBuf, nil)))
			server := &Server{logger: logger}
			recorder := httptest.NewRecorder()
			ctx := reqid.NewContext(context.Background(), "request-runtime-usage")

			server.handleRuntimeUsageError(ctx, recorder, tt.err, tt.details)

			if recorder.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, tt.wantStatus)
			}
			if got := recorder.Header().Get("Retry-After"); got != tt.wantRetryAfter {
				t.Fatalf("Retry-After = %q, want %q", got, tt.wantRetryAfter)
			}
			body := decodeRuntimeQuotaErrorBody(t, recorder.Body.Bytes())
			if body["error"] != tt.wantMessage {
				t.Fatalf("response error = %v, want %q", body["error"], tt.wantMessage)
			}

			entry := decodeSingleRuntimeUsageLog(t, &logBuf)
			assertRuntimeUsageLogField(t, entry, "msg", "runtime usage request failed")
			assertRuntimeUsageLogField(t, entry, "request_id", "request-runtime-usage")
			assertRuntimeUsageLogField(t, entry, "error_class", tt.wantClass)
			assertRuntimeUsageLogField(t, entry, "error_source", "runtime_usage")
			assertRuntimeUsageLogField(t, entry, "error_role", runtimeUsageRoleClientResponse)
			assertRuntimeUsageLogField(t, entry, "stage", tt.wantStage)
			assertRuntimeUsageLogField(t, entry, "http_status", float64(tt.wantStatus))
			if _, ok := entry["mapped_status"]; ok {
				t.Fatalf("mapped_status = %v, want field omitted", entry["mapped_status"])
			}
			assertRuntimeUsageLogField(t, entry, "retryable", tt.wantRetryable)
			assertRuntimeUsageLogField(t, entry, "cluster_id", tt.wantClusterID)
			assertRuntimeUsageLogField(t, entry, "meter", tt.wantMeter)
			if tt.wantOperation == "" {
				if _, ok := entry["operation_id"]; ok {
					t.Fatalf("operation_id = %v, want field omitted", entry["operation_id"])
				}
			} else {
				assertRuntimeUsageLogField(t, entry, "operation_id", tt.wantOperation)
			}
			if bytes.Contains(logBuf.Bytes(), []byte("secret-api-key-subject")) {
				t.Fatal("API key subject leaked into runtime usage log")
			}
		})
	}
}

func TestLogRuntimeUsageBackgroundFinalizeError(t *testing.T) {
	t.Parallel()

	var logBuf bytes.Buffer
	logger := slog.New(reqid.NewHandler(slog.NewJSONHandler(&logBuf, nil)))
	server := &Server{logger: logger}
	ctx := reqid.NewContext(context.Background(), "request-background-finalize")
	details := runtimeUsageFinalizeErrorDetails(&runtimeusage.OperationLease{
		OperationID: "operation-background",
		Subject:     runtimeusage.Subject{ClusterID: "cluster-background"},
		Meter:       runtimeusage.MeterMemoryWriteRequests,
	})

	server.logRuntimeUsageBackgroundFinalizeError(ctx, &runtimeusage.UnavailableError{Err: errors.New("provider timeout")}, details)

	entry := decodeSingleRuntimeUsageLog(t, &logBuf)
	assertRuntimeUsageLogField(t, entry, "msg", "runtime usage background finalization failed")
	assertRuntimeUsageLogField(t, entry, "request_id", "request-background-finalize")
	assertRuntimeUsageLogField(t, entry, "error_class", "unavailable")
	assertRuntimeUsageLogField(t, entry, "error_source", "runtime_usage")
	assertRuntimeUsageLogField(t, entry, "error_role", runtimeUsageRoleBackground)
	assertRuntimeUsageLogField(t, entry, "stage", runtimeUsageStageFinalize)
	assertRuntimeUsageLogField(t, entry, "mapped_status", float64(http.StatusServiceUnavailable))
	assertRuntimeUsageLogField(t, entry, "retryable", true)
	assertRuntimeUsageLogField(t, entry, "cluster_id", "cluster-background")
	assertRuntimeUsageLogField(t, entry, "meter", runtimeusage.MeterMemoryWriteRequests)
	assertRuntimeUsageLogField(t, entry, "operation_id", "operation-background")
	if _, ok := entry["http_status"]; ok {
		t.Fatalf("http_status = %v, want field omitted", entry["http_status"])
	}
}

func TestRuntimeUsagePostRequestContextPreservesValuesAndBoundsLifetime(t *testing.T) {
	t.Parallel()

	parent, cancelParent := context.WithCancel(reqid.NewContext(context.Background(), "request-detached"))
	cancelParent()

	ctx, cancel := runtimeUsagePostRequestContext(parent)
	defer cancel()

	if err := ctx.Err(); err != nil {
		t.Fatalf("detached context error = %v, want nil", err)
	}
	if got := reqid.FromContext(ctx); got != "request-detached" {
		t.Fatalf("request_id = %q, want request-detached", got)
	}
	deadline, ok := ctx.Deadline()
	if !ok {
		t.Fatal("detached context deadline is missing")
	}
	remaining := time.Until(deadline)
	if remaining <= 0 || remaining > runtimeUsagePostRequestTimeout {
		t.Fatalf("detached context remaining timeout = %s", remaining)
	}
}

func decodeSingleRuntimeUsageLog(t *testing.T, buf *bytes.Buffer) map[string]any {
	t.Helper()
	lines := bytes.Split(bytes.TrimSpace(buf.Bytes()), []byte("\n"))
	if len(lines) != 1 {
		t.Fatalf("log entry count = %d, want 1: %s", len(lines), buf.String())
	}
	var entry map[string]any
	if err := json.Unmarshal(lines[0], &entry); err != nil {
		t.Fatalf("decode runtime usage log: %v", err)
	}
	return entry
}

func assertRuntimeUsageLogField(t *testing.T, entry map[string]any, field string, want any) {
	t.Helper()
	if got := entry[field]; got != want {
		t.Fatalf("%s = %v, want %v; log = %#v", field, got, want, entry)
	}
}

func decodeRuntimeQuotaErrorBody(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	return got
}

func runtimeQuotaDetails(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	details := quotaEnvelopeDetails(t, body)
	runtimeQuota, ok := details["runtimeQuota"].(map[string]any)
	if !ok {
		t.Fatalf("details.runtimeQuota missing from response: %#v", body)
	}
	return runtimeQuota
}

func quotaErrorCategory(t *testing.T, body map[string]any) string {
	t.Helper()
	details := quotaEnvelopeDetails(t, body)
	errorCategory, ok := details["errorCategory"].(string)
	if !ok {
		t.Fatalf("details.errorCategory missing from response: %#v", body)
	}
	return errorCategory
}

func quotaEnvelopeDetails(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	details, ok := body["details"].(map[string]any)
	if !ok {
		t.Fatalf("details missing from response: %#v", body)
	}
	return details
}
