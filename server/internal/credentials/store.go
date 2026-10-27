package credentials

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/repository"
)

const ReferencePrefix = "credential:"

var ErrMigrating = errors.New("tenant migration in progress; retry request")

type Record struct {
	ID, Kind, TenantID, BindingID, Ciphertext, NewTenantID, Phase string
	Migrating                                                     bool
}

type Store struct {
	DB         *sql.DB
	Backend    string
	Config     Config
	Keys       *Keyring
	InstanceID string
	UploadDir  string
	Invalidate func(string)
}

func New(db *sql.DB, backend string, cfg Config, uploadDir string) (*Store, error) {
	keys, err := LoadKeyring(cfg.SecretsFile)
	if err != nil {
		return nil, err
	}
	return &Store{DB: db, Backend: backend, Config: cfg, Keys: keys, InstanceID: uuid.NewString(), UploadDir: uploadDir}, nil
}

func (s *Store) SQL(q string) string {
	if s.Backend != "postgres" && s.Backend != "db9" {
		return q
	}
	n := 0
	return rebind(q, &n)
}

func rebind(q string, n *int) string {
	var b strings.Builder
	for _, r := range q {
		if r == '?' {
			*n++
			fmt.Fprintf(&b, "$%d", *n)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (s *Store) CheckSchema(ctx context.Context) error {
	for _, q := range []string{
		"SELECT legacy_key_auth FROM tenants LIMIT 0",
		"SELECT id, key_hash, encrypted_key, migrating, new_tenant_id, migration_phase FROM api_keys LIMIT 0",
		"SELECT id FROM api_key_readers LIMIT 0", "SELECT id FROM api_key_instances LIMIT 0",
		"SELECT instance_id FROM api_key_file_moves LIMIT 0",
	} {
		rows, err := s.DB.QueryContext(ctx, q)
		if err != nil {
			return errors.New("API key schema missing; apply explicit schema migration before enabling credentials")
		}
		if err := rows.Close(); err != nil {
			return errors.New("close credential schema probe failed")
		}
	}
	return nil
}

// BeginTenantWrite serializes metadata-only writes with the final tenant
// cutover. Unlike a request reader, a late finalizer may finish during the file
// phase: its transaction either commits before cutover and is migrated with it,
// or reads the new ID after cutover. It never resurrects the old identifier.
func (s *Store) BeginTenantWrite(ctx context.Context, id string) (*sql.Tx, string, error) {
	r, err := s.ForTenant(ctx, id)
	if err != nil {
		return nil, "", err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, "", errors.New("begin tenant metadata write failed")
	}
	r, err = scanRecord(tx.QueryRowContext(ctx, s.SQL("SELECT "+recordColumns+" FROM api_keys WHERE id=? FOR UPDATE"), r.ID))
	if err != nil {
		tx.Rollback()
		return nil, "", err
	}
	return tx, r.TenantID, nil
}

// Aggregate Chain operations historically have no Space tenant metadata. Keep
// that contract while fencing their exact binding credential, never choosing
// an arbitrary member Space's key as the billing subject.
func (s *Store) BeginSubjectWrite(ctx context.Context, tenantID, key string) (*sql.Tx, string, error) {
	if tenantID != "" {
		return s.BeginTenantWrite(ctx, tenantID)
	}
	r, err := s.ByKey(ctx, key)
	if err != nil {
		return nil, "", err
	}
	if r.Kind != "chain" {
		return nil, "", errors.New("Space subject requires tenant metadata")
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, "", errors.New("begin Chain metadata write failed")
	}
	if _, err := scanRecord(tx.QueryRowContext(ctx, s.SQL("SELECT "+recordColumns+" FROM api_keys WHERE id=? FOR UPDATE"), r.ID)); err != nil {
		tx.Rollback()
		return nil, "", err
	}
	return tx, "", nil
}

const recordColumns = "id, credential_type, COALESCE(tenant_id, ''), COALESCE(binding_id, ''), encrypted_key, migrating, COALESCE(new_tenant_id, ''), migration_phase"

func scanRecord(row interface{ Scan(...any) error }) (*Record, error) {
	var r Record
	if err := row.Scan(&r.ID, &r.Kind, &r.TenantID, &r.BindingID, &r.Ciphertext, &r.Migrating, &r.NewTenantID, &r.Phase); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, errors.New("credential lookup failed")
	}
	return &r, nil
}

func (s *Store) ByID(ctx context.Context, id string) (*Record, error) {
	return scanRecord(s.DB.QueryRowContext(ctx, s.SQL("SELECT "+recordColumns+" FROM api_keys WHERE id = ?"), id))
}

func (s *Store) ByKey(ctx context.Context, key string) (*Record, error) {
	for _, version := range s.Keys.versions() {
		r, err := scanRecord(s.DB.QueryRowContext(ctx, s.SQL("SELECT "+recordColumns+" FROM api_keys WHERE hash_version = ? AND key_hash = ?"), version, s.Keys.digest(version, key)))
		if !errors.Is(err, domain.ErrNotFound) {
			return r, err
		}
	}
	return nil, domain.ErrNotFound
}

func (s *Store) ForTenant(ctx context.Context, id string) (*Record, error) {
	r, err := scanRecord(s.DB.QueryRowContext(ctx, s.SQL("SELECT "+recordColumns+" FROM api_keys WHERE tenant_id = ? AND credential_type = 'space'"), id))
	// A stale in-flight internal identifier can be resolved through its existing
	// HMAC index without keeping a plaintext alias after migration.
	if errors.Is(err, domain.ErrNotFound) {
		r, err = s.ByKey(ctx, id)
		if err == nil && r.Kind != "space" {
			return nil, domain.ErrNotFound
		}
	}
	return r, err
}

func (s *Store) Ensure(ctx context.Context, key, kind, owner string) (*Record, error) {
	if strings.TrimSpace(key) == "" {
		return nil, errors.New("empty credential")
	}
	if r, err := s.ByKey(ctx, key); !errors.Is(err, domain.ErrNotFound) {
		if err != nil {
			return nil, err
		}
		if r.Kind != kind || (kind == "chain" && r.BindingID != owner) {
			return nil, errors.New("credential owner conflict")
		}
		if kind == "space" && r.TenantID != owner && r.Phase != "done" {
			return nil, errors.New("credential tenant conflict")
		}
		return r, nil
	}
	id := uuid.NewString()
	sealed, err := s.Keys.seal(id, key)
	if err != nil {
		return nil, err
	}
	var tenantID, bindingID any
	if kind == "space" {
		tenantID = owner
	} else if kind == "chain" {
		bindingID = owner
	} else {
		return nil, errors.New("invalid credential type")
	}
	q := "INSERT INTO api_keys (id, hash_version, key_hash, encrypted_key, credential_type, tenant_id, binding_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
	if s.Backend == "postgres" || s.Backend == "db9" {
		q += " ON CONFLICT DO NOTHING"
	} else {
		q += " ON DUPLICATE KEY UPDATE id = id"
	}
	if _, err := s.DB.ExecContext(ctx, s.SQL(q), id, s.Keys.HashVersion, s.Keys.digest(s.Keys.HashVersion, key), sealed, kind, tenantID, bindingID); err != nil {
		return nil, errors.New("credential registration failed")
	}
	r, err := s.ByKey(ctx, key)
	if err != nil {
		return nil, err
	}
	if r.Kind != kind || (kind == "space" && r.TenantID != owner) || (kind == "chain" && r.BindingID != owner) {
		return nil, errors.New("credential registration owner conflict")
	}
	return r, nil
}

func (s *Store) Recover(ctx context.Context, id string) (string, error) {
	r, err := s.ByID(ctx, id)
	if err != nil {
		return "", err
	}
	return s.Keys.open(r.ID, r.Ciphertext)
}

func (s *Store) ResolveReference(ctx context.Context, value string) (string, error) {
	if !strings.HasPrefix(value, ReferencePrefix) {
		return value, nil
	}
	return s.Recover(ctx, strings.TrimPrefix(value, ReferencePrefix))
}

func (s *Store) LookupTenant(ctx context.Context, key string) (*Record, error) {
	if s.Config.ReadCredentials {
		r, err := s.ByKey(ctx, key)
		if !errors.Is(err, domain.ErrNotFound) {
			if err == nil && r.Kind != "space" {
				return nil, domain.ErrNotFound
			}
			return r, err
		}
	}
	if !s.Config.LegacyAuth {
		return nil, domain.ErrNotFound
	}
	var legacy bool
	err := s.DB.QueryRowContext(ctx, s.SQL("SELECT legacy_key_auth FROM tenants WHERE id = ?"), key).Scan(&legacy)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !legacy) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, errors.New("legacy credential lookup failed")
	}
	metrics.APIKeyLegacyFallbackTotal.Inc()
	return s.Ensure(ctx, key, "space", key)
}

// EnsureSubject registers the exact request credential, including Chain keys.
func (s *Store) EnsureSubject(ctx context.Context, key, tenantID string) (*Record, error) {
	if strings.HasPrefix(key, domain.ChainKeyPrefix) {
		if r, err := s.ByKey(ctx, key); !errors.Is(err, domain.ErrNotFound) {
			if err != nil {
				return nil, err
			}
			if r.Kind != "chain" {
				return nil, errors.New("credential type mismatch")
			}
			return r, nil
		}
		var bindingID string
		if err := s.DB.QueryRowContext(ctx, s.SQL("SELECT id FROM space_chain_bindings WHERE chain_api_key = ?"), key).Scan(&bindingID); err != nil {
			return nil, errors.New("chain credential binding unavailable")
		}
		return s.Ensure(ctx, key, "chain", bindingID)
	}
	return s.Ensure(ctx, key, "space", tenantID)
}

func (s *Store) CreateTenant(ctx context.Context, t *domain.Tenant, key string, independent bool) error {
	id := uuid.NewString()
	sealed, err := s.Keys.seal(id, key)
	if err != nil {
		return err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return errors.New("begin tenant registration failed")
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, s.SQL(`INSERT INTO tenants
(id,name,db_host,db_port,db_user,db_password,db_name,db_tls,provider,cluster_id,claim_url,claim_expires_at,status,schema_version,legacy_key_auth,created_at,updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`),
		t.ID, t.Name, t.DBHost, t.DBPort, t.DBUser, t.DBPassword, t.DBName, t.DBTLS, t.Provider, t.ClusterID, t.ClaimURL, t.ClaimExpiresAt, string(t.Status), t.SchemaVersion, !independent)
	if err != nil {
		return errors.New("tenant registration failed")
	}
	if _, err = tx.ExecContext(ctx, s.SQL("INSERT INTO api_keys (id,hash_version,key_hash,encrypted_key,credential_type,tenant_id) VALUES (?,?,?,?, 'space', ?)"), id, s.Keys.HashVersion, s.Keys.digest(s.Keys.HashVersion, key), sealed, t.ID); err != nil {
		return errors.New("tenant credential registration failed")
	}
	return tx.Commit()
}

type TenantRepository struct {
	repository.TenantRepo
	Store *Store
}

func (r *TenantRepository) TouchActivity(ctx context.Context, id string, at time.Time) error {
	id, release, err := r.Store.HoldTenant(ctx, id)
	if err != nil {
		return err
	}
	defer release()
	return r.TenantRepo.TouchActivity(ctx, id, at)
}

func (r *TenantRepository) UpsertMemoryStats(ctx context.Context, id string, at time.Time, total, last7d int64, observed time.Time) error {
	id, release, err := r.Store.HoldTenant(ctx, id)
	if err != nil {
		return err
	}
	defer release()
	return r.TenantRepo.UpsertMemoryStats(ctx, id, at, total, last7d, observed)
}
