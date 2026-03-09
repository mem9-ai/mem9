package tenant

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"
)

type TenantPool struct {
	mu          sync.RWMutex
	conns       map[string]*tenantConn
	maxIdle     int
	maxOpen     int
	lifetime    time.Duration
	idleTimeout time.Duration
	totalLimit  int
	backend     string // "tidb" or "postgres"
	stopCh      chan struct{}
}

type tenantConn struct {
	db       *sql.DB
	lastUsed time.Time
	tenantID string
}

type PoolConfig struct {
	MaxIdle     int
	MaxOpen     int
	Lifetime    time.Duration
	IdleTimeout time.Duration
	TotalLimit  int
	Backend     string // "tidb" (default) or "postgres"
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
	backend := cfg.Backend
	if backend == "" {
		backend = "tidb"
	}

	p := &TenantPool{
		conns:       make(map[string]*tenantConn),
		maxIdle:     cfg.MaxIdle,
		maxOpen:     cfg.MaxOpen,
		lifetime:    cfg.Lifetime,
		idleTimeout: cfg.IdleTimeout,
		totalLimit:  cfg.TotalLimit,
		backend:     backend,
		stopCh:      make(chan struct{}),
	}

	go p.evictLoop()
	return p
}

func (p *TenantPool) Get(ctx context.Context, tenantID string, dsn string) (*sql.DB, error) {
	p.mu.RLock()
	conn, ok := p.conns[tenantID]
	p.mu.RUnlock()

	if ok {
		if err := conn.db.PingContext(ctx); err == nil {
			p.mu.Lock()
			if cached, stillOk := p.conns[tenantID]; stillOk {
				cached.lastUsed = time.Now()
				conn = cached
			}
			p.mu.Unlock()
			return conn.db, nil
		}

		p.Remove(tenantID)
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if conn, ok := p.conns[tenantID]; ok {
		conn.lastUsed = time.Now()
		return conn.db, nil
	}

	if len(p.conns) >= p.totalLimit {
		return nil, fmt.Errorf("tenant pool: total limit %d reached", p.totalLimit)
	}

	driver := "mysql"
	if p.backend == "postgres" {
		driver = "pgx"
	}
	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}

	db.SetMaxIdleConns(p.maxIdle)
	db.SetMaxOpenConns(p.maxOpen)
	db.SetConnMaxLifetime(p.lifetime)

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}

	conn = &tenantConn{
		db:       db,
		lastUsed: time.Now(),
		tenantID: tenantID,
	}
	if existing := p.conns[tenantID]; existing != nil {
		_ = db.Close()
		return existing.db, nil
	}
	p.conns[tenantID] = conn
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

func (p *TenantPool) Stats() map[string]time.Time {
	p.mu.RLock()
	defer p.mu.RUnlock()

	stats := make(map[string]time.Time, len(p.conns))
	for tenantID, conn := range p.conns {
		stats[tenantID] = conn.lastUsed
	}
	return stats
}

// Backend returns the configured database backend ("tidb" or "postgres").
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
