package db9

import (
	"database/sql"

	"github.com/qiffang/mnemos/server/internal/repository/postgres"
)

// NewUploadTaskRepo creates the db9 upload-task repository.
// Phase 1 delegates to PostgreSQL SQL implementation.
func NewUploadTaskRepo(db *sql.DB) *postgres.UploadTaskRepoImpl {
	return postgres.NewUploadTaskRepo(db)
}
