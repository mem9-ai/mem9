package service

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/repository"
)

const (
	activityTrackerTimeout = 10 * time.Second
	activityGaugeTTL       = 30 * time.Second
	activeTenantWindow     = 7 * 24 * time.Hour
)

// ActivityTracker records tenant-level memory activity and refreshes the
// process-global activity metrics on a debounce.
type ActivityTracker struct {
	tenants repository.TenantRepo
	logger  *slog.Logger
	ttl     time.Duration

	mu          sync.Mutex
	lastRefresh time.Time
}

func NewActivityTracker(tenants repository.TenantRepo, logger *slog.Logger) *ActivityTracker {
	if logger == nil {
		logger = slog.Default()
	}
	return &ActivityTracker{
		tenants: tenants,
		logger:  logger,
		ttl:     activityGaugeTTL,
	}
}

func (t *ActivityTracker) RecordMemoryActivity(tenantID string, at time.Time) {
	if t == nil || t.tenants == nil || tenantID == "" {
		return
	}
	if at.IsZero() {
		at = time.Now().UTC()
	}

	ctx, cancel := context.WithTimeout(context.Background(), activityTrackerTimeout)
	defer cancel()

	if err := t.tenants.TouchActivity(ctx, tenantID, at); err != nil {
		t.logger.Warn("record tenant activity failed", "tenant_id", tenantID, "err", err)
		return
	}

	t.refreshAggregateMetrics(ctx, time.Now().UTC())
}

func (t *ActivityTracker) RecordMemoryStats(ctx context.Context, tenantID string, activityAt time.Time, total, last7d int64, observedAt time.Time) {
	if t == nil || t.tenants == nil || tenantID == "" {
		return
	}
	if activityAt.IsZero() {
		activityAt = time.Now().UTC()
	}
	if observedAt.IsZero() {
		observedAt = time.Now().UTC()
	}

	callCtx := ctx
	var cancel context.CancelFunc
	if callCtx == nil {
		callCtx = context.Background()
	}
	callCtx, cancel = context.WithTimeout(callCtx, activityTrackerTimeout)
	defer cancel()

	if err := t.tenants.UpsertMemoryStats(callCtx, tenantID, activityAt, total, last7d, observedAt); err != nil {
		t.logger.Warn("record tenant memory stats failed", "tenant_id", tenantID, "err", err)
		return
	}

	t.refreshAggregateMetrics(callCtx, time.Now().UTC())
}

func (t *ActivityTracker) refreshAggregateMetrics(ctx context.Context, now time.Time) {
	if t == nil || t.tenants == nil {
		return
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if !t.shouldRefresh(now) {
		return
	}

	activeTenants, err := t.tenants.CountActiveTenantsSince(ctx, now.Add(-activeTenantWindow))
	if err != nil {
		t.clearRefreshClaim(now)
		t.logger.Warn("refresh aggregate metrics failed", "metric", "active_tenants_7d_total", "err", err)
		return
	}
	activeMemory, activeMemory7d, err := t.tenants.SumActiveMemoryStats(ctx)
	if err != nil {
		t.clearRefreshClaim(now)
		t.logger.Warn("refresh aggregate metrics failed", "metric", "active_memory", "err", err)
		return
	}

	metrics.ActiveTenants7dTotal.Set(float64(activeTenants))
	metrics.ActiveMemoryTotal.Set(float64(activeMemory))
	metrics.ActiveMemory7dTotal.Set(float64(activeMemory7d))
}

func (t *ActivityTracker) shouldRefresh(now time.Time) bool {
	ttl := t.ttl
	if ttl <= 0 {
		ttl = activityGaugeTTL
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.lastRefresh.IsZero() && now.Sub(t.lastRefresh) < ttl {
		return false
	}
	t.lastRefresh = now
	return true
}

func (t *ActivityTracker) clearRefreshClaim(claimedAt time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.lastRefresh.Equal(claimedAt) {
		t.lastRefresh = time.Time{}
	}
}
