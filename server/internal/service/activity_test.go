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
	mu              sync.Mutex
	touchErr        error
	upsertErr       error
	countErr        error
	sumErr          error
	count           int64
	memoryTotal     int64
	memoryLast7d    int64
	touchCalls      int
	upsertCalls     int
	countCalls      int
	sumCalls        int
	lastStatsTotal  int64
	lastStatsLast7d int64
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

func (r *activityTenantRepo) UpsertMemoryStats(_ context.Context, _ string, _ time.Time, total, last7d int64, _ time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.upsertCalls++
	r.lastStatsTotal = total
	r.lastStatsLast7d = last7d
	return r.upsertErr
}

func (r *activityTenantRepo) CountActiveTenantsSince(context.Context, time.Time) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.countCalls++
	return r.count, r.countErr
}

func (r *activityTenantRepo) SumActiveMemoryStats(context.Context) (int64, int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sumCalls++
	return r.memoryTotal, r.memoryLast7d, r.sumErr
}

func TestActivityTrackerRefreshesActiveTenantGauge(t *testing.T) {
	resetActivityGauges()
	repo := &activityTenantRepo{count: 3, memoryTotal: 8, memoryLast7d: 2}
	tracker := NewActivityTracker(repo, nil)

	tracker.RecordMemoryActivity("tenant-a", time.Now())

	if got := activeTenantGaugeValue(t); got != 3 {
		t.Fatalf("active tenant gauge = %v, want 3", got)
	}
	if got := activeMemoryGaugeValue(t); got != 8 {
		t.Fatalf("active memory gauge = %v, want 8", got)
	}
	if got := activeMemory7dGaugeValue(t); got != 2 {
		t.Fatalf("active memory 7d gauge = %v, want 2", got)
	}
	repo.mu.Lock()
	touchCalls := repo.touchCalls
	countCalls := repo.countCalls
	sumCalls := repo.sumCalls
	repo.mu.Unlock()
	if touchCalls != 1 || countCalls != 1 || sumCalls != 1 {
		t.Fatalf("calls = touch:%d count:%d sum:%d, want 1/1/1", touchCalls, countCalls, sumCalls)
	}
}

func TestActivityTrackerSuppressesTouchFailure(t *testing.T) {
	resetActivityGauges()
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
	resetActivityGauges()
	repo := &activityTenantRepo{count: 5, memoryTotal: 10, memoryLast7d: 4, countErr: errors.New("transient count failure")}
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
	if got := activeMemoryGaugeValue(t); got != 10 {
		t.Fatalf("active memory gauge = %v, want 10", got)
	}
	repo.mu.Lock()
	touchCalls := repo.touchCalls
	countCalls := repo.countCalls
	sumCalls := repo.sumCalls
	repo.mu.Unlock()
	if touchCalls != 2 || countCalls != 2 || sumCalls != 1 {
		t.Fatalf("calls = touch:%d count:%d sum:%d, want 2/2/1", touchCalls, countCalls, sumCalls)
	}
}

func TestActivityTrackerDebouncesMetricRefresh(t *testing.T) {
	resetActivityGauges()
	repo := &activityTenantRepo{count: 4, memoryTotal: 12, memoryLast7d: 6}
	tracker := NewActivityTracker(repo, nil)
	tracker.ttl = time.Hour

	tracker.RecordMemoryActivity("tenant-a", time.Now())
	repo.count = 9
	repo.memoryTotal = 99
	tracker.RecordMemoryActivity("tenant-a", time.Now())

	if got := activeTenantGaugeValue(t); got != 4 {
		t.Fatalf("active tenant gauge = %v, want 4", got)
	}
	if got := activeMemoryGaugeValue(t); got != 12 {
		t.Fatalf("active memory gauge = %v, want 12", got)
	}
	repo.mu.Lock()
	touchCalls := repo.touchCalls
	countCalls := repo.countCalls
	sumCalls := repo.sumCalls
	repo.mu.Unlock()
	if touchCalls != 2 || countCalls != 1 || sumCalls != 1 {
		t.Fatalf("calls = touch:%d count:%d sum:%d, want 2/1/1", touchCalls, countCalls, sumCalls)
	}
}

func TestActivityTrackerRecordsMemoryStatsAndRefreshesGauges(t *testing.T) {
	resetActivityGauges()
	repo := &activityTenantRepo{count: 2, memoryTotal: 14, memoryLast7d: 5}
	tracker := NewActivityTracker(repo, nil)

	tracker.RecordMemoryStats(context.Background(), "tenant-a", time.Now(), 7, 3, time.Now())

	if got := activeTenantGaugeValue(t); got != 2 {
		t.Fatalf("active tenant gauge = %v, want 2", got)
	}
	if got := activeMemoryGaugeValue(t); got != 14 {
		t.Fatalf("active memory gauge = %v, want 14", got)
	}
	if got := activeMemory7dGaugeValue(t); got != 5 {
		t.Fatalf("active memory 7d gauge = %v, want 5", got)
	}
	repo.mu.Lock()
	upsertCalls := repo.upsertCalls
	lastStatsTotal := repo.lastStatsTotal
	lastStatsLast7d := repo.lastStatsLast7d
	repo.mu.Unlock()
	if upsertCalls != 1 || lastStatsTotal != 7 || lastStatsLast7d != 3 {
		t.Fatalf("stats upsert = calls:%d total:%d last7d:%d, want 1/7/3", upsertCalls, lastStatsTotal, lastStatsLast7d)
	}
}

func TestActivityTrackerDebouncesAggregateRefreshButNotStatsUpsert(t *testing.T) {
	resetActivityGauges()
	repo := &activityTenantRepo{count: 1, memoryTotal: 20, memoryLast7d: 8}
	tracker := NewActivityTracker(repo, nil)
	tracker.ttl = time.Hour

	tracker.RecordMemoryStats(context.Background(), "tenant-a", time.Now(), 20, 8, time.Now())
	repo.memoryTotal = 30
	tracker.RecordMemoryStats(context.Background(), "tenant-a", time.Now(), 30, 9, time.Now())

	if got := activeMemoryGaugeValue(t); got != 20 {
		t.Fatalf("active memory gauge = %v, want 20", got)
	}
	repo.mu.Lock()
	upsertCalls := repo.upsertCalls
	countCalls := repo.countCalls
	sumCalls := repo.sumCalls
	repo.mu.Unlock()
	if upsertCalls != 2 || countCalls != 1 || sumCalls != 1 {
		t.Fatalf("calls = upsert:%d count:%d sum:%d, want 2/1/1", upsertCalls, countCalls, sumCalls)
	}
}

func TestActivityTrackerLeavesGaugesUnchangedOnAggregateSumFailure(t *testing.T) {
	resetActivityGauges()
	metrics.ActiveTenants7dTotal.Set(9)
	metrics.ActiveMemoryTotal.Set(30)
	metrics.ActiveMemory7dTotal.Set(11)
	repo := &activityTenantRepo{
		count:        4,
		memoryTotal:  40,
		memoryLast7d: 12,
		sumErr:       errors.New("sum failed"),
	}
	tracker := NewActivityTracker(repo, nil)
	tracker.ttl = time.Hour

	tracker.RecordMemoryActivity("tenant-a", time.Now())

	if got := activeTenantGaugeValue(t); got != 9 {
		t.Fatalf("active tenant gauge = %v, want 9", got)
	}
	if got := activeMemoryGaugeValue(t); got != 30 {
		t.Fatalf("active memory gauge = %v, want 30", got)
	}

	repo.mu.Lock()
	repo.sumErr = nil
	repo.mu.Unlock()
	tracker.RecordMemoryActivity("tenant-a", time.Now())

	if got := activeTenantGaugeValue(t); got != 4 {
		t.Fatalf("active tenant gauge after retry = %v, want 4", got)
	}
	if got := activeMemoryGaugeValue(t); got != 40 {
		t.Fatalf("active memory gauge after retry = %v, want 40", got)
	}
}

func resetActivityGauges() {
	metrics.ActiveTenants7dTotal.Set(0)
	metrics.ActiveMemoryTotal.Set(0)
	metrics.ActiveMemory7dTotal.Set(0)
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

func activeMemoryGaugeValue(t *testing.T) float64 {
	t.Helper()

	var pb dto.Metric
	if err := metrics.ActiveMemoryTotal.Write(&pb); err != nil {
		t.Fatalf("write active memory gauge: %v", err)
	}
	if pb.Gauge == nil {
		return 0
	}
	return pb.Gauge.GetValue()
}

func activeMemory7dGaugeValue(t *testing.T) float64 {
	t.Helper()

	var pb dto.Metric
	if err := metrics.ActiveMemory7dTotal.Write(&pb); err != nil {
		t.Fatalf("write active memory 7d gauge: %v", err)
	}
	if pb.Gauge == nil {
		return 0
	}
	return pb.Gauge.GetValue()
}
