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
			"upgradeAction":"upgradePlan",
			"bindingState":"claimed",
			"upgradeUrl":"https://console.example.com/billing/plan",
			"mem9Code":"runtime_quota_denied"
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
	if details["meter"] != "memory_recall_requests" || details["upgradeAction"] != "upgradePlan" || details["bindingState"] != "claimed" || details["upgradeUrl"] != "https://console.example.com/billing/plan" || details["mem9Code"] != "runtime_quota_denied" {
		t.Fatalf("unexpected details: %#v", details)
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
