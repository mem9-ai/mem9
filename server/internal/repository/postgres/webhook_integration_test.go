//go:build integration

package postgres

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
)

var pgTestDB *sql.DB

func TestMain(m *testing.M) {
	dsn := os.Getenv("MNEMO_PG_TEST_DSN")
	if dsn == "" {
		log.Println("MNEMO_PG_TEST_DSN not set; skipping postgres integration tests")
		os.Exit(0)
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		log.Fatalf("open pg: %v", err)
	}
	db.SetMaxOpenConns(5)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("ping pg: %v", err)
	}

	if err := createPGWebhooksTable(db); err != nil {
		log.Fatalf("create webhooks table: %v", err)
	}

	pgTestDB = db
	code := m.Run()
	truncatePGWebhooks(db)
	db.Close()
	os.Exit(code)
}

func createPGWebhooksTable(db *sql.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS webhooks (
		id           VARCHAR(36)    NOT NULL PRIMARY KEY,
		tenant_id    VARCHAR(36)    NOT NULL,
		url          VARCHAR(2048)  NOT NULL,
		secret       TEXT           NOT NULL,
		event_types  JSONB          NOT NULL,
		created_at   TIMESTAMPTZ    DEFAULT NOW(),
		updated_at   TIMESTAMPTZ    DEFAULT NOW()
	)`)
	return err
}

func truncatePGWebhooks(db *sql.DB) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	db.ExecContext(ctx, "DELETE FROM webhooks")
}

func newPGTestWebhook(tenantID string) *domain.Webhook {
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

func TestPGWebhookCreateAndList(t *testing.T) {
	truncatePGWebhooks(pgTestDB)
	repo := NewWebhookRepo(pgTestDB)
	ctx := context.Background()

	tenantID := uuid.New().String()
	w := newPGTestWebhook(tenantID)

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
	if hooks[0].URL != w.URL {
		t.Errorf("url mismatch")
	}
	if hooks[0].Secret != w.Secret {
		t.Errorf("secret mismatch")
	}
}

func TestPGWebhookGetByID_NotFound(t *testing.T) {
	truncatePGWebhooks(pgTestDB)
	repo := NewWebhookRepo(pgTestDB)
	ctx := context.Background()

	_, err := repo.GetByID(ctx, uuid.New().String())
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestPGWebhookDelete(t *testing.T) {
	truncatePGWebhooks(pgTestDB)
	repo := NewWebhookRepo(pgTestDB)
	ctx := context.Background()

	tenantID := uuid.New().String()
	w := newPGTestWebhook(tenantID)
	if _, err := repo.CreateIfBelowLimit(ctx, w, 20); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := repo.Delete(ctx, w.ID, tenantID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	hooks, _ := repo.ListByTenant(ctx, tenantID)
	if len(hooks) != 0 {
		t.Errorf("expected 0 hooks after delete, got %d", len(hooks))
	}
}

func TestPGWebhookDelete_WrongTenant(t *testing.T) {
	truncatePGWebhooks(pgTestDB)
	repo := NewWebhookRepo(pgTestDB)
	ctx := context.Background()

	tenantID := uuid.New().String()
	w := newPGTestWebhook(tenantID)
	if _, err := repo.CreateIfBelowLimit(ctx, w, 20); err != nil {
		t.Fatalf("create: %v", err)
	}

	err := repo.Delete(ctx, w.ID, "wrong-tenant")
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for wrong tenant, got %v", err)
	}
}

func TestPGWebhookCreateIfBelowLimit_EnforcesLimit(t *testing.T) {
	truncatePGWebhooks(pgTestDB)
	repo := NewWebhookRepo(pgTestDB)
	ctx := context.Background()

	tenantID := uuid.New().String()
	const limit = 3
	for i := 0; i < limit; i++ {
		inserted, err := repo.CreateIfBelowLimit(ctx, newPGTestWebhook(tenantID), limit)
		if err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
		if !inserted {
			t.Fatalf("expected inserted=true for %d", i)
		}
	}

	inserted, err := repo.CreateIfBelowLimit(ctx, newPGTestWebhook(tenantID), limit)
	if err != nil {
		t.Fatalf("create at limit: %v", err)
	}
	if inserted {
		t.Error("expected inserted=false at limit")
	}
}

func TestPGWebhookTimestampsRoundtrip(t *testing.T) {
	truncatePGWebhooks(pgTestDB)
	repo := NewWebhookRepo(pgTestDB)
	ctx := context.Background()

	tenantID := uuid.New().String()
	w := newPGTestWebhook(tenantID)
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
