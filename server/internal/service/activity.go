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
// process-global active-tenant metric on a debounce.
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

	now := time.Now().UTC()
	if !t.shouldRefresh(now) {
		return
	}

	count, err := t.tenants.CountActiveTenantsSince(ctx, now.Add(-activeTenantWindow))
	if err != nil {
		t.clearRefreshClaim(now)
		t.logger.Warn("refresh active tenants metric failed", "err", err)
		return
	}
	metrics.ActiveTenants7dTotal.Set(float64(count))
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
