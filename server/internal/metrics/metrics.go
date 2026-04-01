package metrics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

const unmatchedRouteLabel = "unmatched"

var (
	// HTTPRequestsTotal counts requests by method, route pattern, and status code.
	HTTPRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "mnemo",
			Name:      "http_requests_total",
			Help:      "Total number of HTTP requests.",
		},
		[]string{"method", "route", "status"},
	)

	// HTTPRequestDuration observes request latency by method and route pattern.
	HTTPRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "mnemo",
			Name:      "http_request_duration_seconds",
			Help:      "HTTP request duration in seconds.",
			Buckets:   prometheus.DefBuckets,
		},
		[]string{"method", "route"},
	)

	// ProvisionStepDuration observes the duration of each step in the provision flow.
	// step labels: tidb_zero_create_instance, create_tenant_record,
	//              init_schema_create_table, init_schema_vector_index,
	//              init_schema_fts_index, update_status, update_schema_version, total
	ProvisionStepDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "mnemo",
			Name:      "provision_step_duration_seconds",
			Help:      "Duration of each step in the provision flow.",
			Buckets:   []float64{0.05, 0.1, 0.5, 1, 2, 5, 10, 20, 30},
		},
		[]string{"step"},
	)

	// ProvisionTotal counts provision attempts by result (success or error).
	ProvisionTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "mnemo",
			Name:      "provision_total",
			Help:      "Total number of provision attempts.",
		},
		[]string{"result"}, // "success" | "error"
	)

	// LLMRequestDuration observes LLM API call latency by model and status.
	LLMRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "mnemo",
			Name:      "llm_request_duration_seconds",
			Help:      "LLM API request duration in seconds.",
			Buckets:   []float64{0.5, 1, 2, 5, 10, 20, 30, 45, 60, 90, 120},
		},
		[]string{"model", "status"}, // status: "success" | "error"
	)

	// NearDupCosineScore observes the cosine similarity of the nearest existing
	// memory to each extracted fact. Shadow mode only — facts always pass through
	// to reconcile unchanged. Used to calibrate the near-dup suppression threshold.
	NearDupCosineScore = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: "mnemo",
			Name:      "near_dup_cosine_score",
			Help:      "Cosine similarity of nearest memory to each extracted fact (shadow mode).",
			Buckets:   []float64{0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.92, 0.95, 0.97, 0.99},
		},
	)

	// LLMTokensTotal counts LLM token consumption by model and type (prompt/completion).
	// LLMTokensTotal counts LLM token consumption by model and type.
	// type: "input" | "output" | "total" | "cache_read" | "cache_creation"
	LLMTokensTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "mnemo",
			Name:      "llm_tokens_total",
			Help:      "Total number of LLM tokens consumed.",
		},
		[]string{"model", "type"},
	)
	// ActiveMemoryTotal is the current total number of active memories per cluster.
	// Use sum(mnemo_active_memory_total) for the global aggregate.
	ActiveMemoryTotal = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "mnemo",
		Name:      "active_memory_total",
		Help:      "Total active memories for a cluster, refreshed on memory write or delete.",
	}, []string{"cluster_id"})

	// ActiveMemory7dTotal is the current total number of active memories created in the
	// last 7 days per cluster. Use sum(mnemo_active_memory_7d_total) for the global aggregate.
	// Value reflects the state at the last write or delete event; it is not updated between events.
	ActiveMemory7dTotal = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "mnemo",
		Name:      "active_memory_7d_total",
		Help:      "Active memories created in the last 7 days for a cluster, refreshed on memory write or delete.",
	}, []string{"cluster_id"})

	// MemoryChangesTotal counts the number of memory-level changes (ADD, UPDATE, and
	// post-reconcile tag/metadata patches) per cluster. One UPDATE counts as one change
	// even though it produces two DB rows (archive + create). DELETE actions are not
	// counted here; use active_memory_total to observe deletions.
	MemoryChangesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "mnemo",
		Name:      "memory_changes_total",
		Help:      "Memory-level ADD and UPDATE changes per cluster, as reported by the reconcile pipeline.",
	}, []string{"cluster_id"})

	// MemoryWriteDuration observes the latency of memory write operations by op type.
	// op labels: create, bulk_create, archive_and_create, update
	MemoryWriteDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "mnemo",
			Name:      "memory_write_duration_seconds",
			Help:      "Latency of create, bulk_create, archive_and_create, and update memory write operations.",
			Buckets:   []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5},
		},
		[]string{"op", "status"},
	)
)

// Middleware records HTTP request count and duration for each request.
// It uses the chi route pattern (e.g. /v1alpha1/mem9s/{tenantID}/memories)
// rather than the raw URL to avoid high cardinality from tenant IDs.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)

		next.ServeHTTP(ww, r)

		status := strconv.Itoa(ww.Status())
		duration := time.Since(start).Seconds()
		route := routeLabel(r)

		HTTPRequestsTotal.WithLabelValues(r.Method, route, status).Inc()
		HTTPRequestDuration.WithLabelValues(r.Method, route).Observe(duration)
	})
}

func routeLabel(r *http.Request) string {
	routeCtx := chi.RouteContext(r.Context())
	if routeCtx == nil {
		return unmatchedRouteLabel
	}
	route := routeCtx.RoutePattern()
	if route == "" {
		return unmatchedRouteLabel
	}
	return route
}
