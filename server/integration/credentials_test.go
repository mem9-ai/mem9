//go:build integration

package integration

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	"github.com/qiffang/mnemos/server/internal/credentials"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/metering"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/runtimeusage"
	"github.com/qiffang/mnemos/server/internal/service"
	keymigrations "github.com/qiffang/mnemos/server/migrations/api-keys"
)

// This integration scenario uses real control-plane DDL, HTTP authentication,
// two filesystem participants, concurrent migration and a quota HTTP endpoint.
// It creates/drops only its own randomly named database in a disposable Zero.
func TestCredentialOnlineMigration(t *testing.T) {
	dsn := os.Getenv("MNEMO_CREDENTIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("set MNEMO_CREDENTIAL_TEST_DSN to a disposable TiDB Zero DSN")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cfg, err := mysql.ParseDSN(dsn)
	must(t, err)
	root, err := sql.Open("mysql", dsn)
	must(t, err)
	defer root.Close()
	root.SetConnMaxLifetime(30 * time.Second)
	root.SetConnMaxIdleTime(10 * time.Second)
	name := "credential_smoke_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	_, err = root.ExecContext(ctx, "CREATE DATABASE "+name)
	must(t, err)
	defer root.ExecContext(context.Background(), "DROP DATABASE "+name)
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	must(t, err)
	defer db.Close()
	db.SetConnMaxLifetime(30 * time.Second)
	db.SetConnMaxIdleTime(10 * time.Second)
	schema, err := os.ReadFile("../schema.sql")
	must(t, err)
	control := map[string]bool{"tenants": true, "tenant_activity": true, "tenant_utm": true, "space_chains": true, "space_chain_bindings": true, "space_chain_nodes": true, "upload_tasks": true, "runtime_usage_outbox": true, "webhook_endpoints": true, "webhook_events": true, "webhook_deliveries": true}
	pattern := regexp.MustCompile(`CREATE TABLE IF NOT EXISTS (\w+)`)
	for _, statement := range statements(string(schema)) {
		m := pattern.FindStringSubmatch(statement)
		if len(m) > 1 && control[m[1]] {
			_, err := db.ExecContext(ctx, statement)
			must(t, err)
		}
	}
	must(t, keymigrations.Apply(ctx, db, "tidb"))
	must(t, keymigrations.Apply(ctx, db, "tidb"))

	secret := filepath.Join(t.TempDir(), "keys.json")
	data, _ := json.Marshal(map[string]any{"hash_version": "v1", "hmac_keys": map[string]string{"v1": base64.StdEncoding.EncodeToString([]byte(strings.Repeat("h", 32)))}, "encryption_kid": "k1", "encryption_keys": map[string]string{"k1": base64.StdEncoding.EncodeToString([]byte(strings.Repeat("e", 32)))}})
	must(t, os.WriteFile(secret, data, 0600))
	flags := credentials.Config{Enabled: true, ReadCredentials: true, ReferenceOutbox: true, LegacyAuth: true, LegacyOutbox: true, SecretsFile: secret}
	rootA, rootB := t.TempDir(), t.TempDir()
	a, err := credentials.New(db, "tidb", flags, rootA)
	must(t, err)
	b, err := credentials.New(db, "tidb", flags, rootB)
	must(t, err)
	db.SetMaxOpenConns(1)
	must(t, a.CheckSchema(ctx))
	db.SetMaxOpenConns(20)
	old, sibling, independent, key := uuid.NewString(), uuid.NewString(), uuid.NewString(), "new_opaque_space_key"
	for _, id := range []string{old, sibling} {
		exec(t, db, "INSERT INTO tenants(id,name,db_host,db_port,db_user,db_password,db_name,provider,cluster_id,status) VALUES(?,?, 'unused',4000,'unused','unused','unused','zero',?,'active')", id, id, id)
	}
	tenant := &domain.Tenant{ID: independent, Name: independent, DBHost: "unused", DBPort: 4000, DBUser: "unused", DBPassword: "unused", DBName: "unused", Provider: "zero", ClusterID: "real-provider-id", Status: domain.TenantActive}
	must(t, a.CreateTenant(ctx, tenant, key, true))
	exec(t, db, "UPDATE tenants SET claim_url=? WHERE id=?", "https://claim.invalid/instances/"+old+"?token=preserve-token", old)
	chain, binding, chainKey := uuid.NewString(), uuid.NewString(), "chain_opaque_management_key"
	exec(t, db, "INSERT INTO space_chains(id,name) VALUES(?,'integration')", chain)
	exec(t, db, "INSERT INTO space_chain_bindings(id,chain_id,chain_api_key) VALUES(?,?,?)", binding, chain, chainKey)
	exec(t, db, "INSERT INTO space_chain_nodes(id,chain_id,tenant_id,position) VALUES(?,?,?,0)", uuid.NewString(), chain, old)
	exec(t, db, "INSERT INTO tenant_activity(tenant_id,last_activity_at) VALUES(?,CURRENT_TIMESTAMP)", old)
	exec(t, db, "INSERT INTO tenant_utm(tenant_id,source) VALUES(?,'preserve')", old)
	for _, root := range []string{rootA, rootB} {
		must(t, os.MkdirAll(filepath.Join(root, old, "agent"), 0700))
		must(t, os.WriteFile(filepath.Join(root, old, "agent", "input.json"), []byte("preserve file"), 0600))
	}
	task := uuid.NewString()
	exec(t, db, "INSERT INTO upload_tasks(task_id,tenant_id,file_name,file_path,file_type) VALUES(?,?,'input.json',?,'memory')", task, old, filepath.Join(rootA, old, "agent", "input.json"))
	event := uuid.NewString()
	exec(t, db, "INSERT INTO webhook_events(id,scope_type,scope_id,event_type,payload_json) VALUES(?,'tenant',?,'memory.added',?)", event, old, `{"scope":{"tenant_id":"`+old+`"},"data":{"memory":{"tenant_id":"`+old+`","content":"`+old+`","metadata":{"n":9007199254740993}}}}`)
	operation := uuid.NewString()
	exec(t, db, "INSERT INTO runtime_usage_outbox(operation_id,tenant_id,cluster_id,step,phase,payload_json,payload_hash) VALUES(?,?,?,'submit_metering_event','metering_pending',?,'business-hash')", operation, old, old, `{"apiKeySubject":"`+old+`","event":{"apiKeySubject":"`+chainKey+`","metadata":{"n":9007199254740993}}}`)
	_, err = a.Backfill(ctx, 100, false)
	must(t, err)
	_, err = a.Backfill(ctx, 100, false)
	must(t, err)
	rec, err := a.ByKey(ctx, old)
	must(t, err)
	if rec.Ciphertext == old {
		t.Fatal("plaintext credential stored")
	}
	recovered, err := a.Recover(ctx, rec.ID)
	must(t, err)
	if recovered != old {
		t.Fatal("credential recovery changed key")
	}
	_, err = a.ConvertOutbox(ctx, 100, false)
	must(t, err)
	var payload, hash string
	must(t, db.QueryRowContext(ctx, "SELECT payload_json,payload_hash FROM runtime_usage_outbox WHERE operation_id=?", operation).Scan(&payload, &hash))
	chainRecord, err := a.ByKey(ctx, chainKey)
	must(t, err)
	if strings.Contains(payload, "apiKeySubject") || !strings.Contains(payload, chainRecord.ID) || !strings.Contains(payload, "9007199254740993") || hash != "business-hash" {
		t.Fatal("outbox conversion changed subject or business semantics")
	}
	a.Config.LegacyOutbox = false
	a.Config.IndependentTenants = true
	b.Config = a.Config
	must(t, a.CheckStage(ctx))
	must(t, a.SyncFiles(ctx))
	must(t, b.SyncFiles(ctx))
	startFiles := func() func() {
		fileCtx, fileCancel := context.WithCancel(ctx)
		agentA, agentB := make(chan struct{}), make(chan struct{})
		go func() { defer close(agentA); _ = a.RunFileAgent(fileCtx) }()
		go func() { defer close(agentB); _ = b.RunFileAgent(fileCtx) }()
		return func() { fileCancel(); <-agentA; <-agentB }
	}
	stopFiles := startFiles()
	defer func() { stopFiles() }()

	repo := &credentials.TenantRepository{TenantRepo: repository.NewTenantRepo("tidb", db), Store: a}
	started, finish := make(chan struct{}, 1), make(chan struct{})
	api := middleware.ResolveApiKey(repo, realPool{db}, encrypt.NewPlainEncryptor(), nil, middleware.WithCredentials(a), middleware.WithSpaceChainRepo(repository.NewSpaceChainRepo("tidb", db)))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info := middleware.AuthFromContext(r.Context())
		if r.URL.Query().Get("background") == "true" {
			release := info.Hold()
			go func() { <-finish; release() }()
			started <- struct{}{}
		}
		json.NewEncoder(w).Encode(map[string]string{"tenant_id": info.TenantID, "subject": info.APIKeySubject})
	}))
	request := func(key, path string) (int, string) {
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("X-API-Key", key)
		w := httptest.NewRecorder()
		api.ServeHTTP(w, r)
		return w.Code, w.Body.String()
	}
	if status, _ := request(independent, "/"); status == 200 {
		t.Fatal("public tenant ID accepted as key")
	}
	if status, _ := request(key, "/"); status != 200 {
		t.Fatal("independent credential rejected")
	}
	chainService := service.NewSpaceChainService(repository.NewSpaceChainRepo("tidb", db)).WithCredentials(a)
	if _, err := chainService.ReplaceNodes(ctx, chain, service.ReplaceSpaceChainNodesRequest{Nodes: []service.SpaceChainNodeInput{{TenantID: independent}}}); err == nil {
		t.Fatal("Chain accepted public tenant ID without Space key")
	}
	if status, _ := request(old, "/?background=true"); status != 200 {
		t.Fatal("legacy credential rejected")
	}
	<-started
	cutover := make(chan error, 1)
	firstCtx, firstCancel := context.WithCancel(ctx)
	go func() { cutover <- a.MigrateTenant(firstCtx, rec.ID, false) }()
	await(t, ctx, func() bool { r, err := a.ByID(ctx, rec.ID); return err == nil && r.Migrating })
	if status, _ := request(old, "/"); status != 503 {
		t.Fatal("migrating tenant admitted a new request")
	}
	if status, _ := request(sibling, "/"); status != 200 {
		t.Fatal("migration affected unrelated tenant")
	}
	select {
	case <-cutover:
		t.Fatal("cutover overtook retained background reader")
	default:
	}
	paused, err := a.ByID(ctx, rec.ID)
	must(t, err)
	firstCancel()
	if err := <-cutover; err == nil {
		t.Fatal("interrupted migration unexpectedly completed")
	}
	go func() { cutover <- a.MigrateTenant(ctx, rec.ID, false) }()
	close(finish)
	must(t, <-cutover)
	current, err := a.ByID(ctx, rec.ID)
	must(t, err)
	if current.TenantID == old || current.ID != rec.ID || current.TenantID != paused.NewTenantID {
		t.Fatal("tenant ID did not change or credential ID changed")
	}
	if status, body := request(old, "/"); status != 200 || !strings.Contains(body, current.TenantID) {
		t.Fatal("old key no longer resolves migrated tenant")
	}
	var claimTemplate string
	must(t, db.QueryRowContext(ctx, "SELECT claim_url FROM tenants WHERE id=?", current.TenantID).Scan(&claimTemplate))
	if strings.Contains(claimTemplate, old) {
		t.Fatal("claim URL retained original key")
	}
	claimURL, err := a.ExpandClaimURL(ctx, rec.ID, claimTemplate)
	must(t, err)
	if claimURL != "https://claim.invalid/instances/"+old+"?token=preserve-token" {
		t.Fatal("claim URL could not be restored")
	}
	for _, root := range []string{rootA, rootB} {
		if _, err := os.Stat(filepath.Join(root, old)); !os.IsNotExist(err) {
			t.Fatal("old upload directory retained")
		}
		data, err := os.ReadFile(filepath.Join(root, current.TenantID, "agent", "input.json"))
		must(t, err)
		if string(data) != "preserve file" {
			t.Fatal("file contents changed")
		}
	}
	var stored string
	must(t, db.QueryRowContext(ctx, "SELECT payload_json FROM webhook_events WHERE id=?", event).Scan(&stored))
	var envelope map[string]any
	decoder := json.NewDecoder(strings.NewReader(stored))
	decoder.UseNumber()
	must(t, decoder.Decode(&envelope))
	memory := envelope["data"].(map[string]any)["memory"].(map[string]any)
	if memory["content"] != old || memory["tenant_id"] != current.TenantID || !strings.Contains(stored, "9007199254740993") {
		t.Fatal("webhook migration changed user data")
	}
	t.Log("tenant cutover and file participants verified; isolate the one-connection metadata check")
	stopFiles()
	stopFiles = func() {}
	store := runtimeusage.NewSQLStore(db, "tidb").WithCredentials(a)
	late := uuid.NewString()
	lease := &runtimeusage.OperationLease{OperationID: late, Subject: runtimeusage.Subject{TenantID: old, ClusterID: old, APIKeySubject: old}}
	db.SetMaxOpenConns(1)
	must(t, store.StoreReleasePending(ctx, lease, "integration"))
	db.SetMaxOpenConns(20)
	meteringID := uuid.NewString()
	evt := metering.Event{OperationID: meteringID, TenantID: old, ClusterID: old, APIKeySubject: old, Metadata: map[string]any{"counter": int64(9007199254740993)}}
	db.SetMaxOpenConns(1)
	must(t, store.UpsertMeteringPending(ctx, evt, nil, "fresh-business-hash"))
	var precise string
	must(t, db.QueryRowContext(ctx, "SELECT payload_json FROM runtime_usage_outbox WHERE operation_id=?", meteringID).Scan(&precise))
	if !strings.Contains(precise, "9007199254740993") {
		t.Fatal("new metering write rounded user metadata")
	}
	if err := store.UpsertMeteringPending(ctx, evt, nil, "different-business-hash"); err == nil {
		t.Fatal("metering conflict was silently accepted")
	}
	var conflictStatus string
	must(t, db.QueryRowContext(ctx, "SELECT status FROM runtime_usage_outbox WHERE operation_id=?", meteringID).Scan(&conflictStatus))
	if conflictStatus != "terminal_failed" {
		t.Fatal("metering conflict marker was rolled back")
	}
	db.SetMaxOpenConns(20)
	var lateTenant string
	must(t, db.QueryRowContext(ctx, "SELECT tenant_id FROM runtime_usage_outbox WHERE operation_id=?", late).Scan(&lateTenant))
	if lateTenant != current.TenantID {
		t.Fatal("late finalizer resurrected old tenant ID")
	}
	t.Log("single-connection metadata writes, numeric precision and metering conflict persistence verified")
	chainLease := &runtimeusage.OperationLease{OperationID: uuid.NewString(), Subject: runtimeusage.Subject{APIKeySubject: chainKey}}
	must(t, store.StoreReleasePending(ctx, chainLease, "aggregate-chain"))
	observed := make(chan string, 10)
	console := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observed <- r.Header.Get("X-API-Key")
		w.WriteHeader(200)
		io.WriteString(w, "{}")
	}))
	defer console.Close()
	workerCtx, workerCancel := context.WithCancel(ctx)
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		_ = runtimeusage.NewWorker(store, runtimeusage.NewHTTPClient(console.URL, "integration", time.Second), nil, slog.New(slog.NewTextHandler(io.Discard, nil))).Run(workerCtx)
	}()
	seen := map[string]bool{}
	for !seen[old] || !seen[chainKey] {
		select {
		case subject := <-observed:
			if subject != old && subject != chainKey {
				t.Fatal("worker sent internal identity instead of exact request key")
			}
			seen[subject] = true
		case <-ctx.Done():
			t.Fatal("worker did not finalize exact Space and Chain subjects")
		}
	}
	workerCancel()
	<-workerDone
	t.Log("exact Space and aggregate Chain billing subjects verified")
	stopFiles = startFiles()
	siblingRecord, err := a.ByKey(ctx, sibling)
	must(t, err)
	must(t, a.MigrateTenant(ctx, siblingRecord.ID, false))
	a.Config.LegacyAuth = false
	must(t, a.CheckStage(ctx))
	if status, _ := request(old, "/"); status != 200 {
		t.Fatal("old key failed after legacy fallback was closed")
	}
	if status, _ := request(current.TenantID, "/"); status == 200 {
		t.Fatal("new internal ID was accepted as a key")
	}

	// An unavailable ciphertext must leave the task pending; it must never
	// substitute the public tenant ID as the billing credential.
	exec(t, db, "UPDATE api_keys SET encrypted_key='unavailable' WHERE id=?", rec.ID)
	broken := *lease
	broken.OperationID = uuid.NewString()
	must(t, store.StoreReleasePending(ctx, &broken, "decryption-failure"))
	brokenCtx, brokenCancel := context.WithCancel(ctx)
	brokenDone := make(chan struct{})
	go func() {
		defer close(brokenDone)
		_ = runtimeusage.NewWorker(store, runtimeusage.NewHTTPClient(console.URL, "integration", time.Second), nil, slog.New(slog.NewTextHandler(io.Discard, nil))).Run(brokenCtx)
	}()
	await(t, ctx, func() bool {
		var attempts int
		err := db.QueryRowContext(ctx, "SELECT attempt_count FROM runtime_usage_outbox WHERE operation_id=? AND status='pending'", broken.OperationID).Scan(&attempts)
		return err == nil && attempts > 0
	})
	brokenCancel()
	<-brokenDone
	exec(t, db, "UPDATE api_keys SET encrypted_key=? WHERE id=?", rec.Ciphertext, rec.ID)
	counts, err := a.Audit(ctx)
	must(t, err)
	for _, name := range []string{"plaintext_identity_residuals", "plaintext_outbox_subjects", "plaintext_webhook_identities", "plaintext_claim_url_identities", "missing_outbox_credentials", "missing_file_acknowledgements", "migrating_tenants", "legacy_tenants", "legacy_outbox", "missing_space_credentials"} {
		if counts[name] != 0 {
			t.Fatalf("audit %s=%d", name, counts[name])
		}
	}
	t.Log("verified online key continuity, cross-instance file moves, in-flight barriers, Chain authorization, lossless JSON migration, exact outbox subject and late-finalizer fencing")
}

type realPool struct{ db *sql.DB }

func (p realPool) Get(context.Context, string, string) (*sql.DB, error) { return p.db, nil }
func (p realPool) Backend() string                                      { return "tidb" }
func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func exec(t *testing.T, db *sql.DB, q string, args ...any) {
	t.Helper()
	_, err := db.Exec(q, args...)
	must(t, err)
}
func statements(data string) []string {
	var lines []string
	for _, line := range strings.Split(data, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			lines = append(lines, line)
		}
	}
	var out []string
	for _, s := range strings.Split(strings.Join(lines, "\n"), ";") {
		if strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}
func await(t *testing.T, ctx context.Context, ready func() bool) {
	t.Helper()
	for !ready() {
		select {
		case <-ctx.Done():
			t.Fatal("timed out waiting for migration state")
		case <-time.After(100 * time.Millisecond):
		}
	}
}
