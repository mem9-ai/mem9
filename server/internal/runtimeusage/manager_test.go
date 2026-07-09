package runtimeusage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/metering"
)

type fakeQuotaClient struct {
	mu               sync.Mutex
	reserveOps       []Operation
	finalized        []string
	finalizeSubjects []Subject
	state            RuntimeState
	stateSubjects    []Subject
	err              error
	stateErr         error
	stateDelay       time.Duration
	reserveErr       error
	finalizeErr      error
}

func (c *fakeQuotaClient) RuntimeState(_ context.Context, subject Subject) (RuntimeState, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.stateSubjects = append(c.stateSubjects, subject)
	if c.stateErr != nil {
		return RuntimeState{}, c.stateErr
	}
	if c.err != nil {
		return RuntimeState{}, c.err
	}
	if c.stateDelay > 0 {
		time.Sleep(c.stateDelay)
	}
	return c.state, nil
}

func (c *fakeQuotaClient) Reserve(_ context.Context, _ Subject, operationID string, op Operation) (*Reservation, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.reserveErr != nil {
		return nil, c.reserveErr
	}
	if c.err != nil {
		return nil, c.err
	}
	c.reserveOps = append(c.reserveOps, op)
	return &Reservation{OperationID: operationID, Meter: op.Meter, Units: op.Units, Status: "reserved"}, nil
}

func (c *fakeQuotaClient) FinalizeReservation(_ context.Context, subject Subject, operationID string, status string, reason string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.finalizeErr != nil {
		return c.finalizeErr
	}
	if c.err != nil {
		return c.err
	}
	c.finalized = append(c.finalized, operationID+":"+status+":"+reason)
	c.finalizeSubjects = append(c.finalizeSubjects, subject)
	return nil
}

type captureWriter struct {
	events []metering.Event
}

func (w *captureWriter) Record(evt metering.Event) {
	w.events = append(w.events, evt)
}

func (w *captureWriter) Close(context.Context) error { return nil }

type fakeOutboxStore struct {
	commitPending  int
	releasePending int
	done           int
	retryable      int
	unknown        int
	commitErr      error
	releaseReasons []string
	retryReasons   []string
}

func (s *fakeOutboxStore) StoreCommitPending(context.Context, *OperationLease, MeteringEvent) error {
	s.commitPending++
	return s.commitErr
}

func (s *fakeOutboxStore) StoreReleasePending(_ context.Context, _ *OperationLease, reason string) error {
	s.releasePending++
	s.releaseReasons = append(s.releaseReasons, reason)
	return nil
}

func (s *fakeOutboxStore) MarkOperationDone(context.Context, string, string) error {
	s.done++
	return nil
}

func (s *fakeOutboxStore) MarkOperationRetryableFailure(_ context.Context, _ string, reason string) error {
	s.retryable++
	s.retryReasons = append(s.retryReasons, reason)
	return nil
}

func (s *fakeOutboxStore) MarkUnknownAfterCrash(context.Context, string, string) error {
	s.unknown++
	return nil
}

func TestNoopManagerRuntimeStateReturnsDisabledFallback(t *testing.T) {
	quota := &fakeQuotaClient{}
	manager := NewManager(Config{Enabled: false}, quota, nil, nil)

	state, err := manager.RuntimeState(context.Background(), Subject{APIKeySubject: "mem9_test"})
	if err != nil {
		t.Fatalf("RuntimeState: %v", err)
	}
	assertFallbackMeter(t, state, MeterMemoryRecallRequests, RuntimeBudgetTypeNotMetered, RuntimeBudgetStateUnlimited)
	assertFallbackMeter(t, state, MeterMemoryWriteRequests, RuntimeBudgetTypeNotMetered, RuntimeBudgetStateUnlimited)

	lease, err := manager.BeforeRecall(context.Background(), Subject{APIKeySubject: "mem9_test"})
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	if lease != nil {
		t.Fatalf("BeforeRecall lease = %+v, want nil", lease)
	}
	if len(quota.stateSubjects) != 0 || len(quota.reserveOps) != 0 || len(quota.finalized) != 0 {
		t.Fatalf("disabled manager called provider: %+v", quota)
	}
}

func TestManagerRuntimeStateUsesProvider(t *testing.T) {
	quota := &fakeQuotaClient{state: RuntimeState{
		Mem9APIKey:   RuntimeStateAPIKey{Status: RuntimeAPIKeyStatusUnknown},
		ProviderData: json.RawMessage(`{"bindingState":"claimed"}`),
		Meters: []RuntimeStateMeter{{
			Meter: MeterMemoryRecallRequests,
			Budgets: []RuntimeStatusBudget{{
				Type:  RuntimeBudgetTypeNotMetered,
				State: RuntimeBudgetStateUnlimited,
				Measure: RuntimeStatusMeasure{
					Kind:     RuntimeMeasureKindCount,
					Quantity: "request",
					Scale:    1,
				},
				Period:   RuntimeStatusPeriod{Type: RuntimePeriodTypeNone},
				Capacity: RuntimeStatusCapacity{Type: RuntimeCapacityTypeUnlimited},
			}},
		}},
	}}
	manager := NewManager(Config{Enabled: true, ProviderID: "mem9-official"}, quota, nil, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "mem9_test", APIKeyStatus: RuntimeAPIKeyStatusActive}

	state, err := manager.RuntimeState(context.Background(), subject)
	if err != nil {
		t.Fatalf("RuntimeState: %v", err)
	}
	if len(quota.stateSubjects) != 1 || quota.stateSubjects[0] != subject {
		t.Fatalf("state subjects = %+v, want [%+v]", quota.stateSubjects, subject)
	}
	if state.Mem9APIKey.Status != RuntimeAPIKeyStatusActive {
		t.Fatalf("status = %q, want local active status", state.Mem9APIKey.Status)
	}
	if state.ProviderID != "mem9-official" {
		t.Fatalf("ProviderID = %q, want mem9-official", state.ProviderID)
	}
	assertFallbackMeter(t, state, MeterMemoryRecallRequests, RuntimeBudgetTypeNotMetered, RuntimeBudgetStateUnlimited)
}

func TestManagerRuntimeStateFallsBackWhenProviderUnavailable(t *testing.T) {
	quota := &fakeQuotaClient{stateErr: &UnavailableError{Err: errString("timeout")}}
	manager := NewManager(Config{Enabled: true}, quota, nil, nil)

	state, err := manager.RuntimeState(context.Background(), Subject{TenantID: "tenant-a", APIKeySubject: "mem9_test", APIKeyStatus: RuntimeAPIKeyStatusInactive})
	if err != nil {
		t.Fatalf("RuntimeState: %v", err)
	}
	if state.Mem9APIKey.Status != RuntimeAPIKeyStatusInactive {
		t.Fatalf("status = %q, want inactive", state.Mem9APIKey.Status)
	}
	assertFallbackMeter(t, state, MeterMemoryRecallRequests, RuntimeBudgetTypeProviderManaged, RuntimeBudgetStateProviderManaged)
	assertFallbackMeter(t, state, MeterMemoryWriteRequests, RuntimeBudgetTypeProviderManaged, RuntimeBudgetStateProviderManaged)
}

func TestNoticeStateCacheKeyUsesKeyedDigest(t *testing.T) {
	cache := &noticeStateCache{key: []byte("fixed-test-hmac-key")}
	got := cache.cacheKey("raw-api-key")
	again := cache.cacheKey("raw-api-key")
	other := cache.cacheKey("other-api-key")
	plain := sha256.Sum256([]byte("raw-api-key"))

	if got != again {
		t.Fatalf("cacheKey not deterministic: %q != %q", got, again)
	}
	if got == other {
		t.Fatalf("cacheKey should differ for different subjects")
	}
	if len(got) != sha256.Size*2 {
		t.Fatalf("cacheKey length = %d, want %d", len(got), sha256.Size*2)
	}
	if strings.Contains(got, "raw-api-key") {
		t.Fatalf("cacheKey contains raw subject: %q", got)
	}
	if got == hex.EncodeToString(plain[:]) {
		t.Fatalf("cacheKey equals plain sha256(subject); want keyed digest")
	}
}

func TestManagerRuntimeStateForNoticeCachesByDigestKey(t *testing.T) {
	quota := &fakeQuotaClient{state: runtimeNoticeStateWithPercent(82)}
	manager := NewManager(Config{
		Enabled:            true,
		ProviderID:         "mem9-official",
		InternalSecret:     "secret-value",
		NoticeTimeout:      time.Second,
		NoticeCacheEnabled: true,
		NoticeCacheTTL:     30 * time.Second,
		NoticeStaleTTL:     2 * time.Minute,
	}, quota, nil, nil).(*manager)

	subject := Subject{APIKeySubject: "raw-api-key"}
	if _, err := manager.RuntimeStateForNotice(context.Background(), subject); err != nil {
		t.Fatalf("RuntimeStateForNotice first: %v", err)
	}
	if _, err := manager.RuntimeStateForNotice(context.Background(), subject); err != nil {
		t.Fatalf("RuntimeStateForNotice second: %v", err)
	}
	if len(quota.stateSubjects) != 1 {
		t.Fatalf("runtime state calls = %d, want 1", len(quota.stateSubjects))
	}
	for key := range manager.noticeState.entries {
		if strings.Contains(key, "raw-api-key") {
			t.Fatalf("cache key contains raw subject: %q", key)
		}
	}
}

func TestManagerRuntimeStateForNoticeSeparatesSubjects(t *testing.T) {
	quota := &fakeQuotaClient{state: runtimeNoticeStateWithPercent(82)}
	manager := NewManager(Config{
		Enabled:            true,
		ProviderID:         "mem9-official",
		InternalSecret:     "secret-value",
		NoticeTimeout:      time.Second,
		NoticeCacheEnabled: true,
		NoticeCacheTTL:     30 * time.Second,
		NoticeStaleTTL:     2 * time.Minute,
	}, quota, nil, nil)

	if _, err := manager.RuntimeStateForNotice(context.Background(), Subject{APIKeySubject: "key-a"}); err != nil {
		t.Fatalf("key-a: %v", err)
	}
	if _, err := manager.RuntimeStateForNotice(context.Background(), Subject{APIKeySubject: "key-b"}); err != nil {
		t.Fatalf("key-b: %v", err)
	}
	if len(quota.stateSubjects) != 2 {
		t.Fatalf("runtime state calls = %d, want 2", len(quota.stateSubjects))
	}
}

func TestManagerRuntimeStateForNoticeSkipsCacheWithoutSubject(t *testing.T) {
	quota := &fakeQuotaClient{state: runtimeNoticeStateWithPercent(82)}
	manager := NewManager(Config{
		Enabled:            true,
		ProviderID:         "mem9-official",
		InternalSecret:     "secret-value",
		NoticeTimeout:      time.Second,
		NoticeCacheEnabled: true,
		NoticeCacheTTL:     30 * time.Second,
		NoticeStaleTTL:     2 * time.Minute,
	}, quota, nil, nil).(*manager)

	if _, err := manager.RuntimeStateForNotice(context.Background(), Subject{}); err != nil {
		t.Fatalf("first: %v", err)
	}
	if _, err := manager.RuntimeStateForNotice(context.Background(), Subject{}); err != nil {
		t.Fatalf("second: %v", err)
	}
	if len(quota.stateSubjects) != 2 {
		t.Fatalf("runtime state calls = %d, want 2", len(quota.stateSubjects))
	}
	if len(manager.noticeState.entries) != 0 {
		t.Fatalf("entries = %+v, want no cache entries", manager.noticeState.entries)
	}
}

func TestManagerRuntimeStateForNoticeSingleflightCoalescesMisses(t *testing.T) {
	quota := &fakeQuotaClient{state: runtimeNoticeStateWithPercent(82), stateDelay: 10 * time.Millisecond}
	manager := NewManager(Config{
		Enabled:            true,
		ProviderID:         "mem9-official",
		InternalSecret:     "secret-value",
		NoticeTimeout:      time.Second,
		NoticeCacheEnabled: true,
		NoticeCacheTTL:     30 * time.Second,
		NoticeStaleTTL:     2 * time.Minute,
	}, quota, nil, nil)

	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := manager.RuntimeStateForNotice(context.Background(), Subject{APIKeySubject: "key-a"})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("RuntimeStateForNotice error: %v", err)
		}
	}
	if len(quota.stateSubjects) != 1 {
		t.Fatalf("runtime state calls = %d, want 1", len(quota.stateSubjects))
	}
}

func TestManagerRuntimeStateForNoticeUsesStaleOnProviderError(t *testing.T) {
	quota := &fakeQuotaClient{state: runtimeNoticeStateWithPercent(82)}
	manager := NewManager(Config{
		Enabled:            true,
		ProviderID:         "mem9-official",
		InternalSecret:     "secret-value",
		NoticeTimeout:      time.Second,
		NoticeCacheEnabled: true,
		NoticeCacheTTL:     30 * time.Second,
		NoticeStaleTTL:     2 * time.Minute,
	}, quota, nil, nil).(*manager)
	now := time.Date(2026, 7, 9, 12, 0, 0, 0, time.UTC)
	manager.noticeState.now = func() time.Time { return now }

	subject := Subject{APIKeySubject: "key-a"}
	if _, err := manager.RuntimeStateForNotice(context.Background(), subject); err != nil {
		t.Fatalf("prime: %v", err)
	}
	quota.stateErr = errors.New("provider down")
	now = now.Add(45 * time.Second)
	state, err := manager.RuntimeStateForNotice(context.Background(), subject)
	if err != nil {
		t.Fatalf("stale: %v", err)
	}
	if got := *state.Meters[0].Budgets[0].Usage.Percent; got != 82 {
		t.Fatalf("percent = %v, want 82", got)
	}
}

func TestManagerRuntimeStateForNoticeExpiresStaleEntries(t *testing.T) {
	quota := &fakeQuotaClient{state: runtimeNoticeStateWithPercent(82)}
	manager := NewManager(Config{
		Enabled:            true,
		ProviderID:         "mem9-official",
		InternalSecret:     "secret-value",
		NoticeTimeout:      time.Second,
		NoticeCacheEnabled: true,
		NoticeCacheTTL:     30 * time.Second,
		NoticeStaleTTL:     2 * time.Minute,
	}, quota, nil, nil).(*manager)
	now := time.Date(2026, 7, 9, 12, 0, 0, 0, time.UTC)
	manager.noticeState.now = func() time.Time { return now }

	subject := Subject{APIKeySubject: "key-a"}
	if _, err := manager.RuntimeStateForNotice(context.Background(), subject); err != nil {
		t.Fatalf("prime: %v", err)
	}
	quota.stateErr = errors.New("provider down")
	now = now.Add(3 * time.Minute)
	if _, err := manager.RuntimeStateForNotice(context.Background(), subject); err == nil {
		t.Fatal("RuntimeStateForNotice error = nil, want provider error after stale TTL")
	}
	if len(manager.noticeState.entries) != 0 {
		t.Fatalf("entries = %+v, want expired entry pruned", manager.noticeState.entries)
	}
}

func TestManagerRuntimeStateForNoticeRevalidatesExpiredFreshEntry(t *testing.T) {
	quota := &fakeQuotaClient{state: runtimeNoticeStateWithPercent(82)}
	manager := NewManager(Config{
		Enabled:            true,
		ProviderID:         "mem9-official",
		InternalSecret:     "secret-value",
		NoticeTimeout:      time.Second,
		NoticeCacheEnabled: true,
		NoticeCacheTTL:     30 * time.Second,
		NoticeStaleTTL:     2 * time.Minute,
	}, quota, nil, nil).(*manager)
	now := time.Date(2026, 7, 9, 12, 0, 0, 0, time.UTC)
	manager.noticeState.now = func() time.Time { return now }

	subject := Subject{APIKeySubject: "key-a"}
	if _, err := manager.RuntimeStateForNotice(context.Background(), subject); err != nil {
		t.Fatalf("prime: %v", err)
	}
	quota.state = runtimeNoticeStateWithPercent(91)
	now = now.Add(45 * time.Second)
	state, err := manager.RuntimeStateForNotice(context.Background(), subject)
	if err != nil {
		t.Fatalf("revalidate: %v", err)
	}
	if got := *state.Meters[0].Budgets[0].Usage.Percent; got != 91 {
		t.Fatalf("percent = %v, want 91", got)
	}
	if len(quota.stateSubjects) != 2 {
		t.Fatalf("runtime state calls = %d, want 2", len(quota.stateSubjects))
	}
	state, err = manager.RuntimeStateForNotice(context.Background(), subject)
	if err != nil {
		t.Fatalf("cached revalidated state: %v", err)
	}
	if got := *state.Meters[0].Budgets[0].Usage.Percent; got != 91 {
		t.Fatalf("cached percent = %v, want 91", got)
	}
	if len(quota.stateSubjects) != 2 {
		t.Fatalf("runtime state calls after cache hit = %d, want 2", len(quota.stateSubjects))
	}
}

func TestManagerRuntimeStateForNoticeRejectsInvalidProviderData(t *testing.T) {
	quota := &fakeQuotaClient{state: runtimeNoticeStateWithPercent(82)}
	quota.state.ProviderData = json.RawMessage(`["unexpected"]`)
	manager := NewManager(Config{
		Enabled:            true,
		ProviderID:         "mem9-official",
		InternalSecret:     "secret-value",
		NoticeTimeout:      time.Second,
		NoticeCacheEnabled: true,
		NoticeCacheTTL:     30 * time.Second,
		NoticeStaleTTL:     2 * time.Minute,
	}, quota, nil, nil).(*manager)

	subject := Subject{APIKeySubject: "key-a"}
	if _, err := manager.RuntimeStateForNotice(context.Background(), subject); err == nil {
		t.Fatal("RuntimeStateForNotice error = nil, want provider data error")
	}
	if _, err := manager.RuntimeStateForNotice(context.Background(), subject); err == nil {
		t.Fatal("RuntimeStateForNotice second error = nil, want provider data error")
	}
	if len(quota.stateSubjects) != 2 {
		t.Fatalf("runtime state calls = %d, want 2 because invalid state is not cached", len(quota.stateSubjects))
	}
	if len(manager.noticeState.entries) != 0 {
		t.Fatalf("entries = %+v, want no cache entry", manager.noticeState.entries)
	}
}

func TestManagerRuntimeStateForNoticeDeepClonesCachedState(t *testing.T) {
	startAt := time.Date(2026, 7, 9, 12, 0, 0, 0, time.UTC)
	endAt := startAt.Add(time.Hour)
	capacity := int64(100)
	used := int64(18)
	remaining := int64(82)
	percent := float64(82)
	quota := &fakeQuotaClient{state: RuntimeState{
		Mem9APIKey:   RuntimeStateAPIKey{Status: RuntimeAPIKeyStatusUnknown},
		ProviderData: json.RawMessage(`{"bindingState":"claimed"}`),
		RecommendedAction: &RuntimeRecommendedAction{
			Type:               "provider",
			ProviderActionCode: "upgradePlan",
			Severity:           "warning",
			URL:                "https://console.example.com",
		},
		Meters: []RuntimeStateMeter{{
			Meter: MeterMemoryRecallRequests,
			QuotaGateResult: map[string]any{
				"outcome": "allowed",
				"mode":    "included",
				"details": map[string]any{"bucket": "included"},
			},
			Budgets: []RuntimeStatusBudget{{
				Type:     RuntimeBudgetTypeProviderManaged,
				State:    RuntimeBudgetStateProviderManaged,
				Measure:  RuntimeStatusMeasure{Kind: RuntimeMeasureKindCount, Quantity: "request", Scale: 1},
				Period:   RuntimeStatusPeriod{Type: "fixed", StartAt: &startAt, EndAt: &endAt},
				Capacity: RuntimeStatusCapacity{Type: "fixed", Value: &capacity},
				Usage:    &RuntimeStatusUsage{Used: &used, Remaining: &remaining, Percent: &percent},
			}},
		}},
	}}
	manager := NewManager(Config{
		Enabled:            true,
		ProviderID:         "mem9-official",
		InternalSecret:     "secret-value",
		NoticeTimeout:      time.Second,
		NoticeCacheEnabled: true,
		NoticeCacheTTL:     30 * time.Second,
		NoticeStaleTTL:     2 * time.Minute,
	}, quota, nil, nil)

	first, err := manager.RuntimeStateForNotice(context.Background(), Subject{APIKeySubject: "key-a"})
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	first.ProviderData[0] = '['
	first.RecommendedAction.Type = "mutated"
	first.Meters[0].Meter = "mutated"
	first.Meters[0].QuotaGateResult["outcome"] = "mutated"
	first.Meters[0].QuotaGateResult["details"].(map[string]any)["bucket"] = "mutated"
	first.Meters[0].Budgets[0].Type = "mutated"
	*first.Meters[0].Budgets[0].Period.StartAt = startAt.Add(24 * time.Hour)
	*first.Meters[0].Budgets[0].Period.EndAt = endAt.Add(24 * time.Hour)
	*first.Meters[0].Budgets[0].Capacity.Value = 999
	*first.Meters[0].Budgets[0].Usage.Used = 999
	*first.Meters[0].Budgets[0].Usage.Remaining = 999
	*first.Meters[0].Budgets[0].Usage.Percent = 1

	second, err := manager.RuntimeStateForNotice(context.Background(), Subject{APIKeySubject: "key-a"})
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if string(second.ProviderData) != `{"bindingState":"claimed"}` {
		t.Fatalf("ProviderData = %s, want original", second.ProviderData)
	}
	if second.RecommendedAction.Type != "provider" {
		t.Fatalf("RecommendedAction.Type = %q, want provider", second.RecommendedAction.Type)
	}
	if second.Meters[0].Meter != MeterMemoryRecallRequests {
		t.Fatalf("Meter = %q, want recall meter", second.Meters[0].Meter)
	}
	if second.Meters[0].QuotaGateResult["outcome"] != "allowed" {
		t.Fatalf("quota outcome = %v, want allowed", second.Meters[0].QuotaGateResult["outcome"])
	}
	if second.Meters[0].QuotaGateResult["details"].(map[string]any)["bucket"] != "included" {
		t.Fatalf("quota details = %v, want included", second.Meters[0].QuotaGateResult["details"])
	}
	if second.Meters[0].Budgets[0].Type != RuntimeBudgetTypeProviderManaged {
		t.Fatalf("Budget.Type = %q, want provider managed", second.Meters[0].Budgets[0].Type)
	}
	if !second.Meters[0].Budgets[0].Period.StartAt.Equal(startAt) || !second.Meters[0].Budgets[0].Period.EndAt.Equal(endAt) {
		t.Fatalf("period mutated: %+v", second.Meters[0].Budgets[0].Period)
	}
	if got := *second.Meters[0].Budgets[0].Capacity.Value; got != 100 {
		t.Fatalf("capacity = %d, want 100", got)
	}
	if got := *second.Meters[0].Budgets[0].Usage.Used; got != 18 {
		t.Fatalf("used = %d, want 18", got)
	}
	if got := *second.Meters[0].Budgets[0].Usage.Remaining; got != 82 {
		t.Fatalf("remaining = %d, want 82", got)
	}
	if got := *second.Meters[0].Budgets[0].Usage.Percent; got != 82 {
		t.Fatalf("percent = %v, want 82", got)
	}
}

func TestManagerRuntimeStateForNoticeStatusOverlayDoesNotMutateCache(t *testing.T) {
	quota := &fakeQuotaClient{state: runtimeNoticeStateWithPercent(82)}
	manager := NewManager(Config{
		Enabled:            true,
		ProviderID:         "mem9-official",
		InternalSecret:     "secret-value",
		NoticeTimeout:      time.Second,
		NoticeCacheEnabled: true,
		NoticeCacheTTL:     30 * time.Second,
		NoticeStaleTTL:     2 * time.Minute,
	}, quota, nil, nil)

	active, err := manager.RuntimeStateForNotice(context.Background(), Subject{APIKeySubject: "key-a", APIKeyStatus: RuntimeAPIKeyStatusActive})
	if err != nil {
		t.Fatalf("active: %v", err)
	}
	inactive, err := manager.RuntimeStateForNotice(context.Background(), Subject{APIKeySubject: "key-a", APIKeyStatus: RuntimeAPIKeyStatusInactive})
	if err != nil {
		t.Fatalf("inactive: %v", err)
	}
	unknown, err := manager.RuntimeStateForNotice(context.Background(), Subject{APIKeySubject: "key-a"})
	if err != nil {
		t.Fatalf("unknown: %v", err)
	}
	if active.Mem9APIKey.Status != RuntimeAPIKeyStatusActive {
		t.Fatalf("active status = %q", active.Mem9APIKey.Status)
	}
	if inactive.Mem9APIKey.Status != RuntimeAPIKeyStatusInactive {
		t.Fatalf("inactive status = %q", inactive.Mem9APIKey.Status)
	}
	if unknown.Mem9APIKey.Status != RuntimeAPIKeyStatusUnknown {
		t.Fatalf("cached status = %q, want provider unknown", unknown.Mem9APIKey.Status)
	}
	if len(quota.stateSubjects) != 1 {
		t.Fatalf("runtime state calls = %d, want 1", len(quota.stateSubjects))
	}
}

func TestManagerRuntimeStateForNoticeCacheDisabledFetchesEachRequest(t *testing.T) {
	quota := &fakeQuotaClient{state: runtimeNoticeStateWithPercent(82)}
	manager := NewManager(Config{
		Enabled:            true,
		ProviderID:         "mem9-official",
		InternalSecret:     "secret-value",
		NoticeTimeout:      time.Second,
		NoticeCacheEnabled: false,
		NoticeCacheTTL:     30 * time.Second,
		NoticeStaleTTL:     2 * time.Minute,
	}, quota, nil, nil)

	subject := Subject{APIKeySubject: "key-a"}
	if _, err := manager.RuntimeStateForNotice(context.Background(), subject); err != nil {
		t.Fatalf("first: %v", err)
	}
	if _, err := manager.RuntimeStateForNotice(context.Background(), subject); err != nil {
		t.Fatalf("second: %v", err)
	}
	if len(quota.stateSubjects) != 2 {
		t.Fatalf("runtime state calls = %d, want 2", len(quota.stateSubjects))
	}
}

func runtimeNoticeStateWithPercent(percent float64) RuntimeState {
	return RuntimeState{
		Mem9APIKey: RuntimeStateAPIKey{Status: RuntimeAPIKeyStatusUnknown},
		Meters: []RuntimeStateMeter{{
			Meter: MeterMemoryRecallRequests,
			Budgets: []RuntimeStatusBudget{{
				Type:     RuntimeBudgetTypeProviderManaged,
				State:    RuntimeBudgetStateProviderManaged,
				Measure:  RuntimeStatusMeasure{Kind: RuntimeMeasureKindCount, Quantity: "request", Scale: 1},
				Period:   RuntimeStatusPeriod{Type: RuntimePeriodTypeProviderManaged},
				Capacity: RuntimeStatusCapacity{Type: RuntimeCapacityTypeProviderManaged},
				Usage:    &RuntimeStatusUsage{Percent: &percent},
			}},
		}},
		ProviderData: json.RawMessage(`{"bindingState":"claimed"}`),
	}
}

func TestManagerRecallCommitsBeforeMetering(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	manager := NewManager(Config{Enabled: true}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeRecall(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	if err := manager.AfterRecallSuccess(context.Background(), lease, RecallResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"}); err != nil {
		t.Fatalf("AfterRecallSuccess: %v", err)
	}

	if len(quota.reserveOps) != 1 || quota.reserveOps[0].Meter != MeterMemoryRecallRequests || quota.reserveOps[0].Units != 1 {
		t.Fatalf("reserve ops = %+v", quota.reserveOps)
	}
	wantFinalize := lease.OperationID + ":" + ReservationStatusCommitted + ":" + reservationCommitReason
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if len(writer.events) != 1 {
		t.Fatalf("metering events = %+v", writer.events)
	}
	evt := writer.events[0]
	if evt.OperationID != lease.OperationID {
		t.Fatalf("event OperationID = %q, want %q", evt.OperationID, lease.OperationID)
	}
	if evt.APIKeySubject != "tenant-a" || evt.EventType != EventTypeMemoryRecall || evt.Meter != MeterMemoryRecallRequests || evt.Units != 1 {
		t.Fatalf("unexpected event: %+v", evt)
	}
}

func TestManagerMemoryDeleteUsesWriteRequestMeter(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	manager := NewManager(Config{Enabled: true}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	if err := manager.AfterMemoryDeleteSuccess(context.Background(), lease, MemoryDeleteResult{
		MemoryIDs:       []string{"mem-1"},
		AgentName:       "Codex",
		ObjectsAffected: 1,
	}); err != nil {
		t.Fatalf("AfterMemoryDeleteSuccess: %v", err)
	}
	if len(quota.reserveOps) != 1 || quota.reserveOps[0].Meter != MeterMemoryWriteRequests || quota.reserveOps[0].Units != 1 {
		t.Fatalf("reserve ops = %+v", quota.reserveOps)
	}
	wantFinalize := lease.OperationID + ":" + ReservationStatusCommitted + ":" + reservationCommitReason
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if len(writer.events) != 1 {
		t.Fatalf("metering events = %+v, want one", writer.events)
	}
	evt := writer.events[0]
	if evt.EventType != EventTypeMemoryDeleted || evt.Meter != MeterMemoryWriteRequests || evt.Units != 1 {
		t.Fatalf("unexpected event: %+v", evt)
	}
	if evt.Metadata["objectsAffected"] != int64(1) {
		t.Fatalf("metadata = %+v, want objectsAffected=1", evt.Metadata)
	}
}

func TestManagerMemoryUpdateUsesWriteRequestMeter(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	manager := NewManager(Config{Enabled: true}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryUpdate(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeMemoryUpdate: %v", err)
	}
	if err := manager.AfterMemoryUpdateSuccess(context.Background(), lease, MemoryUpdateResult{
		MemoryIDs:       []string{"mem-1"},
		AgentName:       "Codex",
		ObjectsAffected: 1,
	}); err != nil {
		t.Fatalf("AfterMemoryUpdateSuccess: %v", err)
	}
	if len(quota.reserveOps) != 1 || quota.reserveOps[0].Meter != MeterMemoryWriteRequests || quota.reserveOps[0].Units != 1 {
		t.Fatalf("reserve ops = %+v", quota.reserveOps)
	}
	wantFinalize := lease.OperationID + ":" + ReservationStatusCommitted + ":" + reservationCommitReason
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if len(writer.events) != 1 {
		t.Fatalf("metering events = %+v, want one", writer.events)
	}
	evt := writer.events[0]
	if evt.EventType != EventTypeMemoryUpdated || evt.Meter != MeterMemoryWriteRequests || evt.Units != 1 {
		t.Fatalf("unexpected event: %+v", evt)
	}
	if evt.Metadata["objectsAffected"] != int64(1) {
		t.Fatalf("metadata = %+v, want objectsAffected=1", evt.Metadata)
	}
}

func TestManagerMemoryDeleteFailureReleasesReservation(t *testing.T) {
	quota := &fakeQuotaClient{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, &captureWriter{}, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	manager.AfterMemoryDeleteFailure(context.Background(), lease, errString("delete commit failed"))

	wantFinalize := lease.OperationID + ":" + ReservationStatusReleased + ":" + reservationReleaseOperationFailed
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if outbox.releasePending != 1 {
		t.Fatalf("outbox = %+v, want release pending", outbox)
	}
}

func TestManagerFailOpenDoesNotBypassQuotaDenied(t *testing.T) {
	quota := &fakeQuotaClient{reserveErr: &QuotaDeniedError{StatusCode: 402}}
	manager := NewManager(Config{Enabled: true, FailOpen: true}, quota, &captureWriter{}, nil)

	lease, err := manager.BeforeRecall(context.Background(), Subject{TenantID: "tenant-a", APIKeySubject: "tenant-a"})
	if err == nil {
		t.Fatal("BeforeRecall error = nil, want quota denied")
	}
	if lease != nil {
		t.Fatalf("lease = %+v, want nil", lease)
	}
}

func TestManagerCommitFailureWithOutboxQueuesRetryAndReturnsSuccess(t *testing.T) {
	quota := &fakeQuotaClient{finalizeErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeRecall(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	err = manager.AfterRecallSuccess(context.Background(), lease, RecallResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"})
	if err != nil {
		t.Fatalf("AfterRecallSuccess: %v", err)
	}

	if outbox.commitPending != 1 || outbox.retryable != 1 {
		t.Fatalf("outbox = %+v, want recall commit pending and retryable without active reservation write", outbox)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before quota commit", writer.events)
	}
}

func TestManagerMemoryCreateCommitFailureWithOutboxQueuesRetryAndReturnsSuccess(t *testing.T) {
	quota := &fakeQuotaClient{finalizeErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryCreate(context.Background(), subject, 1)
	if err != nil {
		t.Fatalf("BeforeMemoryCreate: %v", err)
	}
	err = manager.AfterMemoryCreateSuccess(context.Background(), lease, MemoryCreateResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"})
	if err != nil {
		t.Fatalf("AfterMemoryCreateSuccess: %v", err)
	}

	if outbox.commitPending != 1 || outbox.retryable != 1 {
		t.Fatalf("outbox = %+v, want memory create commit pending and retryable without active reservation write", outbox)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before quota commit", writer.events)
	}
}

func TestManagerCommitFailureWithoutOutboxReturnsError(t *testing.T) {
	quota := &fakeQuotaClient{finalizeErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	manager := NewManager(Config{Enabled: true}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeRecall(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	err = manager.AfterRecallSuccess(context.Background(), lease, RecallResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"})
	if err == nil {
		t.Fatal("AfterRecallSuccess error = nil, want finalize error without outbox")
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before quota commit", writer.events)
	}
}

func TestManagerMemoryDeleteCommitFailureWithOutboxQueuesRetryAndReturnsSuccess(t *testing.T) {
	quota := &fakeQuotaClient{finalizeErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	err = manager.AfterMemoryDeleteSuccess(context.Background(), lease, MemoryDeleteResult{
		MemoryIDs:       []string{"mem-1"},
		AgentName:       "Codex",
		ObjectsAffected: 1,
	})
	if err != nil {
		t.Fatalf("AfterMemoryDeleteSuccess: %v", err)
	}

	if outbox.commitPending != 1 || outbox.retryable != 1 {
		t.Fatalf("outbox = %+v, want commit pending and retryable", outbox)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before quota commit", writer.events)
	}
}

func TestManagerMemoryDeleteCommitFailureWithoutOutboxReturnsError(t *testing.T) {
	quota := &fakeQuotaClient{finalizeErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	manager := NewManager(Config{Enabled: true}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	err = manager.AfterMemoryDeleteSuccess(context.Background(), lease, MemoryDeleteResult{
		MemoryIDs:       []string{"mem-1"},
		AgentName:       "Codex",
		ObjectsAffected: 1,
	})
	if err == nil {
		t.Fatal("AfterMemoryDeleteSuccess error = nil, want commit error without outbox")
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before quota commit", writer.events)
	}
}

func TestManagerRecallCommitPendingFailureCommitsDirectly(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{commitErr: errString("outbox unavailable")}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeRecall(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	err = manager.AfterRecallSuccess(context.Background(), lease, RecallResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"})
	if err != nil {
		t.Fatalf("AfterRecallSuccess: %v", err)
	}

	wantFinalize := lease.OperationID + ":" + ReservationStatusCommitted + ":" + reservationCommitReason
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if outbox.releasePending != 0 || outbox.done != 1 {
		t.Fatalf("outbox release state = %+v, want no release and best-effort done after successful recall", outbox)
	}
	if len(writer.events) != 1 {
		t.Fatalf("metering events = %+v, want direct metering after commit", writer.events)
	}
}

func TestManagerMemoryCreateCommitPendingFailureCommitsDirectly(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{commitErr: errString("outbox unavailable")}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryCreate(context.Background(), subject, 1)
	if err != nil {
		t.Fatalf("BeforeMemoryCreate: %v", err)
	}
	err = manager.AfterMemoryCreateSuccess(context.Background(), lease, MemoryCreateResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"})
	if err != nil {
		t.Fatalf("AfterMemoryCreateSuccess: %v", err)
	}

	wantFinalize := lease.OperationID + ":" + ReservationStatusCommitted + ":" + reservationCommitReason
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if outbox.releasePending != 0 || outbox.done != 1 {
		t.Fatalf("outbox release state = %+v, want no release and done after successful memory create", outbox)
	}
	if len(writer.events) != 1 {
		t.Fatalf("metering events = %+v, want direct metering after commit", writer.events)
	}
}

func TestManagerCommitPendingFailureAndCommitFailureReturnsErrorWithoutRelease(t *testing.T) {
	quota := &fakeQuotaClient{finalizeErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{commitErr: errString("outbox unavailable")}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeRecall(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	err = manager.AfterRecallSuccess(context.Background(), lease, RecallResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"})
	if err == nil {
		t.Fatal("AfterRecallSuccess error = nil, want non-durable finalization error")
	}
	if outbox.releasePending != 0 || outbox.done != 0 {
		t.Fatalf("outbox release state = %+v, want no release after successful recall", outbox)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before durable quota commit", writer.events)
	}
}

func TestManagerReleaseUsesConsoleSpecReason(t *testing.T) {
	quota := &fakeQuotaClient{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, &captureWriter{}, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeRecall(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	manager.AfterRecallFailure(context.Background(), lease, context.DeadlineExceeded)

	wantFinalize := lease.OperationID + ":" + ReservationStatusReleased + ":" + reservationReleaseTimeout
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if len(outbox.releaseReasons) != 1 || outbox.releaseReasons[0] != reservationReleaseTimeout {
		t.Fatalf("release reasons = %+v, want [%s]", outbox.releaseReasons, reservationReleaseTimeout)
	}
	if len(outbox.retryReasons) != 1 || outbox.retryReasons[0] != "recallFailed: context deadline exceeded" {
		t.Fatalf("retry reasons = %+v, want local failure detail", outbox.retryReasons)
	}
}

func assertFallbackMeter(t *testing.T, state RuntimeState, meter string, budgetType string, budgetState string) {
	t.Helper()
	for _, item := range state.Meters {
		if item.Meter != meter {
			continue
		}
		if len(item.Budgets) != 1 {
			t.Fatalf("%s budgets = %+v, want one", meter, item.Budgets)
		}
		got := item.Budgets[0]
		if got.Type != budgetType || got.State != budgetState {
			t.Fatalf("%s budget = %+v, want type=%s state=%s", meter, got, budgetType, budgetState)
		}
		return
	}
	t.Fatalf("meter %s missing from %+v", meter, state.Meters)
}
