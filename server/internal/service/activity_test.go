package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	dto "github.com/prometheus/client_model/go"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metrics"
)

type activityTenantRepo struct {
	mu         sync.Mutex
	touchErr   error
	countErr   error
	count      int64
	touchCalls int
	countCalls int
}

func (r *activityTenantRepo) Create(context.Context, *domain.Tenant) error { return nil }
func (r *activityTenantRepo) GetByID(context.Context, string) (*domain.Tenant, error) {
	return nil, domain.ErrNotFound
}
func (r *activityTenantRepo) GetByName(context.Context, string) (*domain.Tenant, error) {
	return nil, domain.ErrNotFound
}
func (r *activityTenantRepo) UpdateStatus(context.Context, string, domain.TenantStatus) error {
	return nil
}
func (r *activityTenantRepo) UpdateSchemaVersion(context.Context, string, int) error {
	return nil
}

func (r *activityTenantRepo) TouchActivity(context.Context, string, time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.touchCalls++
	return r.touchErr
}

func (r *activityTenantRepo) CountActiveTenantsSince(context.Context, time.Time) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.countCalls++
	return r.count, r.countErr
}

func TestActivityTrackerRefreshesActiveTenantGauge(t *testing.T) {
	metrics.ActiveTenants7dTotal.Set(0)
	repo := &activityTenantRepo{count: 3}
	tracker := NewActivityTracker(repo, nil)

	tracker.RecordMemoryActivity("tenant-a", time.Now())

	if got := activeTenantGaugeValue(t); got != 3 {
		t.Fatalf("active tenant gauge = %v, want 3", got)
	}
	repo.mu.Lock()
	touchCalls := repo.touchCalls
	countCalls := repo.countCalls
	repo.mu.Unlock()
	if touchCalls != 1 || countCalls != 1 {
		t.Fatalf("calls = touch:%d count:%d, want 1/1", touchCalls, countCalls)
	}
}

func TestActivityTrackerSuppressesTouchFailure(t *testing.T) {
	metrics.ActiveTenants7dTotal.Set(0)
	repo := &activityTenantRepo{touchErr: errors.New("fk failure"), count: 7}
	tracker := NewActivityTracker(repo, nil)

	tracker.RecordMemoryActivity("missing-tenant", time.Now())

	if got := activeTenantGaugeValue(t); got != 0 {
		t.Fatalf("active tenant gauge = %v, want 0", got)
	}
	repo.mu.Lock()
	countCalls := repo.countCalls
	repo.mu.Unlock()
	if countCalls != 0 {
		t.Fatalf("count calls = %d, want 0", countCalls)
	}
}

func TestActivityTrackerRetriesMetricRefreshAfterCountFailure(t *testing.T) {
	metrics.ActiveTenants7dTotal.Set(0)
	repo := &activityTenantRepo{count: 5, countErr: errors.New("transient count failure")}
	tracker := NewActivityTracker(repo, nil)
	tracker.ttl = time.Hour

	tracker.RecordMemoryActivity("tenant-a", time.Now())

	if got := activeTenantGaugeValue(t); got != 0 {
		t.Fatalf("active tenant gauge = %v, want 0", got)
	}

	repo.mu.Lock()
	repo.countErr = nil
	repo.mu.Unlock()

	tracker.RecordMemoryActivity("tenant-a", time.Now())

	if got := activeTenantGaugeValue(t); got != 5 {
		t.Fatalf("active tenant gauge = %v, want 5", got)
	}
	repo.mu.Lock()
	touchCalls := repo.touchCalls
	countCalls := repo.countCalls
	repo.mu.Unlock()
	if touchCalls != 2 || countCalls != 2 {
		t.Fatalf("calls = touch:%d count:%d, want 2/2", touchCalls, countCalls)
	}
}

func TestActivityTrackerDebouncesMetricRefresh(t *testing.T) {
	metrics.ActiveTenants7dTotal.Set(0)
	repo := &activityTenantRepo{count: 4}
	tracker := NewActivityTracker(repo, nil)
	tracker.ttl = time.Hour

	tracker.RecordMemoryActivity("tenant-a", time.Now())
	repo.count = 9
	tracker.RecordMemoryActivity("tenant-a", time.Now())

	if got := activeTenantGaugeValue(t); got != 4 {
		t.Fatalf("active tenant gauge = %v, want 4", got)
	}
	repo.mu.Lock()
	touchCalls := repo.touchCalls
	countCalls := repo.countCalls
	repo.mu.Unlock()
	if touchCalls != 2 || countCalls != 1 {
		t.Fatalf("calls = touch:%d count:%d, want 2/1", touchCalls, countCalls)
	}
}

func activeTenantGaugeValue(t *testing.T) float64 {
	t.Helper()

	var pb dto.Metric
	if err := metrics.ActiveTenants7dTotal.Write(&pb); err != nil {
		t.Fatalf("write active tenant gauge: %v", err)
	}
	if pb.Gauge == nil {
		return 0
	}
	return pb.Gauge.GetValue()
}
