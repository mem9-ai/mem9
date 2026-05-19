package runtimeusage

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/metering"
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

func TestSQLStoreDoneStatusClearsLastError(t *testing.T) {
	rec := &recordingStore{}
	store := NewSQLStore(newRecordingDB(t, rec), "tidb")

	if err := store.MarkOperationDone(context.Background(), "op-1", "reservationReleased"); err != nil {
		t.Fatalf("MarkOperationDone: %v", err)
	}
	if len(rec.execs) != 1 {
		t.Fatalf("exec count = %d, want 1", len(rec.execs))
	}
	if len(rec.execs[0].args) < 3 {
		t.Fatalf("args = %+v, want last_error arg", rec.execs[0].args)
	}
	if rec.execs[0].args[2].Value != nil {
		t.Fatalf("last_error arg = %#v, want NULL", rec.execs[0].args[2].Value)
	}
}
