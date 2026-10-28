package credentials

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/qiffang/mnemos/server/internal/domain"
)

// Store adds credential mappings without changing tenant IDs or existing keys.
type Store struct {
	db      *sql.DB
	backend string
	keys    *Keyring
}

func New(db *sql.DB, backend, secretFile string) (*Store, error) {
	keys, err := LoadKeyring(secretFile)
	if err != nil {
		return nil, err
	}
	return &Store{db: db, backend: backend, keys: keys}, nil
}

func (s *Store) query(q string) string {
	if s.backend != "postgres" && s.backend != "db9" {
		return q
	}
	var b strings.Builder
	index := 0
	for _, r := range q {
		if r == '?' {
			index++
			b.WriteString("$" + strconv.Itoa(index))
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (s *Store) CheckSchema(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, "SELECT id, hash_version, key_hash, encrypted_key, tenant_id FROM api_keys LIMIT 0")
	if err != nil {
		return errors.New("credential schema missing; apply the api_keys schema before starting the server")
	}
	return rows.Close()
}

// LookupTenantID only falls back on a missing mapping, never on a query error.
// Tenant IDs remain valid API keys, including after a mapping is registered.
func (s *Store) LookupTenantID(ctx context.Context, key string) (string, error) {
	for _, version := range s.keys.versions() {
		var tenantID string
		err := s.db.QueryRowContext(ctx, s.query("SELECT tenant_id FROM api_keys WHERE hash_version = ? AND key_hash = ?"), version, s.keys.digest(version, key)).Scan(&tenantID)
		if err == nil {
			return tenantID, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", errors.New("credential lookup failed")
		}
	}
	return key, nil
}

// CreateTenant atomically adds the tenant and its redundant credential record.
// The provider-issued tenant ID is still the API key returned to the client.
func (s *Store) CreateTenant(ctx context.Context, t *domain.Tenant) error {
	id := uuid.NewString()
	sealed, err := s.keys.seal(id, t.ID)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return errors.New("begin tenant registration failed")
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, s.query(`INSERT INTO tenants
(id, name, db_host, db_port, db_user, db_password, db_name, db_tls, provider, cluster_id, claim_url, claim_expires_at, status, schema_version, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`),
		t.ID, t.Name, t.DBHost, t.DBPort, t.DBUser, t.DBPassword, t.DBName, t.DBTLS,
		t.Provider, optionalString(t.ClusterID), optionalString(t.ClaimURL), t.ClaimExpiresAt, string(t.Status), t.SchemaVersion)
	if err != nil {
		return errors.New("tenant registration failed")
	}
	if _, err := tx.ExecContext(ctx, s.query("INSERT INTO api_keys (id, hash_version, key_hash, encrypted_key, tenant_id) VALUES (?, ?, ?, ?, ?)"),
		id, s.keys.HashVersion, s.keys.digest(s.keys.HashVersion, t.ID), sealed, t.ID); err != nil {
		return errors.New("tenant credential registration failed")
	}
	if err := tx.Commit(); err != nil {
		return errors.New("commit tenant registration failed")
	}
	return nil
}

// Backfill copies existing keys in bounded batches without changing tenants.
// Authentication never calls this method or writes credential records.
func (s *Store) Backfill(ctx context.Context, limit int, dryRun bool) (int, error) {
	rows, err := s.db.QueryContext(ctx, s.query("SELECT t.id FROM tenants t LEFT JOIN api_keys k ON k.tenant_id = t.id WHERE k.id IS NULL ORDER BY t.id LIMIT ?"), limit)
	if err != nil {
		return 0, errors.New("list tenants without credential mappings failed")
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, errors.New("read backfill tenant failed")
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, errors.New("read backfill tenants failed")
	}
	if dryRun {
		return len(ids), nil
	}
	count := 0
	for _, tenantID := range ids {
		id := uuid.NewString()
		sealed, err := s.keys.seal(id, tenantID)
		if err != nil {
			return count, err
		}
		q := "INSERT INTO api_keys (id, hash_version, key_hash, encrypted_key, tenant_id) VALUES (?, ?, ?, ?, ?)"
		if s.backend == "postgres" || s.backend == "db9" {
			q += " ON CONFLICT (tenant_id) DO NOTHING"
		} else {
			q += " ON DUPLICATE KEY UPDATE id = id"
		}
		if _, err := s.db.ExecContext(ctx, s.query(q), id, s.keys.HashVersion, s.keys.digest(s.keys.HashVersion, tenantID), sealed, tenantID); err != nil {
			return count, errors.New("credential backfill failed")
		}
		count++
	}
	return count, nil
}

func optionalString(value string) sql.NullString {
	return sql.NullString{String: value, Valid: value != ""}
}
