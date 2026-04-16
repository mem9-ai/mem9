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
	"github.com/qiffang/mnemos/server/internal/reqid"
	"github.com/qiffang/mnemos/server/internal/tenant"
)

type utmRepo interface {
	Create(ctx context.Context, utm *domain.TenantUTM) error
}

type tenantDBPool interface {
	Backend() string
	Get(ctx context.Context, tenantID, dsn string) (*sql.DB, error)
}

type TenantService struct {
	tenants     repository.TenantRepo
	utms        utmRepo
	provisioner tenant.Provisioner
	pool        tenantDBPool
	logger      *slog.Logger
	autoModel   string
	autoDims    int
	clientDims  int
	ftsEnabled  bool
	encryptor   encrypt.Encryptor
}

func NewTenantService(
	tenants repository.TenantRepo,
	provisioner tenant.Provisioner,
	pool tenantDBPool,
	logger *slog.Logger,
	autoModel string,
	autoDims int,
	clientDims int,
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
		clientDims:  clientDims,
		ftsEnabled:  ftsEnabled,
		encryptor:   encryptor,
	}
}

func (s *TenantService) WithUTMRepo(r utmRepo) *TenantService {
	s.utms = r
	return s
}

// ProvisionResult is the output of Provision.
type ProvisionResult struct {
	ID string `json:"id"`
}

type ProvisionRequest struct {
	UTM map[string]string `json:"utm,omitempty"`
}

func (s *TenantService) logProvisionStart(ctx context.Context, req ProvisionRequest) {
	if s.logger == nil {
		return
	}

	s.logger.Info("tenant provision start",
		"request_id", reqid.FromContext(ctx),
		"utm", req.UTM,
	)
}

func (s *TenantService) logProvisionComplete(ctx context.Context, tenantID string, req ProvisionRequest) {
	if s.logger == nil {
		return
	}

	s.logger.Info("tenant provision complete",
		"request_id", reqid.FromContext(ctx),
		"tenant_id", tenantID,
		"utm", req.UTM,
	)
}

func (s *TenantService) logProvisionFailure(ctx context.Context, tenantID string, req ProvisionRequest, err error) {
	if s.logger == nil {
		return
	}

	attrs := []any{
		"request_id", reqid.FromContext(ctx),
		"utm", req.UTM,
		"err", err,
	}
	if tenantID != "" {
		attrs = append(attrs, "tenant_id", tenantID)
	}

	s.logger.Error("tenant provision failed", attrs...)
}

// Provision creates a new cluster and registers it as a tenant.
func (s *TenantService) Provision(ctx context.Context, req ProvisionRequest) (*ProvisionResult, error) {
	s.logProvisionStart(ctx, req)

	if s.pool == nil {
		err := fmt.Errorf("tenant pool not configured")
		s.logProvisionFailure(ctx, "", req, err)
		return nil, err
	}
	if s.pool.Backend() != "tidb" {
		err := &domain.ValidationError{Message: fmt.Sprintf("auto-provisioning requires tidb backend; got %q", s.pool.Backend())}
		s.logProvisionFailure(ctx, "", req, err)
		return nil, err
	}
	if s.provisioner == nil {
		err := &domain.ValidationError{Message: "provisioning not configured"}
		s.logProvisionFailure(ctx, "", req, err)
		return nil, err
	}

	total := time.Now()
	tenantID := ""

	// Step 1: Acquire cluster from provisioner
	t0 := time.Now()
	info, err := s.provisioner.Provision(ctx)
	elapsed := time.Since(t0)
	providerType := s.provisioner.ProviderType()
	s.logger.Info("provision step", "step", "cluster_acquire", "provider", providerType, "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("cluster_acquire_" + providerType).Observe(elapsed.Seconds())
	if err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		s.logProvisionFailure(ctx, tenantID, req, err)
		return nil, fmt.Errorf("provision cluster: %w", err)
	}
	tenantID = info.ID

	// Encrypt password before storing
	encryptedPassword, err := s.encryptor.Encrypt(ctx, info.Password)
	if err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		s.logProvisionFailure(ctx, tenantID, req, err)
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
		s.logProvisionFailure(ctx, tenantID, req, err)
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
		s.logProvisionFailure(ctx, tenantID, req, err)
		return nil, fmt.Errorf("get tenant db: %w", err)
	}

	t0 = time.Now()
	if err := s.provisioner.InitSchema(ctx, db); err != nil {
		if s.logger != nil {
			s.logger.Error("tenant schema init failed", "tenant_id", info.ID, "err", err)
		}
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		s.logProvisionFailure(ctx, tenantID, req, err)
		return nil, fmt.Errorf("init tenant schema: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "init_schema", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("init_schema").Observe(elapsed.Seconds())

	t0 = time.Now()
	if err := s.tenants.UpdateSchemaVersion(ctx, info.ID, 1); err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		s.logProvisionFailure(ctx, tenantID, req, err)
		return nil, fmt.Errorf("update schema version: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "update_schema_version", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("update_schema_version").Observe(elapsed.Seconds())

	t0 = time.Now()
	if err := s.tenants.UpdateStatus(ctx, info.ID, domain.TenantActive); err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		s.logProvisionFailure(ctx, tenantID, req, err)
		return nil, fmt.Errorf("activate tenant: %w", err)
	}
	elapsed = time.Since(t0)
	s.logger.Info("provision step", "step", "update_status", "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("update_status").Observe(elapsed.Seconds())

	totalElapsed := time.Since(total)
	s.logger.Info("provision step", "step", "total", "duration_ms", totalElapsed.Milliseconds(), "tenant_id", info.ID)
	metrics.ProvisionStepDuration.WithLabelValues("total").Observe(totalElapsed.Seconds())
	metrics.ProvisionTotal.WithLabelValues("success").Inc()
	s.logProvisionComplete(ctx, info.ID, req)

	if len(req.UTM) > 0 && s.utms != nil {
		utm := utmFromRequest(info.ID, req.UTM)
		if err := s.utms.Create(ctx, utm); err != nil {
			s.logger.Warn("utm save failed (non-fatal)", "tenant_id", info.ID, "err", err)
		}
	}

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
	if _, err := db.ExecContext(ctx, tenant.BuildSessionsSchema(s.autoModel, s.autoDims, s.clientDims)); err != nil {
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
	return nil
}

func utmFromRequest(tenantID string, raw map[string]string) *domain.TenantUTM {
	return &domain.TenantUTM{
		TenantID: tenantID,
		Source:   raw["utm_source"],
		Medium:   raw["utm_medium"],
		Campaign: raw["utm_campaign"],
		Content:  raw["utm_content"],
	}
}
