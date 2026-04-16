package tidb

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/qiffang/mnemos/server/internal/domain"
)

type UTMRepoImpl struct {
	db *sql.DB
}

func NewUTMRepo(db *sql.DB) *UTMRepoImpl {
	return &UTMRepoImpl{db: db}
}

func (r *UTMRepoImpl) Create(ctx context.Context, utm *domain.TenantUTM) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO tenant_utm (tenant_id, source, medium, campaign, content, created_at)
		 VALUES (?, ?, ?, ?, ?, NOW())`,
		utm.TenantID,
		nullString(utm.Source),
		nullString(utm.Medium),
		nullString(utm.Campaign),
		nullString(utm.Content),
	)
	if err != nil {
		return fmt.Errorf("create tenant utm: %w", err)
	}
	return nil
}
