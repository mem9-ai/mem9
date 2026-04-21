package tidb

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestMemoryFTSSearch_PostFiltersAfterFTSTopK(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain: []string{
				"SELECT id, fts_match_word('golang', content) AS fts_score",
				"FROM memories",
				"WHERE fts_match_word('golang', content)",
				"ORDER BY fts_match_word('golang', content) DESC, id",
			},
			mustNotContain: []string{
				"state = ?",
				"agent_id = ?",
				"JSON_CONTAINS(tags, ?)",
			},
			wantArgs: []any{2, 0},
			rows: &scriptedRows{
				columns: []string{"id", "fts_score"},
				values: [][]driver.Value{
					{"m-deleted", 9.9},
					{"m-good-1", 8.8},
				},
			},
		},
		{
			mustContain: []string{
				"SELECT " + allColumns + " FROM memories",
				"WHERE id IN (?,?) AND state = ? AND agent_id = ? AND JSON_CONTAINS(tags, ?)",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       []any{"m-deleted", "m-good-1", "active", "agent-1", `"tag-a"`},
			rows: &scriptedRows{
				columns: memoryColumns(),
				values: [][]driver.Value{
					memoryRow("m-good-1", "match one", "agent-1", "session-1", "active", []byte(`["tag-a"]`), now),
				},
			},
		},
		{
			mustContain: []string{
				"SELECT id, fts_match_word('golang', content) AS fts_score",
				"FROM memories",
				"WHERE fts_match_word('golang', content)",
				"ORDER BY fts_match_word('golang', content) DESC, id",
			},
			mustNotContain: []string{
				"state = ?",
				"agent_id = ?",
				"JSON_CONTAINS(tags, ?)",
			},
			wantArgs: []any{2, 2},
			rows: &scriptedRows{
				columns: []string{"id", "fts_score"},
				values: [][]driver.Value{
					{"m-good-2", 7.7},
				},
			},
		},
		{
			mustContain: []string{
				"SELECT " + allColumns + " FROM memories",
				"WHERE id IN (?) AND state = ? AND agent_id = ? AND JSON_CONTAINS(tags, ?)",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       []any{"m-good-2", "active", "agent-1", `"tag-a"`},
			rows: &scriptedRows{
				columns: memoryColumns(),
				values: [][]driver.Value{
					memoryRow("m-good-2", "match two", "agent-1", "session-2", "active", []byte(`["tag-a"]`), now),
				},
			},
		},
	})
	defer db.Close()

	repo := NewMemoryRepo(db, "", true, "cluster-1")
	results, err := repo.FTSSearch(context.Background(), "golang", domain.MemoryFilter{
		State:   "active",
		AgentID: "agent-1",
		Tags:    []string{"tag-a"},
	}, 2)
	if err != nil {
		t.Fatalf("FTSSearch: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("len(results) = %d, want 2", len(results))
	}
	if results[0].ID != "m-good-1" || results[1].ID != "m-good-2" {
		t.Fatalf("result IDs = [%s %s], want [m-good-1 m-good-2]", results[0].ID, results[1].ID)
	}
	if results[0].Score == nil || *results[0].Score != 8.8 {
		t.Fatalf("results[0].Score = %v, want 8.8", results[0].Score)
	}
	if results[1].Score == nil || *results[1].Score != 7.7 {
		t.Fatalf("results[1].Score = %v, want 7.7", results[1].Score)
	}
}

func TestSessionFTSSearch_PostFiltersAfterFTSTopK(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain: []string{
				"SELECT id, fts_match_word('golang', content) AS fts_score",
				"FROM sessions",
				"WHERE fts_match_word('golang', content)",
				"ORDER BY fts_match_word('golang', content) DESC, id",
			},
			mustNotContain: []string{
				"state = ?",
				"agent_id = ?",
				"session_id = ?",
				"source = ?",
				"JSON_CONTAINS(tags, ?)",
			},
			wantArgs: []any{2, 0},
			rows: &scriptedRows{
				columns: []string{"id", "fts_score"},
				values: [][]driver.Value{
					{"s-stale", 5.5},
					{"s-good-1", 4.4},
				},
			},
		},
		{
			mustContain: []string{
				"SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at",
				"FROM sessions",
				"WHERE id IN (?,?) AND state = ? AND agent_id = ? AND session_id = ? AND source = ? AND JSON_CONTAINS(tags, ?)",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       []any{"s-stale", "s-good-1", "active", "agent-1", "sess-1", "chat", `"tag-a"`},
			rows: &scriptedRows{
				columns: sessionColumns(),
				values: [][]driver.Value{
					sessionRow("s-good-1", "sess-1", "agent-1", "chat", 1, "user", "match one", []byte(`["tag-a"]`), "active", now),
				},
			},
		},
		{
			mustContain: []string{
				"SELECT id, fts_match_word('golang', content) AS fts_score",
				"FROM sessions",
				"WHERE fts_match_word('golang', content)",
				"ORDER BY fts_match_word('golang', content) DESC, id",
			},
			mustNotContain: []string{
				"state = ?",
				"agent_id = ?",
				"session_id = ?",
				"source = ?",
				"JSON_CONTAINS(tags, ?)",
			},
			wantArgs: []any{2, 2},
			rows: &scriptedRows{
				columns: []string{"id", "fts_score"},
				values: [][]driver.Value{
					{"s-good-2", 3.3},
				},
			},
		},
		{
			mustContain: []string{
				"SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at",
				"FROM sessions",
				"WHERE id IN (?) AND state = ? AND agent_id = ? AND session_id = ? AND source = ? AND JSON_CONTAINS(tags, ?)",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       []any{"s-good-2", "active", "agent-1", "sess-1", "chat", `"tag-a"`},
			rows: &scriptedRows{
				columns: sessionColumns(),
				values: [][]driver.Value{
					sessionRow("s-good-2", "sess-1", "agent-1", "chat", 2, "assistant", "match two", []byte(`["tag-a"]`), "active", now),
				},
			},
		},
	})
	defer db.Close()

	repo := NewSessionRepo(db, "", true, "cluster-1")
	results, err := repo.FTSSearch(context.Background(), "golang", domain.MemoryFilter{
		State:     "active",
		AgentID:   "agent-1",
		SessionID: "sess-1",
		Source:    "chat",
		Tags:      []string{"tag-a"},
	}, 2)
	if err != nil {
		t.Fatalf("FTSSearch: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("len(results) = %d, want 2", len(results))
	}
	if results[0].ID != "s-good-1" || results[1].ID != "s-good-2" {
		t.Fatalf("result IDs = [%s %s], want [s-good-1 s-good-2]", results[0].ID, results[1].ID)
	}
	if results[0].Score == nil || *results[0].Score != 4.4 {
		t.Fatalf("results[0].Score = %v, want 4.4", results[0].Score)
	}
	if results[1].Score == nil || *results[1].Score != 3.3 {
		t.Fatalf("results[1].Score = %v, want 3.3", results[1].Score)
	}
}

type queryExpectation struct {
	mustContain    []string
	mustNotContain []string
	wantArgs       []any
	rows           *scriptedRows
	err            error
}

type scriptedDriver struct {
	script *queryScript
}

type scriptedConn struct {
	script *queryScript
}

type queryScript struct {
	t            *testing.T
	expectations []*queryExpectation
	mu           sync.Mutex
	index        int
}

func (d *scriptedDriver) Open(string) (driver.Conn, error) {
	return &scriptedConn{script: d.script}, nil
}

func (c *scriptedConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("Prepare not supported")
}

func (c *scriptedConn) Close() error { return nil }

func (c *scriptedConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("Begin not supported")
}

func (c *scriptedConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return c.script.query(query, args)
}

type scriptedRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *scriptedRows) Columns() []string { return r.columns }

func (r *scriptedRows) Close() error { return nil }

func (r *scriptedRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}

func newScriptedTestDB(t *testing.T, expectations []*queryExpectation) *sql.DB {
	t.Helper()

	script := &queryScript{t: t, expectations: expectations}
	name := fmt.Sprintf("tidb-scripted-%d", scriptedDriverID.Add(1))
	sql.Register(name, &scriptedDriver{script: script})

	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}

	t.Cleanup(func() {
		script.assertDone()
	})

	return db
}

func (s *queryScript) query(query string, args []driver.NamedValue) (driver.Rows, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.index >= len(s.expectations) {
		s.t.Fatalf("unexpected query %q", query)
	}
	expectation := s.expectations[s.index]
	s.index++

	for _, fragment := range expectation.mustContain {
		if !strings.Contains(query, fragment) {
			s.t.Fatalf("query %q does not contain %q", query, fragment)
		}
	}
	for _, fragment := range expectation.mustNotContain {
		if strings.Contains(query, fragment) {
			s.t.Fatalf("query %q unexpectedly contains %q", query, fragment)
		}
	}

	gotArgs := make([]any, len(args))
	for i, arg := range args {
		gotArgs[i] = normalizeDriverValue(arg.Value)
	}
	wantArgs := make([]any, len(expectation.wantArgs))
	for i, arg := range expectation.wantArgs {
		wantArgs[i] = normalizeDriverValue(arg)
	}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		s.t.Fatalf("args = %#v, want %#v", gotArgs, wantArgs)
	}

	if expectation.err != nil {
		return nil, expectation.err
	}
	return expectation.rows, nil
}

func (s *queryScript) assertDone() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.index != len(s.expectations) {
		s.t.Fatalf("consumed %d queries, want %d", s.index, len(s.expectations))
	}
}

func normalizeDriverValue(v any) any {
	switch x := v.(type) {
	case int:
		return int64(x)
	case int8:
		return int64(x)
	case int16:
		return int64(x)
	case int32:
		return int64(x)
	case int64:
		return x
	case uint:
		return int64(x)
	case uint8:
		return int64(x)
	case uint16:
		return int64(x)
	case uint32:
		return int64(x)
	case []byte:
		return string(x)
	default:
		return v
	}
}

func memoryColumns() []string {
	return []string{
		"id", "content", "source", "tags", "metadata", "embedding", "memory_type", "agent_id",
		"session_id", "state", "version", "updated_by", "created_at", "updated_at", "superseded_by",
	}
}

func memoryRow(id, content, agentID, sessionID, state string, tags []byte, ts time.Time) []driver.Value {
	return []driver.Value{
		id,
		content,
		"chat",
		tags,
		[]byte(`{"k":"v"}`),
		nil,
		string(domain.TypeInsight),
		agentID,
		sessionID,
		state,
		int64(1),
		"tester",
		ts,
		ts,
		nil,
	}
}

func sessionColumns() []string {
	return []string{
		"id", "session_id", "agent_id", "source", "seq", "role", "content", "content_type", "tags", "state", "created_at",
	}
}

func sessionRow(id, sessionID, agentID, source string, seq int64, role, content string, tags []byte, state string, ts time.Time) []driver.Value {
	return []driver.Value{
		id,
		sessionID,
		agentID,
		source,
		seq,
		role,
		content,
		"text",
		tags,
		state,
		ts,
	}
}

var scriptedDriverID atomic.Uint64
