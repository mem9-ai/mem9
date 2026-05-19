package runtimeusage

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
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

func jsonResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}
