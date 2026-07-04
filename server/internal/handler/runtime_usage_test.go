package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qiffang/mnemos/server/internal/runtimeusage"
)

func TestNormalizeRuntimeQuotaErrorBodyCanonicalizesLegacyRecommendedAction(t *testing.T) {
	body := normalizeRuntimeQuotaErrorBody(http.StatusPaymentRequired, []byte(`{
			"code":"quota_exhausted",
			"message":"Included quota is exhausted.",
			"details":{
				"retryable":false,
				"meter":"memory_recall_requests",
				"limitType":"includedQuota",
				"recommendedAction":{
					"bindingState":"claimed",
					"type":"upgradePlan",
					"url":"https://example.com/provider/billing/plan"
				},
				"quotaGateResult":{
					"outcome":"blocked",
				"reason":"includedQuotaExhausted"
			}
		}
		}`))

	got := decodeRuntimeQuotaErrorBody(t, body)
	if got["code"] != "quota_exhausted" || got["message"] != "Included quota is exhausted." {
		t.Fatalf("unexpected envelope: %#v", got)
	}
	if _, ok := got["mem9_code"]; ok {
		t.Fatalf("mem9_code should live under details: %#v", got)
	}
	details := got["details"].(map[string]any)
	recommendedAction := details["recommendedAction"].(map[string]any)
	quotaGateResult := details["quotaGateResult"].(map[string]any)
	if details["meter"] != "memory_recall_requests" ||
		recommendedAction["type"] != "openUrl" ||
		recommendedAction["providerActionCode"] != "upgradePlan" ||
		recommendedAction["url"] != "https://example.com/provider/billing/plan" ||
		quotaGateResult["outcome"] != "blocked" ||
		quotaGateResult["reason"] != "includedQuotaExhausted" ||
		details["mem9Code"] != "runtime_quota_denied" {
		t.Fatalf("unexpected details: %#v", details)
	}
	for _, key := range []string{"upgradeAction", "bindingState", "upgradeUrl"} {
		if _, ok := details[key]; ok {
			t.Fatalf("legacy flat action field %q should be absent: %#v", key, details)
		}
	}
	if _, ok := recommendedAction["bindingState"]; ok {
		t.Fatalf("legacy bindingState should be absent from action: %#v", recommendedAction)
	}
}

func TestNormalizeRuntimeQuotaErrorBodyCanonicalizesLegacyFlatAction(t *testing.T) {
	body := normalizeRuntimeQuotaErrorBody(http.StatusPaymentRequired, []byte(`{
			"code":"spending_limit_exceeded",
			"message":"Spending limit reached.",
			"details":{
				"retryable":false,
				"meter":"memory_write_requests",
				"upgradeAction":"increaseSpendingLimit",
				"upgradeUrl":"https://example.com/provider/spending-limit"
			}
		}`))

	got := decodeRuntimeQuotaErrorBody(t, body)
	details := got["details"].(map[string]any)
	recommendedAction := details["recommendedAction"].(map[string]any)
	if recommendedAction["type"] != "openUrl" ||
		recommendedAction["providerActionCode"] != "increaseSpendingLimit" ||
		recommendedAction["url"] != "https://example.com/provider/spending-limit" {
		t.Fatalf("unexpected recommended action: %#v", recommendedAction)
	}
	for _, key := range []string{"upgradeAction", "upgradeUrl"} {
		if _, ok := details[key]; ok {
			t.Fatalf("legacy flat action field %q should be absent: %#v", key, details)
		}
	}
}

func TestNormalizeRuntimeQuotaErrorBodyDoesNotSynthesizeActionURL(t *testing.T) {
	body := normalizeRuntimeQuotaErrorBody(http.StatusPaymentRequired, []byte(`{
			"code":"runtime_access_blocked",
			"message":"Runtime access is blocked.",
			"details":{
				"recommendedAction":{
					"type":"claimApiKey"
				}
			}
		}`))

	got := decodeRuntimeQuotaErrorBody(t, body)
	details := got["details"].(map[string]any)
	recommendedAction := details["recommendedAction"].(map[string]any)
	if recommendedAction["type"] != "openUrl" || recommendedAction["providerActionCode"] != "claimApiKey" {
		t.Fatalf("unexpected recommended action: %#v", recommendedAction)
	}
	if _, ok := recommendedAction["url"]; ok {
		t.Fatalf("url should only be present when supplied: %#v", recommendedAction)
	}
}

func TestNormalizeRuntimeQuotaErrorBodyMovesLegacyMem9Code(t *testing.T) {
	body := normalizeRuntimeQuotaErrorBody(http.StatusPaymentRequired, []byte(`{
			"code":"quota_exhausted",
			"message":"Included quota is exhausted.",
			"retryable":false,
		"mem9_code":"runtime_quota_denied"
		}`))

	got := decodeRuntimeQuotaErrorBody(t, body)
	if _, ok := got["mem9_code"]; ok {
		t.Fatalf("mem9_code should live under details: %#v", got)
	}
	details := got["details"].(map[string]any)
	if details["retryable"] != false || details["mem9Code"] != "runtime_quota_denied" {
		t.Fatalf("unexpected details: %#v", details)
	}
}

func TestNormalizeRuntimeQuotaErrorBodyUsesFallbackByStatus(t *testing.T) {
	tests := []struct {
		name      string
		status    int
		body      []byte
		code      string
		message   string
		retryable bool
	}{
		{
			name:      "runtime access blocked",
			status:    http.StatusPaymentRequired,
			code:      "runtime_access_blocked",
			message:   "Runtime access is blocked.",
			retryable: false,
		},
		{
			name:      "post quota rate limited",
			status:    http.StatusTooManyRequests,
			body:      []byte("not-json"),
			code:      "post_quota_rate_limited",
			message:   "Post-quota rate limit exceeded.",
			retryable: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := normalizeRuntimeQuotaErrorBody(tt.status, tt.body)

			got := decodeRuntimeQuotaErrorBody(t, body)
			if got["code"] != tt.code || got["message"] != tt.message {
				t.Fatalf("unexpected fallback envelope: %#v", got)
			}
			details := got["details"].(map[string]any)
			if details["retryable"] != tt.retryable || details["mem9Code"] != "runtime_quota_denied" {
				t.Fatalf("unexpected fallback details: %#v", details)
			}
		})
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
	if got["code"] != "post_quota_rate_limited" || got["message"] != "Post-quota rate limit exceeded." {
		t.Fatalf("unexpected envelope: %#v", got)
	}
	details := got["details"].(map[string]any)
	if details["retryable"] != true ||
		details["mem9Code"] != "runtime_quota_denied" ||
		details["meter"] != "memory_recall_requests" {
		t.Fatalf("unexpected details: %#v", details)
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
