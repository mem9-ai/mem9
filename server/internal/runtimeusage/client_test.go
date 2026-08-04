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

type reservationContractCase struct {
	name       string
	code       reservationErrorCode
	status     int
	retryAfter string
}

var reservationContractCases = []reservationContractCase{
	{name: "registry conflict", code: reservationErrorCodeRegistryConflict, status: http.StatusConflict},
	{name: "operation in progress", code: reservationErrorCodeOperationInProgress, status: http.StatusTooManyRequests, retryAfter: "1"},
	{name: "registry busy", code: reservationErrorCodeRegistryBusy, status: http.StatusTooManyRequests, retryAfter: "1"},
	{name: "concurrency limited", code: reservationErrorCodeConcurrencyLimited, status: http.StatusTooManyRequests, retryAfter: "1"},
	{name: "unavailable", code: reservationErrorCodeUnavailable, status: http.StatusServiceUnavailable},
	{name: "operation conflict", code: reservationErrorCodeOperationConflict, status: http.StatusConflict},
}

const postQuotaRateLimitBody = `{"code":"provider_post_quota_throttled","message":"Post-quota rate limit exceeded.","details":{"meter":"memory_recall_requests","quotaGateResult":{"outcome":"rateLimited","mode":"postQuota","reason":"postQuotaRateLimitExceeded"}}}`
const overlappingReservationQuotaBody = `{"code":"registry_busy","message":"Post-quota rate limit exceeded.","details":{"retryable":true,"meter":"memory_recall_requests","quotaGateResult":{"outcome":"rateLimited","mode":"postQuota","reason":"postQuotaRateLimitExceeded"}}}`

func oversizedResponseWithPrefix(prefix string) string {
	return prefix + strings.Repeat(" ", maxResponseBodyBytes+1-len(prefix))
}

type responseBodyCase struct {
	name string
	body func() io.ReadCloser
}

func successfulFinalizeBodyFailureCases() []responseBodyCase {
	return []responseBodyCase{
		{
			name: "read failure",
			body: func() io.ReadCloser {
				return failingReadCloser{err: errors.New("finalize response read sentinel")}
			},
		},
		{
			name: "oversized body",
			body: func() io.ReadCloser {
				return io.NopCloser(strings.NewReader(strings.Repeat("x", maxResponseBodyBytes+1)))
			},
		},
	}
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
		{
			name:       "quota shape takes precedence over reservation code",
			status:     http.StatusTooManyRequests,
			body:       overlappingReservationQuotaBody,
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

func TestHTTPClientReserveMapsGenericRateLimitToPublicRateLimit(t *testing.T) {
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
			if got := HTTPStatus(err); got != http.StatusTooManyRequests {
				t.Fatalf("HTTPStatus = %d, want %d", got, http.StatusTooManyRequests)
			}
		})
	}
}

func TestHTTPClientReserveClassifiesStructuredReservationErrors(t *testing.T) {
	for _, tt := range reservationContractCases {
		t.Run(tt.name, func(t *testing.T) {
			body := `{"code":"` + string(tt.code) + `","details":{"retryable":true}}`
			err := reserveErrorForTest(t, tt.status, body, tt.retryAfter)
			var reservationErr *reservationError
			if !errors.As(err, &reservationErr) {
				t.Fatalf("Reserve error = %T, want ReservationError", err)
			}
			if reservationErr.code != tt.code {
				t.Fatalf("Code = %q, want %q", reservationErr.code, tt.code)
			}
			wantRetryable := tt.code != reservationErrorCodeOperationConflict
			if reservationErr.retryable != wantRetryable {
				t.Fatalf("Retryable = %v, want %v", reservationErr.retryable, wantRetryable)
			}
			wantRetryAfter := time.Duration(0)
			if tt.status == http.StatusTooManyRequests {
				wantRetryAfter = time.Second
			}
			if reservationErr.retryAfter != wantRetryAfter {
				t.Fatalf("RetryAfter = %v, want %v", reservationErr.retryAfter, wantRetryAfter)
			}
			var conflict *ConflictError
			wantConflict := tt.code == reservationErrorCodeOperationConflict
			if got := errors.As(err, &conflict); got != wantConflict {
				t.Fatalf("ConflictError classification = %v, want %v", got, wantConflict)
			}
			wantStatus := http.StatusServiceUnavailable
			if tt.status == http.StatusTooManyRequests {
				wantStatus = http.StatusTooManyRequests
			}
			if got := HTTPStatus(err); got != wantStatus {
				t.Fatalf("HTTPStatus = %d, want %d", got, wantStatus)
			}
		})
	}
}

func TestHTTPClientReserveRetryableRateLimitsRequirePositiveRetryAfter(t *testing.T) {
	tests := []struct {
		name           string
		retryAfter     string
		wantStructured bool
		wantRetryAfter time.Duration
	}{
		{name: "missing"},
		{name: "malformed", retryAfter: "soon"},
		{name: "signed positive", retryAfter: "+2"},
		{name: "negative", retryAfter: "-2"},
		{name: "zero", retryAfter: "0"},
		{name: "duration overflow", retryAfter: "9223372037"},
		{name: "integer overflow", retryAfter: "18446744073709551616"},
		{name: "positive integer seconds", retryAfter: "2", wantStructured: true, wantRetryAfter: 2 * time.Second},
	}

	for _, code := range []reservationErrorCode{
		reservationErrorCodeOperationInProgress,
		reservationErrorCodeRegistryBusy,
		reservationErrorCodeConcurrencyLimited,
	} {
		for _, tt := range tests {
			t.Run(string(code)+"/"+tt.name, func(t *testing.T) {
				client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
				client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
					return statusJSONResponse(
						http.StatusTooManyRequests,
						`{"code":"`+string(code)+`","message":"admission is busy","details":{"retryable":true}}`,
						http.Header{"Retry-After": []string{tt.retryAfter}},
					), nil
				})}

				_, err := client.Reserve(context.Background(), Subject{APIKeySubject: "api-key-subject"}, "op-concurrency", Operation{
					Meter: MeterMemoryRecallRequests,
					Units: 1,
				})
				var reservationErr *reservationError
				if got := errors.As(err, &reservationErr); got != tt.wantStructured {
					t.Fatalf("structured reservation classification = %v, want %v", got, tt.wantStructured)
				}
				if !tt.wantStructured {
					assertReservationFallbackForStatus(t, err, http.StatusTooManyRequests)
					return
				}
				if reservationErr.retryAfter != tt.wantRetryAfter {
					t.Fatalf("RetryAfter = %v, want %v", reservationErr.retryAfter, tt.wantRetryAfter)
				}
			})
		}
	}
}

func TestHTTPClientReserveKeepsPermanentStatusesOutsideRetryAllowlist(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{name: "invalid request", status: http.StatusBadRequest, body: `{"code":"invalid_request","message":"invalid","details":{"retryable":false}}`},
		{name: "unauthenticated", status: http.StatusUnauthorized, body: `{"code":"unauthenticated","message":"authenticate","details":{"retryable":false}}`},
		{name: "forbidden", status: http.StatusForbidden, body: `{"code":"forbidden","message":"forbidden","details":{"retryable":false}}`},
		{name: "unavailable code on unaccepted status", status: http.StatusInternalServerError, body: `{"code":"unavailable","message":"try again","details":{"retryable":true}}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
			client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return statusJSONResponse(tt.status, tt.body, nil), nil
			})}

			_, err := client.Reserve(context.Background(), Subject{APIKeySubject: "api-key-subject"}, "op-terminal", Operation{
				Meter: MeterMemoryRecallRequests,
				Units: 1,
			})
			var reservationErr *reservationError
			if errors.As(err, &reservationErr) {
				t.Fatalf("Reserve error = %+v, want terminal unavailable classification", reservationErr)
			}
			var unavailable *UnavailableError
			if !errors.As(err, &unavailable) {
				t.Fatalf("Reserve error = %T, want UnavailableError", err)
			}
		})
	}
}

func TestHTTPClientReserveRequiresExactReservationRetryContract(t *testing.T) {
	details := []struct {
		name          string
		json          string
		decodable     bool
		wantRetryable bool
	}{
		{name: "true", json: `"details":{"retryable":true}`, decodable: true, wantRetryable: true},
		{name: "false", json: `"details":{"retryable":false}`, decodable: true},
		{name: "missing", decodable: true},
		{name: "non boolean", json: `"details":{"retryable":"true"}`},
	}

	for _, code := range reservationContractCases {
		for _, detail := range details {
			t.Run(code.name+"/"+detail.name, func(t *testing.T) {
				body := `{"code":"` + string(code.code) + `"`
				if detail.json != "" {
					body += "," + detail.json
				}
				body += "}"
				err := reserveErrorForTest(t, code.status, body, code.retryAfter)
				var reservationErr *reservationError
				wantStructured := detail.decodable && (detail.wantRetryable || code.code == reservationErrorCodeOperationConflict)
				if got := errors.As(err, &reservationErr); got != wantStructured {
					t.Fatalf("structured reservation classification = %v, want %v", got, wantStructured)
				}
				if !wantStructured {
					assertReservationFallbackForStatus(t, err, code.status)
					return
				}
				wantRetryable := detail.wantRetryable && code.code != reservationErrorCodeOperationConflict
				if reservationErr.retryable != wantRetryable {
					t.Fatalf("Retryable = %v, want %v", reservationErr.retryable, wantRetryable)
				}
			})
		}
	}
}

func TestHTTPClientReserveUsesOnlyExactKnownStatusCodePairs(t *testing.T) {
	statuses := []int{
		http.StatusConflict,
		http.StatusTooManyRequests,
		http.StatusServiceUnavailable,
	}

	for _, contract := range reservationContractCases {
		for _, status := range statuses {
			t.Run(contract.name+"/"+http.StatusText(status), func(t *testing.T) {
				body := `{"code":"` + string(contract.code) + `","details":{"retryable":true}}`
				err := reserveErrorForTest(t, status, body, "1")
				var reservationErr *reservationError
				if status == contract.status {
					if !errors.As(err, &reservationErr) {
						t.Fatal("exact status/code pair missed structured reservation classification")
					}
					if reservationErr.code != contract.code {
						t.Fatal("exact status/code pair produced the wrong structured classification")
					}
					return
				}
				if errors.As(err, &reservationErr) {
					t.Fatal("status/code mismatch received structured reservation classification")
				}
				assertReservationFallbackForStatus(t, err, status)
			})
		}
	}

	t.Run("unknown code on conflict", func(t *testing.T) {
		err := reserveErrorForTest(
			t,
			http.StatusConflict,
			`{"code":"future_retryable","details":{"retryable":true}}`,
			"",
		)
		var reservationErr *reservationError
		if errors.As(err, &reservationErr) {
			t.Fatal("unknown code received structured reservation classification")
		}
		assertReservationFallbackForStatus(t, err, http.StatusConflict)
	})
}

func assertReservationFallbackForStatus(t *testing.T, err error, status int) {
	t.Helper()
	if status == http.StatusConflict {
		var conflict *ConflictError
		if !errors.As(err, &conflict) || HTTPStatus(err) != http.StatusServiceUnavailable {
			t.Fatal("generic 409 did not map to a public service-unavailable response")
		}
		return
	}
	var unavailable *UnavailableError
	wantStatus := http.StatusServiceUnavailable
	if status == http.StatusTooManyRequests {
		wantStatus = http.StatusTooManyRequests
	}
	if !errors.As(err, &unavailable) || HTTPStatus(err) != wantStatus {
		t.Fatal("generic non-conflict response did not preserve unavailable fallback")
	}
}

func TestHTTPClientReserveBoundsAndRedactsResponseFailures(t *testing.T) {
	t.Run("read failure", func(t *testing.T) {
		readErr := errors.New("response read sentinel")
		client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
		client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusServiceUnavailable,
				Header:     make(http.Header),
				Body:       failingReadCloser{err: readErr},
			}, nil
		})}
		_, err := client.Reserve(context.Background(), Subject{APIKeySubject: "test-subject"}, "test-operation", Operation{Meter: MeterMemoryRecallRequests, Units: 1})
		var unavailable *UnavailableError
		if !errors.As(err, &unavailable) {
			t.Fatalf("Reserve error = %T, want UnavailableError", err)
		}
		if !errors.Is(err, readErr) {
			t.Fatal("Reserve error did not preserve the response read failure")
		}
	})

	t.Run("quota denial survives read failure", func(t *testing.T) {
		client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
		client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusPaymentRequired,
				Header:     make(http.Header),
				Body:       failingReadCloser{err: errors.New("quota response read failed")},
			}, nil
		})}
		_, err := client.Reserve(context.Background(), Subject{APIKeySubject: "test-subject"}, "test-operation", Operation{Meter: MeterMemoryRecallRequests, Units: 1})
		var denied *QuotaDeniedError
		if !errors.As(err, &denied) || denied.Status() != http.StatusPaymentRequired {
			t.Fatalf("Reserve error = %T, want status-based quota denial", err)
		}
	})

	t.Run("conflict survives read failure", func(t *testing.T) {
		client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
		client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusConflict,
				Header:     make(http.Header),
				Body:       failingReadCloser{err: errors.New("conflict response read failed")},
			}, nil
		})}
		_, err := client.Reserve(context.Background(), Subject{APIKeySubject: "test-subject"}, "test-operation", Operation{Meter: MeterMemoryRecallRequests, Units: 1})
		var conflict *ConflictError
		if !errors.As(err, &conflict) {
			t.Fatalf("Reserve error = %T, want status-based conflict", err)
		}
	})

	const structuredBody = `{"code":"unavailable","details":{"retryable":true}}`
	for _, tt := range []struct {
		name           string
		size           int
		wantStructured bool
	}{
		{name: "response at limit", size: maxResponseBodyBytes, wantStructured: true},
		{name: "response above limit", size: maxResponseBodyBytes + 1},
	} {
		t.Run(tt.name, func(t *testing.T) {
			body := structuredBody + strings.Repeat(" ", tt.size-len(structuredBody))
			err := reserveErrorForTest(t, http.StatusServiceUnavailable, body, "")
			var reservationErr *reservationError
			if got := errors.As(err, &reservationErr); got != tt.wantStructured {
				t.Fatalf("structured reservation classification = %v, want %v", got, tt.wantStructured)
			}
			if !tt.wantStructured {
				var unavailable *UnavailableError
				if !errors.As(err, &unavailable) {
					t.Fatalf("Reserve error = %T, want UnavailableError", err)
				}
			}
		})
	}

	t.Run("oversized quota denial preserves status classification", func(t *testing.T) {
		err := reserveErrorForTest(t, http.StatusPaymentRequired, strings.Repeat("x", maxResponseBodyBytes+1), "")
		var denied *QuotaDeniedError
		if !errors.As(err, &denied) || denied.Status() != http.StatusPaymentRequired {
			t.Fatalf("Reserve error = %T, want status-based quota denial", err)
		}
		if len(denied.Body) != 0 {
			t.Fatal("oversized quota denial retained response body bytes")
		}
	})

	t.Run("oversized post quota denial preserves quota classification", func(t *testing.T) {
		body := oversizedResponseWithPrefix(postQuotaRateLimitBody)
		err := reserveErrorForTest(t, http.StatusTooManyRequests, body, "20")
		var denied *QuotaDeniedError
		if !errors.As(err, &denied) || denied.Status() != http.StatusTooManyRequests {
			t.Fatalf("Reserve error = %T, want status-based post-quota denial", err)
		}
		if denied.RetryAfter != "20" {
			t.Fatalf("RetryAfter = %q, want 20", denied.RetryAfter)
		}
		if len(denied.Body) != 0 {
			t.Fatal("oversized post-quota denial retained response body bytes")
		}
	})

	for _, tt := range []struct {
		name string
		body string
	}{
		{name: "oversized generic rate limit", body: `{"error":"rate limited"}`},
		{name: "oversized concurrency limit", body: `{"code":"reservation_concurrency_limited","details":{"retryable":true}}`},
	} {
		t.Run(tt.name+" stays unavailable", func(t *testing.T) {
			err := reserveErrorForTest(t, http.StatusTooManyRequests, oversizedResponseWithPrefix(tt.body), "1")
			var denied *QuotaDeniedError
			if errors.As(err, &denied) {
				t.Fatalf("Reserve error = %T, want non-quota unavailable failure", err)
			}
			var reservationErr *reservationError
			if errors.As(err, &reservationErr) {
				t.Fatalf("Reserve error = %T, want no structured retry classification", err)
			}
			var unavailable *UnavailableError
			if !errors.As(err, &unavailable) {
				t.Fatalf("Reserve error = %T, want UnavailableError", err)
			}
		})
	}

	t.Run("oversized conflict preserves status classification", func(t *testing.T) {
		err := reserveErrorForTest(t, http.StatusConflict, strings.Repeat("x", maxResponseBodyBytes+1), "")
		var conflict *ConflictError
		if !errors.As(err, &conflict) {
			t.Fatalf("Reserve error = %T, want status-based conflict", err)
		}
		if len(conflict.Body) != 0 {
			t.Fatal("oversized conflict retained response body bytes")
		}
	})

	t.Run("structured response body is discarded", func(t *testing.T) {
		const sensitiveMarker = "sensitive-provider-message"
		err := reserveErrorForTest(
			t,
			http.StatusServiceUnavailable,
			`{"code":"unavailable","message":"`+sensitiveMarker+`","details":{"retryable":true}}`,
			"",
		)
		if strings.Contains(err.Error(), sensitiveMarker) {
			t.Fatal("structured reservation error retained provider response text")
		}
	})
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

func TestHTTPClientFinalizeReservationIgnoresSuccessfulResponseBodies(t *testing.T) {
	for _, tt := range successfulFinalizeBodyFailureCases() {
		t.Run(tt.name, func(t *testing.T) {
			client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
			client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     make(http.Header),
					Body:       tt.body(),
				}, nil
			})}

			if err := client.FinalizeReservation(context.Background(), Subject{APIKeySubject: "test-subject"}, "test-operation", ReservationStatusCommitted, reservationCommitReason); err != nil {
				t.Fatalf("FinalizeReservation: %v", err)
			}
		})
	}
}

func TestHTTPClientFinalizeReservationPreservesOversizedConflict(t *testing.T) {
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
	client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return statusJSONResponse(http.StatusConflict, strings.Repeat("x", maxResponseBodyBytes+1), nil), nil
	})}

	err := client.FinalizeReservation(context.Background(), Subject{APIKeySubject: "test-subject"}, "test-operation", ReservationStatusCommitted, reservationCommitReason)
	var conflict *ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("FinalizeReservation error = %T, want status-based conflict", err)
	}
	if len(conflict.Body) != 0 {
		t.Fatal("oversized finalization conflict retained response body bytes")
	}
}

type failingReadCloser struct {
	err error
}

func (r failingReadCloser) Read([]byte) (int, error) {
	return 0, r.err
}

func (failingReadCloser) Close() error { return nil }

func reserveErrorForTest(t *testing.T, status int, body, retryAfter string) error {
	t.Helper()
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
	client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		header := make(http.Header)
		if retryAfter != "" {
			header.Set("Retry-After", retryAfter)
		}
		return statusJSONResponse(status, body, header), nil
	})}
	_, err := client.Reserve(context.Background(), Subject{APIKeySubject: "test-subject"}, "test-operation", Operation{
		Meter: MeterMemoryRecallRequests,
		Units: 1,
	})
	if err == nil {
		t.Fatal("Reserve error = nil")
	}
	return err
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
