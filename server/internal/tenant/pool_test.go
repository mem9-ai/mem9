package tenant

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type testDriver struct{}

func (testDriver) Open(name string) (driver.Conn, error) {
	return nil, errors.New("open not supported")
}

type testConnector struct {
	pingStarted  chan struct{}
	pingRelease  chan struct{}
	pingErr      error
	connectErr   error
	connectCalls atomic.Int32
}

func (c *testConnector) Connect(context.Context) (driver.Conn, error) {
	if c.connectErr != nil {
		return nil, c.connectErr
	}
	c.connectCalls.Add(1)
	return &testConn{connector: c}, nil
}

func (c *testConnector) Driver() driver.Driver {
	return testDriver{}
}

type testConn struct{ connector *testConnector }

func (c *testConn) Prepare(query string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported")
}

func (c *testConn) Close() error { return nil }

func (c *testConn) Begin() (driver.Tx, error) {
	return nil, errors.New("begin not supported")
}

func (c *testConn) Ping(ctx context.Context) error {
	if c.connector.pingStarted != nil {
		select {
		case c.connector.pingStarted <- struct{}{}:
		default:
		}
	}
	if c.connector.pingRelease != nil {
		select {
		case <-c.connector.pingRelease:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return c.connector.pingErr
}

type getResult struct {
	db  *sql.DB
	err error
}

func withSQLOpen(t *testing.T, opener func(driverName, dsn string) (*sql.DB, error)) {
	t.Helper()

	prev := sqlOpen
	sqlOpen = opener
	t.Cleanup(func() {
		sqlOpen = prev
	})
}

func cacheTenantConn(pool *TenantPool, tenantID string, db *sql.DB) {
	pool.mu.Lock()
	pool.conns[tenantID] = &tenantConn{
		db:       db,
		lastUsed: time.Now(),
		tenantID: tenantID,
	}
	pool.mu.Unlock()
}

func startGet(pool *TenantPool, tenantID string, dsn string) (<-chan getResult, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	resultCh := make(chan getResult, 1)
	go func() {
		db, err := pool.Get(ctx, tenantID, dsn)
		resultCh <- getResult{db: db, err: err}
	}()
	return resultCh, cancel
}

func TestNewPool_Defaults(t *testing.T) {
	pool := NewPool(PoolConfig{})
	defer pool.Close()

	if pool.maxIdle != 5 {
		t.Fatalf("maxIdle = %d, want %d", pool.maxIdle, 5)
	}
	if pool.maxOpen != 10 {
		t.Fatalf("maxOpen = %d, want %d", pool.maxOpen, 10)
	}
	if pool.lifetime != 30*time.Minute {
		t.Fatalf("lifetime = %v, want %v", pool.lifetime, 30*time.Minute)
	}
	if pool.idleTimeout != 10*time.Minute {
		t.Fatalf("idleTimeout = %v, want %v", pool.idleTimeout, 10*time.Minute)
	}
	if pool.totalLimit != 200 {
		t.Fatalf("totalLimit = %d, want %d", pool.totalLimit, 200)
	}
	if pool.connectTimeout != 3*time.Second {
		t.Fatalf("connectTimeout = %v, want %v", pool.connectTimeout, 3*time.Second)
	}
}

func TestNewPool_CustomConfig(t *testing.T) {
	cfg := PoolConfig{
		MaxIdle:        2,
		MaxOpen:        4,
		Lifetime:       15 * time.Minute,
		IdleTimeout:    5 * time.Minute,
		TotalLimit:     9,
		ConnectTimeout: 2 * time.Second,
	}
	pool := NewPool(cfg)
	defer pool.Close()

	if pool.maxIdle != cfg.MaxIdle {
		t.Fatalf("maxIdle = %d, want %d", pool.maxIdle, cfg.MaxIdle)
	}
	if pool.maxOpen != cfg.MaxOpen {
		t.Fatalf("maxOpen = %d, want %d", pool.maxOpen, cfg.MaxOpen)
	}
	if pool.lifetime != cfg.Lifetime {
		t.Fatalf("lifetime = %v, want %v", pool.lifetime, cfg.Lifetime)
	}
	if pool.idleTimeout != cfg.IdleTimeout {
		t.Fatalf("idleTimeout = %v, want %v", pool.idleTimeout, cfg.IdleTimeout)
	}
	if pool.totalLimit != cfg.TotalLimit {
		t.Fatalf("totalLimit = %d, want %d", pool.totalLimit, cfg.TotalLimit)
	}
	if pool.connectTimeout != cfg.ConnectTimeout {
		t.Fatalf("connectTimeout = %v, want %v", pool.connectTimeout, cfg.ConnectTimeout)
	}
}

func TestPool_Get_OpenError(t *testing.T) {
	pool := NewPool(PoolConfig{})
	defer pool.Close()

	withSQLOpen(t, func(driverName, dsn string) (*sql.DB, error) {
		return nil, errors.New("open failed")
	})

	_, err := pool.Get(context.Background(), "tenant-1", "tenant-1")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "open failed") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPool_Remove_NonExistent(t *testing.T) {
	pool := NewPool(PoolConfig{})
	defer pool.Close()

	pool.Remove("missing-tenant")
}

func TestPool_RemoveIfMatch_DoesNotRemoveReplacement(t *testing.T) {
	pool := NewPool(PoolConfig{})
	defer pool.Close()

	staleDB := sql.OpenDB(&testConnector{})
	freshDB := sql.OpenDB(&testConnector{})

	staleConn := &tenantConn{db: staleDB, lastUsed: time.Now(), tenantID: "tenant-1"}
	freshConn := &tenantConn{db: freshDB, lastUsed: time.Now(), tenantID: "tenant-1"}

	pool.mu.Lock()
	pool.conns["tenant-1"] = staleConn
	pool.mu.Unlock()

	if removed := pool.removeIfMatch("tenant-1", staleConn); !removed {
		t.Fatal("expected initial stale connection to be removed")
	}

	pool.mu.Lock()
	pool.conns["tenant-1"] = freshConn
	pool.mu.Unlock()

	if removed := pool.removeIfMatch("tenant-1", staleConn); removed {
		t.Fatal("expected stale retry removal to leave replacement connection intact")
	}

	pool.mu.RLock()
	got := pool.conns["tenant-1"]
	pool.mu.RUnlock()
	if got != freshConn {
		t.Fatal("expected replacement connection to remain cached")
	}
	if err := freshDB.PingContext(context.Background()); err != nil {
		t.Fatalf("replacement DB should still be open: %v", err)
	}
}

func TestPool_Stats_Empty(t *testing.T) {
	pool := NewPool(PoolConfig{})
	defer pool.Close()

	stats := pool.Stats()
	if len(stats) != 0 {
		t.Fatalf("expected empty stats, got %d", len(stats))
	}
}

func TestPool_Close_Idempotent(t *testing.T) {
	pool := NewPool(PoolConfig{})
	pool.Close()

	dsn := "user:pass@tcp(127.0.0.1:1)/db?parseTime=true"
	_, err := pool.Get(context.Background(), "tenant-1", dsn)
	if err == nil {
		t.Fatal("expected error after Close, got nil")
	}
}

func TestPool_TotalLimit(t *testing.T) {
	pool := NewPool(PoolConfig{TotalLimit: 1})
	defer pool.Close()

	db := sql.OpenDB(&testConnector{})
	cacheTenantConn(pool, "tenant-1", db)

	_, err := pool.Get(context.Background(), "tenant-2", "tenant-2")
	if err == nil {
		t.Fatal("expected total limit error, got nil")
	}
	if !strings.Contains(err.Error(), "total limit 1 reached") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPool_Get_SameTenantOpenUsesSingleflight(t *testing.T) {
	pool := NewPool(PoolConfig{ConnectTimeout: time.Second})
	defer pool.Close()

	slowConnector := &testConnector{
		pingStarted: make(chan struct{}, 1),
		pingRelease: make(chan struct{}),
	}
	var openCalls atomic.Int32
	withSQLOpen(t, func(driverName, dsn string) (*sql.DB, error) {
		openCalls.Add(1)
		if dsn != "tenant-1" {
			return nil, fmt.Errorf("unexpected dsn %q", dsn)
		}
		return sql.OpenDB(slowConnector), nil
	})

	firstCh, cancelFirst := startGet(pool, "tenant-1", "tenant-1")
	defer cancelFirst()

	select {
	case <-slowConnector.pingStarted:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for first ping to start")
	}

	secondCh, cancelSecond := startGet(pool, "tenant-1", "tenant-1")
	defer cancelSecond()

	close(slowConnector.pingRelease)

	first := <-firstCh
	second := <-secondCh
	if first.err != nil {
		t.Fatalf("first Get error: %v", first.err)
	}
	if second.err != nil {
		t.Fatalf("second Get error: %v", second.err)
	}
	if first.db != second.db {
		t.Fatal("expected both callers to receive the same cached *sql.DB")
	}
	if openCalls.Load() != 1 {
		t.Fatalf("sqlOpen calls = %d, want 1", openCalls.Load())
	}
	if slowConnector.connectCalls.Load() != 1 {
		t.Fatalf("connector connects = %d, want 1", slowConnector.connectCalls.Load())
	}
}

func TestPool_Get_CachedPingFailureReopensConnection(t *testing.T) {
	pool := NewPool(PoolConfig{ConnectTimeout: time.Second})
	defer pool.Close()

	staleDB := sql.OpenDB(&testConnector{pingErr: errors.New("ping failed")})
	cacheTenantConn(pool, "tenant-1", staleDB)

	freshConnector := &testConnector{}
	var openCalls atomic.Int32
	withSQLOpen(t, func(driverName, dsn string) (*sql.DB, error) {
		openCalls.Add(1)
		if dsn != "tenant-1" {
			return nil, fmt.Errorf("unexpected dsn %q", dsn)
		}
		return sql.OpenDB(freshConnector), nil
	})

	db, err := pool.Get(context.Background(), "tenant-1", "tenant-1")
	if err != nil {
		t.Fatalf("Get error: %v", err)
	}
	if db == staleDB {
		t.Fatal("expected stale cached DB to be replaced after ping failure")
	}
	if openCalls.Load() != 1 {
		t.Fatalf("sqlOpen calls = %d, want 1", openCalls.Load())
	}
	if freshConnector.connectCalls.Load() != 1 {
		t.Fatalf("connector connects = %d, want 1", freshConnector.connectCalls.Load())
	}
}

func TestPool_Get_SlowOpenDoesNotBlockOtherCachedTenant(t *testing.T) {
	pool := NewPool(PoolConfig{ConnectTimeout: time.Second})
	defer pool.Close()

	slowConnector := &testConnector{
		pingStarted: make(chan struct{}, 1),
		pingRelease: make(chan struct{}),
	}
	fastConnector := &testConnector{}
	cachedDB := sql.OpenDB(fastConnector)
	cacheTenantConn(pool, "tenant-b", cachedDB)

	withSQLOpen(t, func(driverName, dsn string) (*sql.DB, error) {
		if dsn != "tenant-a" {
			return nil, fmt.Errorf("unexpected dsn %q", dsn)
		}
		return sql.OpenDB(slowConnector), nil
	})

	slowCh, cancelSlow := startGet(pool, "tenant-a", "tenant-a")
	defer cancelSlow()

	select {
	case <-slowConnector.pingStarted:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for slow ping to start")
	}

	fastCtx, cancelFast := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancelFast()

	db, err := pool.Get(fastCtx, "tenant-b", "tenant-b")
	if err != nil {
		t.Fatalf("cached tenant Get error: %v", err)
	}
	if db != cachedDB {
		t.Fatal("expected cached tenant DB to be returned")
	}

	close(slowConnector.pingRelease)
	if slow := <-slowCh; slow.err != nil {
		t.Fatalf("slow tenant Get error: %v", slow.err)
	}
}

func TestPool_Get_InFlightOpenCountsTowardTotalLimit(t *testing.T) {
	pool := NewPool(PoolConfig{TotalLimit: 1, ConnectTimeout: time.Second})
	defer pool.Close()

	slowConnector := &testConnector{
		pingStarted: make(chan struct{}, 1),
		pingRelease: make(chan struct{}),
	}
	var openCalls atomic.Int32
	withSQLOpen(t, func(driverName, dsn string) (*sql.DB, error) {
		openCalls.Add(1)
		switch dsn {
		case "tenant-a":
			return sql.OpenDB(slowConnector), nil
		case "tenant-b":
			return sql.OpenDB(&testConnector{}), nil
		default:
			return nil, fmt.Errorf("unexpected dsn %q", dsn)
		}
	})

	slowCh, cancelSlow := startGet(pool, "tenant-a", "tenant-a")
	defer cancelSlow()

	select {
	case <-slowConnector.pingStarted:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for slow ping to start")
	}

	_, err := pool.Get(context.Background(), "tenant-b", "tenant-b")
	if err == nil {
		t.Fatal("expected total limit error, got nil")
	}
	if !strings.Contains(err.Error(), "total limit 1 reached") {
		t.Fatalf("unexpected error: %v", err)
	}
	if openCalls.Load() != 1 {
		t.Fatalf("sqlOpen calls = %d, want 1", openCalls.Load())
	}

	close(slowConnector.pingRelease)
	if slow := <-slowCh; slow.err != nil {
		t.Fatalf("slow tenant Get error: %v", slow.err)
	}
}
