package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestRateLimiterUsesAPIKeyHeaderForV1Alpha2(t *testing.T) {
	rl := NewRateLimiter(1, 1)
	defer rl.Stop()

	router := chi.NewRouter()
	router.Use(rl.Middleware())
	router.Get("/v1alpha2/mem9s/memories", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	first := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	first.RemoteAddr = "10.0.0.1:1234"
	first.Header.Set(APIKeyHeader, "tenant-1")
	firstRR := httptest.NewRecorder()
	router.ServeHTTP(firstRR, first)
	if firstRR.Code != http.StatusNoContent {
		t.Fatalf("first status = %d, want %d", firstRR.Code, http.StatusNoContent)
	}

	second := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	second.RemoteAddr = "10.0.0.2:1234"
	second.Header.Set(APIKeyHeader, "tenant-1")
	secondRR := httptest.NewRecorder()
	router.ServeHTTP(secondRR, second)
	if secondRR.Code != http.StatusTooManyRequests {
		t.Fatalf("second status = %d, want %d", secondRR.Code, http.StatusTooManyRequests)
	}
}
