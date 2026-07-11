package runtimeusage

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

type noticeStateCache struct {
	enabled  bool
	timeout  time.Duration
	ttl      time.Duration
	staleTTL time.Duration
	key      []byte
	now      func() time.Time
	fetch    func(context.Context, Subject) (RuntimeState, error)

	entries map[string]noticeStateEntry
	group   singleflight.Group
	mu      sync.Mutex
}

type noticeStateEntry struct {
	state     RuntimeState
	fetchedAt time.Time
}

func newNoticeStateCache(cfg Config, fetch func(context.Context, Subject) (RuntimeState, error)) *noticeStateCache {
	timeout := cfg.NoticeTimeout
	if timeout <= 0 {
		timeout = time.Second
	}
	ttl := cfg.NoticeCacheTTL
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	staleTTL := cfg.NoticeStaleTTL
	if staleTTL < 0 {
		staleTTL = 0
	}
	return &noticeStateCache{
		enabled:  cfg.NoticeCacheEnabled,
		timeout:  timeout,
		ttl:      ttl,
		staleTTL: staleTTL,
		key:      noticeDigestKey(cfg),
		now:      time.Now,
		fetch:    fetch,
		entries:  make(map[string]noticeStateEntry),
	}
}

func noticeDigestKey(cfg Config) []byte {
	if cfg.InternalSecret != "" {
		sum := sha256.Sum256([]byte(cfg.InternalSecret))
		return sum[:]
	}
	key := make([]byte, sha256.Size)
	if _, err := rand.Read(key); err == nil {
		return key
	}
	sum := sha256.Sum256([]byte(time.Now().UTC().String()))
	return sum[:]
}

func (c *noticeStateCache) runtimeState(ctx context.Context, subject Subject) (RuntimeState, error) {
	if c == nil {
		return RuntimeState{}, nil
	}
	if !c.enabled || subject.APIKeySubject == "" {
		state, err := c.fetchWithTimeout(ctx, subject)
		if err != nil {
			return RuntimeState{}, err
		}
		return cloneRuntimeStateForSubject(state, subject), nil
	}

	now := c.now()
	key := c.cacheKey(subject.APIKeySubject)
	if state, ok := c.fresh(key, now); ok {
		return cloneRuntimeStateForSubject(state, subject), nil
	}

	result, err, _ := c.group.Do(key, func() (any, error) {
		now := c.now()
		if state, ok := c.fresh(key, now); ok {
			return state, nil
		}
		state, fetchErr := c.fetchWithTimeout(ctx, subject)
		if fetchErr == nil {
			c.store(key, state, c.now())
			return state, nil
		}
		if state, ok := c.stale(key, now); ok {
			return state, nil
		}
		c.pruneExpired(now)
		return RuntimeState{}, fetchErr
	})
	if err != nil {
		return RuntimeState{}, err
	}
	state, ok := result.(RuntimeState)
	if !ok {
		return RuntimeState{}, nil
	}
	return cloneRuntimeStateForSubject(state, subject), nil
}

func (c *noticeStateCache) fetchWithTimeout(ctx context.Context, subject Subject) (RuntimeState, error) {
	timeout := c.timeout
	if timeout <= 0 {
		timeout = time.Second
	}
	fetchCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return c.fetch(fetchCtx, subject)
}

func (c *noticeStateCache) cacheKey(subject string) string {
	mac := hmac.New(sha256.New, c.key)
	_, _ = mac.Write([]byte(subject))
	return hex.EncodeToString(mac.Sum(nil))
}

func (c *noticeStateCache) fresh(key string, now time.Time) (RuntimeState, bool) {
	entry, ok := c.load(key)
	if !ok {
		return RuntimeState{}, false
	}
	if now.Sub(entry.fetchedAt) <= c.ttl {
		return entry.state, true
	}
	return RuntimeState{}, false
}

func (c *noticeStateCache) stale(key string, now time.Time) (RuntimeState, bool) {
	entry, ok := c.load(key)
	if !ok {
		return RuntimeState{}, false
	}
	if now.Sub(entry.fetchedAt) <= c.ttl+c.staleTTL {
		return entry.state, true
	}
	c.delete(key)
	return RuntimeState{}, false
}

func (c *noticeStateCache) load(key string) (noticeStateEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	return entry, ok
}

func (c *noticeStateCache) store(key string, state RuntimeState, fetchedAt time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pruneExpiredLocked(fetchedAt)
	c.entries[key] = noticeStateEntry{state: cloneRuntimeState(state), fetchedAt: fetchedAt}
}

func (c *noticeStateCache) delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, key)
}

func (c *noticeStateCache) pruneExpired(now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pruneExpiredLocked(now)
}

func (c *noticeStateCache) pruneExpiredLocked(now time.Time) {
	maxAge := c.ttl + c.staleTTL
	for key, entry := range c.entries {
		if now.Sub(entry.fetchedAt) > maxAge {
			delete(c.entries, key)
		}
	}
}

func cloneRuntimeStateForSubject(state RuntimeState, subject Subject) RuntimeState {
	out := cloneRuntimeState(state)
	applySubjectStatus(&out, subject.APIKeyStatus)
	return out
}

func cloneRuntimeState(state RuntimeState) RuntimeState {
	out := state
	out.ProviderData = append([]byte(nil), state.ProviderData...)
	if state.RecommendedAction != nil {
		action := *state.RecommendedAction
		out.RecommendedAction = &action
	}
	out.Meters = make([]RuntimeStateMeter, len(state.Meters))
	for i := range state.Meters {
		out.Meters[i] = cloneRuntimeStateMeter(state.Meters[i])
	}
	return out
}

func cloneRuntimeStateMeter(meter RuntimeStateMeter) RuntimeStateMeter {
	out := meter
	if meter.QuotaGateResult != nil {
		out.QuotaGateResult = cloneRuntimeAnyMap(meter.QuotaGateResult)
	}
	out.Budgets = make([]RuntimeStatusBudget, len(meter.Budgets))
	for i := range meter.Budgets {
		out.Budgets[i] = cloneRuntimeStatusBudget(meter.Budgets[i])
	}
	return out
}

func cloneRuntimeStatusBudget(budget RuntimeStatusBudget) RuntimeStatusBudget {
	out := budget
	out.Period.StartAt = cloneTimePtr(budget.Period.StartAt)
	out.Period.EndAt = cloneTimePtr(budget.Period.EndAt)
	out.Capacity.Value = cloneInt64Ptr(budget.Capacity.Value)
	if budget.Usage != nil {
		usage := *budget.Usage
		usage.Used = cloneInt64Ptr(budget.Usage.Used)
		usage.Remaining = cloneInt64Ptr(budget.Usage.Remaining)
		usage.Percent = cloneFloat64Ptr(budget.Usage.Percent)
		out.Usage = &usage
	}
	return out
}

func cloneTimePtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneInt64Ptr(value *int64) *int64 {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneFloat64Ptr(value *float64) *float64 {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneRuntimeAnyMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for key, value := range in {
		out[key] = cloneRuntimeAny(value)
	}
	return out
}

func cloneRuntimeAnySlice(in []any) []any {
	out := make([]any, len(in))
	for i, value := range in {
		out[i] = cloneRuntimeAny(value)
	}
	return out
}

func cloneRuntimeAny(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneRuntimeAnyMap(typed)
	case []any:
		return cloneRuntimeAnySlice(typed)
	case json.RawMessage:
		return append(json.RawMessage(nil), typed...)
	case []byte:
		return append([]byte(nil), typed...)
	default:
		return typed
	}
}

func applySubjectStatus(state *RuntimeState, status string) {
	switch status {
	case RuntimeAPIKeyStatusActive, RuntimeAPIKeyStatusInactive, RuntimeAPIKeyStatusUnknown:
		state.Mem9APIKey.Status = status
	}
}
