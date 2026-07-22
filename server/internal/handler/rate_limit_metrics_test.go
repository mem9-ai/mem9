package handler

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	dto "github.com/prometheus/client_model/go"

	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/service"
)

func TestRouterRecordsLocalRateLimitDenialsInHTTPMetrics(t *testing.T) {
	metrics.HTTPRequestsTotal.Reset()
	rl := middleware.NewRateLimiter(0.001, 1, "fingerprint-secret")
	defer rl.Stop()
	identity := func(next http.Handler) http.Handler { return next }
	srv := NewServer(nil, nil, "", nil, nil, "", false, service.ModeSmart, "", slog.New(slog.NewTextHandler(io.Discard, nil)))
	router := srv.Router(identity, rl.Middleware(), identity, identity)

	first := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	first.RemoteAddr = "10.0.0.1:1234"
	firstRR := httptest.NewRecorder()
	router.ServeHTTP(firstRR, first)
	if firstRR.Code != http.StatusOK {
		t.Fatalf("first status = %d, want %d", firstRR.Code, http.StatusOK)
	}

	second := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	second.RemoteAddr = "10.0.0.1:1234"
	secondRR := httptest.NewRecorder()
	router.ServeHTTP(secondRR, second)
	if secondRR.Code != http.StatusTooManyRequests {
		t.Fatalf("second status = %d, want %d", secondRR.Code, http.StatusTooManyRequests)
	}

	// A global middleware denial happens before chi selects the route handler, so
	// the bounded fallback route label is expected for this response.
	counter, err := metrics.HTTPRequestsTotal.GetMetricWithLabelValues(http.MethodGet, "unmatched", "429")
	if err != nil {
		t.Fatalf("get HTTP request metric: %v", err)
	}
	metric, ok := counter.(interface{ Write(*dto.Metric) error })
	if !ok {
		t.Fatal("HTTP request metric does not implement Write")
	}
	var pb dto.Metric
	if err := metric.Write(&pb); err != nil {
		t.Fatalf("write HTTP request metric: %v", err)
	}
	if pb.Counter == nil || pb.Counter.GetValue() != 1 {
		t.Fatalf("HTTP 429 request metric = %#v, want 1", pb.Counter)
	}
}
