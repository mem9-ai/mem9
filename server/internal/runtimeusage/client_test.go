package runtimeusage

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/reqid"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestHTTPClientReserveAllowsNullRemainingIncludedUnits(t *testing.T) {
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPut {
			t.Fatalf("method = %s, want PUT", req.Method)
		}
		if req.URL.Path != "/api/internal/quota/reservations/op-null" {
			t.Fatalf("path = %s", req.URL.Path)
		}
		if got := req.Header.Get("X-API-Key"); got != "api-key-subject" {
			t.Fatalf("X-API-Key = %q", got)
		}
		return jsonResponse(`{
			"operationId": "op-null",
			"meter": "memory_write_requests",
			"units": 1,
			"status": "reserved",
			"expiresAt": "2026-05-19T08:00:00Z",
			"remainingIncludedUnits": null,
			"reservedUnits": 1,
			"overageAllowed": true
		}`), nil
	})}

	reservation, err := client.Reserve(context.Background(), Subject{APIKeySubject: "api-key-subject"}, "op-null", Operation{
		Meter: MeterMemoryWriteRequests,
		Units: 1,
	})
	if err != nil {
		t.Fatalf("Reserve: %v", err)
	}
	if reservation.RemainingIncludedUnits != nil {
		t.Fatalf("RemainingIncludedUnits = %v, want nil", *reservation.RemainingIncludedUnits)
	}
}

func TestHTTPClientPropagatesRequestID(t *testing.T) {
	const requestID = "req_AAAAAAAAAAAAAAAAAAAAAA"
	tests := []struct {
		name     string
		response string
		call     func(context.Context, *HTTPClient) error
	}{
		{
			name: "reserve",
			response: `{
				"operationId": "op-request-id",
				"meter": "memory_write_requests",
				"units": 1,
				"status": "reserved",
				"expiresAt": "2026-05-19T08:00:00Z",
				"remainingIncludedUnits": 1,
				"reservedUnits": 1,
				"overageAllowed": false
			}`,
			call: func(ctx context.Context, client *HTTPClient) error {
				_, err := client.Reserve(ctx, Subject{APIKeySubject: "api-key-subject"}, "op-request-id", Operation{
					Meter: MeterMemoryWriteRequests,
					Units: 1,
				})
				return err
			},
		},
		{
			name:     "finalize",
			response: `{}`,
			call: func(ctx context.Context, client *HTTPClient) error {
				return client.FinalizeReservation(ctx, Subject{APIKeySubject: "api-key-subject"}, "op-request-id", ReservationStatusCommitted, reservationCommitReason)
			},
		},
		{
			name:     "runtime state",
			response: `{"mem9ApiKey":{"status":"active"},"meters":[]}`,
			call: func(ctx context.Context, client *HTTPClient) error {
				_, err := client.RuntimeState(ctx, Subject{APIKeySubject: "api-key-subject"})
				return err
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
			client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				if got := req.Header.Get("X-Request-Id"); got != requestID {
					t.Fatalf("X-Request-Id = %q, want %q", got, requestID)
				}
				return jsonResponse(tt.response), nil
			})}

			ctx := reqid.NewContext(context.Background(), requestID)
			if err := tt.call(ctx, client); err != nil {
				t.Fatalf("call: %v", err)
			}
		})
	}
}

func TestHTTPClientRuntimeStateCallsProviderStateEndpoint(t *testing.T) {
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodGet {
			t.Fatalf("method = %s, want GET", req.Method)
		}
		if req.URL.Path != "/api/internal/mem9-api-key/state" {
			t.Fatalf("path = %s", req.URL.Path)
		}
		if got := req.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("Authorization = %q, want bearer secret", got)
		}
		if got := req.Header.Get("X-API-Key"); got != "api-key-subject" {
			t.Fatalf("X-API-Key = %q", got)
		}
		if got := req.Header.Get("Content-Type"); got != "" {
			t.Fatalf("Content-Type = %q, want empty", got)
		}
		if req.Body != nil {
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("ReadAll body: %v", err)
			}
			if len(body) != 0 {
				t.Fatalf("body = %q, want empty", body)
			}
		}
		return jsonResponse(`{
			"mem9ApiKey": {"status": "active"},
			"meters": [{
				"meter": "memory_recall_requests",
				"quotaGateResult": {"outcome": "allowed", "mode": "includedQuota", "reason": "includedQuotaAvailable"},
				"budgets": [{
					"type": "includedQuota",
					"state": "ok",
					"measure": {"kind": "count", "quantity": "request", "scale": 1},
					"period": {"type": "calendarMonth", "startAt": "2026-07-01T00:00:00Z", "endAt": "2026-08-01T00:00:00Z"},
					"capacity": {"type": "limited", "value": 1000},
					"usage": {"used": 20, "remaining": 980, "percent": 2}
				}]
			}],
			"providerData": {"bindingState": "claimed"}
		}`), nil
	})}

	state, err := client.RuntimeState(context.Background(), Subject{APIKeySubject: "api-key-subject"})
	if err != nil {
		t.Fatalf("RuntimeState: %v", err)
	}
	if state.Mem9APIKey.Status != RuntimeAPIKeyStatusActive {
		t.Fatalf("status = %q, want active", state.Mem9APIKey.Status)
	}
	if !hasRuntimeStateMeter(state, MeterMemoryRecallRequests) {
		t.Fatalf("meters = %+v, want recall meter", state.Meters)
	}
	if !strings.Contains(string(state.ProviderData), "bindingState") || !strings.Contains(string(state.ProviderData), "claimed") {
		t.Fatalf("ProviderData = %s, want binding state", state.ProviderData)
	}
}

func TestHTTPClientRuntimeStateRejectsNonObjectProviderData(t *testing.T) {
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
	client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(`{
			"mem9ApiKey": {"status": "active"},
			"meters": [],
			"providerData": ["unexpected"]
		}`), nil
	})}

	_, err := client.RuntimeState(context.Background(), Subject{APIKeySubject: "api-key-subject"})
	var unavailable *UnavailableError
	if !errors.As(err, &unavailable) {
		t.Fatalf("RuntimeState error = %T, want UnavailableError", err)
	}
}

func TestHTTPClientReserveDecodesRemainingIncludedUnits(t *testing.T) {
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
	client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		body, err := json.Marshal(map[string]any{
			"operationId":            "op-remaining",
			"meter":                  "memory_recall_requests",
			"units":                  1,
			"status":                 "reserved",
			"expiresAt":              "2026-05-19T08:00:00Z",
			"remainingIncludedUnits": 42,
			"reservedUnits":          1,
			"overageAllowed":         false,
		})
		if err != nil {
			t.Fatalf("Marshal response: %v", err)
		}
		return jsonResponse(string(body)), nil
	})}

	reservation, err := client.Reserve(context.Background(), Subject{APIKeySubject: "api-key-subject"}, "op-remaining", Operation{
		Meter: MeterMemoryRecallRequests,
		Units: 1,
	})
	if err != nil {
		t.Fatalf("Reserve: %v", err)
	}
	if reservation.RemainingIncludedUnits == nil || *reservation.RemainingIncludedUnits != 42 {
		t.Fatalf("RemainingIncludedUnits = %v, want 42", reservation.RemainingIncludedUnits)
	}
}

func TestHTTPClientReserveClassifiesQuotaStatuses(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		body       string
		retryAfter string
	}{
		{
			name:   "payment required",
			status: http.StatusPaymentRequired,
			body:   `{"code":"provider_runtime_blocked","message":"Runtime access is blocked.","details":{"meter":"memory_recall_requests","quotaGateResult":{"outcome":"blocked","mode":"includedQuota","reason":"includedQuotaExhausted"}}}`,
		},
		{
			name:   "payment required legacy body",
			status: http.StatusPaymentRequired,
			body:   `{"error":"quota exhausted"}`,
		},
		{
			name:   "payment required empty body",
			status: http.StatusPaymentRequired,
			body:   ``,
		},
		{
			name:       "post quota rate limit",
			status:     http.StatusTooManyRequests,
			body:       `{"code":"provider_post_quota_throttled","message":"Post-quota rate limit exceeded.","details":{"meter":"memory_recall_requests","quotaGateResult":{"outcome":"rateLimited","mode":"postQuota","reason":"postQuotaRateLimitExceeded"}}}`,
			retryAfter: "20",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
			client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return statusJSONResponse(tt.status, tt.body, http.Header{"Retry-After": []string{tt.retryAfter}}), nil
			})}

			_, err := client.Reserve(context.Background(), Subject{APIKeySubject: "api-key-subject"}, "op-denied", Operation{
				Meter: MeterMemoryRecallRequests,
				Units: 1,
			})
			var denied *QuotaDeniedError
			if !errors.As(err, &denied) {
				t.Fatalf("Reserve error = %T, want QuotaDeniedError", err)
			}
			if denied.Status() != tt.status {
				t.Fatalf("Status() = %d, want %d", denied.Status(), tt.status)
			}
			if denied.RetryAfter != tt.retryAfter {
				t.Fatalf("RetryAfter = %q, want %q", denied.RetryAfter, tt.retryAfter)
			}
			if tt.body == "" {
				if !strings.Contains(string(denied.ResponseBody()), "Runtime access is blocked.") {
					t.Fatalf("ResponseBody() = %s, want fallback runtime access message", denied.ResponseBody())
				}
			} else if string(denied.ResponseBody()) != tt.body {
				t.Fatalf("ResponseBody() = %s, want %s", denied.ResponseBody(), tt.body)
			}
		})
	}
}

func TestHTTPClientReserveTreatsGenericRateLimitAsUnavailable(t *testing.T) {
	tests := []struct {
		name   string
		body   string
		header http.Header
	}{
		{
			name: "gateway rate limit",
			body: `{"error":"rate limited"}`,
		},
		{
			name: "empty body",
			body: ``,
		},
		{
			name: "invalid json",
			body: `{`,
		},
		{
			name:   "quota-like code without quota details",
			body:   `{"code":"post_quota_rate_limited","message":"rate limited","details":{"retryable":true}}`,
			header: http.Header{"Retry-After": []string{"20"}},
		},
		{
			name: "quota details without message",
			body: `{"code":"provider_post_quota_throttled","details":{"meter":"memory_recall_requests","quotaGateResult":{"outcome":"rateLimited","reason":"postQuotaRateLimitExceeded"}}}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
			client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return statusJSONResponse(http.StatusTooManyRequests, tt.body, tt.header), nil
			})}

			_, err := client.Reserve(context.Background(), Subject{APIKeySubject: "api-key-subject"}, "op-rate-limited", Operation{
				Meter: MeterMemoryRecallRequests,
				Units: 1,
			})
			var denied *QuotaDeniedError
			if errors.As(err, &denied) {
				t.Fatalf("Reserve error = %T, want non-quota unavailable failure", err)
			}
			var unavailable *UnavailableError
			if !errors.As(err, &unavailable) {
				t.Fatalf("Reserve error = %T, want UnavailableError", err)
			}
		})
	}
}

func TestHTTPClientFinalizeReservationTreatsRateLimitAsUnavailable(t *testing.T) {
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPatch {
			t.Fatalf("method = %s, want PATCH", req.Method)
		}
		if req.URL.Path != "/api/internal/quota/reservations/op-finalize" {
			t.Fatalf("path = %s", req.URL.Path)
		}
		return statusJSONResponse(http.StatusTooManyRequests, `{"error":"rate limited"}`, http.Header{"Retry-After": []string{"20"}}), nil
	})}

	err := client.FinalizeReservation(context.Background(), Subject{APIKeySubject: "api-key-subject"}, "op-finalize", ReservationStatusCommitted, reservationCommitReason)
	var denied *QuotaDeniedError
	if errors.As(err, &denied) {
		t.Fatalf("FinalizeReservation error = %T, want non-quota finalization failure", err)
	}
	var unavailable *UnavailableError
	if !errors.As(err, &unavailable) {
		t.Fatalf("FinalizeReservation error = %T, want UnavailableError", err)
	}
}

func jsonResponse(body string) *http.Response {
	return statusJSONResponse(http.StatusOK, body, http.Header{"Content-Type": []string{"application/json"}})
}

func statusJSONResponse(status int, body string, header http.Header) *http.Response {
	if header == nil {
		header = make(http.Header)
	}
	if header.Get("Content-Type") == "" {
		header.Set("Content-Type", "application/json")
	}
	return &http.Response{
		StatusCode: status,
		Header:     header,
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func hasRuntimeStateMeter(state RuntimeState, meter string) bool {
	for _, item := range state.Meters {
		if item.Meter == meter {
			return true
		}
	}
	return false
}
