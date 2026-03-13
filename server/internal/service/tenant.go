package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
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

// tenantMemorySchemaDB9Base is the db9/PostgreSQL schema template with auto-embedding support.
const tenantMemorySchemaDB9Base = `CREATE TABLE IF NOT EXISTS memories (
    id              VARCHAR(36)     PRIMARY KEY,
    content         TEXT            NOT NULL,
    source          VARCHAR(100),
    tags            JSONB,
    metadata        JSONB,
    %s
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
CREATE INDEX IF NOT EXISTS idx_memory_source ON memories(source);
CREATE INDEX IF NOT EXISTS idx_memory_state ON memories(state);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_session ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_updated ON memories(updated_at);
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_memories_updated ON memories;
CREATE TRIGGER trg_memories_updated BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
`

func buildMemorySchema(autoModel string, autoDims int) string {
	var embeddingCol string
	if autoModel != "" {
		sanitizedModel := strings.ReplaceAll(autoModel, "'", "''")
		embeddingCol = fmt.Sprintf(
			`embedding VECTOR(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', content, '{"dimensions": %d}')) STORED,`,
			autoDims, sanitizedModel, autoDims,
		)
	} else {
		embeddingCol = `embedding VECTOR(1536) NULL,`
	}
	return fmt.Sprintf(tenantMemorySchemaBase, embeddingCol)
}

func buildDB9MemorySchema(autoModel string, autoDims int) string {
	var embeddingCol string
	if autoModel != "" {
		sanitizedModel := strings.ReplaceAll(autoModel, "'", "''")
		embeddingCol = fmt.Sprintf(
			`embedding VECTOR(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', content, '{"dimensions": %d}')) STORED,`,
			autoDims, sanitizedModel, autoDims,
		)
	} else {
		embeddingCol = `embedding VECTOR(1536) NULL,`
	}
	return fmt.Sprintf(tenantMemorySchemaDB9Base, embeddingCol)
}

type TenantService struct {
	tenants     repository.TenantRepo
	provisioner tenant.Provisioner
	pool        *tenant.TenantPool
	logger      *slog.Logger
	autoModel   string
	autoDims    int
	ftsEnabled  bool
}

func NewTenantService(
	tenants repository.TenantRepo,
	provisioner tenant.Provisioner,
	pool *tenant.TenantPool,
	logger *slog.Logger,
	autoModel string,
	autoDims int,
	ftsEnabled bool,
) *TenantService {
	return &TenantService{
		tenants:     tenants,
		provisioner: provisioner,
		pool:        pool,
		logger:      logger,
		autoModel:   autoModel,
		autoDims:    autoDims,
		ftsEnabled:  ftsEnabled,
	}
}

// ProvisionResult is the output of Provision.
type ProvisionResult struct {
	ID string `json:"id"`
}

// Provision creates a new cluster and registers it as a tenant.
func (s *TenantService) Provision(ctx context.Context) (*ProvisionResult, error) {
	if s.pool == nil {
		return nil, fmt.Errorf("tenant pool not configured")
	}
	if s.pool.Backend() != "tidb" {
		return nil, &domain.ValidationError{Message: fmt.Sprintf("auto-provisioning requires tidb backend; got %q", s.pool.Backend())}
	}
	if s.provisioner == nil {
		return nil, &domain.ValidationError{Message: "provisioning not configured"}
	}

	total := time.Now()

	// Step 1: Acquire cluster from provisioner
	t0 := time.Now()
	info, err := s.provisioner.Provision(ctx)
	elapsed := time.Since(t0)
	// Determine provider type for metrics
	providerType := "unknown"
	if _, ok := s.provisioner.(*tenant.TiDBCloudProvisioner); ok {
		providerType = "tidb_cloud_starter"
	} else if _, ok := s.provisioner.(*tenant.ZeroProvisioner); ok {
		providerType = "tidb_zero"
	}
	s.logger.Info("provision step", "step", "cluster_acquire", "provider", providerType, "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("cluster_acquire_" + providerType).Observe(elapsed.Seconds())
	if err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("provision cluster: %w", err)
	}

	tenantID := info.ID

	t := &domain.Tenant{
		ID:            tenantID,
		Name:          tenantID,
		DBHost:        info.Host,
		DBPort:        info.Port,
		DBUser:        info.Username,
		DBPassword:    info.Password,
		DBName:        info.DBName,
		DBTLS:         true,
		Provider:      providerType,
		ClusterID:     info.ID,
		Status:        domain.TenantProvisioning,
		SchemaVersion: 0,
	}

	t0 = time.Now()
	if err := s.tenants.Create(ctx, t); err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("create tenant record: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "create_tenant_record", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("create_tenant_record").Observe(elapsed.Seconds())

	// Get DB connection for schema initialization
	db, err := s.pool.Get(ctx, tenantID, t.DSNForBackend(s.pool.Backend()))
	if err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("get tenant db: %w", err)
	}

	t0 = time.Now()
	if err := s.provisioner.InitSchema(ctx, db); err != nil {
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
	if err := s.tenants.UpdateSchemaVersion(ctx, tenantID, 1); err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("update schema version: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "update_schema_version", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("update_schema_version").Observe(elapsed.Seconds())

	t0 = time.Now()
	if err := s.tenants.UpdateStatus(ctx, tenantID, domain.TenantActive); err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("activate tenant: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "update_status", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("update_status").Observe(elapsed.Seconds())

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



func isIndexExistsError(err error) bool {
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		return mysqlErr.Number == 1061
	}
	return strings.Contains(err.Error(), "already exists")
}
