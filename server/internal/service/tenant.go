package service

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/tenant"
)

type TenantService struct {
	tenants     repository.TenantRepo
	provisioner tenant.Provisioner
	pool        *tenant.TenantPool
	logger      *slog.Logger
	autoModel   string
	autoDims    int
	ftsEnabled  bool
	encryptor   encrypt.Encryptor
}

func NewTenantService(
	tenants repository.TenantRepo,
	provisioner tenant.Provisioner,
	pool *tenant.TenantPool,
	logger *slog.Logger,
	autoModel string,
	autoDims int,
	ftsEnabled bool,
	encryptor encrypt.Encryptor,
) *TenantService {
	return &TenantService{
		tenants:     tenants,
		provisioner: provisioner,
		pool:        pool,
		logger:      logger,
		autoModel:   autoModel,
		autoDims:    autoDims,
		ftsEnabled:  ftsEnabled,
		encryptor:   encryptor,
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
	providerType := s.provisioner.ProviderType()
	s.logger.Info("provision step", "step", "cluster_acquire", "provider", providerType, "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("cluster_acquire_" + providerType).Observe(elapsed.Seconds())
	if err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("provision cluster: %w", err)
	}

	// Encrypt password before storing
	encryptedPassword, err := s.encryptor.Encrypt(ctx, info.Password)
	if err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("encrypt tenant password: %w", err)
	}

	// Build tenant record
	t := &domain.Tenant{
		ID:             info.ID,
		Name:           info.ID,
		DBHost:         info.Host,
		DBPort:         info.Port,
		DBUser:         info.Username,
		DBPassword:     encryptedPassword,
		DBName:         info.DBName,
		DBTLS:          true,
		Provider:       providerType,
		ClusterID:      info.ClusterID,
		ClaimURL:       info.ClaimURL,
		ClaimExpiresAt: info.ClaimExpiresAt,
		Status:         domain.TenantProvisioning,
		SchemaVersion:  0,
	}

	t0 = time.Now()
	if err := s.tenants.Create(ctx, t); err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		s.logger.Error("orphaned cluster: tenants.Create failed",
			"tenant_id", info.ID,
			"cluster_id", info.ClusterID,
			"provider", providerType,
			"err", err)
		return nil, fmt.Errorf("create tenant record: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "create_tenant_record", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("create_tenant_record").Observe(elapsed.Seconds())

	// Get DB connection for schema initialization
	// Use plaintext password for DSN (DBPassword in t is encrypted for storage)
	plainTenant := *t
	plainTenant.DBPassword = info.Password
	db, err := s.pool.Get(ctx, info.ID, plainTenant.DSNForBackend(s.pool.Backend()))
	if err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("get tenant db: %w", err)
	}

	t0 = time.Now()
	if err := s.provisioner.InitSchema(ctx, db); err != nil {
		if s.logger != nil {
			s.logger.Error("tenant schema init failed", "tenant_id", info.ID, "err", err)
		}
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("init tenant schema: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "init_schema", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("init_schema").Observe(elapsed.Seconds())

	t0 = time.Now()
	if err := s.tenants.UpdateSchemaVersion(ctx, info.ID, 1); err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("update schema version: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "update_schema_version", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("update_schema_version").Observe(elapsed.Seconds())

	t0 = time.Now()
	if err := s.tenants.UpdateStatus(ctx, info.ID, domain.TenantActive); err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("activate tenant: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "update_status", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("update_status").Observe(elapsed.Seconds())

	totalElapsed := time.Since(total)
	s.logger.Info("provision step", "step", "total", "duration_ms", totalElapsed.Milliseconds(), "tenant_id", info.ID)
	metrics.ProvisionStepDuration.WithLabelValues("total").Observe(totalElapsed.Seconds())
	metrics.ProvisionTotal.WithLabelValues("success").Inc()

	return &ProvisionResult{
		ID: info.ID,
	}, nil
}

// GetInfo returns tenant info including agent and memory counts.
func (s *TenantService) GetInfo(ctx context.Context, tenantID string) (*domain.TenantInfo, error) {
	t, err := s.tenants.GetByID(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	// Decrypt password before using
	decryptedPassword, err := s.encryptor.Decrypt(ctx, t.DBPassword)
	if err != nil {
		return nil, fmt.Errorf("decrypt tenant password for %s: %w", tenantID, err)
	}
	t.DBPassword = decryptedPassword

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

// EnsureMemoriesAutoEmbedding migrates the memories.embedding column to
// GENERATED ALWAYS AS (EMBED_TEXT(...)) STORED when MNEMO_EMBED_AUTO_MODEL is set
// but the column is still a plain VECTOR NULL column (e.g. created from schema.sql).
// This is a no-op when autoModel is not configured or the column is already GENERATED.
func (s *TenantService) EnsureMemoriesAutoEmbedding(ctx context.Context, db *sql.DB) error {
	if s.autoModel == "" || s.autoDims == 0 {
		return nil
	}

	var extra string
	err := db.QueryRowContext(ctx,
		`SELECT EXTRA FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'memories' AND COLUMN_NAME = 'embedding'`,
	).Scan(&extra)
	if err == sql.ErrNoRows {
		slog.Warn("memories.embedding column not found; skipping auto-embedding migration")
		return nil
	}
	if err != nil {
		return fmt.Errorf("check embedding column: %w", err)
	}

	// Already a generated column — nothing to do.
	if strings.Contains(strings.ToUpper(extra), "GENERATED") {
		return nil
	}

	slog.Warn("memories.embedding is a plain VECTOR column; migrating to EMBED_TEXT-generated column",
		"model", s.autoModel, "dims", s.autoDims)

	// First try the simple in-place ALTER path.
	_, _ = db.ExecContext(ctx, `ALTER TABLE memories DROP INDEX idx_cosine`)

	sanitizedModel := strings.ReplaceAll(s.autoModel, "'", "''")
	alterSQL := fmt.Sprintf(
		`ALTER TABLE memories MODIFY COLUMN embedding VECTOR(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', content, '{"dimensions": %d}')) STORED`,
		s.autoDims, sanitizedModel, s.autoDims,
	)
	if _, err := db.ExecContext(ctx, alterSQL); err != nil {
		// Some TiDB versions reject changing a plain column into a generated column in-place.
		// Rebuild the table into the correct shape and swap it in.
		if strings.Contains(err.Error(), "newCol IsGenerated true, oldCol IsGenerated false") {
			if rebuildErr := s.rebuildMemoriesTableWithAutoEmbedding(ctx, db); rebuildErr != nil {
				return fmt.Errorf("migrate embedding column via rebuild: %w (original alter error: %v)", rebuildErr, err)
			}
		} else {
			return fmt.Errorf(
				"migrate embedding column: run manually: ALTER TABLE memories MODIFY COLUMN embedding VECTOR(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', content, '{\"dimensions\": %d}')) STORED: %w",
				s.autoDims, s.autoModel, s.autoDims, err,
			)
		}
	}

	_, err = db.ExecContext(ctx,
		`ALTER TABLE memories ADD VECTOR INDEX idx_cosine ((VEC_COSINE_DISTANCE(embedding))) ADD_COLUMNAR_REPLICA_ON_DEMAND`)
	if err != nil && !tenant.IsIndexExistsError(err) {
		slog.Warn("failed to add vector index after embedding migration (non-fatal)", "err", err)
	}

	slog.Info("memories.embedding column migrated to EMBED_TEXT-generated", "model", s.autoModel, "dims", s.autoDims)
	return nil
}

func (s *TenantService) EnsureSessionsTable(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, tenant.BuildSessionsSchema(s.autoModel, s.autoDims)); err != nil {
		return fmt.Errorf("ensure sessions table: create: %w", err)
	}
	if s.autoModel != "" {
		var extra string
		err := db.QueryRowContext(ctx,
			`SELECT EXTRA FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'embedding'`,
		).Scan(&extra)
		if err == nil && !strings.Contains(strings.ToUpper(extra), "GENERATED") {
			slog.Warn("sessions.embedding is a plain VECTOR column; rebuilding table to EMBED_TEXT-generated",
				"model", s.autoModel, "dims", s.autoDims)
			if rebuildErr := s.rebuildSessionsTableWithAutoEmbedding(ctx, db); rebuildErr != nil {
				return fmt.Errorf("ensure sessions table: rebuild: %w", rebuildErr)
			}
		}
		_, err = db.ExecContext(ctx,
			`ALTER TABLE sessions ADD VECTOR INDEX idx_sessions_cosine ((VEC_COSINE_DISTANCE(embedding))) ADD_COLUMNAR_REPLICA_ON_DEMAND`)
		if err != nil && !tenant.IsIndexExistsError(err) {
			return fmt.Errorf("ensure sessions table: vector index: %w", err)
		}
	}
	if s.ftsEnabled {
		_, err := db.ExecContext(ctx,
			`ALTER TABLE sessions ADD FULLTEXT INDEX idx_sessions_fts (content) WITH PARSER MULTILINGUAL ADD_COLUMNAR_REPLICA_ON_DEMAND`)
		if err != nil && !tenant.IsIndexExistsError(err) {
			return fmt.Errorf("ensure sessions table: fts index: %w", err)
		}
	}
	return nil
}

func (s *TenantService) rebuildMemoriesTableWithAutoEmbedding(ctx context.Context, db *sql.DB) error {
	tmp := "memories_auto_tmp"
	backup := fmt.Sprintf("memories_backup_%d", time.Now().Unix())
	createSQL := strings.Replace(tenant.BuildMemorySchema(s.autoModel, s.autoDims), "CREATE TABLE IF NOT EXISTS memories", "CREATE TABLE "+tmp, 1)
	if _, err := db.ExecContext(ctx, `DROP TABLE IF EXISTS `+tmp); err != nil {
		return fmt.Errorf("drop temp memories table: %w", err)
	}
	if _, err := db.ExecContext(ctx, createSQL); err != nil {
		return fmt.Errorf("create temp memories table: %w", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO `+tmp+` (id, content, source, tags, metadata, memory_type, agent_id, session_id, state, version, updated_by, superseded_by, created_at, updated_at)
		SELECT id, content, source, tags, metadata, memory_type, agent_id, session_id, state, version, updated_by, superseded_by, created_at, updated_at FROM memories`); err != nil {
		return fmt.Errorf("copy memories data: %w", err)
	}
	renameSQL := fmt.Sprintf("RENAME TABLE memories TO %s, %s TO memories", backup, tmp)
	if _, err := db.ExecContext(ctx, renameSQL); err != nil {
		return fmt.Errorf("swap memories tables: %w", err)
	}
	return nil
}

func (s *TenantService) rebuildSessionsTableWithAutoEmbedding(ctx context.Context, db *sql.DB) error {
	tmp := "sessions_auto_tmp"
	backup := fmt.Sprintf("sessions_backup_%d", time.Now().Unix())
	createSQL := strings.Replace(tenant.BuildSessionsSchema(s.autoModel, s.autoDims), "CREATE TABLE IF NOT EXISTS sessions", "CREATE TABLE "+tmp, 1)
	if _, err := db.ExecContext(ctx, `DROP TABLE IF EXISTS `+tmp); err != nil {
		return fmt.Errorf("drop temp sessions table: %w", err)
	}
	if _, err := db.ExecContext(ctx, createSQL); err != nil {
		return fmt.Errorf("create temp sessions table: %w", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO `+tmp+` (id, session_id, agent_id, source, seq, role, content, content_type, content_hash, tags, state, created_at, updated_at)
		SELECT id, session_id, agent_id, source, seq, role, content, content_type, content_hash, tags, state, created_at, updated_at FROM sessions`); err != nil {
		return fmt.Errorf("copy sessions data: %w", err)
	}
	renameSQL := fmt.Sprintf("RENAME TABLE sessions TO %s, %s TO sessions", backup, tmp)
	if _, err := db.ExecContext(ctx, renameSQL); err != nil {
		return fmt.Errorf("swap sessions tables: %w", err)
	}
	return nil
}
