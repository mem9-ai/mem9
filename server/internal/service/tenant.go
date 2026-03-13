package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
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
	providerType := s.provisioner.ProviderType()
	s.logger.Info("provision step", "step", "cluster_acquire", "provider", providerType, "duration_ms", elapsed.Milliseconds())
	metrics.ProvisionStepDuration.WithLabelValues("cluster_acquire_" + providerType).Observe(elapsed.Seconds())
	if err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		return nil, fmt.Errorf("provision cluster: %w", err)
	}

	tenantID := info.ID

	// Build tenant record
	t := &domain.Tenant{
		ID:             tenantID,
		Name:           tenantID,
		DBHost:         info.Host,
		DBPort:         info.Port,
		DBUser:         info.Username,
		DBPassword:     info.Password,
		DBName:         info.DBName,
		DBTLS:          true,
		Provider:       providerType,
		ClusterID:      info.ID,
		ClaimURL:       info.ClaimURL,
		ClaimExpiresAt: info.ClaimExpiresAt,
		Status:         domain.TenantProvisioning,
		SchemaVersion:  0,
	}

	t0 = time.Now()
	if err := s.tenants.Create(ctx, t); err != nil {
		metrics.ProvisionTotal.WithLabelValues("error").Inc()
		s.logger.Error("orphaned cluster: tenants.Create failed",
			"cluster_id", info.ID,
			"provider", providerType,
			"err", err)
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
