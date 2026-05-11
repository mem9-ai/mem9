//go:build integration

package tidb

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestTenantCreate(t *testing.T) {
	truncateTenants(t)
	repo := NewTenantRepo(testDB)
	ctx := context.Background()

	tenant := newTestTenant()
	if err := repo.Create(ctx, tenant); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := repo.GetByID(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Name != tenant.Name {
		t.Fatalf("name mismatch: got %q want %q", got.Name, tenant.Name)
	}
	if got.DBHost != tenant.DBHost {
		t.Fatalf("db_host mismatch: got %q want %q", got.DBHost, tenant.DBHost)
	}
	if got.Provider != tenant.Provider {
		t.Fatalf("provider mismatch: got %q want %q", got.Provider, tenant.Provider)
	}
	if got.Status != domain.TenantProvisioning {
		t.Fatalf("status mismatch: got %q want %q", got.Status, domain.TenantProvisioning)
	}
	if got.SchemaVersion != 1 {
		t.Fatalf("schema_version mismatch: got %d want 1", got.SchemaVersion)
	}
}

func TestTenantCreateDuplicateName(t *testing.T) {
	truncateTenants(t)
	repo := NewTenantRepo(testDB)
	ctx := context.Background()

	name := "unique-" + uuid.New().String()[:8]
	t1 := newTestTenant(func(t *domain.Tenant) { t.Name = name })
	if err := repo.Create(ctx, t1); err != nil {
		t.Fatalf("first Create: %v", err)
	}

	t2 := newTestTenant(func(t *domain.Tenant) { t.Name = name })
	if err := repo.Create(ctx, t2); err == nil {
		t.Fatal("expected error on duplicate name")
	}
}

func TestTenantGetByName(t *testing.T) {
	truncateTenants(t)
	repo := NewTenantRepo(testDB)
	ctx := context.Background()

	tenant := newTestTenant()
	if err := repo.Create(ctx, tenant); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := repo.GetByName(ctx, tenant.Name)
	if err != nil {
		t.Fatalf("GetByName: %v", err)
	}
	if got.ID != tenant.ID {
		t.Fatalf("ID mismatch: got %q want %q", got.ID, tenant.ID)
	}
}

func TestTenantGetByNameDeleted(t *testing.T) {
	truncateTenants(t)
	repo := NewTenantRepo(testDB)
	ctx := context.Background()

	tenant := newTestTenant()
	if err := repo.Create(ctx, tenant); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Mark as deleted.
	if err := repo.UpdateStatus(ctx, tenant.ID, domain.TenantDeleted); err != nil {
		t.Fatalf("UpdateStatus: %v", err)
	}

	// GetByName filters out deleted.
	_, err := repo.GetByName(ctx, tenant.Name)
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for deleted tenant, got %v", err)
	}
}

func TestTenantGetByIDNotFound(t *testing.T) {
	truncateTenants(t)
	repo := NewTenantRepo(testDB)
	ctx := context.Background()

	_, err := repo.GetByID(ctx, "nonexistent-id")
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestTenantUpdateStatus(t *testing.T) {
	truncateTenants(t)
	repo := NewTenantRepo(testDB)
	ctx := context.Background()

	tenant := newTestTenant()
	if err := repo.Create(ctx, tenant); err != nil {
		t.Fatalf("Create: %v", err)
	}

	statuses := []domain.TenantStatus{
		domain.TenantActive,
		domain.TenantSuspended,
		domain.TenantDeleted,
	}
	for _, s := range statuses {
		if err := repo.UpdateStatus(ctx, tenant.ID, s); err != nil {
			t.Fatalf("UpdateStatus(%s): %v", s, err)
		}
		got, err := repo.GetByID(ctx, tenant.ID)
		if err != nil {
			t.Fatalf("GetByID after UpdateStatus: %v", err)
		}
		if got.Status != s {
			t.Fatalf("status mismatch: got %q want %q", got.Status, s)
		}
	}
}

func TestTenantUpdateSchemaVersion(t *testing.T) {
	truncateTenants(t)
	repo := NewTenantRepo(testDB)
	ctx := context.Background()

	tenant := newTestTenant()
	if err := repo.Create(ctx, tenant); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := repo.UpdateSchemaVersion(ctx, tenant.ID, 5); err != nil {
		t.Fatalf("UpdateSchemaVersion: %v", err)
	}

	got, err := repo.GetByID(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.SchemaVersion != 5 {
		t.Fatalf("schema_version mismatch: got %d want 5", got.SchemaVersion)
	}
}

func TestTenantTouchActivityKeepsGreatestTimestamp(t *testing.T) {
	if err := truncateAll(testDB); err != nil {
		t.Fatalf("truncateAll: %v", err)
	}
	repo := NewTenantRepo(testDB)
	ctx := context.Background()

	tenant := newTestTenant(func(t *domain.Tenant) { t.Status = domain.TenantActive })
	if err := repo.Create(ctx, tenant); err != nil {
		t.Fatalf("Create: %v", err)
	}

	later := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	earlier := later.Add(-24 * time.Hour)
	if err := repo.TouchActivity(ctx, tenant.ID, later); err != nil {
		t.Fatalf("TouchActivity later: %v", err)
	}
	if err := repo.TouchActivity(ctx, tenant.ID, earlier); err != nil {
		t.Fatalf("TouchActivity earlier: %v", err)
	}

	var got time.Time
	if err := testDB.QueryRowContext(ctx,
		`SELECT last_activity_at FROM tenant_activity WHERE tenant_id = ?`,
		tenant.ID,
	).Scan(&got); err != nil {
		t.Fatalf("query last_activity_at: %v", err)
	}
	if !got.Equal(later) {
		t.Fatalf("last_activity_at = %s, want %s", got, later)
	}
}

func TestTenantCountActiveTenantsSince(t *testing.T) {
	if err := truncateAll(testDB); err != nil {
		t.Fatalf("truncateAll: %v", err)
	}
	repo := NewTenantRepo(testDB)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	since := now.Add(-7 * 24 * time.Hour)

	recentActive := newTestTenant(func(t *domain.Tenant) { t.Status = domain.TenantActive })
	staleActive := newTestTenant(func(t *domain.Tenant) { t.Status = domain.TenantActive })
	noActivity := newTestTenant(func(t *domain.Tenant) { t.Status = domain.TenantActive })
	suspended := newTestTenant(func(t *domain.Tenant) { t.Status = domain.TenantSuspended })
	deleted := newTestTenant(func(t *domain.Tenant) { t.Status = domain.TenantDeleted })
	deletedAt := newTestTenant(func(t *domain.Tenant) { t.Status = domain.TenantActive })

	for _, tenant := range []*domain.Tenant{recentActive, staleActive, noActivity, suspended, deleted, deletedAt} {
		if err := repo.Create(ctx, tenant); err != nil {
			t.Fatalf("Create(%s): %v", tenant.ID, err)
		}
	}
	if _, err := testDB.ExecContext(ctx, `UPDATE tenants SET deleted_at = ? WHERE id = ?`, now, deletedAt.ID); err != nil {
		t.Fatalf("mark deleted_at: %v", err)
	}

	touches := map[string]time.Time{
		recentActive.ID: now,
		staleActive.ID:  since.Add(-time.Second),
		suspended.ID:    now,
		deleted.ID:      now,
		deletedAt.ID:    now,
	}
	for tenantID, at := range touches {
		if err := repo.TouchActivity(ctx, tenantID, at); err != nil {
			t.Fatalf("TouchActivity(%s): %v", tenantID, err)
		}
	}

	got, err := repo.CountActiveTenantsSince(ctx, since)
	if err != nil {
		t.Fatalf("CountActiveTenantsSince: %v", err)
	}
	if got != 1 {
		t.Fatalf("active tenants since = %d, want 1", got)
	}
}
