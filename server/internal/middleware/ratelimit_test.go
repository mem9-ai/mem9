package middleware

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	dto "github.com/prometheus/client_model/go"
	"golang.org/x/time/rate"

	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/reqid"
)

func TestRateLimiterDenialsAreActionable(t *testing.T) {
	previousLogger := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previousLogger) })

	tests := []struct {
		name            string
		firstIP         string
		secondIP        string
		apiKey          string
		wantScope       string
		wantFingerprint bool
	}{
		{
			name:      "client IP",
			firstIP:   "10.0.0.1:1234",
			secondIP:  "10.0.0.1:1234",
			wantScope: "ip",
		},
		{
			name:            "API key",
			firstIP:         "10.0.0.1:1234",
			secondIP:        "10.0.0.2:1234",
			apiKey:          "mem9_secret_customer_key",
			wantScope:       "api_key",
			wantFingerprint: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			metrics.LocalRateLimitDenialsTotal.Reset()
			var logBuf bytes.Buffer
			slog.SetDefault(slog.New(reqid.NewHandler(slog.NewJSONHandler(&logBuf, nil))))
			rl := NewRateLimiter(0.001, 1, "fingerprint-secret")
			defer rl.Stop()

			router := chi.NewRouter()
			router.Use(reqid.Middleware)
			router.Use(rl.Middleware())
			router.Get("/v1alpha2/mem9s/memories", func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})

			first := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
			first.RemoteAddr = tt.firstIP
			first.Header.Set(APIKeyHeader, tt.apiKey)
			firstRR := httptest.NewRecorder()
			router.ServeHTTP(firstRR, first)
			if firstRR.Code != http.StatusNoContent {
				t.Fatalf("first status = %d, want %d", firstRR.Code, http.StatusNoContent)
			}

			second := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
			second.RemoteAddr = tt.secondIP
			second.Header.Set(APIKeyHeader, tt.apiKey)
			secondRR := httptest.NewRecorder()
			router.ServeHTTP(secondRR, second)

			if secondRR.Code != http.StatusTooManyRequests {
				t.Fatalf("second status = %d, want %d", secondRR.Code, http.StatusTooManyRequests)
			}
			var response map[string]string
			if err := json.NewDecoder(secondRR.Body).Decode(&response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response["error"] != "rate limit exceeded" {
				t.Fatalf("error = %q, want existing message", response["error"])
			}
			if response["code"] != "local_rate_limited" {
				t.Fatalf("code = %q, want local_rate_limited", response["code"])
			}
			retryAfter, err := strconv.Atoi(secondRR.Header().Get("Retry-After"))
			if err != nil || retryAfter < 1 {
				t.Fatalf("Retry-After = %q, want positive integer", secondRR.Header().Get("Retry-After"))
			}

			var entry map[string]any
			if err := json.Unmarshal(bytes.TrimSpace(logBuf.Bytes()), &entry); err != nil {
				t.Fatalf("decode denial log: %v; log = %s", err, logBuf.String())
			}
			if entry["msg"] != "local rate limit denied" || entry["level"] != "WARN" {
				t.Fatalf("log = %#v, want warning denial summary", entry)
			}
			if entry["request_id"] != secondRR.Header().Get(reqid.Header) {
				t.Fatalf("request_id = %v, want response request ID %q", entry["request_id"], secondRR.Header().Get(reqid.Header))
			}
			if entry["scope"] != tt.wantScope || entry["limit_rps"] != 0.001 || entry["burst"] != float64(1) {
				t.Fatalf("limiter fields = scope:%v limit:%v burst:%v", entry["scope"], entry["limit_rps"], entry["burst"])
			}
			if retryMS, ok := entry["retry_after_ms"].(float64); !ok || retryMS < 1 {
				t.Fatalf("retry_after_ms = %#v, want positive duration", entry["retry_after_ms"])
			}
			fingerprint, hasFingerprint := entry["api_key_fingerprint"].(string)
			if hasFingerprint != tt.wantFingerprint {
				t.Fatalf("api_key_fingerprint present = %v, want %v", hasFingerprint, tt.wantFingerprint)
			}
			if tt.wantFingerprint && (fingerprint == "" || strings.Contains(logBuf.String(), tt.apiKey)) {
				t.Fatalf("API-key denial log exposed raw key or omitted fingerprint: %s", logBuf.String())
			}
			if got := localRateLimitDenialCount(t, tt.wantScope); got != 1 {
				t.Fatalf("local denial metric = %v, want 1", got)
			}
		})
	}
}

func TestRateLimiterAPIKeyFingerprintIsStableAndKeyed(t *testing.T) {
	first := NewRateLimiter(1, 1, "secret-a")
	defer first.Stop()
	second := NewRateLimiter(1, 1, "secret-b")
	defer second.Stop()

	fingerprint := first.apiKeyFingerprint("mem9_customer_key")
	if fingerprint != first.apiKeyFingerprint("mem9_customer_key") {
		t.Fatal("fingerprint changed for the same API key")
	}
	if fingerprint == second.apiKeyFingerprint("mem9_customer_key") {
		t.Fatal("fingerprint did not change with the HMAC key")
	}
	plain := sha256.Sum256([]byte("mem9_customer_key"))
	if fingerprint == hex.EncodeToString(plain[:12]) {
		t.Fatal("fingerprint equals the unkeyed SHA-256 digest")
	}
}

func TestAllowRateLimitConcurrentDenialsPreserveCapacity(t *testing.T) {
	const deniedRequests = 100
	now := time.Now()
	visitor := &visitor{limiter: rate.NewLimiter(10, 1)}
	if !visitor.limiter.AllowN(now, 1) {
		t.Fatal("initial request was denied")
	}

	start := make(chan struct{})
	results := make(chan bool, deniedRequests)
	var group sync.WaitGroup
	for range deniedRequests {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			allowed, _ := allowRateLimitAt(visitor, now)
			results <- allowed
		}()
	}
	close(start)
	group.Wait()
	close(results)

	for allowed := range results {
		if allowed {
			t.Fatal("concurrent request was unexpectedly allowed")
		}
	}
	if !visitor.limiter.AllowN(now.Add(101*time.Millisecond), 1) {
		t.Fatal("concurrent denials consumed future limiter capacity")
	}
}

func localRateLimitDenialCount(t *testing.T, scope string) float64 {
	t.Helper()
	counter, err := metrics.LocalRateLimitDenialsTotal.GetMetricWithLabelValues(scope)
	if err != nil {
		t.Fatalf("get local rate-limit metric: %v", err)
	}
	metric, ok := counter.(interface{ Write(*dto.Metric) error })
	if !ok {
		t.Fatal("local rate-limit metric does not implement Write")
	}
	var pb dto.Metric
	if err := metric.Write(&pb); err != nil {
		t.Fatalf("write local rate-limit metric: %v", err)
	}
	if pb.Counter == nil {
		return 0
	}
	return pb.Counter.GetValue()
}
