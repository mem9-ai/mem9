package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

type TenantRepoImpl struct {
	db *sql.DB
}

func NewTenantRepo(db *sql.DB) *TenantRepoImpl {
	return &TenantRepoImpl{db: db}
}

func (r *TenantRepoImpl) Create(ctx context.Context, t *domain.Tenant) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO tenants (id, name, db_host, db_port, db_user, db_password, db_name, db_tls, provider, cluster_id, claim_url, claim_expires_at, status, schema_version, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
		t.ID, t.Name, t.DBHost, t.DBPort, t.DBUser, t.DBPassword, t.DBName, t.DBTLS,
		t.Provider, nullString(t.ClusterID), nullString(t.ClaimURL), nullTime(t.ClaimExpiresAt), string(t.Status), t.SchemaVersion,
	)
	if err != nil {
		return fmt.Errorf("create tenant: %w", err)
	}
	return nil
}

func (r *TenantRepoImpl) GetByID(ctx context.Context, id string) (*domain.Tenant, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, name, db_host, db_port, db_user, db_password, db_name, db_tls, provider, cluster_id, claim_url, claim_expires_at,
		 status, schema_version, created_at, updated_at, deleted_at
		 FROM tenants WHERE id = $1`, id,
	)
	return scanTenant(row)
}

func (r *TenantRepoImpl) GetByName(ctx context.Context, name string) (*domain.Tenant, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, name, db_host, db_port, db_user, db_password, db_name, db_tls, provider, cluster_id, claim_url, claim_expires_at,
		 status, schema_version, created_at, updated_at, deleted_at
		 FROM tenants WHERE name = $1 AND status != 'deleted'`, name,
	)
	return scanTenant(row)
}

func (r *TenantRepoImpl) UpdateStatus(ctx context.Context, id string, status domain.TenantStatus) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE tenants SET status = $1, updated_at = NOW() WHERE id = $2`,
		string(status), id,
	)
	if err != nil {
		return fmt.Errorf("update tenant status: %w", err)
	}
	return nil
}

func (r *TenantRepoImpl) UpdateSchemaVersion(ctx context.Context, id string, version int) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE tenants SET schema_version = $1, updated_at = NOW() WHERE id = $2`,
		version, id,
	)
	if err != nil {
		return fmt.Errorf("update tenant schema version: %w", err)
	}
	return nil
}


func scanTenant(row *sql.Row) (*domain.Tenant, error) {
	var t domain.Tenant
	var clusterID, claimURL sql.NullString
	var claimExpiresAt sql.NullTime
	var status string
	var deletedAt sql.NullTime
	if err := row.Scan(&t.ID, &t.Name, &t.DBHost, &t.DBPort, &t.DBUser, &t.DBPassword, &t.DBName, &t.DBTLS,
		&t.Provider, &clusterID, &claimURL, &claimExpiresAt, &status, &t.SchemaVersion, &t.CreatedAt, &t.UpdatedAt, &deletedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("scan tenant: %w", err)
	}
	t.ClusterID = clusterID.String
	t.ClaimURL = claimURL.String
	t.Status = domain.TenantStatus(status)
	if claimExpiresAt.Valid {
		t.ClaimExpiresAt = &claimExpiresAt.Time
	}
	if deletedAt.Valid {
		t.DeletedAt = &deletedAt.Time
	}
	return &t, nil
}

func nullTime(t *time.Time) sql.NullTime {
	if t == nil {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: *t, Valid: true}
}
