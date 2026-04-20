package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/repository/db9"
	"github.com/qiffang/mnemos/server/internal/repository/postgres"
	"github.com/qiffang/mnemos/server/internal/repository/tidb"
)

// NewDB creates a database connection pool for the specified backend.
func NewDB(backend, dsn string) (*sql.DB, error) {
	switch backend {
	case "db9":
		return db9.NewDB(dsn)
	case "postgres":
		return postgres.NewDB(dsn)
	case "tidb":
		return tidb.NewDB(dsn)
	default:
		return nil, fmt.Errorf("unsupported DB backend: %s", backend)
	}
}

// NewTenantRepo creates a TenantRepo for the specified backend.
func NewTenantRepo(backend string, db *sql.DB) TenantRepo {
	switch backend {
	case "db9":
		return db9.NewTenantRepo(db)
	case "postgres":
		return postgres.NewTenantRepo(db)
	default:
		return tidb.NewTenantRepo(db)
	}
}

// NewUploadTaskRepo creates an UploadTaskRepo for the specified backend.
func NewUploadTaskRepo(backend string, db *sql.DB) UploadTaskRepo {
	switch backend {
	case "db9":
		return db9.NewUploadTaskRepo(db)
	case "postgres":
		return postgres.NewUploadTaskRepo(db)
	default:
		return tidb.NewUploadTaskRepo(db)
	}
}

// NewUTMRepo creates a UTMRepo for the specified backend.
// Only the tidb backend has a tenant_utm table; all other backends return a no-op stub.
func NewUTMRepo(backend string, db *sql.DB) UTMRepo {
	switch backend {
	case "tidb", "":
		return tidb.NewUTMRepo(db)
	default:
		return stubUTMRepo{}
	}
}

// stubUTMRepo satisfies UTMRepo for non-TiDB backends.
type stubUTMRepo struct{}

func (stubUTMRepo) Create(_ context.Context, _ *domain.TenantUTM) error { return nil }

// autoModel is used by tidb and db9 backends for auto-embedding features.
func NewMemoryRepo(backend string, db *sql.DB, autoModel string, ftsEnabled bool, clusterID string) MemoryRepo {
	switch backend {
	case "db9":
		return db9.NewMemoryRepo(db, autoModel, ftsEnabled, clusterID)
	case "postgres":
		return postgres.NewMemoryRepo(db, ftsEnabled, clusterID)
	default:
		return tidb.NewMemoryRepo(db, autoModel, ftsEnabled, clusterID)
	}
}

// NewSessionRepo creates a SessionRepo for the specified backend.
// Only TiDB has a sessions table; all other backends return a stub that
// silently no-ops writes/searches and returns ErrNotSupported for reads.
func NewSessionRepo(backend string, db *sql.DB, autoModel string, ftsEnabled bool, clusterID string) SessionRepo {
	switch backend {
	case "tidb", "":
		return tidb.NewSessionRepo(db, autoModel, ftsEnabled, clusterID)
	default:
		return stubSessionRepo{}
	}
}

// stubSessionRepo satisfies SessionRepo for non-TiDB backends.
// Write and search methods are silently skipped (consistent with the
// IsTableNotFoundError no-op pattern). ListBySessionIDs returns ErrNotSupported
// so the handler returns HTTP 501 instead of a misleading empty result.
type stubSessionRepo struct{}

func (stubSessionRepo) BulkCreate(_ context.Context, _ []*domain.Session) error { return nil }
func (stubSessionRepo) PatchTags(_ context.Context, _, _ string, _ []string) error {
	return nil
}
func (stubSessionRepo) AutoVectorSearch(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	return nil, domain.ErrAutoVectorSearchSkipped
}
func (stubSessionRepo) VectorSearch(_ context.Context, _ []float32, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	return nil, nil
}
func (stubSessionRepo) FTSSearch(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	return nil, nil
}
func (stubSessionRepo) KeywordSearch(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	return nil, nil
}
func (stubSessionRepo) FTSAvailable() bool { return false }
func (stubSessionRepo) ListBySessionIDs(_ context.Context, _ []string, _ int) ([]*domain.Session, error) {
	return nil, fmt.Errorf("session messages: %w", domain.ErrNotSupported)
}
