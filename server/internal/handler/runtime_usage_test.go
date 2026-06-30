package handler

import (
	"encoding/json"
	"testing"
)

func TestNormalizeRuntimeQuotaDeniedBodyPreservesConsoleDetails(t *testing.T) {
	body := normalizeRuntimeQuotaDeniedBody([]byte(`{
		"code":"quota_exhausted",
		"message":"Included quota is exhausted.",
		"details":{
			"retryable":false,
			"meter":"memory_recall_requests",
			"limitType":"includedQuota",
			"recommendedAction":{
				"bindingState":"claimed",
				"type":"upgradePlan",
				"url":"https://console.example.com/console/billing/plan"
			},
			"quotaGateResult":{
				"outcome":"blocked",
				"reason":"includedQuotaExhausted"
			}
		}
	}`))

	got := decodeRuntimeQuotaDeniedBody(t, body)
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
		recommendedAction["type"] != "upgradePlan" ||
		recommendedAction["bindingState"] != "claimed" ||
		recommendedAction["url"] != "https://console.example.com/console/billing/plan" ||
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
}

func TestNormalizeRuntimeQuotaDeniedBodyMovesLegacyMem9Code(t *testing.T) {
	body := normalizeRuntimeQuotaDeniedBody([]byte(`{
		"code":"quota_exhausted",
		"message":"Included quota is exhausted.",
		"retryable":false,
		"mem9_code":"runtime_quota_denied"
	}`))

	got := decodeRuntimeQuotaDeniedBody(t, body)
	if _, ok := got["mem9_code"]; ok {
		t.Fatalf("mem9_code should live under details: %#v", got)
	}
	details := got["details"].(map[string]any)
	if details["retryable"] != false || details["mem9Code"] != "runtime_quota_denied" {
		t.Fatalf("unexpected details: %#v", details)
	}
}

func TestNormalizeRuntimeQuotaDeniedBodyUsesFallback(t *testing.T) {
	body := normalizeRuntimeQuotaDeniedBody(nil)

	got := decodeRuntimeQuotaDeniedBody(t, body)
	if got["code"] != "runtime_quota_denied" || got["message"] != "runtime usage quota denied" {
		t.Fatalf("unexpected fallback envelope: %#v", got)
	}
	details := got["details"].(map[string]any)
	if details["retryable"] != false || details["mem9Code"] != "runtime_quota_denied" {
		t.Fatalf("unexpected fallback details: %#v", details)
	}
}

func decodeRuntimeQuotaDeniedBody(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	return got
}
