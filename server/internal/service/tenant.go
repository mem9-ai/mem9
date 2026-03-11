package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/tenant"
)

// tenantMemorySchemaBase is the MySQL/TiDB schema template.
// The %s placeholder is replaced with the embedding column definition.
const tenantMemorySchemaBase = `CREATE TABLE IF NOT EXISTS memories (
	    id              VARCHAR(36)     PRIMARY KEY,
	    content         TEXT            NOT NULL,
	    source          VARCHAR(100),
	    tags            JSON,
	    metadata        JSON,
	    %s
	    memory_type     VARCHAR(20)     NOT NULL DEFAULT 'pinned',
	    agent_id        VARCHAR(100)    NULL,
	    session_id      VARCHAR(100)    NULL,
	    state           VARCHAR(20)     NOT NULL DEFAULT 'active',
	    version         INT             DEFAULT 1,
	    updated_by      VARCHAR(100),
	    superseded_by   VARCHAR(36)     NULL,
	    created_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
	    updated_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	    INDEX idx_memory_type         (memory_type),
	    INDEX idx_source              (source),
	    INDEX idx_state               (state),
	    INDEX idx_agent               (agent_id),
	    INDEX idx_session             (session_id),
	    INDEX idx_updated             (updated_at)
	)`

// tenantMemorySchemaPostgres is the PostgreSQL schema with pgvector support.
const tenantMemorySchemaPostgres = `CREATE TABLE IF NOT EXISTS memories (
	    id              VARCHAR(36)     PRIMARY KEY,
	    content         TEXT            NOT NULL,
	    source          VARCHAR(100),
	    tags            JSONB,
	    metadata        JSONB,
	    embedding       vector(1536)    NULL,
	    memory_type     VARCHAR(20)     NOT NULL DEFAULT 'pinned',
	    agent_id        VARCHAR(100)    NULL,
	    session_id      VARCHAR(100)    NULL,
	    state           VARCHAR(20)     NOT NULL DEFAULT 'active',
	    version         INT             DEFAULT 1,
	    updated_by      VARCHAR(100),
	    superseded_by   VARCHAR(36)     NULL,
	    created_at      TIMESTAMPTZ     DEFAULT NOW(),
	    updated_at      TIMESTAMPTZ     DEFAULT NOW()
	);
	CREATE INDEX IF NOT EXISTS idx_memory_type ON memories(memory_type);
	CREATE INDEX IF NOT EXISTS idx_source ON memories(source);
	CREATE INDEX IF NOT EXISTS idx_state ON memories(state);
	CREATE INDEX IF NOT EXISTS idx_agent ON memories(agent_id);
	CREATE INDEX IF NOT EXISTS idx_session ON memories(session_id);
	CREATE INDEX IF NOT EXISTS idx_updated ON memories(updated_at);
	CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
	DROP TRIGGER IF EXISTS trg_memories_updated ON memories;
	CREATE TRIGGER trg_memories_updated BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
	`

func buildMemorySchema(autoModel string, autoDims int) string {
	var embeddingCol string
	if autoModel != "" {
		dims := strconv.Itoa(autoDims)
		embeddingCol = `embedding VECTOR(` + dims + `) GENERATED ALWAYS AS (EMBED_TEXT('` + autoModel + `', content)) STORED,`
	} else {
		embeddingCol = `embedding VECTOR(1536) NULL,`
	}
	return fmt.Sprintf(tenantMemorySchemaBase, embeddingCol)
}

type TenantService struct {
	tenants    repository.TenantRepo
	zero       *tenant.ZeroClient
	pool       *tenant.TenantPool
	logger     *slog.Logger
	autoModel  string
	autoDims   int
	ftsEnabled bool
}

func NewTenantService(
	tenants repository.TenantRepo,
	zero *tenant.ZeroClient,
	pool *tenant.TenantPool,
	logger *slog.Logger,
	autoModel string,
	autoDims int,
	ftsEnabled bool,
) *TenantService {
	return &TenantService{
		tenants:    tenants,
		zero:       zero,
		pool:       pool,
		logger:     logger,
		autoModel:  autoModel,
		autoDims:   autoDims,
		ftsEnabled: ftsEnabled,
	}
}

// ProvisionResult is the output of Provision.
type ProvisionResult struct {
	ID string `json:"id"`
}

// Provision creates a new TiDB Zero instance and registers it as a tenant.
// The TiDB Zero instance ID is used as the tenant ID.
func (s *TenantService) Provision(ctx context.Context) (*ProvisionResult, error) {
	if s.zero == nil {
		return nil, &domain.ValidationError{Message: "provisioning disabled (TiDB Zero not configured)"}
	}

	total := time.Now()

	t0 := time.Now()
	instance, err := s.zero.CreateInstance(ctx, "mem9s")
	elapsed := time.Since(t0)
	s.logger.Info("provision step", "step", "tidb_zero_create_instance", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("tidb_zero_create_instance").Observe(elapsed.Seconds())
	if err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("provision TiDB Zero instance: %w", err)
	}

	// Use the TiDB Zero instance ID as the tenant ID.
	tenantID := instance.ID

	t := &domain.Tenant{
		ID:             tenantID,
		Name:           tenantID, // Use ID as name for auto-provisioned tenants.
		DBHost:         instance.Host,
		DBPort:         instance.Port,
		DBUser:         instance.Username,
		DBPassword:     instance.Password,
		DBName:         "test",
		DBTLS:          true,
		Provider:       "tidb_zero",
		ClusterID:      instance.ID,
		ClaimURL:       instance.ClaimURL,
		ClaimExpiresAt: instance.ClaimExpiresAt,
		Status:         domain.TenantProvisioning,
		SchemaVersion:  0,
	}

	t0 = time.Now()
	if err := s.tenants.Create(ctx, t); err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("create tenant record: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "create_tenant_record", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("create_tenant_record").Observe(elapsed.Seconds())

	t0 = time.Now()
	if err := s.initSchema(ctx, t); err != nil {
		if s.logger != nil {
			s.logger.Error("tenant schema init failed", "tenant_id", tenantID, "err", err)
		}
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("init tenant schema: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "init_schema", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("init_schema").Observe(elapsed.Seconds())

	t0 = time.Now()
	if err := s.tenants.UpdateStatus(ctx, tenantID, domain.TenantActive); err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("activate tenant: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "update_status", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("update_status").Observe(elapsed.Seconds())

	t0 = time.Now()
	if err := s.tenants.UpdateSchemaVersion(ctx, tenantID, 1); err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("update schema version: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "update_schema_version", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("update_schema_version").Observe(elapsed.Seconds())

	totalElapsed := time.Since(total)
	s.logger.Info("provision step", "step", "total", "duration_ms", totalElapsed.Milliseconds(), "tenant_id", tenantID)
	metrics.ProvisionStepDuration.WithLabelValues("total").Observe(totalElapsed.Seconds())
	metrics.ProvisionTotal.WithLabelValues("success").Inc()

	return &ProvisionResult{
		ID: tenantID,
	}, nil
}

// GetInfo returns tenant info including agent and memory counts.
func (s *TenantService) GetInfo(ctx context.Context, tenantID string) (*domain.TenantInfo, error) {
	t, err := s.tenants.GetByID(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	if s.pool == nil {
		return nil, fmt.Errorf("tenant pool not configured")
	}
	db, err := s.pool.Get(ctx, tenantID, t.DSNForBackend(s.pool.Backend()))
	if err != nil {
		return nil, err
	}

	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM memories").Scan(&count); err != nil {
		return nil, err
	}

	return &domain.TenantInfo{
		TenantID:    t.ID,
		Name:        t.Name,
		Status:      t.Status,
		Provider:    t.Provider,
		MemoryCount: count,
		CreatedAt:   t.CreatedAt,
	}, nil
}

func (s *TenantService) initSchema(ctx context.Context, t *domain.Tenant) error {
	if s.pool == nil {
		return fmt.Errorf("tenant pool not configured")
	}
	db, err := s.pool.Get(ctx, t.ID, t.DSNForBackend(s.pool.Backend()))
	if err != nil {
		return err
	}

	switch s.pool.Backend() {
	case "postgres":
		t0 := time.Now()
		if _, err := db.ExecContext(ctx, `CREATE EXTENSION IF NOT EXISTS vector`); err != nil {
			return fmt.Errorf("init tenant schema: pgvector extension: %w", err)
		}
		elapsed := time.Since(t0)
		s.logger.Info("provision step", "step", "init_schema_pgvector_extension", "duration_ms", elapsed.Milliseconds())
		metrics.ProvisionStepDuration.WithLabelValues("init_schema_pgvector_extension").Observe(elapsed.Seconds())

		t0 = time.Now()
		// PostgreSQL schema includes CREATE INDEX and updated_at trigger statements,
		// so no extra ALTER TABLE index creation is needed here.
		if _, err := db.ExecContext(ctx, tenantMemorySchemaPostgres); err != nil {
			return fmt.Errorf("init tenant schema: memories: %w", err)
		}
		elapsed = time.Since(t0)
		s.logger.Info("provision step", "step", "init_schema_create_table", "duration_ms", elapsed.Milliseconds())
		metrics.ProvisionStepDuration.WithLabelValues("init_schema_create_table").Observe(elapsed.Seconds())
		return nil
	case "tidb":
		t0 := time.Now()
		if _, err := db.ExecContext(ctx, buildMemorySchema(s.autoModel, s.autoDims)); err != nil {
			return fmt.Errorf("init tenant schema: memories: %w", err)
		}
		elapsed := time.Since(t0)
		s.logger.Info("provision step", "step", "init_schema_create_table", "duration_ms", elapsed.Milliseconds())
		metrics.ProvisionStepDuration.WithLabelValues("init_schema_create_table").Observe(elapsed.Seconds())

		if s.autoModel != "" {
			t0 = time.Now()
			_, err := db.ExecContext(ctx,
				`ALTER TABLE memories ADD VECTOR INDEX idx_cosine ((VEC_COSINE_DISTANCE(embedding))) ADD_COLUMNAR_REPLICA_ON_DEMAND`)
			elapsed = time.Since(t0)
			if err != nil && !isIndexExistsError(err) {
				return fmt.Errorf("init tenant schema: vector index: %w", err)
			}
			s.logger.Info("provision step", "step", "init_schema_vector_index", "duration_ms", elapsed.Milliseconds())
			metrics.ProvisionStepDuration.WithLabelValues("init_schema_vector_index").Observe(elapsed.Seconds())
		}

		if s.ftsEnabled {
			t0 = time.Now()
			_, err := db.ExecContext(ctx,
				`ALTER TABLE memories ADD FULLTEXT INDEX idx_fts_content (content) WITH PARSER MULTILINGUAL ADD_COLUMNAR_REPLICA_ON_DEMAND`)
			elapsed = time.Since(t0)
			if err != nil && !isIndexExistsError(err) {
				return fmt.Errorf("init tenant schema: fulltext index: %w", err)
			}
			s.logger.Info("provision step", "step", "init_schema_fts_index", "duration_ms", elapsed.Milliseconds())
			metrics.ProvisionStepDuration.WithLabelValues("init_schema_fts_index").Observe(elapsed.Seconds())
		}
		return nil
	default:
		return fmt.Errorf("init tenant schema: unsupported backend %q", s.pool.Backend())
	}
}

func isIndexExistsError(err error) bool {
	// Check MySQL-specific error code 1061 (duplicate index).
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		return mysqlErr.Number == 1061
	}
	// Fallback: check for PostgreSQL "already exists" message.
	return strings.Contains(err.Error(), "already exists")
}
