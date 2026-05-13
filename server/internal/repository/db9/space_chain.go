package db9

import (
	"database/sql"

	"github.com/qiffang/mnemos/server/internal/repository/postgres"
)

// NewSpaceChainRepo creates the db9 Space Chain repository.
// Phase 1 delegates to PostgreSQL SQL implementation.
func NewSpaceChainRepo(db *sql.DB) *postgres.SpaceChainRepoImpl {
	return postgres.NewSpaceChainRepo(db)
}
