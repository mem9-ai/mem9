//go:build integration

package tidb

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
)

var testDB *sql.DB

func TestMain(m *testing.M) {
	dsn := os.Getenv("MNEMO_TEST_DSN")
	if dsn == "" {
		dsn = os.Getenv("MNEMO_DSN")
	}
	if dsn == "" {
		log.Println("MNEMO_TEST_DSN (or MNEMO_DSN) not set; skipping integration tests")
		os.Exit(0)
	}

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("ping database: %v", err)
	}

	// Create all tables needed for integration tests.
	if err := createTables(db); err != nil {
		log.Fatalf("create tables: %v", err)
	}

	testDB = db

	code := m.Run()

	// Cleanup: truncate all tables after tests.
	_ = truncateAll(db)
	db.Close()
	os.Exit(code)
}

func createTables(db *sql.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Control plane tables.
	_, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS tenants (
		id              VARCHAR(36)   PRIMARY KEY,
		name            VARCHAR(255)  NOT NULL,
		db_host         VARCHAR(255)  NOT NULL,
		db_port         INT           NOT NULL,
		db_user         VARCHAR(255)  NOT NULL,
		db_password     VARCHAR(255)  NOT NULL,
		db_name         VARCHAR(255)  NOT NULL,
		db_tls          TINYINT(1)    NOT NULL DEFAULT 0,
		provider        VARCHAR(50)   NOT NULL,
		cluster_id      VARCHAR(255)  NULL,
		claim_url       TEXT          NULL,
		claim_expires_at TIMESTAMP    NULL,
		status          VARCHAR(20)   NOT NULL DEFAULT 'provisioning',
		schema_version  INT           NOT NULL DEFAULT 1,
		created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
		updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		deleted_at      TIMESTAMP     NULL,
		UNIQUE INDEX idx_tenant_name (name),
		INDEX idx_tenant_status (status),
		INDEX idx_tenant_provider (provider)
	)`)
	if err != nil {
		return fmt.Errorf("create tenants table: %w", err)
	}

	// Data plane table (memories). Note: VECTOR column omitted for MySQL compatibility.
	// TiDB-specific VECTOR(1536) replaced with TEXT NULL for cross-DB compatibility.
	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS memories (
		id              VARCHAR(36)     PRIMARY KEY,
		content         TEXT            NOT NULL,
		source          VARCHAR(100),
		tags            JSON,
		metadata        JSON,
		embedding       TEXT            NULL,
		memory_type     VARCHAR(20)     NOT NULL DEFAULT 'pinned',
		agent_id        VARCHAR(100)    NULL,
		session_id      VARCHAR(100)    NULL,
		state           VARCHAR(20)     NOT NULL DEFAULT 'active',
		version         INT             DEFAULT 1,
		updated_by      VARCHAR(100),
		created_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
		updated_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		superseded_by   VARCHAR(36)     NULL,
		INDEX idx_memory_type         (memory_type),
		INDEX idx_source              (source),
		INDEX idx_state               (state),
		INDEX idx_agent               (agent_id),
		INDEX idx_session             (session_id),
		INDEX idx_updated             (updated_at)
	)`)
	if err != nil {
		return fmt.Errorf("create memories table: %w", err)
	}

	return nil
}

func truncateAll(db *sql.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, table := range []string{"tenants", "memories"} {
		if _, err := db.ExecContext(ctx, "DELETE FROM "+table); err != nil {
			return fmt.Errorf("truncate %s: %w", table, err)
		}
	}
	return nil
}

func truncateMemories(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := testDB.ExecContext(ctx, "DELETE FROM memories"); err != nil {
		t.Fatalf("truncate memories: %v", err)
	}
}

func truncateTenants(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := testDB.ExecContext(ctx, "DELETE FROM tenants"); err != nil {
		t.Fatalf("truncate tenants: %v", err)
	}
}

func newTestMemory(overrides ...func(*domain.Memory)) *domain.Memory {
	now := time.Now()
	m := &domain.Memory{
		ID:         uuid.New().String(),
		Content:    "test memory content",
		Source:     "test-agent",
		Tags:       []string{"test"},
		Metadata:   json.RawMessage(`{"key":"value"}`),
		MemoryType: domain.TypePinned,
		AgentID:    "agent-1",
		SessionID:  "session-1",
		State:      domain.StateActive,
		Version:    1,
		UpdatedBy:  "test-agent",
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	for _, fn := range overrides {
		fn(m)
	}
	return m
}

func newTestTenant(overrides ...func(*domain.Tenant)) *domain.Tenant {
	t := &domain.Tenant{
		ID:            uuid.New().String(),
		Name:          "test-tenant-" + uuid.New().String()[:8],
		DBHost:        "localhost",
		DBPort:        4000,
		DBUser:        "root",
		DBPassword:    "pass",
		DBName:        "test",
		DBTLS:         false,
		Provider:      "tidb_zero",
		Status:        domain.TenantProvisioning,
		SchemaVersion: 1,
	}
	for _, fn := range overrides {
		fn(t)
	}
	return t
}

// newMemoryRepo creates a MemoryRepo pointing at testDB with no auto-embedding and FTS disabled.
func newMemoryRepo() *MemoryRepo {
	return NewMemoryRepo(testDB, "", false, "")
}
