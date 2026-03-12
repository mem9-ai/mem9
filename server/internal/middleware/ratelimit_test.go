package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientIP(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		remoteAddr string
		headers    map[string]string
		want       string
	}{
		{
			name:       "uses forwarded for first valid ip",
			remoteAddr: "10.0.0.1:8080",
			headers: map[string]string{
				"X-Forwarded-For": "203.0.113.10, 10.0.0.1",
			},
			want: "203.0.113.10",
		},
		{
			name:       "falls back to real ip when forwarded for invalid",
			remoteAddr: "10.0.0.1:8080",
			headers: map[string]string{
				"X-Forwarded-For": "unknown",
				"X-Real-IP":       "198.51.100.7",
			},
			want: "198.51.100.7",
		},
		{
			name:       "falls back to remote addr host",
			remoteAddr: "192.0.2.44:9000",
			want:       "192.0.2.44",
		},
		{
			name:       "keeps remote addr when not hostport",
			remoteAddr: "192.0.2.55",
			want:       "192.0.2.55",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tt.remoteAddr
			for key, value := range tt.headers {
				req.Header.Set(key, value)
			}

			if got := clientIP(req); got != tt.want {
				t.Fatalf("clientIP() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestRateLimiterUsesForwardedIPBuckets(t *testing.T) {
	t.Parallel()

	rl := NewRateLimiter(0, 1)
	defer rl.Stop()

	handler := rl.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	makeRequest := func(forwardedFor string) int {
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		req.RemoteAddr = "10.0.0.1:8080"
		if forwardedFor != "" {
			req.Header.Set("X-Forwarded-For", forwardedFor)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}

	if got := makeRequest("203.0.113.10"); got != http.StatusOK {
		t.Fatalf("first forwarded request status = %d, want %d", got, http.StatusOK)
	}
	if got := makeRequest("198.51.100.7"); got != http.StatusOK {
		t.Fatalf("second forwarded request with different client ip status = %d, want %d", got, http.StatusOK)
	}
	if got := makeRequest("203.0.113.10"); got != http.StatusTooManyRequests {
		t.Fatalf("third forwarded request with repeated client ip status = %d, want %d", got, http.StatusTooManyRequests)
	}
}
