package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

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

func TestHandleRuntimeUsageErrorReturnsPostQuotaRateLimit(t *testing.T) {
	recorder := httptest.NewRecorder()
	server := &Server{}
	server.handleRuntimeUsageError(recorder, &runtimeusage.QuotaDeniedError{
		StatusCode: http.StatusTooManyRequests,
		RetryAfter: "20",
		Body: []byte(`{
			"code":"post_quota_rate_limited",
			"message":"Post-quota rate limit exceeded.",
			"details":{
				"meter":"memory_recall_requests"
			}
		}`),
	})

	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", recorder.Code)
	}
	if got := recorder.Header().Get("Retry-After"); got != "20" {
		t.Fatalf("Retry-After = %q, want 20", got)
	}
	got := decodeRuntimeQuotaErrorBody(t, recorder.Body.Bytes())
	if got["error"] != "Post-quota rate limit exceeded." {
		t.Fatalf("unexpected envelope: %#v", got)
	}
	if quotaErrorCategory(t, got) != "runtime_quota_denied" {
		t.Fatalf("details.errorCategory should include stable runtime quota category: %#v", got)
	}
	runtimeQuota := runtimeQuotaDetails(t, got)
	if runtimeQuota["meter"] != "memory_recall_requests" {
		t.Fatalf("unexpected runtime quota details: %#v", runtimeQuota)
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
