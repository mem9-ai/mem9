package db9

import (
	"database/sql"

	"github.com/qiffang/mnemos/server/internal/repository/postgres"
)

// NewMemoryRepo creates the db9 memory repository.
// Phase 1 delegates to PostgreSQL SQL implementation.
func NewMemoryRepo(db *sql.DB, ftsEnabled bool) *postgres.MemoryRepo {
	return postgres.NewMemoryRepo(db, ftsEnabled)
}
