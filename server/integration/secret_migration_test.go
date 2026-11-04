//go:build integration

package integration

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	"github.com/qiffang/mnemos/server/internal/credentials"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/logsafe"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/runtimeusage"
	"github.com/qiffang/mnemos/server/internal/secretmigrate"
	"github.com/qiffang/mnemos/server/internal/secrets"
	"github.com/qiffang/mnemos/server/internal/webhook"
)

// Backfill legacy rows in a randomly named disposable database, then check the
// server read path still returns the original values.
func TestSecretMigration(t *testing.T) {
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
	name := "secret_migration_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	_, err = root.ExecContext(ctx, "CREATE DATABASE "+name)
	must(t, err)
	defer func() {
		cleanupCtx, done := context.WithTimeout(context.Background(), 30*time.Second)
		defer done()
		if _, err := root.ExecContext(cleanupCtx, "DROP DATABASE "+name); err != nil {
			t.Error("disposable database cleanup failed")
		}
	}()
	cfg.DBName = name
	cfg.ParseTime = true
	db, err := sql.Open("mysql", cfg.FormatDSN())
	must(t, err)
	defer db.Close()
	schema, err := os.ReadFile("../schema.sql")
	must(t, err)
	for _, statement := range statements(string(schema)) {
		if strings.HasPrefix(strings.TrimSpace(statement), "CREATE TABLE IF NOT EXISTS tenants (") {
			exec(t, ctx, db, statement)
		}
	}
	must(t, webhook.NewSQLStore(db, "tidb").EnsureSchema(ctx))
	must(t, runtimeusage.NewSQLStore(db, "tidb").EnsureSchema(ctx))

	key := func(b byte) string { return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{b}, 32)) }
	keyringFile := filepath.Join(t.TempDir(), "keys.json")
	data, err := json.Marshal(map[string]any{
		"hash_version":   "v1",
		"hmac_keys":      map[string]string{"v1": key('h')},
		"encryption_kid": "space-k1",
		"encryption_keys": map[string]string{
			"space-k1": key('s'), "db-k1": key('d'), "cu-k1": key('c'), "wh-k1": key('w'), "ob-k1": key('o'),
		},
		"secret_field_kids": map[string]string{
			secrets.FieldTenantDBPassword:    "db-k1",
			secrets.FieldTenantClaimURL:      "cu-k1",
			secrets.FieldWebhookSecret:       "wh-k1",
			secrets.FieldOutboxAPIKeySubject: "ob-k1",
		},
	})
	must(t, err)
	must(t, os.WriteFile(keyringFile, data, 0600))
	keyring, err := credentials.LoadKeyring(keyringFile)
	must(t, err)
	protector, err := secrets.New(keyring, encrypt.NewPlainEncryptor(), secrets.WriteFormatEncV1)
	must(t, err)

	tenants := repository.NewTenantRepo("tidb", db)
	active, deleted := uuid.NewString(), uuid.NewString()
	for _, tenant := range []*domain.Tenant{
		{ID: active, Name: active, DBHost: "unused", DBPort: 4000, DBUser: "unused", DBPassword: "active-password", DBName: "unused", ClaimURL: "https://claim.example.test/active", Provider: "tidb_zero", Status: domain.TenantActive},
		{ID: deleted, Name: deleted, DBHost: "unused", DBPort: 4000, DBUser: "unused", DBPassword: "deleted-password", DBName: "unused", Provider: "tidb_cloud_starter", Status: domain.TenantActive},
	} {
		must(t, tenants.Create(ctx, tenant))
	}
	exec(t, ctx, db, "UPDATE tenants SET status = 'deleted', deleted_at = NOW(), updated_at = '2020-01-01 00:00:00' WHERE id = ?", deleted)
	exec(t, ctx, db, "UPDATE tenants SET updated_at = '2020-01-01 00:00:00' WHERE id = ?", active)

	endpoint := uuid.NewString()
	exec(t, ctx, db, `INSERT INTO webhook_endpoints (id, scope_type, scope_id, name, url, enabled, events_json, secret_ciphertext, created_at, updated_at)
VALUES (?, 'tenant', ?, 'hook', 'https://hook.example.test', 1, '[]', 'webhook-secret', '2020-01-01 00:00:00', '2020-01-01 00:00:00')`, endpoint, active)

	pending, done := uuid.NewString(), uuid.NewString()
	payload := `{"apiKeySubject":"pending-subject","meter":"memory_write","event":{"apiKeySubject":"pending-event-subject","eventType":"write"}}`
	exec(t, ctx, db, `INSERT INTO runtime_usage_outbox (operation_id, tenant_id, step, phase, payload_json, payload_hash, status)
VALUES (?, ?, 'submit_metering_event', 'metering_pending', ?, 'hash-pending', 'pending'), (?, ?, 'submit_metering_event', 'done', ?, 'hash-done', 'done')`,
		pending, active, payload, done, active, `{"apiKeySubject":"done-subject","event":{"apiKeySubject":"done-event-subject"}}`)

	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	run := func(mode string, writeFormat string, p *secrets.Protector) error {
		return secretmigrate.Run(ctx, secretmigrate.Deps{DB: db, Backend: "tidb", Protector: p, WriteFormat: writeFormat}, secretmigrate.Options{Mode: mode, BatchSize: 1}, logger)
	}
	if err := run(secretmigrate.ModeVerify, secrets.WriteFormatEncV1, protector); err == nil {
		t.Fatal("verify passed before backfill")
	}
	must(t, run(secretmigrate.ModeDryRun, secrets.WriteFormatLegacy, nil))
	if err := run(secretmigrate.ModeBackfill, secrets.WriteFormatLegacy, protector); err == nil {
		t.Fatal("backfill ran without enc_v1")
	}
	must(t, run(secretmigrate.ModeBackfill, secrets.WriteFormatEncV1, protector))
	must(t, run(secretmigrate.ModeBackfill, secrets.WriteFormatEncV1, protector))
	must(t, run(secretmigrate.ModeVerify, secrets.WriteFormatEncV1, protector))

	check := func(field, stored, want string) {
		t.Helper()
		if !strings.HasPrefix(stored, "enc:v1:") {
			t.Fatalf("%s was not backfilled", field)
		}
		got, err := protector.For(field).Decrypt(ctx, stored)
		if err != nil || got != want {
			t.Fatalf("%s does not decrypt to the original value", field)
		}
	}
	for id, want := range map[string][2]string{active: {"active-password", "https://claim.example.test/active"}, deleted: {"deleted-password", ""}} {
		var password string
		var claimURL sql.NullString
		var updatedAt time.Time
		must(t, db.QueryRowContext(ctx, "SELECT db_password, claim_url, updated_at FROM tenants WHERE id = ?", id).Scan(&password, &claimURL, &updatedAt))
		check(secrets.FieldTenantDBPassword, password, want[0])
		if want[1] != "" {
			check(secrets.FieldTenantClaimURL, claimURL.String, want[1])
		} else if claimURL.String != "" {
			t.Fatal("empty claim URL was rewritten")
		}
		if updatedAt.Year() != 2020 {
			t.Fatal("tenant updated_at changed")
		}
	}
	var secret string
	var webhookUpdated time.Time
	must(t, db.QueryRowContext(ctx, "SELECT secret_ciphertext, updated_at FROM webhook_endpoints WHERE id = ?", endpoint).Scan(&secret, &webhookUpdated))
	check(secrets.FieldWebhookSecret, secret, "webhook-secret")
	if webhookUpdated.Year() != 2020 {
		t.Fatal("webhook updated_at changed")
	}

	var stored, hash, before string
	must(t, db.QueryRowContext(ctx, "SELECT payload_json, payload_hash FROM runtime_usage_outbox WHERE operation_id = ?", pending).Scan(&stored, &hash))
	if hash != "hash-pending" {
		t.Fatal("payload_hash changed")
	}
	var got struct {
		APIKeySubject string `json:"apiKeySubject"`
		Meter         string `json:"meter"`
		Event         struct {
			APIKeySubject string `json:"apiKeySubject"`
			EventType     string `json:"eventType"`
		} `json:"event"`
	}
	must(t, json.Unmarshal([]byte(stored), &got))
	check(secrets.FieldOutboxAPIKeySubject, got.APIKeySubject, "pending-subject")
	check(secrets.FieldOutboxAPIKeySubject, got.Event.APIKeySubject, "pending-event-subject")
	if got.Meter != "memory_write" || got.Event.EventType != "write" {
		t.Fatal("outbox backfill changed other payload fields")
	}
	// Done rows are kept and backfilled too, so they stay usable for troubleshooting.
	must(t, db.QueryRowContext(ctx, "SELECT payload_json FROM runtime_usage_outbox WHERE operation_id = ?", done).Scan(&stored))
	got = struct {
		APIKeySubject string `json:"apiKeySubject"`
		Meter         string `json:"meter"`
		Event         struct {
			APIKeySubject string `json:"apiKeySubject"`
			EventType     string `json:"eventType"`
		} `json:"event"`
	}{}
	must(t, json.Unmarshal([]byte(stored), &got))
	check(secrets.FieldOutboxAPIKeySubject, got.APIKeySubject, "done-subject")
	check(secrets.FieldOutboxAPIKeySubject, got.Event.APIKeySubject, "done-event-subject")

	// The worker's done transition leaves the encrypted subjects in place.
	must(t, db.QueryRowContext(ctx, "SELECT payload_json FROM runtime_usage_outbox WHERE operation_id = ?", pending).Scan(&before))
	must(t, runtimeusage.NewSQLStore(db, "tidb").MarkOperationDone(ctx, pending, ""))
	var status string
	must(t, db.QueryRowContext(ctx, "SELECT payload_json, payload_hash, status FROM runtime_usage_outbox WHERE operation_id = ?", pending).Scan(&stored, &hash, &status))
	if status != "done" || stored != before || hash != "hash-pending" {
		t.Fatal("done transition changed the payload")
	}

	// inspect-outbox finds rows by the log fingerprint of the tenant and
	// prints only fingerprints of the decrypted subjects.
	var inspectLogs bytes.Buffer
	inspect := func(opts secretmigrate.Options) {
		t.Helper()
		opts.Mode, opts.Limit = secretmigrate.ModeInspectOutbox, 20
		must(t, secretmigrate.Run(ctx, secretmigrate.Deps{DB: db, Backend: "tidb", Protector: protector}, opts, slog.New(slog.NewJSONHandler(&inspectLogs, nil))))
	}
	inspect(secretmigrate.Options{TenantFingerprint: logsafe.TenantID(active)})
	inspect(secretmigrate.Options{OperationID: done})
	for _, want := range []string{
		`"rows":2`, `"rows":1`, `"operation_id":"` + pending + `"`, `"operation_id":"` + done + `"`,
		`"tenant":"` + logsafe.TenantID(active) + `"`,
		`"subject":"` + logsafe.TenantID("pending-subject") + `"`, `"event_subject":"` + logsafe.TenantID("done-event-subject") + `"`,
		`"subject_format":"enc_v1"`, `"undecryptable":0`,
	} {
		if !strings.Contains(inspectLogs.String(), want) {
			t.Fatalf("inspect output misses %s", want)
		}
	}
	for _, needle := range []string{active, "pending-subject", "done-subject", "enc:v1:"} {
		if strings.Contains(inspectLogs.String(), `"`+needle) {
			t.Fatalf("inspect output leaked %q", needle)
		}
	}

	for _, needle := range []string{active, deleted, endpoint, pending, done, "active-password", "deleted-password", "claim.example.test", "webhook-secret", "pending-subject", "pending-event-subject", "done-subject", "enc:v1:"} {
		if strings.Contains(logs.String(), needle) {
			t.Fatalf("migration logs leaked %q", needle)
		}
	}
}
