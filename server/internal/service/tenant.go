package service

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
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

func (s *TenantService) EnsureSessionsTable(ctx context.Context, db *sql.DB) error {
	if s == nil {
		return nil
	}
	if !s.supportsSessionSchemaEnsure() {
		return nil
	}
	if _, err := db.ExecContext(ctx, tenant.BuildSessionsSchema(s.autoModel, s.autoDims)); err != nil {
		return fmt.Errorf("ensure sessions table: create: %w", err)
	}
	if s.autoModel != "" {
		exists, err := tenant.IndexExists(ctx, db, "sessions", "idx_sessions_cosine")
		if err != nil {
			return fmt.Errorf("ensure sessions table: check vector index: %w", err)
		}
		if !exists {
			if _, err := db.ExecContext(ctx,
				`ALTER TABLE sessions ADD VECTOR INDEX idx_sessions_cosine ((VEC_COSINE_DISTANCE(embedding))) ADD_COLUMNAR_REPLICA_ON_DEMAND`); err != nil && !tenant.IsIndexExistsError(err) {
				return fmt.Errorf("ensure sessions table: vector index: %w", err)
			}
		}
	}
	if s.ftsEnabled {
		exists, err := tenant.IndexExists(ctx, db, "sessions", "idx_sessions_fts")
		if err != nil {
			return fmt.Errorf("ensure sessions table: check fts index: %w", err)
		}
		if !exists {
			if _, err := db.ExecContext(ctx,
				`ALTER TABLE sessions ADD FULLTEXT INDEX idx_sessions_fts (content) WITH PARSER MULTILINGUAL ADD_COLUMNAR_REPLICA_ON_DEMAND`); err != nil && !tenant.IsIndexExistsError(err) {
				return fmt.Errorf("ensure sessions table: fts index: %w", err)
			}
		}
	}
	if _, err := db.ExecContext(ctx, tenant.TenantMemorySessionLinksSchema); err != nil {
		return fmt.Errorf("ensure sessions table: memory_session_links: %w", err)
	}
	return nil
}

func (s *TenantService) supportsSessionSchemaEnsure() bool {
	if s == nil || s.pool == nil {
		return true
	}
	backend := s.pool.Backend()
	return backend == "" || backend == "tidb"
}
