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

func TestMemoryFTSSearch_PagesPureFTSBeforePostFilter(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	initialCandidateLimit := 2
	firstPageArgs := append(ftsCandidateArgs("m-page-0", initialCandidateLimit), "active", "agent-1", `"tag-a"`)
	secondPageArgs := append(ftsCandidateArgs("m-page-1", maxFTSCandidatePageLimit), "active", "agent-1", `"tag-a"`)
	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain: []string{
				"SELECT id, fts_match_word('golang', content) AS fts_score",
				"FROM memories",
				"WHERE fts_match_word('golang', content)",
				"ORDER BY fts_match_word('golang', content) DESC, id",
				"LIMIT ? OFFSET ?",
			},
			mustNotContain: []string{
				"state = ?",
				"agent_id = ?",
				"JSON_CONTAINS(tags, ?)",
			},
			wantArgs: []any{initialCandidateLimit, 0},
			rows: &generatedFTSCandidateRows{
				prefix: "m-page-0",
				count:  initialCandidateLimit,
			},
		},
		{
			mustContain: []string{
				"SELECT " + allColumns + " FROM memories",
				"WHERE id IN (",
				"AND state = ? AND agent_id = ? AND JSON_CONTAINS(tags, ?)",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       firstPageArgs,
			rows: &scriptedRows{
				columns: memoryColumns(),
				values: [][]driver.Value{
					memoryRow("m-page-0-0001", "match one", "agent-1", "session-1", "active", []byte(`["tag-a"]`), now),
				},
			},
		},
		{
			mustContain: []string{
				"SELECT id, fts_match_word('golang', content) AS fts_score",
				"FROM memories",
				"WHERE fts_match_word('golang', content)",
				"ORDER BY fts_match_word('golang', content) DESC, id",
				"LIMIT ? OFFSET ?",
			},
			mustNotContain: []string{
				"state = ?",
				"agent_id = ?",
				"JSON_CONTAINS(tags, ?)",
			},
			wantArgs: []any{maxFTSCandidatePageLimit, initialCandidateLimit},
			rows: &generatedFTSCandidateRows{
				prefix: "m-page-1",
				count:  maxFTSCandidatePageLimit,
			},
		},
		{
			mustContain: []string{
				"SELECT " + allColumns + " FROM memories",
				"WHERE id IN (",
				"AND state = ? AND agent_id = ? AND JSON_CONTAINS(tags, ?)",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       secondPageArgs,
			rows: &scriptedRows{
				columns: memoryColumns(),
				values: [][]driver.Value{
					memoryRow("m-page-0-0001", "match one", "agent-1", "session-1", "active", []byte(`["tag-a"]`), now),
					memoryRow("m-page-1-0000", "match two", "agent-1", "session-2", "active", []byte(`["tag-a"]`), now),
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
	if results[0].ID != "m-page-0-0001" || results[1].ID != "m-page-1-0000" {
		t.Fatalf("result IDs = [%s %s], want [m-page-0-0001 m-page-1-0000]", results[0].ID, results[1].ID)
	}
	if results[0].Score == nil || *results[0].Score != 1 {
		t.Fatalf("results[0].Score = %v, want 1", results[0].Score)
	}
	if results[1].Score == nil || *results[1].Score != 10000 {
		t.Fatalf("results[1].Score = %v, want 10000", results[1].Score)
	}
}

func TestSessionFTSSearch_PagesPureFTSBeforePostFilter(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	initialCandidateLimit := 2
	firstPageArgs := append(ftsCandidateArgs("s-page-0", initialCandidateLimit), "active", "agent-1", "sess-1", "chat", `"tag-a"`)
	secondPageArgs := append(ftsCandidateArgs("s-page-1", maxFTSCandidatePageLimit), "active", "agent-1", "sess-1", "chat", `"tag-a"`)
	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain: []string{
				"SELECT id, fts_match_word('golang', content) AS fts_score",
				"FROM sessions",
				"WHERE fts_match_word('golang', content)",
				"ORDER BY fts_match_word('golang', content) DESC, id",
				"LIMIT ? OFFSET ?",
			},
			mustNotContain: []string{
				"state = ?",
				"agent_id = ?",
				"session_id = ?",
				"source = ?",
				"JSON_CONTAINS(tags, ?)",
			},
			wantArgs: []any{initialCandidateLimit, 0},
			rows: &generatedFTSCandidateRows{
				prefix: "s-page-0",
				count:  initialCandidateLimit,
			},
		},
		{
			mustContain: []string{
				"SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at",
				"FROM sessions",
				"WHERE id IN (",
				"AND state = ? AND agent_id = ? AND session_id = ? AND source = ? AND JSON_CONTAINS(tags, ?)",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       firstPageArgs,
			rows: &scriptedRows{
				columns: sessionColumns(),
				values: [][]driver.Value{
					sessionRow("s-page-0-0001", "sess-1", "agent-1", "chat", 1, "user", "match one", []byte(`["tag-a"]`), "active", now),
				},
			},
		},
		{
			mustContain: []string{
				"SELECT id, fts_match_word('golang', content) AS fts_score",
				"FROM sessions",
				"WHERE fts_match_word('golang', content)",
				"ORDER BY fts_match_word('golang', content) DESC, id",
				"LIMIT ? OFFSET ?",
			},
			mustNotContain: []string{
				"state = ?",
				"agent_id = ?",
				"session_id = ?",
				"source = ?",
				"JSON_CONTAINS(tags, ?)",
			},
			wantArgs: []any{maxFTSCandidatePageLimit, initialCandidateLimit},
			rows: &generatedFTSCandidateRows{
				prefix: "s-page-1",
				count:  maxFTSCandidatePageLimit,
			},
		},
		{
			mustContain: []string{
				"SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at",
				"FROM sessions",
				"WHERE id IN (",
				"AND state = ? AND agent_id = ? AND session_id = ? AND source = ? AND JSON_CONTAINS(tags, ?)",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       secondPageArgs,
			rows: &scriptedRows{
				columns: sessionColumns(),
				values: [][]driver.Value{
					sessionRow("s-page-0-0001", "sess-1", "agent-1", "chat", 1, "user", "match one", []byte(`["tag-a"]`), "active", now),
					sessionRow("s-page-1-0000", "sess-1", "agent-1", "chat", 2, "assistant", "match two", []byte(`["tag-a"]`), "active", now),
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
	if results[0].ID != "s-page-0-0001" || results[1].ID != "s-page-1-0000" {
		t.Fatalf("result IDs = [%s %s], want [s-page-0-0001 s-page-1-0000]", results[0].ID, results[1].ID)
	}
	if results[0].Score == nil || *results[0].Score != 1 {
		t.Fatalf("results[0].Score = %v, want 1", results[0].Score)
	}
	if results[1].Score == nil || *results[1].Score != 10000 {
		t.Fatalf("results[1].Score = %v, want 10000", results[1].Score)
	}
}

func TestMemoryFTSSearch_StopsAfterRequestedLimitPageWhenFull(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	candidateArgs := append(ftsCandidateArgs("m-full", 2), "active", "agent-1")
	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain: []string{
				"SELECT id, fts_match_word('golang', content) AS fts_score",
				"FROM memories",
				"WHERE fts_match_word('golang', content)",
				"ORDER BY fts_match_word('golang', content) DESC, id",
				"LIMIT ? OFFSET ?",
			},
			mustNotContain: []string{
				"state = ?",
				"agent_id = ?",
			},
			wantArgs: []any{2, 0},
			rows: &generatedFTSCandidateRows{
				prefix: "m-full",
				count:  2,
			},
		},
		{
			mustContain: []string{
				"SELECT " + allColumns + " FROM memories",
				"WHERE id IN (",
				"AND state = ? AND agent_id = ?",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       candidateArgs,
			rows: &scriptedRows{
				columns: memoryColumns(),
				values: [][]driver.Value{
					memoryRow("m-full-0000", "match one", "agent-1", "session-1", "active", []byte(`[]`), now),
					memoryRow("m-full-0001", "match two", "agent-1", "session-2", "active", []byte(`[]`), now),
				},
			},
		},
	})
	defer db.Close()

	repo := NewMemoryRepo(db, "", true, "cluster-1")
	results, err := repo.FTSSearch(context.Background(), "golang", domain.MemoryFilter{
		State:   "active",
		AgentID: "agent-1",
	}, 2)
	if err != nil {
		t.Fatalf("FTSSearch: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("len(results) = %d, want 2", len(results))
	}
}

func TestSessionFTSSearch_StopsAfterRequestedLimitPageWhenFull(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	candidateArgs := append(ftsCandidateArgs("s-full", 2), "active", "agent-1")
	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain: []string{
				"SELECT id, fts_match_word('golang', content) AS fts_score",
				"FROM sessions",
				"WHERE fts_match_word('golang', content)",
				"ORDER BY fts_match_word('golang', content) DESC, id",
				"LIMIT ? OFFSET ?",
			},
			mustNotContain: []string{
				"state = ?",
				"agent_id = ?",
			},
			wantArgs: []any{2, 0},
			rows: &generatedFTSCandidateRows{
				prefix: "s-full",
				count:  2,
			},
		},
		{
			mustContain: []string{
				"SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at",
				"FROM sessions",
				"WHERE id IN (",
				"AND state = ? AND agent_id = ?",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       candidateArgs,
			rows: &scriptedRows{
				columns: sessionColumns(),
				values: [][]driver.Value{
					sessionRow("s-full-0000", "sess-1", "agent-1", "chat", 1, "user", "match one", []byte(`[]`), "active", now),
					sessionRow("s-full-0001", "sess-2", "agent-1", "chat", 2, "assistant", "match two", []byte(`[]`), "active", now),
				},
			},
		},
	})
	defer db.Close()

	repo := NewSessionRepo(db, "", true, "cluster-1")
	results, err := repo.FTSSearch(context.Background(), "golang", domain.MemoryFilter{
		State:   "active",
		AgentID: "agent-1",
	}, 2)
	if err != nil {
		t.Fatalf("FTSSearch: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("len(results) = %d, want 2", len(results))
	}
}

func TestMemoryFTSSearch_StopsAtCandidatePageLimit(t *testing.T) {
	initialCandidateLimit := 1
	initialCandidateArgs := ftsCandidateArgs("m-cap-initial", initialCandidateLimit)
	expectations := make([]*queryExpectation, 0, 2+maxFTSFallbackPages*2)
	expectations = append(expectations, &queryExpectation{
		mustContain: []string{
			"SELECT id, fts_match_word('golang', content) AS fts_score",
			"FROM memories",
			"WHERE fts_match_word('golang', content)",
			"ORDER BY fts_match_word('golang', content) DESC, id",
			"LIMIT ? OFFSET ?",
		},
		mustNotContain: []string{
			"state = ?",
		},
		wantArgs: []any{initialCandidateLimit, 0},
		rows: &generatedFTSCandidateRows{
			prefix: "m-cap-initial",
			count:  initialCandidateLimit,
		},
	}, &queryExpectation{
		mustContain: []string{
			"SELECT " + allColumns + " FROM memories",
			"WHERE id IN (",
			"AND state = ?",
		},
		mustNotContain: []string{"fts_match_word("},
		wantArgs:       append(initialCandidateArgs, "active"),
		rows: &scriptedRows{
			columns: memoryColumns(),
		},
	})
	for page := 0; page < maxFTSFallbackPages; page++ {
		prefix := fmt.Sprintf("m-cap-%02d", page)
		candidateArgs := ftsCandidateArgs(prefix, maxFTSCandidatePageLimit)
		postFilterArgs := append(candidateArgs, "active")
		offset := initialCandidateLimit + page*maxFTSCandidatePageLimit
		expectations = append(expectations, &queryExpectation{
			mustContain: []string{
				"SELECT id, fts_match_word('golang', content) AS fts_score",
				"FROM memories",
				"WHERE fts_match_word('golang', content)",
				"ORDER BY fts_match_word('golang', content) DESC, id",
				"LIMIT ? OFFSET ?",
			},
			mustNotContain: []string{
				"state = ?",
			},
			wantArgs: []any{maxFTSCandidatePageLimit, offset},
			rows: &generatedFTSCandidateRows{
				prefix: prefix,
				count:  maxFTSCandidatePageLimit,
			},
		}, &queryExpectation{
			mustContain: []string{
				"SELECT " + allColumns + " FROM memories",
				"WHERE id IN (",
				"AND state = ?",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       postFilterArgs,
			rows: &scriptedRows{
				columns: memoryColumns(),
			},
		})
	}
	db := newScriptedTestDB(t, expectations)
	defer db.Close()

	repo := NewMemoryRepo(db, "", true, "cluster-1")
	results, err := repo.FTSSearch(context.Background(), "golang", domain.MemoryFilter{
		State: "active",
	}, initialCandidateLimit)
	if err != nil {
		t.Fatalf("FTSSearch: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("len(results) = %d, want 0", len(results))
	}
}

func TestSessionFTSSearch_StopsAtCandidatePageLimit(t *testing.T) {
	initialCandidateLimit := 1
	initialCandidateArgs := ftsCandidateArgs("s-cap-initial", initialCandidateLimit)
	expectations := make([]*queryExpectation, 0, 2+maxFTSFallbackPages*2)
	expectations = append(expectations, &queryExpectation{
		mustContain: []string{
			"SELECT id, fts_match_word('golang', content) AS fts_score",
			"FROM sessions",
			"WHERE fts_match_word('golang', content)",
			"ORDER BY fts_match_word('golang', content) DESC, id",
			"LIMIT ? OFFSET ?",
		},
		mustNotContain: []string{
			"state = ?",
		},
		wantArgs: []any{initialCandidateLimit, 0},
		rows: &generatedFTSCandidateRows{
			prefix: "s-cap-initial",
			count:  initialCandidateLimit,
		},
	}, &queryExpectation{
		mustContain: []string{
			"SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at",
			"FROM sessions",
			"WHERE id IN (",
			"AND state = ?",
		},
		mustNotContain: []string{"fts_match_word("},
		wantArgs:       append(initialCandidateArgs, "active"),
		rows: &scriptedRows{
			columns: sessionColumns(),
		},
	})
	for page := 0; page < maxFTSFallbackPages; page++ {
		prefix := fmt.Sprintf("s-cap-%02d", page)
		candidateArgs := ftsCandidateArgs(prefix, maxFTSCandidatePageLimit)
		postFilterArgs := append(candidateArgs, "active")
		offset := initialCandidateLimit + page*maxFTSCandidatePageLimit
		expectations = append(expectations, &queryExpectation{
			mustContain: []string{
				"SELECT id, fts_match_word('golang', content) AS fts_score",
				"FROM sessions",
				"WHERE fts_match_word('golang', content)",
				"ORDER BY fts_match_word('golang', content) DESC, id",
				"LIMIT ? OFFSET ?",
			},
			mustNotContain: []string{
				"state = ?",
			},
			wantArgs: []any{maxFTSCandidatePageLimit, offset},
			rows: &generatedFTSCandidateRows{
				prefix: prefix,
				count:  maxFTSCandidatePageLimit,
			},
		}, &queryExpectation{
			mustContain: []string{
				"SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at",
				"FROM sessions",
				"WHERE id IN (",
				"AND state = ?",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       postFilterArgs,
			rows: &scriptedRows{
				columns: sessionColumns(),
			},
		})
	}
	db := newScriptedTestDB(t, expectations)
	defer db.Close()

	repo := NewSessionRepo(db, "", true, "cluster-1")
	results, err := repo.FTSSearch(context.Background(), "golang", domain.MemoryFilter{
		State: "active",
	}, initialCandidateLimit)
	if err != nil {
		t.Fatalf("FTSSearch: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("len(results) = %d, want 0", len(results))
	}
}

type queryExpectation struct {
	mustContain    []string
	mustNotContain []string
	wantArgs       []any
	rows           driver.Rows
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
	return scriptedTx{}, nil
}

func (c *scriptedConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return c.script.query(query, args)
}

type scriptedTx struct{}

func (scriptedTx) Commit() error { return nil }

func (scriptedTx) Rollback() error { return nil }

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

type generatedFTSCandidateRows struct {
	prefix string
	count  int
	index  int
}

func (r *generatedFTSCandidateRows) Columns() []string {
	return []string{"id", "fts_score"}
}

func (r *generatedFTSCandidateRows) Close() error { return nil }

func (r *generatedFTSCandidateRows) Next(dest []driver.Value) error {
	if r.index >= r.count {
		return io.EOF
	}
	dest[0] = fmt.Sprintf("%s-%04d", r.prefix, r.index)
	dest[1] = float64(r.count - r.index)
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

func ftsCandidateArgs(prefix string, count int) []any {
	args := make([]any, count)
	for i := 0; i < count; i++ {
		args[i] = fmt.Sprintf("%s-%04d", prefix, i)
	}
	return args
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
