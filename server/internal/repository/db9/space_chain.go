package db9

import (
	"context"
	"database/sql"

	"github.com/qiffang/mnemos/server/internal/repository/postgres"
)

// EnsureSpaceChainSchema applies the Space Chain startup schema check.
// Phase 1 delegates to the PostgreSQL implementation.
func EnsureSpaceChainSchema(ctx context.Context, db *sql.DB) error {
	return postgres.EnsureSpaceChainSchema(ctx, db)
}

// NewSpaceChainRepo creates the db9 Space Chain repository.
// Phase 1 delegates to PostgreSQL SQL implementation.
func NewSpaceChainRepo(db *sql.DB) *postgres.SpaceChainRepoImpl {
	return postgres.NewSpaceChainRepo(db)
}
