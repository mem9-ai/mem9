package repository

import (
	"database/sql"
	"fmt"

	"github.com/qiffang/mnemos/server/internal/repository/postgres"
	"github.com/qiffang/mnemos/server/internal/repository/tidb"
)

// NewDB creates a database connection pool for the specified backend.
func NewDB(backend, dsn string) (*sql.DB, error) {
	switch backend {
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
	case "postgres":
		return postgres.NewTenantRepo(db)
	default:
		return tidb.NewTenantRepo(db)
	}
}


// NewUploadTaskRepo creates an UploadTaskRepo for the specified backend.
func NewUploadTaskRepo(backend string, db *sql.DB) UploadTaskRepo {
	switch backend {
	case "postgres":
		return postgres.NewUploadTaskRepo(db)
	default:
		return tidb.NewUploadTaskRepo(db)
	}
}

// NewMemoryRepo creates a MemoryRepo for the specified backend.
// autoModel is only used by the tidb backend (for TiDB auto-embedding).
func NewMemoryRepo(backend string, db *sql.DB, autoModel string, ftsEnabled bool) MemoryRepo {
	switch backend {
	case "postgres":
		return postgres.NewMemoryRepo(db, ftsEnabled)
	default:
		return tidb.NewMemoryRepo(db, autoModel, ftsEnabled)
	}
}
