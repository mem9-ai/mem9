package middleware

import (
	"sync"
	"time"
)

type SpendLimitCooldown struct {
	mu        sync.Mutex
	lastRaise map[string]time.Time
	inFlight  map[string]struct{}
	interval  time.Duration
}

func NewSpendLimitCooldown(interval time.Duration) *SpendLimitCooldown {
	return &SpendLimitCooldown{
		lastRaise: make(map[string]time.Time),
		inFlight:  make(map[string]struct{}),
		interval:  interval,
	}
}

func (c *SpendLimitCooldown) TryStartRaise(clusterID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	if lastRaise, ok := c.lastRaise[clusterID]; ok && now.Sub(lastRaise) < c.interval {
		return false
	}
	if _, ok := c.inFlight[clusterID]; ok {
		return false
	}

	c.inFlight[clusterID] = struct{}{}
	return true
}

func (c *SpendLimitCooldown) RecordSuccess(clusterID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	delete(c.inFlight, clusterID)
	c.lastRaise[clusterID] = time.Now()
}

func (c *SpendLimitCooldown) RecordFailure(clusterID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	delete(c.inFlight, clusterID)
	c.lastRaise[clusterID] = time.Now()
}
