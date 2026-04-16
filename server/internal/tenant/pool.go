package tenant

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

var sqlOpen = sql.Open

type TenantPool struct {
	mu             sync.RWMutex
	conns          map[string]*tenantConn
	maxIdle        int
	maxOpen        int
	lifetime       time.Duration
	idleTimeout    time.Duration
	totalLimit     int
	backend        string // "tidb", "postgres", or "db9"
	stopCh         chan struct{}
	connectGroup   singleflight.Group
	opening        int
	connectTimeout time.Duration
}

type tenantConn struct {
	db       *sql.DB
	lastUsed time.Time
	tenantID string
}

type PoolConfig struct {
	MaxIdle        int
	MaxOpen        int
	Lifetime       time.Duration
	IdleTimeout    time.Duration
	TotalLimit     int
	Backend        string // "tidb" (default), "postgres", or "db9"
	ConnectTimeout time.Duration
}

func NewPool(cfg PoolConfig) *TenantPool {
	if cfg.MaxIdle == 0 {
		cfg.MaxIdle = 5
	}
	if cfg.MaxOpen == 0 {
		cfg.MaxOpen = 10
	}
	if cfg.Lifetime == 0 {
		cfg.Lifetime = 30 * time.Minute
	}
	if cfg.IdleTimeout == 0 {
		cfg.IdleTimeout = 10 * time.Minute
	}
	if cfg.TotalLimit == 0 {
		cfg.TotalLimit = 200
	}
	if cfg.ConnectTimeout == 0 {
		cfg.ConnectTimeout = 3 * time.Second
	}
	backend := cfg.Backend
	if backend == "" {
		backend = "tidb"
	}

	p := &TenantPool{
		conns:          make(map[string]*tenantConn),
		maxIdle:        cfg.MaxIdle,
		maxOpen:        cfg.MaxOpen,
		lifetime:       cfg.Lifetime,
		idleTimeout:    cfg.IdleTimeout,
		totalLimit:     cfg.TotalLimit,
		backend:        backend,
		stopCh:         make(chan struct{}),
		connectTimeout: cfg.ConnectTimeout,
	}

	go p.evictLoop()
	return p
}

func (p *TenantPool) Get(ctx context.Context, tenantID string, dsn string) (*sql.DB, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	p.mu.RLock()
	conn, ok := p.conns[tenantID]
	p.mu.RUnlock()

	if ok {
		pingStart := time.Now()
		if err := conn.db.PingContext(ctx); err == nil {
			p.mu.Lock()
			if cached, stillOk := p.conns[tenantID]; stillOk {
				cached.lastUsed = time.Now()
				conn = cached
			}
			p.mu.Unlock()
			return conn.db, nil
		} else {
			slog.ErrorContext(ctx, "tenant pool cached ping failed",
				"tenant_id", tenantID,
				"duration_ms", time.Since(pingStart).Milliseconds(),
				"err", err,
			)
			p.removeIfMatch(tenantID, conn)
		}
	}

	// open tenantDB
	resultCh := p.connectGroup.DoChan(tenantID, func() (any, error) {
		openStart := time.Now()
		db, err := p.openTenantDB(tenantID, dsn)
		if err != nil {
			slog.ErrorContext(ctx, "tenant pool open failed",
				"tenant_id", tenantID,
				"duration_ms", time.Since(openStart).Milliseconds(),
				"err", err,
			)
		}
		return db, err
	})

	select {
	case res := <-resultCh:
		if res.Err != nil {
			return nil, res.Err
		}
		db, ok := res.Val.(*sql.DB)
		if !ok {
			return nil, fmt.Errorf("tenant pool: unexpected connection type %T", res.Val)
		}
		return db, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (p *TenantPool) openTenantDB(tenantID string, dsn string) (*sql.DB, error) {
	p.mu.Lock()
	if conn, ok := p.conns[tenantID]; ok {
		conn.lastUsed = time.Now()
		p.mu.Unlock()
		return conn.db, nil
	}
	if len(p.conns)+p.opening >= p.totalLimit {
		p.mu.Unlock()
		return nil, fmt.Errorf("tenant pool: total limit %d reached", p.totalLimit)
	}
	p.opening++
	p.mu.Unlock()

	driver := "mysql"
	if p.backend == "postgres" || p.backend == "db9" {
		driver = "pgx"
	}
	db, err := sqlOpen(driver, dsn)
	if err != nil {
		p.mu.Lock()
		p.opening--
		p.mu.Unlock()
		return nil, err
	}

	db.SetMaxIdleConns(p.maxIdle)
	db.SetMaxOpenConns(p.maxOpen)
	db.SetConnMaxLifetime(p.lifetime)

	openCtx, cancel := context.WithTimeout(context.Background(), p.connectTimeout)
	defer cancel()

	if err := db.PingContext(openCtx); err != nil {
		_ = db.Close()
		p.mu.Lock()
		p.opening--
		p.mu.Unlock()
		return nil, err
	}

	now := time.Now()
	p.mu.Lock()
	p.opening--
	// Close/Remove/eviction can mutate this slot while the shared open is in flight.
	// Reuse any handle already published before we reacquire the lock.
	if existing := p.conns[tenantID]; existing != nil {
		existing.lastUsed = now
		p.mu.Unlock()
		_ = db.Close()
		return existing.db, nil
	}
	p.conns[tenantID] = &tenantConn{
		db:       db,
		lastUsed: now,
		tenantID: tenantID,
	}
	p.mu.Unlock()
	return db, nil
}

func (p *TenantPool) Close() {
	close(p.stopCh)

	p.mu.Lock()
	conns := p.conns
	p.conns = make(map[string]*tenantConn)
	p.mu.Unlock()

	for _, conn := range conns {
		_ = conn.db.Close()
	}
}

func (p *TenantPool) Remove(tenantID string) {
	p.mu.Lock()
	conn, ok := p.conns[tenantID]
	if ok {
		delete(p.conns, tenantID)
	}
	p.mu.Unlock()

	if ok {
		_ = conn.db.Close()
	}
}

func (p *TenantPool) removeIfMatch(tenantID string, expected *tenantConn) bool {
	if expected == nil {
		return false
	}

	p.mu.Lock()
	current, ok := p.conns[tenantID]
	if !ok || current != expected {
		p.mu.Unlock()
		return false
	}
	delete(p.conns, tenantID)
	p.mu.Unlock()

	_ = expected.db.Close()
	return true
}

func (p *TenantPool) Stats() map[string]time.Time {
	p.mu.RLock()
	defer p.mu.RUnlock()

	stats := make(map[string]time.Time, len(p.conns))
	for tenantID, conn := range p.conns {
		stats[tenantID] = conn.lastUsed
	}
	return stats
}

// Backend returns the configured database backend ("tidb", "postgres", or "db9").
func (p *TenantPool) Backend() string {
	return p.backend
}

func (p *TenantPool) evictLoop() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			p.evictIdle()
		case <-p.stopCh:
			return
		}
	}
}

func (p *TenantPool) evictIdle() {
	cutoff := time.Now().Add(-p.idleTimeout)
	var toClose []*sql.DB

	p.mu.Lock()
	for tenantID, conn := range p.conns {
		if conn.lastUsed.Before(cutoff) {
			delete(p.conns, tenantID)
			toClose = append(toClose, conn.db)
		}
	}
	p.mu.Unlock()

	for _, db := range toClose {
		_ = db.Close()
	}
}
