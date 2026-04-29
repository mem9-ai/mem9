package middleware

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
	"unsafe"

	"github.com/go-chi/chi/v5"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/tenant"
)

type stubTenantRepo struct {
	tenants map[string]*domain.Tenant
}

func (r stubTenantRepo) Create(context.Context, *domain.Tenant) error {
	return nil
}

func (r stubTenantRepo) GetByID(_ context.Context, id string) (*domain.Tenant, error) {
	t, ok := r.tenants[id]
	if !ok {
		return nil, domain.ErrNotFound
	}
	return t, nil
}

func (r stubTenantRepo) GetByName(context.Context, string) (*domain.Tenant, error) {
	return nil, domain.ErrNotFound
}

func (r stubTenantRepo) UpdateStatus(context.Context, string, domain.TenantStatus) error {
	return nil
}

func (r stubTenantRepo) UpdateSchemaVersion(context.Context, string, int) error {
	return nil
}

type pingOKConnector struct{}

func (pingOKConnector) Connect(context.Context) (driver.Conn, error) {
	return pingOKConn{}, nil
}

func (pingOKConnector) Driver() driver.Driver {
	return pingOKDriver{}
}

type pingOKDriver struct{}

func (pingOKDriver) Open(string) (driver.Conn, error) {
	return pingOKConn{}, nil
}

type pingOKConn struct{}

func (pingOKConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported")
}

func (pingOKConn) Close() error {
	return nil
}

func (pingOKConn) Begin() (driver.Tx, error) {
	return nil, errors.New("begin not supported")
}

func (pingOKConn) Ping(context.Context) error {
	return nil
}

func TestResolveApiKey_MissingHeader(t *testing.T) {
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	enc := encrypt.NewPlainEncryptor()
	mw := ResolveApiKey(stubTenantRepo{}, pool, enc, nil)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusBadRequest)
	}
	if got := rr.Body.String(); !strings.Contains(got, "missing API key") {
		t.Fatalf("body = %q, want missing API key", got)
	}
}

func TestResolveApiKey_WhitespaceOnlyHeader(t *testing.T) {
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	enc := encrypt.NewPlainEncryptor()
	mw := ResolveApiKey(stubTenantRepo{}, pool, enc, nil)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set(APIKeyHeader, "   ")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusBadRequest)
	}
	if got := rr.Body.String(); !strings.Contains(got, "missing API key") {
		t.Fatalf("body = %q, want missing API key", got)
	}
}

func TestResolveApiKey_InvalidKey(t *testing.T) {
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	enc := encrypt.NewPlainEncryptor()
	mw := ResolveApiKey(stubTenantRepo{}, pool, enc, nil)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set(APIKeyHeader, "missing-tenant")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusBadRequest)
	}
	if got := rr.Body.String(); !strings.Contains(got, "invalid API key") {
		t.Fatalf("body = %q, want invalid API key", got)
	}
}

func TestResolveApiKey_TrimsHeaderValue(t *testing.T) {
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	db := sql.OpenDB(pingOKConnector{})
	defer db.Close()
	cacheTenantDB(t, pool, "tenant-1", db)

	repo := stubTenantRepo{
		tenants: map[string]*domain.Tenant{
			"tenant-1": {
				ID:       "tenant-1",
				Status:   domain.TenantActive,
				DBHost:   "127.0.0.1",
				DBPort:   4000,
				DBUser:   "user",
				DBName:   "db",
				Provider: "tidb",
			},
		},
	}

	enc := encrypt.NewPlainEncryptor()
	mw := ResolveApiKey(repo, pool, enc, nil)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info := AuthFromContext(r.Context())
		if info == nil {
			t.Fatal("auth info missing from context")
		}
		if info.TenantID != "tenant-1" {
			t.Fatalf("tenant ID = %q, want %q", info.TenantID, "tenant-1")
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set(APIKeyHeader, " tenant-1 ")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNoContent)
	}
}

func TestResolveApiKey_InactiveTenant(t *testing.T) {
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	repo := stubTenantRepo{
		tenants: map[string]*domain.Tenant{
			"tenant-1": {
				ID:     "tenant-1",
				Status: domain.TenantSuspended,
			},
		},
	}

	enc := encrypt.NewPlainEncryptor()
	mw := ResolveApiKey(repo, pool, enc, nil)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set(APIKeyHeader, "tenant-1")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusBadRequest)
	}
	if got := rr.Body.String(); !strings.Contains(got, "invalid API key") {
		t.Fatalf("body = %q, want invalid API key", got)
	}
}

func TestResolveApiKey_DeletedAtRejectsKey(t *testing.T) {
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	now := time.Now()
	repo := stubTenantRepo{
		tenants: map[string]*domain.Tenant{
			"tenant-1": {
				ID:        "tenant-1",
				Status:    domain.TenantActive,
				DeletedAt: &now,
			},
		},
	}

	enc := encrypt.NewPlainEncryptor()
	mw := ResolveApiKey(repo, pool, enc, nil)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set(APIKeyHeader, "tenant-1")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusBadRequest)
	}
	if got := rr.Body.String(); !strings.Contains(got, "invalid API key") {
		t.Fatalf("body = %q, want invalid API key", got)
	}
}

func TestResolveApiKey_PopulatesAuthInfo(t *testing.T) {
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	db := sql.OpenDB(pingOKConnector{})
	defer db.Close()
	cacheTenantDB(t, pool, "tenant-1", db)

	repo := stubTenantRepo{
		tenants: map[string]*domain.Tenant{
			"tenant-1": {
				ID:       "tenant-1",
				Status:   domain.TenantActive,
				DBHost:   "127.0.0.1",
				DBPort:   4000,
				DBUser:   "user",
				DBName:   "db",
				Provider: "tidb",
			},
		},
	}

	enc := encrypt.NewPlainEncryptor()
	mw := ResolveApiKey(repo, pool, enc, nil)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info := AuthFromContext(r.Context())
		if info == nil {
			t.Fatal("auth info missing from context")
		}
		if info.TenantID != "tenant-1" {
			t.Fatalf("tenant ID = %q, want %q", info.TenantID, "tenant-1")
		}
		if info.AgentName != "agent-1" {
			t.Fatalf("agent name = %q, want %q", info.AgentName, "agent-1")
		}
		if info.TenantDB != db {
			t.Fatal("tenant DB pointer does not match cached connection")
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set(APIKeyHeader, "tenant-1")
	req.Header.Set(AgentIDHeader, "agent-1")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNoContent)
	}
}

func TestResolveApiKey_MD5Encryptor_DecryptsPassword(t *testing.T) {
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	db := sql.OpenDB(pingOKConnector{})
	defer db.Close()
	cacheTenantDB(t, pool, "tenant-1", db)

	enc := encrypt.NewMD5Encryptor("test-key")
	password := "db-secret-password"
	encryptedPassword, err := enc.Encrypt(context.Background(), password)
	if err != nil {
		t.Fatalf("failed to encrypt password: %v", err)
	}

	repo := stubTenantRepo{
		tenants: map[string]*domain.Tenant{
			"tenant-1": {
				ID:         "tenant-1",
				Status:     domain.TenantActive,
				DBHost:     "127.0.0.1",
				DBPort:     4000,
				DBUser:     "user",
				DBPassword: encryptedPassword,
				DBName:     "db",
				Provider:   "tidb",
			},
		},
	}

	mw := ResolveApiKey(repo, pool, enc, nil)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info := AuthFromContext(r.Context())
		if info == nil {
			t.Fatal("auth info missing from context")
		}
		if info.TenantID != "tenant-1" {
			t.Fatalf("tenant ID = %q, want %q", info.TenantID, "tenant-1")
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set(APIKeyHeader, "tenant-1")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNoContent)
	}
}

func TestResolveTenant_Success(t *testing.T) {
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	db := sql.OpenDB(pingOKConnector{})
	defer db.Close()
	cacheTenantDB(t, pool, "tenant-1", db)

	enc := encrypt.NewMD5Encryptor("test-key")
	password := "db-secret-password"
	encryptedPassword, err := enc.Encrypt(context.Background(), password)
	if err != nil {
		t.Fatalf("failed to encrypt password: %v", err)
	}

	repo := stubTenantRepo{
		tenants: map[string]*domain.Tenant{
			"tenant-1": {
				ID:         "tenant-1",
				Status:     domain.TenantActive,
				DBHost:     "127.0.0.1",
				DBPort:     4000,
				DBUser:     "user",
				DBPassword: encryptedPassword,
				DBName:     "db",
				Provider:   "tidb",
			},
		},
	}

	// Build handler that asserts auth info is populated
	baseHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info := AuthFromContext(r.Context())
		if info == nil {
			t.Fatal("auth info missing from context")
		}
		if info.TenantID != "tenant-1" {
			t.Fatalf("tenant ID = %q, want %q", info.TenantID, "tenant-1")
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Apply middleware directly using chi's URL param injection
	mw := ResolveTenant(repo, pool, enc, nil)
	handler := mw(baseHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	// Inject tenantID into chi context
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, &chi.Context{
		URLParams: chi.RouteParams{
			Keys:   []string{"tenantID"},
			Values: []string{"tenant-1"},
		},
	}))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNoContent)
	}
}

func TestResolveTenant_DecryptFailure_Returns500(t *testing.T) {
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	enc := encrypt.NewMD5Encryptor("test-key")

	repo := stubTenantRepo{
		tenants: map[string]*domain.Tenant{
			"tenant-1": {
				ID:         "tenant-1",
				Status:     domain.TenantActive,
				DBHost:     "127.0.0.1",
				DBPort:     4000,
				DBUser:     "user",
				DBPassword: "not-valid-base64!!!",
				DBName:     "db",
				Provider:   "tidb",
			},
		},
	}

	mw := ResolveTenant(repo, pool, enc, nil)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	// Inject tenantID into chi context
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, &chi.Context{
		URLParams: chi.RouteParams{
			Keys:   []string{"tenantID"},
			Values: []string{"tenant-1"},
		},
	}))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusInternalServerError)
	}
	if got := rr.Body.String(); !strings.Contains(got, "decrypt tenant credentials") {
		t.Fatalf("body = %q, want decrypt tenant credentials error", got)
	}
}

func TestResolveApiKey_MD5DecryptFailure_Returns500(t *testing.T) {
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	enc := encrypt.NewMD5Encryptor("test-key")

	repo := stubTenantRepo{
		tenants: map[string]*domain.Tenant{
			"tenant-1": {
				ID:         "tenant-1",
				Status:     domain.TenantActive,
				DBHost:     "127.0.0.1",
				DBPort:     4000,
				DBUser:     "user",
				DBPassword: "not-valid-base64!!!",
				DBName:     "db",
				Provider:   "tidb",
			},
		},
	}

	mw := ResolveApiKey(repo, pool, enc, nil)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set(APIKeyHeader, "tenant-1")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusInternalServerError)
	}
	if got := rr.Body.String(); !strings.Contains(got, "decrypt tenant credentials") {
		t.Fatalf("body = %q, want decrypt tenant credentials error", got)
	}
}

func cacheTenantDB(t *testing.T, pool *tenant.TenantPool, tenantID string, db *sql.DB) {
	t.Helper()

	poolValue := reflect.ValueOf(pool).Elem()
	connsField := poolValue.FieldByName("conns")
	connsValue := reflect.NewAt(connsField.Type(), unsafe.Pointer(connsField.UnsafeAddr())).Elem()
	elemType := connsValue.Type().Elem()
	connValue := reflect.New(elemType.Elem())

	setUnexportedField(connValue.Elem().FieldByName("db"), reflect.ValueOf(db))
	setUnexportedField(connValue.Elem().FieldByName("lastUsed"), reflect.ValueOf(time.Now()))
	setUnexportedField(connValue.Elem().FieldByName("tenantID"), reflect.ValueOf(tenantID))

	connsValue.SetMapIndex(reflect.ValueOf(tenantID), connValue)
}

func setUnexportedField(field reflect.Value, value reflect.Value) {
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(value)
}

type stubPool struct {
	db  *sql.DB
	err error
}

func (s stubPool) Get(_ context.Context, _ string, _ string) (*sql.DB, error) {
	return s.db, s.err
}

func (s stubPool) Backend() string { return "tidb" }

var spendLimitErr = errors.New("Error 1105 (HY000): Due to the usage quota being exhausted, access to the cluster has been restricted.")

func TestIsSpendLimitError(t *testing.T) {
	cases := []struct {
		err  error
		want bool
	}{
		{spendLimitErr, true},
		{errors.New("connection refused"), false},
		{errors.New("tenant pool: total limit 200 reached"), false},
		{nil, false},
	}
	for _, c := range cases {
		if got := isSpendLimitError(c.err); got != c.want {
			t.Errorf("isSpendLimitError(%v) = %v, want %v", c.err, got, c.want)
		}
	}
}

func TestResolveApiKey_BlacklistedCluster_SpendLimit_Returns429(t *testing.T) {
	blacklist := map[string]struct{}{"cluster-1": {}}
	pool := stubPool{err: spendLimitErr}
	enc := encrypt.NewPlainEncryptor()

	repo := stubTenantRepo{
		tenants: map[string]*domain.Tenant{
			"tenant-1": {
				ID:        "tenant-1",
				Status:    domain.TenantActive,
				ClusterID: "cluster-1",
				Provider:  "tidb",
			},
		},
	}

	mw := ResolveApiKey(repo, pool, enc, blacklist)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set(APIKeyHeader, "tenant-1")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusTooManyRequests)
	}
	if got := rr.Body.String(); !strings.Contains(got, "cluster quota exhausted") {
		t.Fatalf("body = %q, want cluster quota exhausted", got)
	}
}

func TestResolveApiKey_BlacklistedCluster_OtherError_Returns503(t *testing.T) {
	blacklist := map[string]struct{}{"cluster-1": {}}
	pool := stubPool{err: errors.New("connection refused")}
	enc := encrypt.NewPlainEncryptor()

	repo := stubTenantRepo{
		tenants: map[string]*domain.Tenant{
			"tenant-1": {
				ID:        "tenant-1",
				Status:    domain.TenantActive,
				ClusterID: "cluster-1",
				Provider:  "tidb",
			},
		},
	}

	mw := ResolveApiKey(repo, pool, enc, blacklist)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set(APIKeyHeader, "tenant-1")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusServiceUnavailable)
	}
}

func TestResolveApiKey_BlacklistedCluster_Success(t *testing.T) {
	blacklist := map[string]struct{}{"cluster-1": {}}
	db := sql.OpenDB(pingOKConnector{})
	defer db.Close()
	pool := stubPool{db: db}
	enc := encrypt.NewPlainEncryptor()

	repo := stubTenantRepo{
		tenants: map[string]*domain.Tenant{
			"tenant-1": {
				ID:        "tenant-1",
				Status:    domain.TenantActive,
				ClusterID: "cluster-1",
				Provider:  "tidb",
			},
		},
	}

	nextCalled := false
	mw := ResolveApiKey(repo, pool, enc, blacklist)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set(APIKeyHeader, "tenant-1")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNoContent)
	}
	if !nextCalled {
		t.Fatal("next handler was not called for blacklisted cluster with successful connection")
	}
}

func TestResolveTenant_BlacklistedCluster_SpendLimit_Returns429(t *testing.T) {
	blacklist := map[string]struct{}{"cluster-1": {}}
	pool := stubPool{err: spendLimitErr}
	enc := encrypt.NewPlainEncryptor()

	repo := stubTenantRepo{
		tenants: map[string]*domain.Tenant{
			"tenant-1": {
				ID:        "tenant-1",
				Status:    domain.TenantActive,
				ClusterID: "cluster-1",
				Provider:  "tidb",
			},
		},
	}

	mw := ResolveTenant(repo, pool, enc, blacklist)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, &chi.Context{
		URLParams: chi.RouteParams{
			Keys:   []string{"tenantID"},
			Values: []string{"tenant-1"},
		},
	}))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusTooManyRequests)
	}
	if got := rr.Body.String(); !strings.Contains(got, "cluster quota exhausted") {
		t.Fatalf("body = %q, want cluster quota exhausted", got)
	}
}

type mockSpendLimitAdjuster struct {
	getSpendLimitFn      func(ctx context.Context, clusterID string) (int, error)
	increaseSpendLimitFn func(ctx context.Context, clusterID string, monthlyCents int) error
}

func (m *mockSpendLimitAdjuster) GetSpendLimit(ctx context.Context, clusterID string) (int, error) {
	return m.getSpendLimitFn(ctx, clusterID)
}

func (m *mockSpendLimitAdjuster) IncreaseSpendLimit(ctx context.Context, clusterID string, monthlyCents int) error {
	return m.increaseSpendLimitFn(ctx, clusterID, monthlyCents)
}

type autoSpendLimitTracker struct {
	mu                   sync.Mutex
	getCalls             int
	increaseCalls        int
	increaseMonthlyCents int
	getCalled            chan struct{}
	increaseCalled       chan struct{}
}

func newAutoSpendLimitTracker() *autoSpendLimitTracker {
	return &autoSpendLimitTracker{
		getCalled:      make(chan struct{}, 1),
		increaseCalled: make(chan struct{}, 1),
	}
}

func (t *autoSpendLimitTracker) markGet() {
	t.mu.Lock()
	t.getCalls++
	t.mu.Unlock()
	select {
	case t.getCalled <- struct{}{}:
	default:
	}
}

func (t *autoSpendLimitTracker) markIncrease(monthlyCents int) {
	t.mu.Lock()
	t.increaseCalls++
	t.increaseMonthlyCents = monthlyCents
	t.mu.Unlock()
	select {
	case t.increaseCalled <- struct{}{}:
	default:
	}
}

func (t *autoSpendLimitTracker) snapshot() (int, int, int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.getCalls, t.increaseCalls, t.increaseMonthlyCents
}

func autoSpendLimitCfg(enabled bool) AutoSpendLimitConfig {
	return AutoSpendLimitConfig{Enabled: enabled, Increment: 500, Max: 10000}
}

func autoSpendLimitStarterTenant(id, clusterID string) *domain.Tenant {
	return &domain.Tenant{
		ID:        id,
		Status:    domain.TenantActive,
		ClusterID: clusterID,
		Provider:  tenant.StarterProvisionerType,
	}
}

func autoSpendLimitZeroTenant(id, clusterID string) *domain.Tenant {
	return &domain.Tenant{
		ID:        id,
		Status:    domain.TenantActive,
		ClusterID: clusterID,
		Provider:  tenant.ZeroProvisionerType,
	}
}

func autoSpendLimitResolveTenantRequest(tenantID string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, &chi.Context{
		URLParams: chi.RouteParams{
			Keys:   []string{"tenantID"},
			Values: []string{tenantID},
		},
	}))
}

func autoSpendLimitResolveApiKeyRequest(tenantID string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/memories", nil)
	req.Header.Set(APIKeyHeader, tenantID)
	return req
}

func autoSpendLimitRequestHandler(t *testing.T) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	})
}

func autoSpendLimitServe(
	t *testing.T,
	resolve func(repository.TenantRepo, tenantDBGetter, encrypt.Encryptor, map[string]struct{}, ...authOption) func(http.Handler) http.Handler,
	req *http.Request,
	repo stubTenantRepo,
	pool stubPool,
	adjuster tenant.SpendLimitAdjuster,
	cooldown *SpendLimitCooldown,
	cfg AutoSpendLimitConfig,
) *httptest.ResponseRecorder {
	t.Helper()
	handler := resolve(repo, pool, encrypt.NewPlainEncryptor(), nil, WithSpendLimitAdjuster(adjuster, cooldown, cfg))(autoSpendLimitRequestHandler(t))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

func autoSpendLimitCases() []struct {
	name                 string
	tenant               *domain.Tenant
	poolErr              error
	cfg                  AutoSpendLimitConfig
	preRecord            bool
	adjusterNil          bool
	currentLimit         int
	getErr               error
	increaseErr          error
	wantStatus           int
	wantGetCalls         int
	wantIncreaseCalls    int
	wantIncreaseCents    int
	checkCooldownRestart bool
} {
	return []struct {
		name                 string
		tenant               *domain.Tenant
		poolErr              error
		cfg                  AutoSpendLimitConfig
		preRecord            bool
		adjusterNil          bool
		currentLimit         int
		getErr               error
		increaseErr          error
		wantStatus           int
		wantGetCalls         int
		wantIncreaseCalls    int
		wantIncreaseCents    int
		checkCooldownRestart bool
	}{
		{
			name:              "disabled config skips adjuster",
			tenant:            autoSpendLimitStarterTenant("tenant-1", "cluster-1"),
			poolErr:           spendLimitErr,
			cfg:               autoSpendLimitCfg(false),
			wantStatus:        http.StatusServiceUnavailable,
			wantGetCalls:      0,
			wantIncreaseCalls: 0,
		},
		{
			name:              "starter spend-limit error triggers raise",
			tenant:            autoSpendLimitStarterTenant("tenant-1", "cluster-1"),
			poolErr:           spendLimitErr,
			cfg:               autoSpendLimitCfg(true),
			currentLimit:      9500,
			wantStatus:        http.StatusServiceUnavailable,
			wantGetCalls:      1,
			wantIncreaseCalls: 1,
			wantIncreaseCents: 10000,
		},
		{
			name:              "zero tenant fires adjuster (same as starter)",
			tenant:            autoSpendLimitZeroTenant("tenant-2", "cluster-2"),
			poolErr:           spendLimitErr,
			cfg:               autoSpendLimitCfg(true),
			currentLimit:      500,
			wantStatus:        http.StatusServiceUnavailable,
			wantGetCalls:      1,
			wantIncreaseCalls: 1,
			wantIncreaseCents: 1000,
		},
		{
			name:              "non spend-limit error skips adjuster",
			tenant:            autoSpendLimitStarterTenant("tenant-3", "cluster-3"),
			poolErr:           errors.New("connection refused"),
			cfg:               autoSpendLimitCfg(true),
			wantStatus:        http.StatusServiceUnavailable,
			wantGetCalls:      0,
			wantIncreaseCalls: 0,
		},
		{
			name:              "cooldown active skips adjuster",
			tenant:            autoSpendLimitStarterTenant("tenant-4", "cluster-4"),
			poolErr:           spendLimitErr,
			cfg:               autoSpendLimitCfg(true),
			preRecord:         true,
			wantStatus:        http.StatusServiceUnavailable,
			wantGetCalls:      0,
			wantIncreaseCalls: 0,
		},
		{
			name:                 "max cap skips increase",
			tenant:               autoSpendLimitStarterTenant("tenant-5", "cluster-5"),
			poolErr:              spendLimitErr,
			cfg:                  autoSpendLimitCfg(true),
			currentLimit:         10000,
			wantStatus:           http.StatusServiceUnavailable,
			wantGetCalls:         1,
			wantIncreaseCalls:    0,
			checkCooldownRestart: true,
		},
		{
			name:                 "get spend-limit error records failure",
			tenant:               autoSpendLimitStarterTenant("tenant-6", "cluster-6"),
			poolErr:              spendLimitErr,
			cfg:                  autoSpendLimitCfg(true),
			currentLimit:         9000,
			getErr:               errors.New("get limit failed"),
			wantStatus:           http.StatusServiceUnavailable,
			wantGetCalls:         1,
			wantIncreaseCalls:    0,
			checkCooldownRestart: true,
		},
		{
			name:                 "increase spend-limit error records failure",
			tenant:               autoSpendLimitStarterTenant("tenant-7", "cluster-7"),
			poolErr:              spendLimitErr,
			cfg:                  autoSpendLimitCfg(true),
			currentLimit:         9500,
			increaseErr:          errors.New("patch failed"),
			wantStatus:           http.StatusServiceUnavailable,
			wantGetCalls:         1,
			wantIncreaseCalls:    1,
			wantIncreaseCents:    10000,
			checkCooldownRestart: true,
		},
		{
			name:              "nil adjuster does not panic",
			tenant:            autoSpendLimitStarterTenant("tenant-8", "cluster-8"),
			poolErr:           spendLimitErr,
			cfg:               autoSpendLimitCfg(true),
			adjusterNil:       true,
			wantStatus:        http.StatusServiceUnavailable,
			wantGetCalls:      0,
			wantIncreaseCalls: 0,
		},
	}
}

func runAutoSpendLimitCases(
	t *testing.T,
	resolve func(repository.TenantRepo, tenantDBGetter, encrypt.Encryptor, map[string]struct{}, ...authOption) func(http.Handler) http.Handler,
	requestBuilder func(string) *http.Request,
) {
	t.Helper()
	for _, tc := range autoSpendLimitCases() {
		t.Run(tc.name, func(t *testing.T) {
			cooldown := NewSpendLimitCooldown(50 * time.Millisecond)
			if tc.preRecord {
				cooldown.RecordSuccess(tc.tenant.ClusterID)
			}

			repo := stubTenantRepo{tenants: map[string]*domain.Tenant{tc.tenant.ID: tc.tenant}}
			pool := stubPool{err: tc.poolErr}

			var adjuster tenant.SpendLimitAdjuster
			tracker := newAutoSpendLimitTracker()
			if !tc.adjusterNil {
				adjuster = &mockSpendLimitAdjuster{
					getSpendLimitFn: func(ctx context.Context, clusterID string) (int, error) {
						tracker.markGet()
						return tc.currentLimit, tc.getErr
					},
					increaseSpendLimitFn: func(ctx context.Context, clusterID string, monthlyCents int) error {
						tracker.markIncrease(monthlyCents)
						return tc.increaseErr
					},
				}
			}

			req := requestBuilder(tc.tenant.ID)
			rr := autoSpendLimitServe(t, resolve, req, repo, pool, adjuster, cooldown, tc.cfg)

			if rr.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rr.Code, tc.wantStatus)
			}

			time.Sleep(100 * time.Millisecond)

			if !tc.adjusterNil {
				getCalls, increaseCalls, increaseCents := tracker.snapshot()
				if getCalls != tc.wantGetCalls {
					t.Fatalf("GetSpendLimit calls = %d, want %d", getCalls, tc.wantGetCalls)
				}
				if increaseCalls != tc.wantIncreaseCalls {
					t.Fatalf("IncreaseSpendLimit calls = %d, want %d", increaseCalls, tc.wantIncreaseCalls)
				}
				if tc.wantIncreaseCalls > 0 && increaseCents != tc.wantIncreaseCents {
					t.Fatalf("IncreaseSpendLimit monthlyCents = %d, want %d", increaseCents, tc.wantIncreaseCents)
				}
			}

			if tc.checkCooldownRestart && !cooldown.TryStartRaise(tc.tenant.ClusterID) {
				t.Fatal("cooldown was not released after the failed adjustment")
			}
		})
	}
}

func TestResolveTenant_AutoSpendLimit(t *testing.T) {
	runAutoSpendLimitCases(t, ResolveTenant, func(tenantID string) *http.Request {
		return autoSpendLimitResolveTenantRequest(tenantID)
	})
}

func TestResolveApiKey_AutoSpendLimit(t *testing.T) {
	runAutoSpendLimitCases(t, ResolveApiKey, func(tenantID string) *http.Request {
		return autoSpendLimitResolveApiKeyRequest(tenantID)
	})
}
