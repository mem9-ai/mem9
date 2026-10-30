//go:build integration

package integration

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	"github.com/qiffang/mnemos/server/internal/credentials"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/handler"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/runtimeusage"
	"github.com/qiffang/mnemos/server/internal/service"
	"github.com/qiffang/mnemos/server/internal/tenant"
)

// Exercise real SQL transactions and HTTP auth with synthetic provider/Console
// boundaries. Only this scenario's randomly named disposable database is removed.
func TestCredentialMappings(t *testing.T) {
	dsn := os.Getenv("MNEMO_CREDENTIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("set MNEMO_CREDENTIAL_TEST_DSN to a disposable TiDB DSN")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cfg, err := mysql.ParseDSN(dsn)
	must(t, err)
	root, err := sql.Open("mysql", dsn)
	must(t, err)
	defer root.Close()
	var version string
	must(t, root.QueryRowContext(ctx, "SELECT VERSION()").Scan(&version))
	t.Log("database version:", version)
	name := "credential_mapping_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	_, err = root.ExecContext(ctx, "CREATE DATABASE "+name)
	must(t, err)
	defer func() {
		cleanupCtx, done := context.WithTimeout(context.Background(), 30*time.Second)
		defer done()
		_, err := root.ExecContext(cleanupCtx, "DROP DATABASE "+name)
		if err != nil {
			t.Error("disposable database cleanup failed")
		}
	}()
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	must(t, err)
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetConnMaxLifetime(30 * time.Second)
	schema, err := os.ReadFile("../schema.sql")
	must(t, err)
	for _, statement := range statements(string(schema)) {
		for _, table := range []string{"tenants", "space_keys", "space_chains", "space_chain_bindings", "space_chain_nodes"} {
			if strings.HasPrefix(strings.TrimSpace(statement), "CREATE TABLE IF NOT EXISTS "+table+" (") {
				exec(t, ctx, db, statement)
				if table == "space_keys" {
					// Schema preparation must be safe to repeat.
					exec(t, ctx, db, statement)
				}
			}
		}
	}

	secret := filepath.Join(t.TempDir(), "keys.json")
	data, err := json.Marshal(map[string]any{
		"hash_version": "v1", "hmac_keys": map[string]string{"v1": base64.StdEncoding.EncodeToString([]byte(strings.Repeat("h", 32)))},
		"encryption_kid": "k1", "encryption_keys": map[string]string{"k1": base64.StdEncoding.EncodeToString([]byte(strings.Repeat("e", 32)))},
	})
	must(t, err)
	must(t, os.WriteFile(secret, data, 0600))
	store, err := credentials.New(db, "tidb", secret)
	must(t, err)
	must(t, store.CheckSchema(ctx))
	repo := repository.NewTenantRepo("tidb", db)
	old, fresh := uuid.NewString(), uuid.NewString()
	must(t, repo.Create(ctx, &domain.Tenant{ID: old, Name: old, DBHost: "unused", DBPort: 4000, DBUser: "unused", DBPassword: "unused", DBName: "unused", Provider: "tidb_zero", Status: domain.TenantActive}))
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := service.NewTenantService(repo, fixtureProvisioner{fresh}, realPool{db}, logger, "", 0, 0, false, encrypt.NewPlainEncryptor()).WithCredentials(store)
	chains := repository.NewSpaceChainRepo("tidb", db)
	tenantMW := middleware.ResolveTenant(repo, realPool{db}, encrypt.NewPlainEncryptor(), nil, middleware.WithCredentials(store))
	apiMW := middleware.ResolveApiKey(repo, realPool{db}, encrypt.NewPlainEncryptor(), nil, middleware.WithCredentials(store), middleware.WithSpaceChainRepo(chains))
	consoleKeys := make(chan string, 10)
	console := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		consoleKeys <- r.Header.Get("X-API-Key")
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"mem9ApiKey":{"status":"active"},"meters":[]}`)
	}))
	defer console.Close()
	quota := runtimeusage.NewHTTPClient(console.URL, "synthetic-internal-secret", time.Second)
	manager := runtimeusage.NewManager(runtimeusage.Config{Enabled: true}, quota, nil, logger)
	pass := func(h http.Handler) http.Handler { return h }
	router := handler.NewServer(svc, nil, "", nil, nil, "", false, service.IngestMode(""), "tidb", logger).
		WithSpaceChainService(service.NewSpaceChainService(chains), 0.8).
		WithRuntimeUsage(manager).Router(tenantMW, pass, apiMW, pass)

	created := request(t, router, http.MethodPost, "/v1alpha1/mem9s", "", http.StatusCreated)
	var provision struct {
		ID string `json:"id"`
	}
	must(t, json.Unmarshal(created.Body.Bytes(), &provision))
	if provision.ID != fresh {
		t.Fatal("provisioning changed the provider-issued API key")
	}
	var mappedID, ciphertext string
	var digest []byte
	must(t, db.QueryRowContext(ctx, "SELECT tenant_id, key_hash, encrypted_key FROM space_keys").Scan(&mappedID, &digest, &ciphertext))
	hash := hmac.New(sha256.New, []byte(strings.Repeat("h", 32)))
	hash.Write([]byte(fresh))
	if mappedID != fresh || !hmac.Equal(digest, hash.Sum(nil)) || strings.Contains(ciphertext, fresh) {
		t.Fatal("provisioned mapping changed identity or did not protect the credential")
	}
	var nullMetadata bool
	must(t, db.QueryRowContext(ctx, "SELECT cluster_id IS NULL AND claim_url IS NULL AND claim_expires_at IS NULL FROM tenants WHERE id=?", fresh).Scan(&nullMetadata))
	if !nullMetadata {
		t.Fatal("provisioning changed nullable provider metadata")
	}

	echo := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := middleware.AuthFromContext(r.Context())
		json.NewEncoder(w).Encode(map[string]string{"tenant": auth.TenantID, "subject": auth.APIKeySubject})
	})
	api := apiMW(echo)
	pathAPI := chi.NewRouter()
	pathAPI.With(tenantMW).Get("/{tenantID}", echo.ServeHTTP)
	assertAuth := func(key, tenantID string) {
		t.Helper()
		for _, result := range []*httptest.ResponseRecorder{
			request(t, api, http.MethodGet, "/", key, http.StatusOK),
			request(t, pathAPI, http.MethodGet, "/"+key, "", http.StatusOK),
		} {
			var got map[string]string
			must(t, json.Unmarshal(result.Body.Bytes(), &got))
			if got["tenant"] != tenantID || got["subject"] != key {
				t.Fatal("authentication confused tenant identity and original request key")
			}
		}
		request(t, router, http.MethodGet, "/v1alpha2/status", key, http.StatusOK)
		request(t, router, http.MethodGet, "/v1alpha2/mem9s/runtime-state", key, http.StatusOK)
		select {
		case got := <-consoleKeys:
			if got != key {
				t.Fatal("Console received an internal identity instead of the original key")
			}
		case <-ctx.Done():
			t.Fatal("Console did not receive runtime-state request")
		}
	}
	assertAuth(old, old)
	assertAuth(fresh, fresh)
	var count int
	must(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM space_keys").Scan(&count))
	if count != 1 {
		t.Fatal("authentication unexpectedly registered an old key")
	}
	request(t, api, http.MethodGet, "/", uuid.NewString(), http.StatusBadRequest)

	// A synthetic remapping proves lookup precedence and raw-key propagation
	// even when the resolved tenant ID differs; provisioning never makes this change.
	exec(t, ctx, db, "UPDATE space_keys SET tenant_id=? WHERE tenant_id=?", old, fresh)
	assertAuth(fresh, old)
	exec(t, ctx, db, "UPDATE space_keys SET tenant_id=? WHERE tenant_id=?", fresh, old)

	chain, chainKey := uuid.NewString(), "chain_"+uuid.NewString()
	exec(t, ctx, db, "INSERT INTO space_chains(id,name) VALUES(?,'integration')", chain)
	exec(t, ctx, db, "INSERT INTO space_chain_bindings(id,chain_id,chain_api_key) VALUES(?,?,?)", uuid.NewString(), chain, chainKey)
	for position, id := range []string{old, fresh} {
		exec(t, ctx, db, "INSERT INTO space_chain_nodes(id,chain_id,tenant_id,position) VALUES(?,?,?,?)", uuid.NewString(), chain, id, position)
	}
	chainResponse := request(t, api, http.MethodGet, "/", chainKey, http.StatusOK)
	var chainAuth map[string]string
	must(t, json.Unmarshal(chainResponse.Body.Bytes(), &chainAuth))
	if chainAuth["subject"] != chainKey {
		t.Fatal("Chain authentication changed its original subject")
	}
	request(t, router, http.MethodGet, "/v1alpha2/mem9s/runtime-state", chainKey, http.StatusOK)
	if <-consoleKeys != chainKey {
		t.Fatal("Console did not receive the original Chain key")
	}

	for _, id := range []string{old, fresh} {
		exec(t, ctx, db, "UPDATE tenants SET status='suspended' WHERE id=?", id)
		request(t, api, http.MethodGet, "/", id, http.StatusBadRequest)
		status, err := svc.KeyStatus(ctx, id)
		must(t, err)
		if status != domain.KeyStatusInactive {
			t.Fatal("credential mapping bypassed tenant lifecycle")
		}
		exec(t, ctx, db, "UPDATE tenants SET deleted_at=CURRENT_TIMESTAMP WHERE id=?", id)
		if _, err := svc.KeyStatus(ctx, id); !errors.Is(err, domain.ErrNotFound) {
			t.Fatal("credential mapping bypassed soft deletion")
		}
		exec(t, ctx, db, "UPDATE tenants SET status='active',deleted_at=NULL WHERE id=?", id)
	}

	// Removing the mapping table must fail reads explicitly, not fall through.
	// A failed mapping insert must also roll back its preceding tenant insert.
	exec(t, ctx, db, "RENAME TABLE space_keys TO space_keys_unavailable")
	request(t, api, http.MethodGet, "/", old, http.StatusServiceUnavailable)
	failedID := uuid.NewString()
	failedSvc := service.NewTenantService(repo, fixtureProvisioner{failedID}, realPool{db}, logger, "", 0, 0, false, encrypt.NewPlainEncryptor()).WithCredentials(store)
	if _, err := failedSvc.Provision(ctx, service.ProvisionRequest{}); err == nil {
		t.Fatal("provisioning succeeded without its credential mapping")
	}
	if _, err := repo.GetByID(ctx, failedID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("failed mapping insert left a partially provisioned tenant")
	}
	exec(t, ctx, db, "RENAME TABLE space_keys_unavailable TO space_keys")
	assertAuth(fresh, fresh)
	t.Log("verified unchanged keys, transactional mappings, legacy fallback, read-only auth, raw Console subjects, Chain compatibility and transaction rollback")
}

type realPool struct{ db *sql.DB }

func (p realPool) Get(context.Context, string, string) (*sql.DB, error) { return p.db, nil }
func (p realPool) Backend() string                                      { return "tidb" }

type fixtureProvisioner struct{ id string }

func (p fixtureProvisioner) Provision(context.Context) (*tenant.ClusterInfo, error) {
	return &tenant.ClusterInfo{ID: p.id, Host: "unused", Port: 4000, Username: "unused", Password: "unused", DBName: "unused"}, nil
}
func (fixtureProvisioner) InitSchema(context.Context, *sql.DB) error { return nil }
func (fixtureProvisioner) ProviderType() string                      { return "tidb_zero" }

func request(t *testing.T, h http.Handler, method, path, key string, status int) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, nil)
	if key != "" {
		r.Header.Set("X-API-Key", key)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != status {
		t.Fatalf("%s %s returned %d, want %d", method, path, w.Code, status)
	}
	return w
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func exec(t *testing.T, ctx context.Context, db *sql.DB, q string, args ...any) {
	t.Helper()
	_, err := db.ExecContext(ctx, q, args...)
	must(t, err)
}

func statements(data string) []string {
	var lines []string
	for _, line := range strings.Split(data, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			lines = append(lines, line)
		}
	}
	return strings.Split(strings.Join(lines, "\n"), ";")
}
