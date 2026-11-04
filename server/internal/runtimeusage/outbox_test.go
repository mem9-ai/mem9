package runtimeusage

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/credentials"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/metering"
	"github.com/qiffang/mnemos/server/internal/secrets"
)

var (
	recordingDriverOnce sync.Once
	recordingStores     sync.Map
)

type recordedExec struct {
	query string
	args  []driver.NamedValue
}

type recordingStore struct {
	mu          sync.Mutex
	execs       []recordedExec
	statusRow   []driver.Value
	attemptsRow []driver.Value
}

type recordingDriver struct{}

func (recordingDriver) Open(name string) (driver.Conn, error) {
	value, _ := recordingStores.Load(name)
	return &recordingConn{store: value.(*recordingStore)}, nil
}

type recordingConn struct {
	store *recordingStore
}

func (c *recordingConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (c *recordingConn) Close() error                        { return nil }
func (c *recordingConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }

func (c *recordingConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	c.store.execs = append(c.store.execs, recordedExec{query: query, args: append([]driver.NamedValue(nil), args...)})
	return driver.RowsAffected(1), nil
}

func (c *recordingConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.store.mu.Lock()
	defer c.store.mu.Unlock()
	if strings.Contains(query, "SELECT status, phase, last_error") {
		return &recordingRows{cols: []string{"status", "phase", "last_error"}, values: append([]driver.Value(nil), c.store.statusRow...)}, nil
	}
	if strings.Contains(query, "SELECT attempt_count") {
		return &recordingRows{cols: []string{"attempt_count"}, values: append([]driver.Value(nil), c.store.attemptsRow...)}, nil
	}
	return &recordingRows{}, nil
}

type recordingRows struct {
	cols   []string
	values []driver.Value
	read   bool
}

func (r *recordingRows) Columns() []string { return r.cols }
func (r *recordingRows) Close() error      { return nil }
func (r *recordingRows) Next(dest []driver.Value) error {
	if r.read || len(r.values) == 0 {
		return io.EOF
	}
	r.read = true
	copy(dest, r.values)
	return nil
}

func newRecordingDB(t *testing.T, store *recordingStore) *sql.DB {
	t.Helper()
	recordingDriverOnce.Do(func() {
		sql.Register("runtimeusage_recording", recordingDriver{})
	})
	name := t.Name()
	recordingStores.Store(name, store)
	t.Cleanup(func() {
		recordingStores.Delete(name)
	})
	db, err := sql.Open("runtimeusage_recording", name)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func TestSQLStoreStoreOperationUsesAtomicUpsert(t *testing.T) {
	for _, tt := range []struct {
		backend string
		want    string
	}{
		{backend: "tidb", want: "ON DUPLICATE KEY UPDATE"},
		{backend: "postgres", want: "ON CONFLICT (operation_id) DO UPDATE"},
	} {
		t.Run(tt.backend, func(t *testing.T) {
			rec := &recordingStore{}
			store := NewSQLStore(newRecordingDB(t, rec), tt.backend)
			store.now = func() time.Time { return time.Unix(100, 0).UTC() }

			lease := &OperationLease{
				OperationID: "018f7f3a-7b8c-7c2d-9a5b-6d7e8f901234",
				Subject:     Subject{TenantID: "tenant-a", ClusterID: "cluster-a"},
				Meter:       MeterMemoryRecallRequests,
				Units:       1,
				Reserved:    true,
			}
			if err := store.StoreCommitPending(context.Background(), lease, MeteringEvent{EventType: EventTypeMemoryRecall, Meter: MeterMemoryRecallRequests, Units: 1}); err != nil {
				t.Fatalf("StoreCommitPending: %v", err)
			}

			if len(rec.execs) != 1 {
				t.Fatalf("exec count = %d, want 1", len(rec.execs))
			}
			if !strings.Contains(rec.execs[0].query, tt.want) {
				t.Fatalf("query does not contain %q:\n%s", tt.want, rec.execs[0].query)
			}
		})
	}
}

func TestSQLStoreStoreCommitPendingPersistsAPIKeySubject(t *testing.T) {
	rec := &recordingStore{}
	store := NewSQLStore(newRecordingDB(t, rec), "tidb")
	store.now = func() time.Time { return time.Unix(100, 0).UTC() }

	lease := &OperationLease{
		OperationID: "018f7f3a-7b8c-7c2d-9a5b-6d7e8f901234",
		Subject:     Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "api-key-subject"},
		Meter:       MeterMemoryRecallRequests,
		Units:       1,
		Reserved:    true,
	}
	if err := store.StoreCommitPending(context.Background(), lease, MeteringEvent{EventType: EventTypeMemoryRecall, Meter: MeterMemoryRecallRequests, Units: 1}); err != nil {
		t.Fatalf("StoreCommitPending: %v", err)
	}

	if len(rec.execs) != 1 {
		t.Fatalf("exec count = %d, want 1", len(rec.execs))
	}
	var payload outboxPayload
	if err := json.Unmarshal([]byte(rec.execs[0].args[6].Value.(string)), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.APIKeySubject != "api-key-subject" {
		t.Fatalf("payload APIKeySubject = %q, want api-key-subject", payload.APIKeySubject)
	}
	if payload.Event == nil || payload.Event.APIKeySubject != "api-key-subject" {
		t.Fatalf("payload event = %+v, want APIKeySubject", payload.Event)
	}
}

func TestSQLStoreUpsertMeteringPendingUsesAtomicUpsertAndDetectsConflict(t *testing.T) {
	rec := &recordingStore{
		statusRow: []driver.Value{outboxStatusTerminalFailed, outboxPhaseTerminalFailed, "different payload hash for existing metering operation"},
	}
	store := NewSQLStore(newRecordingDB(t, rec), "tidb")

	err := store.UpsertMeteringPending(context.Background(), metering.Event{
		OperationID: "018f7f3a-7b8c-7c2d-9a5b-6d7e8f901234",
		TenantID:    "tenant-a",
		ClusterID:   "cluster-a",
	}, []byte(`{"eventType":"memoryRecall"}`), "hash-a")
	if err == nil {
		t.Fatal("UpsertMeteringPending error = nil, want payload hash conflict")
	}
	if len(rec.execs) != 1 {
		t.Fatalf("exec count = %d, want 1", len(rec.execs))
	}
	if !strings.Contains(rec.execs[0].query, "ON DUPLICATE KEY UPDATE") {
		t.Fatalf("query does not use atomic upsert:\n%s", rec.execs[0].query)
	}
}

func TestSQLStoreUpsertMeteringPendingEncryptsSubjectWithoutChangingHash(t *testing.T) {
	protector, err := secrets.New(runtimeUsageTestKeyring(t), encrypt.NewPlainEncryptor(), secrets.WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New protector: %v", err)
	}
	rec := &recordingStore{
		statusRow: []driver.Value{outboxStatusPending, outboxPhaseMeteringPending, nil},
	}
	store := NewSQLStore(newRecordingDB(t, rec), "tidb", protector.For(secrets.FieldOutboxAPIKeySubject))
	wantHash := strings.Repeat("a", 64)
	err = store.UpsertMeteringPending(context.Background(), metering.Event{
		OperationID:   "018f7f3a-7b8c-7c2d-9a5b-6d7e8f901234",
		TenantID:      "tenant-a",
		APIKeySubject: "api-key-subject",
		EventType:     EventTypeMemoryRecall,
		Meter:         MeterMemoryRecallRequests,
		Units:         1,
	}, []byte(`{"apiKeySubject":"api-key-subject"}`), wantHash)
	if err != nil {
		t.Fatalf("UpsertMeteringPending: %v", err)
	}
	if got := rec.execs[0].args[7].Value; got != wantHash {
		t.Fatalf("payload hash = %v, want %s", got, wantHash)
	}
	var payload outboxPayload
	if err := json.Unmarshal([]byte(rec.execs[0].args[6].Value.(string)), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.Event == nil || !strings.HasPrefix(payload.Event.APIKeySubject, "enc:v1:") {
		t.Fatalf("stored event subject is not encrypted")
	}
}

func TestSQLStoreDoneStatusClearsLastErrorAndKeepsPayload(t *testing.T) {
	for _, backend := range []string{"tidb", "postgres", "db9"} {
		t.Run(backend, func(t *testing.T) {
			rec := &recordingStore{}
			store := NewSQLStore(newRecordingDB(t, rec), backend)

			if err := store.MarkOperationDone(context.Background(), "op-1", "reservationReleased"); err != nil {
				t.Fatalf("MarkOperationDone: %v", err)
			}
			if len(rec.execs) != 1 {
				t.Fatalf("exec count = %d, want 1", len(rec.execs))
			}
			if strings.Contains(rec.execs[0].query, "payload_json") {
				t.Fatalf("done transition rewrites the payload:\n%s", rec.execs[0].query)
			}
			if len(rec.execs[0].args) < 3 {
				t.Fatalf("args = %+v, want last_error arg", rec.execs[0].args)
			}
			if rec.execs[0].args[2].Value != nil {
				t.Fatalf("last_error arg = %#v, want NULL", rec.execs[0].args[2].Value)
			}
		})
	}
}

func TestSQLStoreEncryptedSubjectsKeepPlaintextPayloadHash(t *testing.T) {
	keyring := runtimeUsageTestKeyring(t)
	legacyProtector, err := secrets.New(keyring, encrypt.NewPlainEncryptor(), secrets.WriteFormatLegacy)
	if err != nil {
		t.Fatalf("New legacy protector: %v", err)
	}
	encProtector, err := secrets.New(keyring, encrypt.NewPlainEncryptor(), secrets.WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New enc protector: %v", err)
	}

	lease := &OperationLease{
		OperationID: "018f7f3a-7b8c-7c2d-9a5b-6d7e8f901234",
		Subject:     Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "api-key-subject"},
		Meter:       MeterMemoryRecallRequests,
		Units:       1,
		Reserved:    true,
	}
	event := MeteringEvent{EventType: EventTypeMemoryRecall, Meter: MeterMemoryRecallRequests, Units: 1}

	records := make([]*recordingStore, 0, 2)
	for _, fieldEncryptor := range []encrypt.Encryptor{
		legacyProtector.For(secrets.FieldOutboxAPIKeySubject),
		encProtector.For(secrets.FieldOutboxAPIKeySubject),
	} {
		rec := &recordingStore{}
		store := NewSQLStore(newRecordingDB(t, rec), "tidb", fieldEncryptor)
		store.now = func() time.Time { return time.Unix(100, 0).UTC() }
		if err := store.StoreCommitPending(context.Background(), lease, event); err != nil {
			t.Fatalf("StoreCommitPending: %v", err)
		}
		records = append(records, rec)
	}

	if got, want := records[1].execs[0].args[7].Value, records[0].execs[0].args[7].Value; got != want {
		t.Fatalf("encrypted payload hash = %v, want legacy hash %v", got, want)
	}
	var stored outboxPayload
	if err := json.Unmarshal([]byte(records[1].execs[0].args[6].Value.(string)), &stored); err != nil {
		t.Fatalf("unmarshal encrypted payload: %v", err)
	}
	if !strings.HasPrefix(stored.APIKeySubject, "enc:v1:") {
		t.Fatalf("top-level subject is not encrypted")
	}
	if stored.Event == nil || !strings.HasPrefix(stored.Event.APIKeySubject, "enc:v1:") {
		t.Fatalf("event subject is not encrypted")
	}
}

func runtimeUsageTestKeyring(t *testing.T) *credentials.Keyring {
	t.Helper()
	key := make([]byte, 32)
	dbKey := make([]byte, 32)
	whKey := make([]byte, 32)
	obKey := make([]byte, 32)
	cuKey := make([]byte, 32)
	hmacKey := make([]byte, 32)
	for i := range key {
		key[i] = 0x22
		dbKey[i] = 0x33
		whKey[i] = 0x34
		obKey[i] = 0x35
		cuKey[i] = 0x36
		hmacKey[i] = 0x11
	}
	contents := fmt.Sprintf(`{
  "hash_version":"h1",
  "hmac_keys":{"h1":%q},
  "encryption_kid":"enc-current",
  "encryption_keys":{"enc-current":%q,"db-k1":%q,"wh-k1":%q,"ob-k1":%q,"cu-k1":%q},
  "secret_field_kids":{"%s":"db-k1","%s":"wh-k1","%s":"ob-k1","%s":"cu-k1"}
}`, base64.StdEncoding.EncodeToString(hmacKey), base64.StdEncoding.EncodeToString(key), base64.StdEncoding.EncodeToString(dbKey), base64.StdEncoding.EncodeToString(whKey), base64.StdEncoding.EncodeToString(obKey), base64.StdEncoding.EncodeToString(cuKey), secrets.FieldTenantDBPassword, secrets.FieldWebhookSecret, secrets.FieldOutboxAPIKeySubject, secrets.FieldTenantClaimURL)
	path := filepath.Join(t.TempDir(), "keyring.json")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	keyring, err := credentials.LoadKeyring(path)
	if err != nil {
		t.Fatalf("LoadKeyring: %v", err)
	}
	return keyring
}
