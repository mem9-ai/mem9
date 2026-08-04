package runtimeusage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/metering"
)

type fakeQuotaClient struct {
	mu               sync.Mutex
	reserveOps       []Operation
	reserveSubjects  []Subject
	reserveIDs       []string
	finalized        []string
	finalizeSubjects []Subject
	state            RuntimeState
	stateSubjects    []Subject
	err              error
	stateErr         error
	stateDelay       time.Duration
	reserveErr       error
	reserveErrs      []error
	reserveHook      func(context.Context, Subject, string, Operation) (*Reservation, error)
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

func (c *fakeQuotaClient) Reserve(ctx context.Context, subject Subject, operationID string, op Operation) (*Reservation, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reserveOps = append(c.reserveOps, op)
	c.reserveSubjects = append(c.reserveSubjects, subject)
	c.reserveIDs = append(c.reserveIDs, operationID)
	if c.reserveHook != nil {
		return c.reserveHook(ctx, subject, operationID, op)
	}
	attempt := len(c.reserveOps) - 1
	if attempt < len(c.reserveErrs) && c.reserveErrs[attempt] != nil {
		return nil, c.reserveErrs[attempt]
	}
	if c.reserveErr != nil {
		return nil, c.reserveErr
	}
	if c.err != nil {
		return nil, c.err
	}
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

func TestManagerRuntimeStateKeepsProviderDataWithoutConfiguredProvider(t *testing.T) {
	quota := &fakeQuotaClient{state: RuntimeState{
		Mem9APIKey:   RuntimeStateAPIKey{Status: RuntimeAPIKeyStatusUnknown},
		ProviderID:   "mem9-official",
		ProviderData: json.RawMessage(`{"bindingState":"claimed"}`),
		RecommendedAction: &RuntimeRecommendedAction{
			Type:               "openUrl",
			ProviderActionCode: "upgradePlan",
			Severity:           "warning",
			URL:                "https://example.com/provider/billing/plan",
		},
		Meters: []RuntimeStateMeter{{
			Meter: MeterMemoryRecallRequests,
			Budgets: []RuntimeStatusBudget{{
				Type:     RuntimeBudgetTypeNotMetered,
				State:    RuntimeBudgetStateUnlimited,
				Measure:  RuntimeStatusMeasure{Kind: RuntimeMeasureKindCount, Quantity: "request", Scale: 1},
				Period:   RuntimeStatusPeriod{Type: RuntimePeriodTypeNone},
				Capacity: RuntimeStatusCapacity{Type: RuntimeCapacityTypeUnlimited},
			}},
		}},
	}}
	manager := NewManager(Config{Enabled: true}, quota, nil, nil)

	state, err := manager.RuntimeState(context.Background(), Subject{APIKeySubject: "mem9_test"})
	if err != nil {
		t.Fatalf("RuntimeState: %v", err)
	}
	if state.ProviderID != "" {
		t.Fatalf("ProviderID = %q, want empty when provider is not configured", state.ProviderID)
	}
	if string(state.ProviderData) != `{"bindingState":"claimed"}` {
		t.Fatalf("ProviderData = %s, want upstream provider data when provider is not configured", state.ProviderData)
	}
	if state.RecommendedAction == nil || state.RecommendedAction.ProviderActionCode != "upgradePlan" {
		t.Fatalf("RecommendedAction = %+v, want preserved when provider is not configured", state.RecommendedAction)
	}
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

func TestManagerReservationRetriesKeepStableRequestIdentity(t *testing.T) {
	tests := []struct {
		name        string
		meter       string
		chooseUpper []bool
		wantDelays  []time.Duration
		before      func(Manager, context.Context, Subject) (*OperationLease, error)
	}{
		{
			name:        "recall",
			meter:       MeterMemoryRecallRequests,
			chooseUpper: []bool{false, true},
			wantDelays:  []time.Duration{400 * time.Millisecond, 800 * time.Millisecond},
			before: func(manager Manager, ctx context.Context, subject Subject) (*OperationLease, error) {
				return manager.BeforeRecall(ctx, subject)
			},
		},
		{
			name:        "write",
			meter:       MeterMemoryWriteRequests,
			chooseUpper: []bool{true, false},
			wantDelays:  []time.Duration{600 * time.Millisecond, 600 * time.Millisecond},
			before: func(manager Manager, ctx context.Context, subject Subject) (*OperationLease, error) {
				return manager.BeforeMemoryCreate(ctx, subject, 1)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			quota := &fakeQuotaClient{reserveErrs: []error{
				newReservationError(reservationErrorCodeRegistryConflict, true, 0),
				newReservationError(reservationErrorCodeUnavailable, true, 0),
				nil,
			}}
			runtimeManager := NewManager(Config{
				Enabled:                   true,
				ReservationRetryBaseDelay: 400 * time.Millisecond,
				ReservationRetryMaxDelay:  800 * time.Millisecond,
			}, quota, &captureWriter{}, nil)
			concrete := runtimeManager.(*manager)
			var delays []time.Duration
			concrete.wait = func(_ context.Context, delay time.Duration) error {
				delays = append(delays, delay)
				return nil
			}
			randomCalls := 0
			concrete.randomInt64N = func(n int64) int64 {
				if n != int64(200*time.Millisecond)+1 {
					t.Fatalf("random range width = %d, want %d", n, int64(200*time.Millisecond)+1)
				}
				chooseUpper := tt.chooseUpper[randomCalls]
				randomCalls++
				if chooseUpper {
					return n - 1
				}
				return 0
			}

			subject := Subject{
				TenantID:      "tenant-a",
				ClusterID:     "cluster-a",
				APIKeySubject: "api-key-subject",
				AgentName:     "Codex",
			}
			lease, err := tt.before(runtimeManager, context.Background(), subject)
			if err != nil {
				t.Fatalf("Before operation: %v", err)
			}
			if lease == nil || !lease.Reserved {
				t.Fatal("Before operation returned no active reservation")
			}
			if len(quota.reserveOps) != 3 {
				t.Fatalf("Reserve attempts = %d, want 3", len(quota.reserveOps))
			}
			for attempt := range quota.reserveOps {
				if quota.reserveIDs[attempt] != lease.OperationID {
					t.Fatalf("attempt %d changed the operation ID", attempt+1)
				}
				if quota.reserveSubjects[attempt] != subject {
					t.Fatalf("attempt %d changed the reservation subject", attempt+1)
				}
				if quota.reserveOps[attempt] != (Operation{Meter: tt.meter, Units: 1}) {
					t.Fatalf("attempt %d changed the reservation operation", attempt+1)
				}
			}
			if len(delays) != len(tt.wantDelays) || delays[0] != tt.wantDelays[0] || delays[1] != tt.wantDelays[1] {
				t.Fatalf("retry delays = %v, want %v", delays, tt.wantDelays)
			}
		})
	}
}

func TestManagerReservationRetriesKeepStableSerializedHTTPRequest(t *testing.T) {
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", 750*time.Millisecond)
	var paths []string
	var subjects []string
	var bodies []string
	client.client = &http.Client{
		Timeout: 750 * time.Millisecond,
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("read request body: %v", err)
			}
			paths = append(paths, req.URL.Path)
			subjects = append(subjects, req.Header.Get("X-API-Key"))
			bodies = append(bodies, string(body))
			switch len(bodies) {
			case 1:
				return statusJSONResponse(
					http.StatusConflict,
					`{"code":"registry_conflict","message":"registry changed","details":{"retryable":true}}`,
					nil,
				), nil
			case 2:
				return statusJSONResponse(
					http.StatusServiceUnavailable,
					`{"code":"unavailable","message":"try again","details":{"retryable":true}}`,
					nil,
				), nil
			default:
				return jsonResponse(`{"status":"reserved"}`), nil
			}
		}),
	}
	runtimeManager := NewManager(Config{Enabled: true}, client, &captureWriter{}, nil)
	concrete := runtimeManager.(*manager)
	concrete.wait = func(context.Context, time.Duration) error { return nil }

	lease, err := runtimeManager.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	if lease == nil || !lease.Reserved {
		t.Fatal("BeforeRecall returned no active reservation")
	}
	if client.client.Timeout != 750*time.Millisecond {
		t.Fatalf("HTTP timeout = %v, want 750ms", client.client.Timeout)
	}
	if len(paths) != reservationMaxAttempts {
		t.Fatalf("request count = %d, want %d", len(paths), reservationMaxAttempts)
	}
	wantPath := "/api/internal/quota/reservations/" + lease.OperationID
	for attempt := range paths {
		if paths[attempt] != wantPath {
			t.Fatalf("attempt %d changed the request path", attempt+1)
		}
		if subjects[attempt] != "api-key-subject" {
			t.Fatalf("attempt %d changed the API key subject", attempt+1)
		}
		if bodies[attempt] != bodies[0] {
			t.Fatalf("attempt %d changed the serialized request body", attempt+1)
		}
	}
	var operation Operation
	if err := json.Unmarshal([]byte(bodies[0]), &operation); err != nil {
		t.Fatalf("decode reservation request body: %v", err)
	}
	if operation != (Operation{Meter: MeterMemoryRecallRequests, Units: 1}) {
		t.Fatal("reservation request body has unexpected semantics")
	}
}

func TestManagerReservationRateLimitsUseGreaterDelay(t *testing.T) {
	tests := []struct {
		name       string
		baseDelay  time.Duration
		maxDelay   time.Duration
		retryAfter string
		random     func(int64) int64
		wantDelay  time.Duration
	}{
		{
			name:       "retry after exceeds jitter",
			baseDelay:  400 * time.Millisecond,
			maxDelay:   800 * time.Millisecond,
			retryAfter: "1",
			random:     func(int64) int64 { return 0 },
			wantDelay:  time.Second,
		},
		{
			name:       "jitter exceeds retry after",
			baseDelay:  time.Second,
			maxDelay:   2 * time.Second,
			retryAfter: "1",
			random:     func(n int64) int64 { return n - 1 },
			wantDelay:  1500 * time.Millisecond,
		},
	}

	for _, code := range []reservationErrorCode{
		reservationErrorCodeOperationInProgress,
		reservationErrorCodeRegistryBusy,
		reservationErrorCodeConcurrencyLimited,
	} {
		for _, tt := range tests {
			t.Run(string(code)+"/"+tt.name, func(t *testing.T) {
				attempts := 0
				client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
				client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
					attempts++
					if attempts == 1 {
						return statusJSONResponse(
							http.StatusTooManyRequests,
							`{"code":"`+string(code)+`","details":{"retryable":true}}`,
							http.Header{"Retry-After": []string{tt.retryAfter}},
						), nil
					}
					return jsonResponse(`{"status":"reserved"}`), nil
				})}
				runtimeManager := NewManager(Config{
					Enabled:                   true,
					ReservationRetryBaseDelay: tt.baseDelay,
					ReservationRetryMaxDelay:  tt.maxDelay,
				}, client, &captureWriter{}, nil)
				concrete := runtimeManager.(*manager)
				var delays []time.Duration
				concrete.wait = func(_ context.Context, delay time.Duration) error {
					delays = append(delays, delay)
					return nil
				}
				concrete.randomInt64N = tt.random

				lease, err := runtimeManager.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
				if err != nil {
					t.Fatalf("BeforeRecall: %v", err)
				}
				if lease == nil || !lease.Reserved {
					t.Fatal("BeforeRecall returned no active reservation")
				}
				if attempts != 2 {
					t.Fatalf("Reserve attempts = %d, want 2", attempts)
				}
				if len(delays) != 1 || delays[0] != tt.wantDelay {
					t.Fatalf("retry delays = %v, want [%v]", delays, tt.wantDelay)
				}
			})
		}
	}
}

func TestManagerReservationRetriesEachAllowedCode(t *testing.T) {
	for _, tt := range reservationContractCases {
		contractPolicy, _ := tt.code.policy()
		if !contractPolicy.retryable {
			continue
		}
		t.Run(tt.name, func(t *testing.T) {
			attempts := 0
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				attempts++
				if attempts == 1 {
					writeReservationContractError(w, tt)
					return
				}
				_, _ = io.WriteString(w, `{"status":"reserved"}`)
			}))
			defer provider.Close()

			client := NewHTTPClient(provider.URL, "secret", time.Second)
			runtimeManager := NewManager(Config{Enabled: true}, client, &captureWriter{}, nil)
			concrete := runtimeManager.(*manager)
			var delays []time.Duration
			concrete.wait = func(_ context.Context, delay time.Duration) error {
				delays = append(delays, delay)
				return nil
			}

			lease, err := runtimeManager.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
			if err != nil {
				t.Fatalf("BeforeRecall: %v", err)
			}
			if lease == nil || !lease.Reserved {
				t.Fatal("retryable reservation returned no active lease")
			}
			if attempts != 2 {
				t.Fatalf("Reserve attempts = %d, want 2", attempts)
			}
			if len(delays) != 1 {
				t.Fatalf("retry delays = %d, want 1", len(delays))
			}
		})
	}
}

func TestManagerReservationRetriesStopOnCallerCancellation(t *testing.T) {
	t.Run("active request", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		entered := make(chan struct{})
		client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
		client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			close(entered)
			timer := time.NewTimer(time.Second)
			defer timer.Stop()
			select {
			case <-req.Context().Done():
				return nil, req.Context().Err()
			case <-timer.C:
				return nil, errors.New("request context remained active")
			}
		})}
		runtimeManager := NewManager(Config{Enabled: true, FailOpen: true}, client, &captureWriter{}, nil)
		result := make(chan error, 1)
		go func() {
			lease, err := runtimeManager.BeforeRecall(ctx, Subject{APIKeySubject: "api-key-subject"})
			if lease != nil {
				result <- errors.New("caller cancellation returned a lease")
				return
			}
			result <- err
		}()

		awaitTestSignal(t, entered)
		cancel()
		err := awaitTestError(t, result)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("BeforeRecall error = %v, want context canceled", err)
		}
	})

	t.Run("retry delay", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		quota := &fakeQuotaClient{reserveErr: newReservationError(reservationErrorCodeRegistryConflict, true, 0)}
		runtimeManager := NewManager(Config{Enabled: true, FailOpen: true}, quota, &captureWriter{}, nil)
		concrete := runtimeManager.(*manager)
		entered := make(chan struct{})
		concrete.wait = func(ctx context.Context, delay time.Duration) error {
			close(entered)
			return waitForContext(ctx, delay)
		}
		result := make(chan error, 1)
		go func() {
			lease, err := runtimeManager.BeforeRecall(ctx, Subject{APIKeySubject: "api-key-subject"})
			if lease != nil {
				result <- errors.New("retry cancellation returned a lease")
				return
			}
			result <- err
		}()

		awaitTestSignal(t, entered)
		cancel()
		err := awaitTestError(t, result)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("BeforeRecall error = %v, want context canceled", err)
		}
		if len(quota.reserveOps) != 1 {
			t.Fatalf("Reserve attempts = %d, want 1", len(quota.reserveOps))
		}
	})
}

func TestManagerEachReservationAttemptGetsFreshHTTPClientTimeout(t *testing.T) {
	const attemptTimeout = 25 * time.Millisecond
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", attemptTimeout)
	var deadlines []time.Time
	client.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		deadline, ok := req.Context().Deadline()
		if !ok {
			return nil, errors.New("request has no deadline")
		}
		deadlines = append(deadlines, deadline)
		if len(deadlines) == 1 {
			return statusJSONResponse(
				http.StatusServiceUnavailable,
				`{"code":"unavailable","details":{"retryable":true}}`,
				nil,
			), nil
		}
		timer := time.NewTimer(time.Second)
		defer timer.Stop()
		select {
		case <-req.Context().Done():
			return nil, req.Context().Err()
		case <-timer.C:
			return nil, errors.New("request deadline was not enforced")
		}
	})
	runtimeManager := NewManager(Config{Enabled: true}, client, &captureWriter{}, nil)
	runtimeManager.(*manager).wait = func(context.Context, time.Duration) error { return nil }

	lease, err := runtimeManager.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("BeforeRecall error = %v, want deadline exceeded", err)
	}
	if lease != nil {
		t.Fatal("timed-out reservation returned a lease")
	}
	if len(deadlines) != 2 {
		t.Fatalf("Reservation attempts = %d, want 2", len(deadlines))
	}
	if !deadlines[1].After(deadlines[0]) {
		t.Fatal("second Reservation attempt did not receive a fresh timeout deadline")
	}
}

func TestManagerDefaultReservationRetryJitterRanges(t *testing.T) {
	runtimeManager := NewManager(Config{Enabled: true}, &fakeQuotaClient{}, &captureWriter{}, nil)
	concrete := runtimeManager.(*manager)
	if concrete.cfg.ReservationRetryBaseDelay != DefaultReservationRetryBaseDelay {
		t.Fatalf("default base delay = %v, want %v", concrete.cfg.ReservationRetryBaseDelay, DefaultReservationRetryBaseDelay)
	}
	if concrete.cfg.ReservationRetryMaxDelay != DefaultReservationRetryMaxDelay {
		t.Fatalf("default maximum delay = %v, want %v", concrete.cfg.ReservationRetryMaxDelay, DefaultReservationRetryMaxDelay)
	}

	err := newReservationError(reservationErrorCodeUnavailable, true, 0)
	concrete.randomInt64N = func(int64) int64 { return 0 }
	if got := concrete.reservationRetryDelay(0, err); got != 500*time.Millisecond {
		t.Fatalf("first retry lower bound = %v, want 500ms", got)
	}
	if got := concrete.reservationRetryDelay(1, err); got != 750*time.Millisecond {
		t.Fatalf("second retry lower bound = %v, want 750ms", got)
	}
	concrete.randomInt64N = func(n int64) int64 { return n - 1 }
	if got := concrete.reservationRetryDelay(0, err); got != 750*time.Millisecond {
		t.Fatalf("first retry upper bound = %v, want 750ms", got)
	}
	if got := concrete.reservationRetryDelay(1, err); got != time.Second {
		t.Fatalf("second retry upper bound = %v, want 1s", got)
	}

	conflictWithRetryAfter := newReservationError(reservationErrorCodeRegistryConflict, true, time.Hour)
	concrete.randomInt64N = func(int64) int64 { return 0 }
	if got := concrete.reservationRetryDelay(0, conflictWithRetryAfter); got != 500*time.Millisecond {
		t.Fatalf("registry conflict retry delay = %v, want jitter-only 500ms", got)
	}
}

func TestManagerConcurrentReservationsRetryWithStableUniqueIdentity(t *testing.T) {
	const concurrentReservations = 64
	attemptsByOperation := make(map[string]int)
	firstSubjects := make(map[string]Subject)
	firstOperations := make(map[string]Operation)
	quota := &fakeQuotaClient{}
	quota.reserveHook = func(_ context.Context, subject Subject, operationID string, op Operation) (*Reservation, error) {
		attemptsByOperation[operationID]++
		switch attemptsByOperation[operationID] {
		case 1:
			firstSubjects[operationID] = subject
			firstOperations[operationID] = op
			return nil, newReservationError(reservationErrorCodeUnavailable, true, 0)
		case 2:
			if firstSubjects[operationID] != subject || firstOperations[operationID] != op {
				return nil, errors.New("Reservation retry changed request identity")
			}
			return &Reservation{OperationID: operationID, Meter: op.Meter, Units: op.Units, Status: "reserved"}, nil
		default:
			return nil, errors.New("Reservation exceeded two attempts")
		}
	}
	concrete := NewManager(Config{Enabled: true}, quota, &captureWriter{}, nil).(*manager)
	concrete.wait = func(context.Context, time.Duration) error { return nil }
	errCh := make(chan error, concurrentReservations)
	var workers sync.WaitGroup
	for range concurrentReservations {
		workers.Add(1)
		go func() {
			defer workers.Done()
			lease, err := concrete.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
			if err != nil {
				errCh <- err
				return
			}
			if lease == nil || !lease.Reserved {
				errCh <- errors.New("concurrent Reservation returned no active lease")
			}
		}()
	}
	workers.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatal(err)
	}
	if len(attemptsByOperation) != concurrentReservations {
		t.Fatalf("unique operation IDs = %d, want %d", len(attemptsByOperation), concurrentReservations)
	}
	for _, attempts := range attemptsByOperation {
		if attempts != 2 {
			t.Fatalf("attempts for one operation = %d, want 2", attempts)
		}
	}
}

func TestManagerRetriedReservationCompletesSuccessLifecycle(t *testing.T) {
	tests := []struct {
		name   string
		before func(Manager, context.Context, Subject) (*OperationLease, error)
		finish func(Manager, context.Context, *OperationLease) error
		meter  string
		event  string
	}{
		{
			name: "recall",
			before: func(manager Manager, ctx context.Context, subject Subject) (*OperationLease, error) {
				return manager.BeforeRecall(ctx, subject)
			},
			finish: func(manager Manager, ctx context.Context, lease *OperationLease) error {
				return manager.AfterRecallSuccess(ctx, lease, RecallResult{AgentName: "test-agent"})
			},
			meter: MeterMemoryRecallRequests,
			event: EventTypeMemoryRecall,
		},
		{
			name: "write",
			before: func(manager Manager, ctx context.Context, subject Subject) (*OperationLease, error) {
				return manager.BeforeMemoryCreate(ctx, subject, 1)
			},
			finish: func(manager Manager, ctx context.Context, lease *OperationLease) error {
				return manager.AfterMemoryCreateSuccess(ctx, lease, MemoryCreateResult{AgentName: "test-agent", ObjectsAffected: 1})
			},
			meter: MeterMemoryWriteRequests,
			event: EventTypeMemoryCreated,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			quota := &fakeQuotaClient{reserveErrs: []error{
				newReservationError(reservationErrorCodeUnavailable, true, 0),
				nil,
			}}
			writer := &captureWriter{}
			outbox := &fakeOutboxStore{}
			runtimeManager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
			runtimeManager.(*manager).wait = func(context.Context, time.Duration) error { return nil }

			lease, err := tt.before(runtimeManager, context.Background(), Subject{APIKeySubject: "api-key-subject"})
			if err != nil {
				t.Fatalf("Before operation: %v", err)
			}
			if err := tt.finish(runtimeManager, context.Background(), lease); err != nil {
				t.Fatalf("After success: %v", err)
			}
			if len(quota.reserveOps) != 2 {
				t.Fatalf("Reserve attempts = %d, want 2", len(quota.reserveOps))
			}
			if len(quota.finalized) != 1 {
				t.Fatalf("Finalize calls = %d, want 1", len(quota.finalized))
			}
			if outbox.commitPending != 1 {
				t.Fatalf("outbox commit-pending calls = %d, want 1", outbox.commitPending)
			}
			if len(writer.events) != 1 {
				t.Fatalf("metering events = %d, want 1", len(writer.events))
			}
			if writer.events[0].Meter != tt.meter || writer.events[0].EventType != tt.event {
				t.Fatal("success lifecycle recorded unexpected metering semantics")
			}
		})
	}
}

func TestManagerSuccessfulFinalizeBodyFailuresDoNotQueueRetry(t *testing.T) {
	for _, tt := range successfulFinalizeBodyFailureCases() {
		t.Run(tt.name, func(t *testing.T) {
			reserveCalls := 0
			finalizeCalls := 0
			client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
			client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				switch req.Method {
				case http.MethodPut:
					reserveCalls++
					return jsonResponse(`{"status":"reserved"}`), nil
				case http.MethodPatch:
					finalizeCalls++
					return &http.Response{
						StatusCode: http.StatusOK,
						Header:     make(http.Header),
						Body:       tt.body(),
					}, nil
				default:
					return nil, errors.New("unexpected runtime usage method")
				}
			})}
			writer := &captureWriter{}
			outbox := &fakeOutboxStore{}
			runtimeManager := NewManager(Config{Enabled: true, Outbox: outbox}, client, writer, nil)

			lease, err := runtimeManager.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
			if err != nil {
				t.Fatalf("BeforeRecall: %v", err)
			}
			if err := runtimeManager.AfterRecallSuccess(context.Background(), lease, RecallResult{AgentName: "test-agent"}); err != nil {
				t.Fatalf("AfterRecallSuccess: %v", err)
			}
			if reserveCalls != 1 || finalizeCalls != 1 {
				t.Fatalf("runtime usage calls = reserve %d, finalize %d; want 1 each", reserveCalls, finalizeCalls)
			}
			if outbox.commitPending != 1 || outbox.retryable != 0 {
				t.Fatalf("outbox calls = commit pending %d, retryable %d; want 1, 0", outbox.commitPending, outbox.retryable)
			}
			if len(writer.events) != 1 {
				t.Fatalf("metering events = %d, want 1", len(writer.events))
			}
		})
	}
}

func TestManagerReservationRetryExhaustionAppliesDeploymentPolicy(t *testing.T) {
	policies := []struct {
		name     string
		failOpen bool
	}{
		{name: "fail closed"},
		{name: "fail open", failOpen: true},
	}

	for _, contract := range reservationContractCases {
		contractPolicy, _ := contract.code.policy()
		if !contractPolicy.retryable {
			continue
		}
		for _, policy := range policies {
			t.Run(contract.name+"/"+policy.name, func(t *testing.T) {
				attempts := 0
				provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					attempts++
					writeReservationContractError(w, contract)
				}))
				defer provider.Close()

				client := NewHTTPClient(provider.URL, "secret", time.Second)
				runtimeManager := NewManager(Config{Enabled: true, FailOpen: policy.failOpen}, client, &captureWriter{}, nil)
				concrete := runtimeManager.(*manager)
				var delays []time.Duration
				concrete.wait = func(_ context.Context, delay time.Duration) error {
					delays = append(delays, delay)
					return nil
				}

				lease, err := runtimeManager.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
				if policy.failOpen {
					if err != nil {
						t.Fatalf("BeforeRecall: %v", err)
					}
					if lease == nil || lease.Reserved {
						t.Fatal("retry exhaustion returned an unexpected fail-open lease state")
					}
				} else {
					var reservationErr *reservationError
					if !errors.As(err, &reservationErr) {
						t.Fatalf("BeforeRecall error = %T, want structured reservation error", err)
					}
					if lease != nil {
						t.Fatal("fail-closed retry exhaustion returned a lease")
					}
					wantStatus := http.StatusServiceUnavailable
					if contract.status == http.StatusTooManyRequests {
						wantStatus = http.StatusTooManyRequests
					}
					if got := HTTPStatus(err); got != wantStatus {
						t.Fatalf("HTTPStatus = %d, want %d", got, wantStatus)
					}
					details, ok := ReservationFailureDetails(err)
					if !ok || details.UpstreamStatus != contract.status || details.Code != string(contract.code) || !details.Retryable || details.AttemptCount != reservationMaxAttempts || details.RetryDecision != string(reservationRetryDecisionExhausted) || details.ExhaustionReason != string(reservationExhaustionMaxAttempts) {
						t.Fatalf("ReservationFailureDetails = %+v, %v", details, ok)
					}
				}
				if attempts != reservationMaxAttempts {
					t.Fatalf("Reserve attempts = %d, want %d", attempts, reservationMaxAttempts)
				}
				if len(delays) != reservationMaxAttempts-1 {
					t.Fatalf("retry delays = %d, want %d", len(delays), reservationMaxAttempts-1)
				}
			})
		}
	}
}

func writeReservationContractError(w http.ResponseWriter, contract reservationContractCase) {
	w.Header().Set("Content-Type", "application/json")
	if contract.retryAfter != "" {
		w.Header().Set("Retry-After", contract.retryAfter)
	}
	w.WriteHeader(contract.status)
	_, _ = io.WriteString(w, `{"code":"`+string(contract.code)+`","details":{"retryable":true}}`)
}

func TestManagerUnknownReservationResponsesDoNotRetry(t *testing.T) {
	tests := []struct {
		name             string
		status           int
		body             string
		retryAfter       string
		failOpen         bool
		wantPublicStatus int
		wantFailOpen     bool
	}{
		{
			name:             "old operation in progress conflict uses unknown conflict policy",
			status:           http.StatusConflict,
			body:             `{"code":"operation_in_progress","details":{"retryable":true}}`,
			failOpen:         true,
			wantPublicStatus: http.StatusServiceUnavailable,
		},
		{
			name:             "unknown rate limit fails closed as rate limit",
			status:           http.StatusTooManyRequests,
			body:             `{"code":"future_rate_limit","details":{"retryable":true}}`,
			retryAfter:       "2",
			wantPublicStatus: http.StatusTooManyRequests,
		},
		{
			name:         "unknown rate limit preserves fail open",
			status:       http.StatusTooManyRequests,
			body:         `{"code":"future_rate_limit","details":{"retryable":true}}`,
			retryAfter:   "2",
			failOpen:     true,
			wantFailOpen: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			attempts := 0
			client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
			client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				attempts++
				header := make(http.Header)
				if tt.retryAfter != "" {
					header.Set("Retry-After", tt.retryAfter)
				}
				return statusJSONResponse(tt.status, tt.body, header), nil
			})}
			concrete := NewManager(Config{Enabled: true, FailOpen: tt.failOpen}, client, &captureWriter{}, nil).(*manager)
			concrete.wait = func(context.Context, time.Duration) error {
				t.Fatal("unknown Reservation response entered retry delay")
				return nil
			}

			lease, err := concrete.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
			if attempts != 1 {
				t.Fatalf("Reserve attempts = %d, want 1", attempts)
			}
			if tt.wantFailOpen {
				if err != nil || lease == nil || lease.Reserved {
					t.Fatalf("fail-open result = (%v, %v), want unreserved lease", lease, err)
				}
				return
			}
			if err == nil || lease != nil {
				t.Fatalf("fail-closed result = (%v, %v), want error", lease, err)
			}
			if got := HTTPStatus(err); got != tt.wantPublicStatus {
				t.Fatalf("HTTPStatus = %d, want %d", got, tt.wantPublicStatus)
			}
			details, ok := ReservationFailureDetails(err)
			if !ok || details.Code != "unknown" || details.AttemptCount != 1 || details.RetryDecision != "terminal" || details.ExhaustionReason != "unrecognized_contract" {
				t.Fatalf("ReservationFailureDetails = %+v, %v", details, ok)
			}
		})
	}
}

func TestManagerReservationTerminalFailuresUseOneAttempt(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		failOpen bool
	}{
		{name: "quota denied", err: &QuotaDeniedError{StatusCode: http.StatusPaymentRequired}},
		{name: "post quota rate limited", err: &QuotaDeniedError{StatusCode: http.StatusTooManyRequests}},
		{name: "permanent operation conflict", err: newReservationError(reservationErrorCodeOperationConflict, false, 0)},
		{name: "permanent operation conflict with fail open", err: newReservationError(reservationErrorCodeOperationConflict, false, 0), failOpen: true},
		{name: "allowlisted code marked terminal", err: newReservationError(reservationErrorCodeUnavailable, false, 0)},
		{name: "unknown structured code", err: newReservationError(reservationErrorCode("future_retryable"), true, 0)},
		{name: "legacy conflict", err: &ConflictError{StatusCode: http.StatusConflict}},
		{name: "invalid or authentication response", err: &UnavailableError{Err: errString("terminal response")}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			quota := &fakeQuotaClient{reserveErr: tt.err}
			runtimeManager := NewManager(Config{Enabled: true, FailOpen: tt.failOpen}, quota, &captureWriter{}, nil)
			concrete := runtimeManager.(*manager)
			concrete.wait = func(context.Context, time.Duration) error {
				t.Fatal("terminal failure entered retry delay")
				return nil
			}

			lease, err := runtimeManager.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
			if err == nil {
				t.Fatal("BeforeRecall error = nil")
			}
			if lease != nil {
				t.Fatal("terminal reservation failure returned a lease")
			}
			if len(quota.reserveOps) != 1 {
				t.Fatalf("Reserve attempts = %d, want 1", len(quota.reserveOps))
			}
		})
	}
}

func TestManagerNonRetryableReservationConflictPreservesFailOpenFence(t *testing.T) {
	attempts := 0
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
	client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		attempts++
		return statusJSONResponse(
			http.StatusConflict,
			`{"code":"registry_conflict","details":{"retryable":false}}`,
			nil,
		), nil
	})}
	runtimeManager := NewManager(Config{Enabled: true, FailOpen: true}, client, &captureWriter{}, nil)
	runtimeManager.(*manager).wait = func(context.Context, time.Duration) error {
		t.Fatal("non-retryable conflict entered retry delay")
		return nil
	}

	lease, err := runtimeManager.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
	var conflict *ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("BeforeRecall error = %T, want legacy conflict", err)
	}
	if lease != nil {
		t.Fatal("fail-open reservation conflict returned a lease")
	}
	if attempts != 1 {
		t.Fatalf("Reservation attempts = %d, want 1", attempts)
	}
}

func TestManagerOversizedQuotaDenialPreservesFailOpenFence(t *testing.T) {
	attempts := 0
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
	client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		attempts++
		return statusJSONResponse(http.StatusPaymentRequired, strings.Repeat("x", maxResponseBodyBytes+1), nil), nil
	})}
	runtimeManager := NewManager(Config{Enabled: true, FailOpen: true}, client, &captureWriter{}, nil)
	runtimeManager.(*manager).wait = func(context.Context, time.Duration) error {
		t.Fatal("quota denial entered retry delay")
		return nil
	}

	lease, err := runtimeManager.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
	var denied *QuotaDeniedError
	if !errors.As(err, &denied) || denied.Status() != http.StatusPaymentRequired {
		t.Fatalf("BeforeRecall error = %T, want quota denial", err)
	}
	if lease != nil {
		t.Fatal("fail-open quota denial returned a lease")
	}
	if attempts != 1 {
		t.Fatalf("Reservation attempts = %d, want 1", attempts)
	}
}

func TestManagerOversizedPostQuotaDenialPreservesFailOpenFence(t *testing.T) {
	attempts := 0
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
	client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		attempts++
		body := oversizedResponseWithPrefix(postQuotaRateLimitBody)
		return statusJSONResponse(http.StatusTooManyRequests, body, http.Header{"Retry-After": []string{"20"}}), nil
	})}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	runtimeManager := NewManager(Config{Enabled: true, FailOpen: true}, client, &captureWriter{}, logger)
	runtimeManager.(*manager).wait = func(context.Context, time.Duration) error {
		t.Fatal("post-quota denial entered retry delay")
		return nil
	}

	lease, err := runtimeManager.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
	var denied *QuotaDeniedError
	if !errors.As(err, &denied) || denied.Status() != http.StatusTooManyRequests {
		t.Fatalf("BeforeRecall error = %T, want post-quota denial", err)
	}
	if lease != nil {
		t.Fatal("fail-open post-quota denial returned a lease")
	}
	if attempts != 1 {
		t.Fatalf("Reservation attempts = %d, want 1", attempts)
	}
}

func TestManagerQuotaShapeTakesPrecedenceOverReservationCode(t *testing.T) {
	attempts := 0
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
	client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		attempts++
		return statusJSONResponse(
			http.StatusTooManyRequests,
			overlappingReservationQuotaBody,
			http.Header{"Retry-After": []string{"20"}},
		), nil
	})}
	runtimeManager := NewManager(Config{Enabled: true, FailOpen: true}, client, &captureWriter{}, nil)
	runtimeManager.(*manager).wait = func(context.Context, time.Duration) error {
		t.Fatal("quota denial entered retry delay")
		return nil
	}

	lease, err := runtimeManager.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
	var denied *QuotaDeniedError
	if !errors.As(err, &denied) || denied.Status() != http.StatusTooManyRequests {
		t.Fatalf("BeforeRecall error = %T, want post-quota denial", err)
	}
	if lease != nil {
		t.Fatal("fail-open quota denial returned a lease")
	}
	if attempts != 1 {
		t.Fatalf("Reservation attempts = %d, want 1", attempts)
	}
}

func TestManagerOversizedConflictPreservesFailOpenFence(t *testing.T) {
	attempts := 0
	client := NewHTTPClient("https://runtime-usage.example.com", "secret", time.Second)
	client.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		attempts++
		return statusJSONResponse(http.StatusConflict, strings.Repeat("x", maxResponseBodyBytes+1), nil), nil
	})}
	runtimeManager := NewManager(Config{Enabled: true, FailOpen: true}, client, &captureWriter{}, nil)
	runtimeManager.(*manager).wait = func(context.Context, time.Duration) error {
		t.Fatal("conflict entered retry delay")
		return nil
	}

	lease, err := runtimeManager.BeforeRecall(context.Background(), Subject{APIKeySubject: "api-key-subject"})
	var conflict *ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("BeforeRecall error = %T, want conflict", err)
	}
	if lease != nil {
		t.Fatal("fail-open conflict returned a lease")
	}
	if attempts != 1 {
		t.Fatalf("Reservation attempts = %d, want 1", attempts)
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

func awaitTestSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for test rendezvous")
	}
}

func awaitTestError(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for operation result")
		return nil
	}
}
