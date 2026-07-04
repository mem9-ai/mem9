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
	if got["error"] != "Included quota is exhausted." {
		t.Fatalf("unexpected envelope: %#v", got)
	}
	for _, key := range []string{"code", "message", "mem9_code"} {
		if _, ok := got[key]; ok {
			t.Fatalf("%q should not be exposed at the top level: %#v", key, got)
		}
	}
	runtimeQuota := runtimeQuotaDetails(t, got)
	recommendedAction := runtimeQuota["recommendedAction"].(map[string]any)
	quotaGateResult := runtimeQuota["quotaGateResult"].(map[string]any)
	if runtimeQuota["category"] != "runtime_quota_denied" ||
		runtimeQuota["meter"] != "memory_recall_requests" ||
		runtimeQuota["providerReason"] != "quota_exhausted" ||
		recommendedAction["type"] != "openUrl" ||
		recommendedAction["providerActionCode"] != "upgradePlan" ||
		recommendedAction["url"] != "https://example.com/provider/billing/plan" ||
		quotaGateResult["outcome"] != "blocked" ||
		quotaGateResult["reason"] != "includedQuotaExhausted" {
		t.Fatalf("unexpected runtime quota details: %#v", runtimeQuota)
	}
	for _, key := range []string{"upgradeAction", "bindingState", "upgradeUrl"} {
		if _, ok := runtimeQuota[key]; ok {
			t.Fatalf("legacy flat action field %q should be absent: %#v", key, runtimeQuota)
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
				"meter":"memory_write_requests",
				"upgradeAction":"increaseSpendingLimit",
				"upgradeUrl":"https://example.com/provider/spending-limit"
			}
		}`))

	got := decodeRuntimeQuotaErrorBody(t, body)
	runtimeQuota := runtimeQuotaDetails(t, got)
	recommendedAction := runtimeQuota["recommendedAction"].(map[string]any)
	if recommendedAction["type"] != "openUrl" ||
		recommendedAction["providerActionCode"] != "increaseSpendingLimit" ||
		recommendedAction["url"] != "https://example.com/provider/spending-limit" {
		t.Fatalf("unexpected recommended action: %#v", recommendedAction)
	}
	for _, key := range []string{"upgradeAction", "upgradeUrl"} {
		if _, ok := runtimeQuota[key]; ok {
			t.Fatalf("legacy flat action field %q should be absent: %#v", key, runtimeQuota)
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
	runtimeQuota := runtimeQuotaDetails(t, got)
	recommendedAction := runtimeQuota["recommendedAction"].(map[string]any)
	if recommendedAction["type"] != "openUrl" || recommendedAction["providerActionCode"] != "claimApiKey" {
		t.Fatalf("unexpected recommended action: %#v", recommendedAction)
	}
	if _, ok := recommendedAction["url"]; ok {
		t.Fatalf("url should only be present when supplied: %#v", recommendedAction)
	}
}

func TestNormalizeRuntimeQuotaErrorBodyDropsLegacyMem9Code(t *testing.T) {
	body := normalizeRuntimeQuotaErrorBody(http.StatusPaymentRequired, []byte(`{
			"code":"quota_exhausted",
			"message":"Included quota is exhausted.",
			"details":{
				"mem9Code":"runtime_quota_denied",
				"mem9_code":"runtime_quota_denied",
				"meter":"memory_recall_requests"
			},
		"mem9_code":"runtime_quota_denied"
		}`))

	got := decodeRuntimeQuotaErrorBody(t, body)
	if _, ok := got["mem9_code"]; ok {
		t.Fatalf("mem9_code should not be exposed at the top level: %#v", got)
	}
	runtimeQuota := runtimeQuotaDetails(t, got)
	if _, ok := runtimeQuota["mem9Code"]; ok {
		t.Fatalf("mem9Code should not be exposed in runtimeQuota: %#v", runtimeQuota)
	}
	if _, ok := runtimeQuota["mem9_code"]; ok {
		t.Fatalf("mem9_code should not be exposed in runtimeQuota: %#v", runtimeQuota)
	}
	if runtimeQuota["category"] != "runtime_quota_denied" ||
		runtimeQuota["providerReason"] != "quota_exhausted" ||
		runtimeQuota["meter"] != "memory_recall_requests" {
		t.Fatalf("unexpected runtime quota details: %#v", runtimeQuota)
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
			runtimeQuota := runtimeQuotaDetails(t, got)
			if runtimeQuota["category"] != "runtime_quota_denied" {
				t.Fatalf("fallback should include stable runtime quota category: %#v", runtimeQuota)
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
	if got["error"] != "Post-quota rate limit exceeded." {
		t.Fatalf("unexpected envelope: %#v", got)
	}
	runtimeQuota := runtimeQuotaDetails(t, got)
	if runtimeQuota["category"] != "runtime_quota_denied" ||
		runtimeQuota["providerReason"] != "post_quota_rate_limited" ||
		runtimeQuota["meter"] != "memory_recall_requests" {
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
	details, ok := body["details"].(map[string]any)
	if !ok {
		t.Fatalf("details missing from response: %#v", body)
	}
	runtimeQuota, ok := details["runtimeQuota"].(map[string]any)
	if !ok {
		t.Fatalf("details.runtimeQuota missing from response: %#v", body)
	}
	return runtimeQuota
}
