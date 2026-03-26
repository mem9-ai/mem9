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

func truncateWebhooks(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := testDB.ExecContext(ctx, "DELETE FROM webhooks"); err != nil {
		t.Fatalf("truncate webhooks: %v", err)
	}
}

func newTestWebhook(tenantID string) *domain.Webhook {
	now := time.Now().UTC().Truncate(time.Second)
	return &domain.Webhook{
		ID:         uuid.New().String(),
		TenantID:   tenantID,
		URL:        "https://example.com/hook-" + uuid.New().String()[:8],
		Secret:     "whsec_test",
		EventTypes: domain.AllEventTypes,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
}

func TestWebhookCreateAndList(t *testing.T) {
	truncateWebhooks(t)
	repo := NewWebhookRepo(testDB)
	ctx := context.Background()

	tenantID := uuid.New().String()
	w := newTestWebhook(tenantID)

	inserted, err := repo.CreateIfBelowLimit(ctx, w, 20)
	if err != nil {
		t.Fatalf("CreateIfBelowLimit: %v", err)
	}
	if !inserted {
		t.Fatal("expected inserted=true")
	}

	hooks, err := repo.ListByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListByTenant: %v", err)
	}
	if len(hooks) != 1 {
		t.Fatalf("expected 1 hook, got %d", len(hooks))
	}
	got := hooks[0]
	if got.ID != w.ID {
		t.Errorf("id mismatch: got %q want %q", got.ID, w.ID)
	}
	if got.URL != w.URL {
		t.Errorf("url mismatch: got %q want %q", got.URL, w.URL)
	}
	if got.Secret != w.Secret {
		t.Errorf("secret mismatch: got %q want %q", got.Secret, w.Secret)
	}
	if len(got.EventTypes) != len(domain.AllEventTypes) {
		t.Errorf("event_types mismatch: got %v", got.EventTypes)
	}
	if got.CreatedAt.IsZero() {
		t.Error("expected non-zero created_at")
	}
}

func TestWebhookGetByID(t *testing.T) {
	truncateWebhooks(t)
	repo := NewWebhookRepo(testDB)
	ctx := context.Background()

	tenantID := uuid.New().String()
	w := newTestWebhook(tenantID)
	if _, err := repo.CreateIfBelowLimit(ctx, w, 20); err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := repo.GetByID(ctx, w.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.ID != w.ID {
		t.Errorf("id mismatch")
	}
}

func TestWebhookGetByID_NotFound(t *testing.T) {
	truncateWebhooks(t)
	repo := NewWebhookRepo(testDB)
	ctx := context.Background()

	_, err := repo.GetByID(ctx, uuid.New().String())
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestWebhookDelete(t *testing.T) {
	truncateWebhooks(t)
	repo := NewWebhookRepo(testDB)
	ctx := context.Background()

	tenantID := uuid.New().String()
	w := newTestWebhook(tenantID)
	if _, err := repo.CreateIfBelowLimit(ctx, w, 20); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := repo.Delete(ctx, w.ID, tenantID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	hooks, err := repo.ListByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListByTenant after delete: %v", err)
	}
	if len(hooks) != 0 {
		t.Errorf("expected 0 hooks after delete, got %d", len(hooks))
	}
}

func TestWebhookDelete_WrongTenant(t *testing.T) {
	truncateWebhooks(t)
	repo := NewWebhookRepo(testDB)
	ctx := context.Background()

	tenantID := uuid.New().String()
	w := newTestWebhook(tenantID)
	if _, err := repo.CreateIfBelowLimit(ctx, w, 20); err != nil {
		t.Fatalf("create: %v", err)
	}

	err := repo.Delete(ctx, w.ID, "wrong-tenant")
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for wrong tenant, got %v", err)
	}
}

func TestWebhookCountByTenant(t *testing.T) {
	truncateWebhooks(t)
	repo := NewWebhookRepo(testDB)
	ctx := context.Background()

	tenantID := uuid.New().String()
	for i := 0; i < 3; i++ {
		w := newTestWebhook(tenantID)
		if _, err := repo.CreateIfBelowLimit(ctx, w, 20); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}

	count, err := repo.CountByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("CountByTenant: %v", err)
	}
	if count != 3 {
		t.Errorf("expected count=3, got %d", count)
	}
}

func TestWebhookCreateIfBelowLimit_EnforcesLimit(t *testing.T) {
	truncateWebhooks(t)
	repo := NewWebhookRepo(testDB)
	ctx := context.Background()

	tenantID := uuid.New().String()
	const limit = 3
	for i := 0; i < limit; i++ {
		inserted, err := repo.CreateIfBelowLimit(ctx, newTestWebhook(tenantID), limit)
		if err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
		if !inserted {
			t.Fatalf("expected inserted=true for %d", i)
		}
	}

	inserted, err := repo.CreateIfBelowLimit(ctx, newTestWebhook(tenantID), limit)
	if err != nil {
		t.Fatalf("create at limit: %v", err)
	}
	if inserted {
		t.Error("expected inserted=false when at limit")
	}

	count, _ := repo.CountByTenant(ctx, tenantID)
	if count != limit {
		t.Errorf("expected count=%d, got %d", limit, count)
	}
}

func TestWebhookTimestampsRoundtrip(t *testing.T) {
	truncateWebhooks(t)
	repo := NewWebhookRepo(testDB)
	ctx := context.Background()

	tenantID := uuid.New().String()
	w := newTestWebhook(tenantID)
	if _, err := repo.CreateIfBelowLimit(ctx, w, 20); err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := repo.GetByID(ctx, w.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.CreatedAt.Unix() != w.CreatedAt.Unix() {
		t.Errorf("created_at mismatch: stored %v, got %v", w.CreatedAt, got.CreatedAt)
	}
}
