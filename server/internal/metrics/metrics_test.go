package metrics

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	dto "github.com/prometheus/client_model/go"
)

func TestMiddlewareUsesRoutePatternForMatchedRoute(t *testing.T) {
	resetMetrics()

	router := chi.NewRouter()
	router.Use(Middleware)
	router.Get("/v1alpha1/mem9s/{tenantID}/memories", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/v1alpha1/mem9s/t-123/memories", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if got := counterValue(t, http.MethodGet, "/v1alpha1/mem9s/{tenantID}/memories", "204"); got != 1 {
		t.Fatalf("matched route counter = %v, want 1", got)
	}
}

func TestMiddlewareUsesSingleLabelForUnmatchedRoutes(t *testing.T) {
	resetMetrics()

	router := chi.NewRouter()
	router.Use(Middleware)
	router.Get("/ok", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	for _, path := range []string{"/missing/one", "/missing/two"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("status for %q = %d, want 404", path, rr.Code)
		}
	}

	if got := counterValue(t, http.MethodGet, unmatchedRouteLabel, "404"); got != 2 {
		t.Fatalf("unmatched route counter = %v, want 2", got)
	}
	if got := counterValue(t, http.MethodGet, "/missing/one", "404"); got != 0 {
		t.Fatalf("raw path series for /missing/one = %v, want 0", got)
	}
	if got := counterValue(t, http.MethodGet, "/missing/two", "404"); got != 0 {
		t.Fatalf("raw path series for /missing/two = %v, want 0", got)
	}
}

func resetMetrics() {
	HTTPRequestsTotal.Reset()
	HTTPRequestDuration.Reset()
}

func counterValue(t *testing.T, method, route, status string) float64 {
	t.Helper()

	metric, err := HTTPRequestsTotal.GetMetricWithLabelValues(method, route, status)
	if err != nil {
		t.Fatalf("get metric %s %s %s: %v", method, route, status, err)
	}

	var pb dto.Metric
	if err := metric.Write(&pb); err != nil {
		t.Fatalf("write metric %s %s %s: %v", method, route, status, err)
	}
	if pb.Counter == nil {
		return 0
	}
	return pb.Counter.GetValue()
}
