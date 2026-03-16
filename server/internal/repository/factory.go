package repository

import (
	"database/sql"
	"fmt"

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

// NewMemoryRepo creates a MemoryRepo for the specified backend.
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
