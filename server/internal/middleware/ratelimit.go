package middleware

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/time/rate"

	"github.com/qiffang/mnemos/server/internal/metrics"
)

type visitor struct {
	mu       sync.Mutex
	limiter  *rate.Limiter
	lastSeen time.Time
}

const rateLimitFingerprintKeyDomain = "mnemo/local-rate-limit-fingerprint/v1\x00"

// RateLimiter provides per-tenant rate limiting middleware.
// The rate-limit key is the tenantID extracted from the URL path parameter
// {tenantID} or the X-API-Key header on v1alpha2 routes. For routes without a
// tenant key (e.g. POST /v1alpha1/mem9s), the client IP is used as fallback.
type RateLimiter struct {
	mu             sync.Mutex
	visitors       map[string]*visitor
	limit          rate.Limit
	burst          int
	fingerprintKey []byte
	done           chan struct{}
}

// NewRateLimiter creates a limiter and derives a log-fingerprint key from secret.
func NewRateLimiter(rps float64, burst int, fingerprintSecret string) *RateLimiter {
	rl := &RateLimiter{
		visitors:       make(map[string]*visitor),
		limit:          rate.Limit(rps),
		burst:          burst,
		fingerprintKey: newRateLimitFingerprintKey(fingerprintSecret),
		done:           make(chan struct{}),
	}
	go rl.cleanup()
	return rl
}

// Stop terminates the cleanup goroutine.
func (rl *RateLimiter) Stop() {
	close(rl.done)
}

// Middleware returns the rate limiting HTTP middleware.
func (rl *RateLimiter) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip, _, _ := net.SplitHostPort(r.RemoteAddr)
			if ip == "" {
				ip = r.RemoteAddr
			}

			if allowed, retryDelay := allowRateLimit(rl.getLimiter(ip)); !allowed {
				rl.deny(w, r, "ip", "", retryDelay)
				return
			}

			key := chi.URLParam(r, "tenantID")
			if key == "" {
				key = r.Header.Get(APIKeyHeader)
			}
			if key != "" {
				if allowed, retryDelay := allowRateLimit(rl.getLimiter(key)); !allowed {
					rl.deny(w, r, "api_key", key, retryDelay)
					return
				}
			}

			next.ServeHTTP(w, r)
		})
	}
}

func allowRateLimit(visitor *visitor) (bool, time.Duration) {
	return allowRateLimitAt(visitor, time.Now())
}

func allowRateLimitAt(visitor *visitor, now time.Time) (bool, time.Duration) {
	visitor.mu.Lock()
	defer visitor.mu.Unlock()

	reservation := visitor.limiter.ReserveN(now, 1)
	if !reservation.OK() {
		return false, rate.InfDuration
	}
	retryDelay := reservation.DelayFrom(now)
	if retryDelay <= 0 {
		return true, 0
	}
	reservation.CancelAt(now)
	return false, retryDelay
}

func (rl *RateLimiter) deny(w http.ResponseWriter, r *http.Request, scope, apiKey string, retryDelay time.Duration) {
	retryAfter := retryAfterSeconds(retryDelay)
	w.Header().Set("Retry-After", retryAfter)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": "rate limit exceeded",
		"code":  "local_rate_limited",
	})

	attrs := []any{
		"scope", scope,
		"limit_rps", float64(rl.limit),
		"burst", rl.burst,
		"retry_after_ms", retryDelay.Milliseconds(),
	}
	if scope == "api_key" {
		attrs = append(attrs, "api_key_fingerprint", rl.apiKeyFingerprint(apiKey))
	}
	slog.WarnContext(r.Context(), "local rate limit denied", attrs...)
	metrics.LocalRateLimitDenialsTotal.WithLabelValues(scope).Inc()
}

func retryAfterSeconds(delay time.Duration) string {
	seconds := int64(math.Ceil(delay.Seconds()))
	if seconds < 1 {
		seconds = 1
	}
	return strconv.FormatInt(seconds, 10)
}

func newRateLimitFingerprintKey(secret string) []byte {
	if secret != "" {
		sum := sha256.Sum256([]byte(rateLimitFingerprintKeyDomain + secret))
		return sum[:]
	}
	key := make([]byte, sha256.Size)
	if _, err := rand.Read(key); err != nil {
		panic(fmt.Sprintf("generate rate-limit fingerprint key: %v", err))
	}
	return key
}

func (rl *RateLimiter) apiKeyFingerprint(apiKey string) string {
	mac := hmac.New(sha256.New, rl.fingerprintKey)
	_, _ = mac.Write([]byte(apiKey))
	return hex.EncodeToString(mac.Sum(nil)[:12])
}

func (rl *RateLimiter) getLimiter(key string) *visitor {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	v, ok := rl.visitors[key]
	if !ok {
		v = &visitor{limiter: rate.NewLimiter(rl.limit, rl.burst), lastSeen: time.Now()}
		rl.visitors[key] = v
		return v
	}
	v.lastSeen = time.Now()
	return v
}

// cleanup removes stale entries every 3 minutes until stopped.
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(3 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			rl.mu.Lock()
			for key, v := range rl.visitors {
				if time.Since(v.lastSeen) > 5*time.Minute {
					delete(rl.visitors, key)
				}
			}
			rl.mu.Unlock()
		case <-rl.done:
			return
		}
	}
}
