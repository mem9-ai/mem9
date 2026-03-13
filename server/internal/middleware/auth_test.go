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
	"testing"
	"time"
	"unsafe"

	"github.com/qiffang/mnemos/server/internal/domain"
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

	mw := ResolveApiKey(stubTenantRepo{}, pool)
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

func TestResolveApiKey_InvalidKey(t *testing.T) {
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	mw := ResolveApiKey(stubTenantRepo{}, pool)
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

	mw := ResolveApiKey(repo, pool)
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

	mw := ResolveApiKey(repo, pool)
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
