package db9

import (
	"database/sql"

	"github.com/qiffang/mnemos/server/internal/repository/postgres"
)

// NewTenantRepo creates the db9 tenant repository.
// Phase 1 delegates to PostgreSQL SQL implementation.
func NewTenantRepo(db *sql.DB) *postgres.TenantRepoImpl {
	return postgres.NewTenantRepo(db)
}
