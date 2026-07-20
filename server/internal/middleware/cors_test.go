package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/reqid"
)

func TestCORS_AllowsPreflightBeforeNext(t *testing.T) {
	called := false
	handler := CORS([]string{"https://mem9.ai", "http://localhost:4321"})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))

	req := httptest.NewRequest(http.MethodOptions, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set("Origin", "http://localhost:4321")
	req.Header.Set("Access-Control-Request-Method", "GET")
	req.Header.Set("Access-Control-Request-Headers", "X-API-Key, "+reqid.Header)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if called {
		t.Fatal("next handler must not run for allowed preflight")
	}
	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNoContent)
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:4321" {
		t.Fatalf("allow origin = %q", got)
	}
	if got := rr.Header().Get("Access-Control-Allow-Headers"); got == "" {
		t.Fatal("allow headers missing")
	}
	if got := rr.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(got, "If-Match") {
		t.Fatalf("allow headers = %q, want If-Match", got)
	}
	if got := rr.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(got, reqid.Header) {
		t.Fatalf("allow headers = %q, want %s", got, reqid.Header)
	}
}

func TestCORS_RejectsDisallowedPreflight(t *testing.T) {
	handler := CORS([]string{"https://mem9.ai"})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("next handler must not run for rejected preflight")
	}))

	req := httptest.NewRequest(http.MethodOptions, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set("Origin", "https://evil.example")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusForbidden)
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("disallowed origin should not be echoed, got %q", got)
	}
}

func TestCORS_AddsHeadersForAllowedRequest(t *testing.T) {
	handler := CORS([]string{"https://mem9.ai"})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "https://mem9.ai")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "https://mem9.ai" {
		t.Fatalf("allow origin = %q", got)
	}
	if got := rr.Header().Get("Access-Control-Expose-Headers"); !strings.Contains(got, reqid.Header) {
		t.Fatalf("expose headers = %q, want %s", got, reqid.Header)
	}
}
