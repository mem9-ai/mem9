package secretmigrate

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/credentials"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/repository/sqltest"
	"github.com/qiffang/mnemos/server/internal/secrets"
)

var zeroResult driver.Result = driver.RowsAffected(0)

func TestParseValidatesFlags(t *testing.T) {
	tests := []struct {
		name string
		args []string
	}{
		{name: "missing mode", args: nil},
		{name: "unknown mode", args: []string{"--mode=unknown"}},
		{name: "unknown field", args: []string{"--mode=dry-run", "--fields=not-a-field"}},
		{name: "duplicate field", args: []string{"--mode=dry-run", "--fields=tenants.db_password,tenants.db_password"}},
		{name: "batch too small", args: []string{"--mode=dry-run", "--batch-size=0"}},
		{name: "batch too large", args: []string{"--mode=dry-run", "--batch-size=1001"}},
		{name: "negative pause", args: []string{"--mode=dry-run", "--pause=-1s"}},
		{name: "negative max", args: []string{"--mode=dry-run", "--max-rows=-1"}},
		{name: "positional argument", args: []string{"--mode=dry-run", "extra"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := Parse(tt.args); err == nil {
				t.Fatal("Parse error = nil")
			}
		})
	}
	opts, err := Parse([]string{"--mode=backfill", "--fields=tenants.db_password", "--batch-size=10", "--pause=1ms", "--max-rows=2"})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(opts.Fields) != 1 || opts.Fields[0] != secrets.FieldTenantDBPassword || opts.BatchSize != 10 || opts.Pause != time.Millisecond || opts.MaxRows != 2 {
		t.Fatalf("Parse options = %+v", opts)
	}
}

func TestBackfillRefusesLegacyWriteFormat(t *testing.T) {
	db, rec := sqltest.New(t)
	err := Run(context.Background(), Deps{DB: db, Backend: "tidb", Protector: testProtector(t), WriteFormat: secrets.WriteFormatLegacy}, Options{Mode: ModeBackfill, BatchSize: 10}, testLogger())
	if err == nil || !strings.Contains(err.Error(), "enc_v1") {
		t.Fatalf("Run error = %v, want enc_v1 precondition", err)
	}
	for _, stmt := range rec.Statements() {
		if strings.HasPrefix(stmt.Query, "UPDATE") {
			t.Fatalf("backfill wrote while refused: %s", stmt.Query)
		}
	}
}

func TestBackfillSimpleFieldsUseCASAndFieldKIDs(t *testing.T) {
	protector := testProtector(t)
	for _, tt := range []struct {
		field, table, column, kid string
	}{
		{secrets.FieldTenantDBPassword, "tenants", "db_password", "db-k1"},
		{secrets.FieldTenantClaimURL, "tenants", "claim_url", "cu-k1"},
		{secrets.FieldWebhookSecret, "webhook_endpoints", "secret_ciphertext", "wh-k1"},
	} {
		t.Run(tt.field, func(t *testing.T) {
			db, rec := sqltest.New(t,
				sqltest.Rule{Match: "SELECT id, " + tt.column + " FROM", Nth: 1, Rows: []map[string]driver.Value{{"id": "row-1", tt.column: "legacy-plaintext-value"}}},
				sqltest.Rule{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(0)}}},
			)
			err := Run(context.Background(), Deps{DB: db, Backend: "tidb", Protector: protector, WriteFormat: secrets.WriteFormatEncV1}, Options{Mode: ModeBackfill, Fields: []string{tt.field}, BatchSize: 10}, testLogger())
			if err != nil {
				t.Fatalf("Run: %v", err)
			}
			selects := statementsWithPrefix(rec, "SELECT id, ")
			if len(selects) != 2 || selects[1].Args[0] != "row-1" {
				t.Fatalf("keyset pagination did not advance the cursor: %+v", selects)
			}
			if !strings.Contains(selects[0].Query, "NOT LIKE 'enc:%'") {
				t.Fatalf("select does not skip enc values: %s", selects[0].Query)
			}
			updates := statementsWithPrefix(rec, "UPDATE")
			if len(updates) != 1 {
				t.Fatalf("updates = %d, want 1", len(updates))
			}
			want := "UPDATE " + tt.table + " SET " + tt.column + " = ?, updated_at = updated_at WHERE id = ? AND " + tt.column + " = ?"
			if updates[0].Query != want {
				t.Fatalf("update = %s, want %s", updates[0].Query, want)
			}
			next, _ := updates[0].Args[0].(string)
			if !strings.HasPrefix(next, "enc:v1:"+tt.kid+":") {
				t.Fatal("new value does not use the field's kid")
			}
			if plain, err := protector.For(tt.field).Decrypt(context.Background(), next); err != nil || plain != "legacy-plaintext-value" {
				t.Fatal("new value does not decrypt to the original")
			}
			if updates[0].Args[1] != "row-1" || updates[0].Args[2] != "legacy-plaintext-value" {
				t.Fatal("update does not compare against the old value")
			}
		})
	}
}

func TestBackfillPostgresUsesNumberedPlaceholders(t *testing.T) {
	db, rec := sqltest.New(t,
		sqltest.Rule{Match: "SELECT id, db_password FROM", Nth: 1, Rows: []map[string]driver.Value{{"id": "row-1", "db_password": "legacy"}}},
		sqltest.Rule{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(0)}}},
	)
	err := Run(context.Background(), Deps{DB: db, Backend: "postgres", Protector: testProtector(t), WriteFormat: secrets.WriteFormatEncV1}, Options{Mode: ModeBackfill, Fields: []string{secrets.FieldTenantDBPassword}, BatchSize: 10}, testLogger())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	for _, stmt := range rec.Statements() {
		if strings.Contains(stmt.Query, "?") {
			t.Fatalf("postgres statement kept ? placeholders: %s", stmt.Query)
		}
	}
	updates := statementsWithPrefix(rec, "UPDATE")
	if len(updates) != 1 || updates[0].Query != "UPDATE tenants SET db_password = $1 WHERE id = $2 AND db_password = $3" {
		t.Fatalf("postgres update = %+v", updates)
	}
}

func TestBackfillOutboxUsesPathUpdates(t *testing.T) {
	for _, tt := range []struct {
		backend, top, event string
	}{
		{
			backend: "tidb",
			top:     "UPDATE runtime_usage_outbox SET payload_json = JSON_SET(payload_json, '$.apiKeySubject', ?) WHERE operation_id = ? AND status <> 'done' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.apiKeySubject')) = ?",
			event:   "UPDATE runtime_usage_outbox SET payload_json = JSON_SET(payload_json, '$.event.apiKeySubject', ?) WHERE operation_id = ? AND status <> 'done' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.event.apiKeySubject')) = ?",
		},
		{
			backend: "db9",
			top:     "UPDATE runtime_usage_outbox SET payload_json = jsonb_set(payload_json, '{apiKeySubject}', to_jsonb($1::text)) WHERE operation_id = $2 AND status <> 'done' AND payload_json->>'apiKeySubject' = $3",
			event:   "UPDATE runtime_usage_outbox SET payload_json = jsonb_set(payload_json, '{event,apiKeySubject}', to_jsonb($1::text)) WHERE operation_id = $2 AND status <> 'done' AND payload_json #>> '{event,apiKeySubject}' = $3",
		},
	} {
		t.Run(tt.backend, func(t *testing.T) {
			protector := testProtector(t)
			db, rec := sqltest.New(t,
				sqltest.Rule{Match: "SELECT operation_id,", Nth: 1, Rows: []map[string]driver.Value{{
					"operation_id": "op-1", "apiKeySubject": "legacy-subject", "event_api_key_subject": "legacy-event-subject",
				}}},
				sqltest.Rule{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(0)}}},
			)
			err := Run(context.Background(), Deps{DB: db, Backend: tt.backend, Protector: protector, WriteFormat: secrets.WriteFormatEncV1}, Options{Mode: ModeBackfill, Fields: []string{secrets.FieldOutboxAPIKeySubject}, BatchSize: 10}, testLogger())
			if err != nil {
				t.Fatalf("Run: %v", err)
			}
			selects := statementsWithPrefix(rec, "SELECT operation_id,")
			if len(selects) != 2 {
				t.Fatalf("selects = %d, want 2", len(selects))
			}
			if !strings.Contains(selects[0].Query, "status <> 'done' AND ((") {
				t.Fatalf("legacy subject condition is not grouped behind the cursor and status filters: %s", selects[0].Query)
			}
			updates := statementsWithPrefix(rec, "UPDATE")
			if len(updates) != 2 || updates[0].Query != tt.top || updates[1].Query != tt.event {
				t.Fatalf("outbox updates = %+v", updates)
			}
			for i, old := range []string{"legacy-subject", "legacy-event-subject"} {
				next, _ := updates[i].Args[0].(string)
				if !strings.HasPrefix(next, "enc:v1:ob-k1:") {
					t.Fatal("subject does not use the outbox kid")
				}
				if plain, err := protector.For(secrets.FieldOutboxAPIKeySubject).Decrypt(context.Background(), next); err != nil || plain != old {
					t.Fatal("subject does not decrypt to the original")
				}
				if updates[i].Args[1] != "op-1" || updates[i].Args[2] != old {
					t.Fatal("outbox update does not compare against the old value")
				}
			}
			for _, stmt := range rec.Statements() {
				if strings.Contains(stmt.Query, "payload_hash") {
					t.Fatal("outbox backfill touches payload_hash")
				}
			}
		})
	}
}

func TestBackfillSkipsEmptyOutboxPath(t *testing.T) {
	db, rec := sqltest.New(t,
		sqltest.Rule{Match: "SELECT operation_id,", Nth: 1, Rows: []map[string]driver.Value{{
			"operation_id": "op-1", "apiKeySubject": "legacy-subject", "event_api_key_subject": nil,
		}}},
		sqltest.Rule{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(0)}}},
	)
	err := Run(context.Background(), Deps{DB: db, Backend: "tidb", Protector: testProtector(t), WriteFormat: secrets.WriteFormatEncV1}, Options{Mode: ModeBackfill, Fields: []string{secrets.FieldOutboxAPIKeySubject}, BatchSize: 10}, testLogger())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	updates := statementsWithPrefix(rec, "UPDATE")
	if len(updates) != 1 || !strings.Contains(updates[0].Query, "'$.apiKeySubject'") {
		t.Fatalf("updates = %+v, want only the top-level path", updates)
	}
}

func TestBackfillCountsConflictsAndRowErrors(t *testing.T) {
	protector := testProtector(t)

	db, rec := sqltest.New(t,
		sqltest.Rule{Match: "SELECT id, secret_ciphertext FROM", Nth: 1, Rows: []map[string]driver.Value{{"id": "row-1", "secret_ciphertext": "legacy"}}},
		sqltest.Rule{Match: "UPDATE", Result: zeroResult},
		sqltest.Rule{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(1)}}},
	)
	var logs bytes.Buffer
	err := Run(context.Background(), Deps{DB: db, Backend: "tidb", Protector: protector, WriteFormat: secrets.WriteFormatEncV1}, Options{Mode: ModeBackfill, Fields: []string{secrets.FieldWebhookSecret}, BatchSize: 10}, slog.New(slog.NewJSONHandler(&logs, nil)))
	if err != nil {
		t.Fatalf("CAS conflict is not an error: %v", err)
	}
	if len(statementsWithPrefix(rec, "UPDATE")) != 1 || !strings.Contains(logs.String(), `"cas_conflicts":1`) || !strings.Contains(logs.String(), `"remaining":1`) {
		t.Fatalf("conflict not counted: %s", logs.String())
	}

	db, rec = sqltest.New(t,
		sqltest.Rule{Match: "SELECT id, secret_ciphertext FROM", Nth: 1, Rows: []map[string]driver.Value{
			{"id": "row-1", "secret_ciphertext": "enc:v9:unknown"},
			{"id": "row-2", "secret_ciphertext": "legacy"},
		}},
		sqltest.Rule{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(1)}}},
	)
	logs.Reset()
	err = Run(context.Background(), Deps{DB: db, Backend: "tidb", Protector: protector, WriteFormat: secrets.WriteFormatEncV1}, Options{Mode: ModeBackfill, Fields: []string{secrets.FieldWebhookSecret}, BatchSize: 10}, slog.New(slog.NewJSONHandler(&logs, nil)))
	if err == nil || !strings.Contains(err.Error(), "row errors") {
		t.Fatalf("Run error = %v, want row errors", err)
	}
	updates := statementsWithPrefix(rec, "UPDATE")
	if len(updates) != 1 || updates[0].Args[1] != "row-2" {
		t.Fatal("run did not continue after a row error")
	}
	if !strings.Contains(logs.String(), `"errors":1`) || !strings.Contains(logs.String(), `"updated":1`) {
		t.Fatalf("row error not counted: %s", logs.String())
	}
}

func TestBackfillHonorsMaxRows(t *testing.T) {
	db, rec := sqltest.New(t,
		sqltest.Rule{Match: "SELECT id, db_password FROM", Nth: 1, Rows: []map[string]driver.Value{
			{"id": "row-1", "db_password": "legacy-1"},
			{"id": "row-2", "db_password": "legacy-2"},
			{"id": "row-3", "db_password": "legacy-3"},
		}},
		sqltest.Rule{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(1)}}},
	)
	err := Run(context.Background(), Deps{DB: db, Backend: "tidb", Protector: testProtector(t), WriteFormat: secrets.WriteFormatEncV1}, Options{Mode: ModeBackfill, Fields: []string{secrets.FieldTenantDBPassword}, BatchSize: 10, MaxRows: 2}, testLogger())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if updates := statementsWithPrefix(rec, "UPDATE"); len(updates) != 2 {
		t.Fatalf("updates = %d, want 2", len(updates))
	}
}

func TestDryRunIsReadOnlyAndNeedsNoProtector(t *testing.T) {
	db, rec := sqltest.New(t, sqltest.Rule{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(3)}}})
	var logs bytes.Buffer
	err := Run(context.Background(), Deps{DB: db, Backend: "tidb"}, Options{Mode: ModeDryRun, BatchSize: 10}, slog.New(slog.NewJSONHandler(&logs, nil)))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	for _, stmt := range rec.Statements() {
		if !strings.HasPrefix(stmt.Query, "SELECT COUNT(*)") {
			t.Fatalf("dry-run issued %s", stmt.Query)
		}
	}
	if got := strings.Count(logs.String(), "secret migration field summary"); got != 4 {
		t.Fatalf("field summaries = %d, want 4", got)
	}
	if !strings.Contains(logs.String(), `"done_rows_with_subject":3`) {
		t.Fatalf("dry-run did not report done outbox rows: %s", logs.String())
	}
}

func TestVerifyReportsRemainingAndDecryptFailures(t *testing.T) {
	protector := testProtector(t)
	good, err := protector.For(secrets.FieldTenantDBPassword).Encrypt(context.Background(), "secret")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	db, _ := sqltest.New(t,
		sqltest.Rule{Match: "SELECT id, db_password FROM", Nth: 1, Rows: []map[string]driver.Value{{"id": "row-1", "db_password": good}}},
		sqltest.Rule{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(0)}}},
	)
	if err := Run(context.Background(), Deps{DB: db, Backend: "tidb", Protector: protector, WriteFormat: secrets.WriteFormatLegacy}, Options{Mode: ModeVerify, Fields: []string{secrets.FieldTenantDBPassword}, BatchSize: 10}, testLogger()); err != nil {
		t.Fatalf("clean verify: %v", err)
	}

	for name, rules := range map[string][]sqltest.Rule{
		"remaining legacy": {
			{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(2)}}},
		},
		"undecryptable value": {
			{Match: "SELECT id, db_password FROM", Nth: 1, Rows: []map[string]driver.Value{{"id": "row-1", "db_password": "enc:v1:wh-k1:" + strings.TrimPrefix(good, "enc:v1:db-k1:")}}},
			{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(0)}}},
		},
		"unknown enc prefix": {
			{Match: "SELECT id, db_password FROM", Nth: 1, Rows: []map[string]driver.Value{{"id": "row-1", "db_password": "enc:v9:x"}}},
			{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(0)}}},
		},
	} {
		t.Run(name, func(t *testing.T) {
			db, _ := sqltest.New(t, rules...)
			err := Run(context.Background(), Deps{DB: db, Backend: "tidb", Protector: protector}, Options{Mode: ModeVerify, Fields: []string{secrets.FieldTenantDBPassword}, BatchSize: 10}, testLogger())
			if err == nil || !strings.Contains(err.Error(), "verification failed") {
				t.Fatalf("Run error = %v, want verification failure", err)
			}
		})
	}
}

func TestVerifyFailsOnDoneOutboxRowsWithSubject(t *testing.T) {
	db, _ := sqltest.New(t,
		sqltest.Rule{Match: "WHERE status = 'done'", Rows: []map[string]driver.Value{{"COUNT(*)": int64(1)}}},
		sqltest.Rule{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(0)}}},
	)
	err := Run(context.Background(), Deps{DB: db, Backend: "tidb", Protector: testProtector(t)}, Options{Mode: ModeVerify, Fields: []string{secrets.FieldOutboxAPIKeySubject}, BatchSize: 10}, testLogger())
	if err == nil || !strings.Contains(err.Error(), "verification failed") {
		t.Fatalf("Run error = %v, want verification failure", err)
	}
}

func TestScrubStatementsLoopUntilZero(t *testing.T) {
	for _, tt := range []struct {
		backend string
		want    string
	}{
		{backend: "tidb", want: "UPDATE runtime_usage_outbox SET payload_json = JSON_REMOVE(payload_json, '$.apiKeySubject', '$.event.apiKeySubject') WHERE status = 'done' AND JSON_CONTAINS_PATH(payload_json, 'one', '$.apiKeySubject', '$.event.apiKeySubject') LIMIT ?"},
		{backend: "postgres", want: "UPDATE runtime_usage_outbox SET payload_json = payload_json #- '{apiKeySubject}' #- '{event,apiKeySubject}' WHERE operation_id IN (SELECT operation_id FROM runtime_usage_outbox WHERE status = 'done' AND (payload_json->'apiKeySubject' IS NOT NULL OR payload_json #> '{event,apiKeySubject}' IS NOT NULL) LIMIT $1)"},
		{backend: "db9", want: "UPDATE runtime_usage_outbox SET payload_json = payload_json #- '{apiKeySubject}' #- '{event,apiKeySubject}' WHERE operation_id IN (SELECT operation_id FROM runtime_usage_outbox WHERE status = 'done' AND (payload_json->'apiKeySubject' IS NOT NULL OR payload_json #> '{event,apiKeySubject}' IS NOT NULL) LIMIT $1)"},
	} {
		t.Run(tt.backend, func(t *testing.T) {
			db, rec := sqltest.New(t,
				sqltest.Rule{Match: "UPDATE runtime_usage_outbox", Nth: 3, Result: zeroResult},
				sqltest.Rule{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(0)}}},
			)
			err := Run(context.Background(), Deps{DB: db, Backend: tt.backend}, Options{Mode: ModeScrub, BatchSize: 1, Pause: time.Millisecond}, testLogger())
			if err != nil {
				t.Fatalf("Run: %v", err)
			}
			updates := statementsWithPrefix(rec, "UPDATE")
			if len(updates) != 3 {
				t.Fatalf("scrub attempts = %d, want 3", len(updates))
			}
			for _, stmt := range updates {
				if stmt.Query != tt.want {
					t.Fatalf("scrub query = %s", stmt.Query)
				}
			}
		})
	}
}

func TestScrubRejectsOtherFields(t *testing.T) {
	db, _ := sqltest.New(t)
	err := Run(context.Background(), Deps{DB: db, Backend: "tidb"}, Options{Mode: ModeScrub, Fields: []string{secrets.FieldTenantDBPassword}, BatchSize: 10}, testLogger())
	if err == nil {
		t.Fatal("scrub accepted a non-outbox field")
	}
}

func TestLogsAndErrorsDoNotLeakValues(t *testing.T) {
	protector := testProtector(t)
	const (
		rowID    = "distinct-row-id-7f3a"
		opID     = "distinct-operation-id-91c2"
		password = "distinct-password-5e8d"
		claimURL = "https://claim.example.test/distinct-claim-2b6f"
		subject  = "distinct-subject-c41a"
	)
	var logs bytes.Buffer
	db, rec := sqltest.New(t,
		sqltest.Rule{Match: "SELECT id, db_password FROM", Nth: 1, Rows: []map[string]driver.Value{{"id": rowID, "db_password": password}}},
		sqltest.Rule{Match: "SELECT id, claim_url FROM", Nth: 1, Rows: []map[string]driver.Value{{"id": rowID, "claim_url": claimURL}}},
		sqltest.Rule{Match: "SELECT id, secret_ciphertext FROM", Nth: 1, Rows: []map[string]driver.Value{{"id": rowID, "secret_ciphertext": "enc:v9:" + password}}},
		sqltest.Rule{Match: "SELECT operation_id,", Nth: 1, Rows: []map[string]driver.Value{{"operation_id": opID, "apiKeySubject": subject, "event_api_key_subject": subject}}},
		sqltest.Rule{Match: "SELECT COUNT(*)", Rows: []map[string]driver.Value{{"COUNT(*)": int64(0)}}},
	)
	err := Run(context.Background(), Deps{DB: db, Backend: "tidb", Protector: protector, WriteFormat: secrets.WriteFormatEncV1}, Options{Mode: ModeBackfill, BatchSize: 10}, slog.New(slog.NewJSONHandler(&logs, nil)))
	if err == nil {
		t.Fatal("expected the undecryptable webhook row to fail the run")
	}
	needles := []string{rowID, opID, password, claimURL, subject, "enc:v1:"}
	for _, stmt := range statementsWithPrefix(rec, "UPDATE") {
		needles = append(needles, stmt.Args[0].(string))
	}
	for _, needle := range needles {
		if strings.Contains(logs.String(), needle) || strings.Contains(err.Error(), needle) {
			t.Fatalf("logs or error leaked a value: %q", needle)
		}
	}
}

func statementsWithPrefix(rec *sqltest.Recorder, prefix string) []sqltest.Stmt {
	var out []sqltest.Stmt
	for _, stmt := range rec.Statements() {
		if strings.HasPrefix(stmt.Query, prefix) {
			out = append(out, stmt)
		}
	}
	return out
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil))
}

func testProtector(t *testing.T) *secrets.Protector {
	t.Helper()
	key := func(b byte) string { return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{b}, 32)) }
	contents := fmt.Sprintf(`{
 "hash_version":"h1",
 "hmac_keys":{"h1":%q},
 "encryption_kid":"space-k1",
 "encryption_keys":{"space-k1":%q,"db-k1":%q,"cu-k1":%q,"wh-k1":%q,"ob-k1":%q},
 "secret_field_kids":{%q:"db-k1",%q:"cu-k1",%q:"wh-k1",%q:"ob-k1"}
}`,
		key(0x11), key(0x22), key(0x33), key(0x36), key(0x34), key(0x35),
		secrets.FieldTenantDBPassword, secrets.FieldTenantClaimURL, secrets.FieldWebhookSecret, secrets.FieldOutboxAPIKeySubject)
	path := filepath.Join(t.TempDir(), "keyring.json")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	keyring, err := credentials.LoadKeyring(path)
	if err != nil {
		t.Fatalf("LoadKeyring: %v", err)
	}
	protector, err := secrets.New(keyring, encrypt.NewPlainEncryptor(), secrets.WriteFormatEncV1)
	if err != nil {
		t.Fatalf("secrets.New: %v", err)
	}
	return protector
}
