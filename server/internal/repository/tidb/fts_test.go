package tidb

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestMemoryVectorSearchSelectsSearchColumnsWithoutEmbedding(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	rows := &scriptedRows{
		columns: append(memorySearchColumns(), "distance"),
		values: [][]driver.Value{
			append(memorySearchRow("m-vector-1", "vector match", "agent-1", "session-1", "active", []byte(`[]`), now), float64(0.2)),
		},
	}
	db := newScriptedTestDB(t, []*queryExpectation{{
		mustContain: []string{
			"SELECT " + searchColumns + ", VEC_COSINE_DISTANCE(embedding, ?) AS distance",
			"FROM memories",
			"WHERE state = 'active' AND agent_id = ? AND embedding IS NOT NULL",
			"ORDER BY VEC_COSINE_DISTANCE(embedding, ?)",
			"LIMIT ?",
		},
		mustNotContain: []string{allColumns},
		wantArgs:       []any{"[0.25,0.5]", "agent-1", "[0.25,0.5]", 3},
		rows:           rows,
	}})
	defer db.Close()

	repo := NewMemoryRepo(db, "", true, "cluster-1")
	results, err := repo.VectorSearch(context.Background(), []float32{0.25, 0.5}, domain.MemoryFilter{AgentID: "agent-1"}, 3)
	if err != nil {
		t.Fatalf("VectorSearch: %v", err)
	}
	if len(results) != 1 || results[0].ID != "m-vector-1" {
		t.Fatalf("unexpected VectorSearch results: %+v", results)
	}
	if len(results[0].Embedding) != 0 {
		t.Fatalf("VectorSearch hydrated embedding length = %d, want 0", len(results[0].Embedding))
	}
	if results[0].Score == nil || *results[0].Score < 0.799 || *results[0].Score > 0.801 {
		t.Fatalf("VectorSearch score = %v, want about 0.8", results[0].Score)
	}
}

func TestMemoryAutoVectorSearchSelectsSearchColumnsWithoutEmbedding(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	rows := &scriptedRows{
		columns: append(memorySearchColumns(), "distance"),
		values: [][]driver.Value{
			append(memorySearchRow("m-auto-1", "auto vector match", "agent-1", "session-1", "active", []byte(`[]`), now), float64(0.15)),
		},
	}
	db := newScriptedTestDB(t, []*queryExpectation{{
		mustContain: []string{
			"SELECT " + searchColumns + ", VEC_EMBED_COSINE_DISTANCE(embedding, ?) AS distance",
			"FROM memories",
			"WHERE state = 'active' AND agent_id = ? AND embedding IS NOT NULL",
			"ORDER BY VEC_EMBED_COSINE_DISTANCE(embedding, ?)",
			"LIMIT ?",
		},
		mustNotContain: []string{allColumns},
		wantArgs:       []any{"recall query", "agent-1", "recall query", 2},
		rows:           rows,
	}})
	defer db.Close()

	repo := NewMemoryRepo(db, "test-auto-model", true, "cluster-1")
	results, err := repo.AutoVectorSearch(context.Background(), "recall query", domain.MemoryFilter{AgentID: "agent-1"}, 2)
	if err != nil {
		t.Fatalf("AutoVectorSearch: %v", err)
	}
	if len(results) != 1 || results[0].ID != "m-auto-1" {
		t.Fatalf("unexpected AutoVectorSearch results: %+v", results)
	}
	if len(results[0].Embedding) != 0 {
		t.Fatalf("AutoVectorSearch hydrated embedding length = %d, want 0", len(results[0].Embedding))
	}
	if results[0].Score == nil || *results[0].Score < 0.849 || *results[0].Score > 0.851 {
		t.Fatalf("AutoVectorSearch score = %v, want about 0.85", results[0].Score)
	}
}

func TestMemoryListSelectsSearchColumnsWithoutEmbedding(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain:    []string{"SELECT COUNT(*) FROM memories WHERE state = 'active'"},
			mustNotContain: []string{"embedding"},
			rows: &scriptedRows{
				columns: []string{"COUNT(*)"},
				values:  [][]driver.Value{{int64(1)}},
			},
		},
		{
			mustContain: []string{
				"SELECT " + searchColumns + " FROM memories",
				"WHERE state = 'active'",
				"ORDER BY updated_at DESC, id DESC",
				"LIMIT ? OFFSET ?",
			},
			mustNotContain: []string{allColumns},
			wantArgs:       []any{2, 0},
			rows: &scriptedRows{
				columns: memorySearchColumns(),
				values: [][]driver.Value{
					memorySearchRow("m-list-1", "list match", "agent-1", "session-1", "active", []byte(`[]`), now),
				},
			},
		},
	})
	defer db.Close()

	repo := NewMemoryRepo(db, "", true, "cluster-1")
	results, total, err := repo.List(context.Background(), domain.MemoryFilter{Limit: 2})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 1 || len(results) != 1 || results[0].ID != "m-list-1" {
		t.Fatalf("unexpected List results: total=%d results=%+v", total, results)
	}
	if len(results[0].Embedding) != 0 {
		t.Fatalf("List hydrated embedding length = %d, want 0", len(results[0].Embedding))
	}
}

func TestMemoryListAllTypesMergesBoundedTimeOrderedPages(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	appID := "app-1"
	filterArgs := []any{"active", "agent-1", "sess-1", appID, "chat", `"tag-a"`}
	countArgs := append(append([]any(nil), filterArgs...), filterArgs...)
	pageArgs := append(append([]any(nil), filterArgs...), 5)

	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain: []string{
				"(SELECT COUNT(*) FROM memories WHERE state = ? AND agent_id = ? AND session_id = ? AND app_id = ? AND source = ? AND JSON_CONTAINS(tags, ?))",
				"(SELECT COUNT(*) FROM sessions WHERE state = ? AND agent_id = ? AND session_id = ? AND app_id = ? AND source = ? AND JSON_CONTAINS(tags, ?))",
			},
			mustNotContain: []string{"ALTER TABLE", "CREATE INDEX"},
			wantArgs:       countArgs,
			rows: &scriptedRows{
				columns: []string{"total"},
				values:  [][]driver.Value{{int64(6)}},
			},
		},
		{
			mustContain: []string{
				"SELECT " + searchColumns,
				"FROM memories",
				"ORDER BY updated_at DESC LIMIT ?",
			},
			mustNotContain: []string{
				"embedding", "ALTER TABLE", "CREATE INDEX", "UNION ALL", ", id DESC",
			},
			wantArgs: pageArgs,
			rows: &scriptedRows{
				columns: memorySearchColumns(),
				values: [][]driver.Value{
					memorySearchRow("memory-1", "new durable memory", "agent-1", "sess-1", "active", []byte(`["tag-a"]`), now.Add(-time.Minute)),
					memorySearchRow("memory-2", "older durable memory", "agent-1", "sess-1", "active", []byte(`["tag-a"]`), now.Add(-4*time.Minute)),
					memorySearchRow("memory-3", "oldest durable memory", "agent-1", "sess-1", "active", []byte(`["tag-a"]`), now.Add(-6*time.Minute)),
				},
			},
		},
		{
			mustContain: []string{
				"SELECT id, content, source, tags",
				"JSON_OBJECT('role', COALESCE(role, ''), 'seq', seq, 'content_type', COALESCE(content_type, '')) AS metadata",
				"'session' AS memory_type",
				"FROM sessions",
				"ORDER BY created_at DESC LIMIT ?",
			},
			mustNotContain: []string{
				"embedding", "ALTER TABLE", "CREATE INDEX", "UNION ALL", ", id DESC",
			},
			wantArgs: pageArgs,
			rows: &scriptedRows{
				columns: memorySearchColumns(),
				values: [][]driver.Value{
					{
						"session-1", "newest raw turn", "chat", []byte(`["tag-a"]`),
						[]byte(`{"role":"assistant","seq":1,"content_type":"text"}`), string(domain.TypeSession),
						"agent-1", "sess-1", appID, "active", int64(0), nil, now, now, nil,
					},
					{
						"session-2", "middle raw turn", "chat", []byte(`["tag-a"]`),
						[]byte(`{"role":"assistant","seq":2,"content_type":"text"}`), string(domain.TypeSession),
						"agent-1", "sess-1", appID, "active", int64(0), nil,
						now.Add(-2 * time.Minute), now.Add(-2 * time.Minute), nil,
					},
					{
						"session-3", "older raw turn", "chat", []byte(`["tag-a"]`),
						[]byte(`{"role":"user","seq":3,"content_type":"text"}`), string(domain.TypeSession),
						"agent-1", "sess-1", appID, "active", int64(0), nil,
						now.Add(-3 * time.Minute), now.Add(-3 * time.Minute), nil,
					},
				},
			},
		},
	})
	defer db.Close()

	repo := NewMemoryRepo(db, "", true, "cluster-1")
	memories, total, err := repo.ListAllTypes(context.Background(), domain.MemoryFilter{
		State:     "active",
		AgentID:   "agent-1",
		SessionID: "sess-1",
		AppID:     &appID,
		Source:    "chat",
		Tags:      []string{"tag-a"},
		Limit:     2,
		Offset:    3,
	})
	if err != nil {
		t.Fatalf("ListAllTypes: %v", err)
	}
	if total != 6 || len(memories) != 2 {
		t.Fatalf("page = total:%d memories:%+v, want 6/2", total, memories)
	}
	if memories[0].ID != "session-3" || memories[0].MemoryType != domain.TypeSession {
		t.Fatalf("first memory = %+v, want session-3", memories[0])
	}
	if memories[1].ID != "memory-2" {
		t.Fatalf("second memory = %+v, want memory-2", memories[1])
	}
	var metadata map[string]any
	if err := json.Unmarshal(memories[0].Metadata, &metadata); err != nil {
		t.Fatalf("decode session metadata: %v", err)
	}
	if metadata["role"] != "user" || metadata["seq"] != float64(3) || metadata["content_type"] != "text" {
		t.Fatalf("session metadata = %#v", metadata)
	}
}

func TestMemoryListAllTypesMergesAscendingPages(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain: []string{
				"(SELECT COUNT(*) FROM memories WHERE state = 'active')",
				"(SELECT COUNT(*) FROM sessions WHERE state = 'active')",
			},
			rows: &scriptedRows{
				columns: []string{"total"},
				values:  [][]driver.Value{{int64(4)}},
			},
		},
		{
			mustContain: []string{
				"SELECT " + searchColumns,
				"FROM memories",
				"ORDER BY updated_at ASC LIMIT ?",
			},
			mustNotContain: []string{", id ASC"},
			wantArgs:       []any{3},
			rows: &scriptedRows{
				columns: memorySearchColumns(),
				values: [][]driver.Value{
					memorySearchRow("memory-1", "oldest durable", "", "", "active", []byte(`[]`), now.Add(-4*time.Minute)),
					memorySearchRow("memory-2", "new durable", "", "", "active", []byte(`[]`), now.Add(-time.Minute)),
				},
			},
		},
		{
			mustContain: []string{
				"FROM sessions",
				"ORDER BY created_at ASC LIMIT ?",
			},
			mustNotContain: []string{", id ASC"},
			wantArgs:       []any{3},
			rows: &scriptedRows{
				columns: memorySearchColumns(),
				values: [][]driver.Value{
					{
						"session-1", "older raw turn", "", []byte(`[]`), []byte(`{}`), string(domain.TypeSession),
						"", "", "", "active", int64(0), nil,
						now.Add(-3 * time.Minute), now.Add(-3 * time.Minute), nil,
					},
					{
						"session-2", "newer raw turn", "", []byte(`[]`), []byte(`{}`), string(domain.TypeSession),
						"", "", "", "active", int64(0), nil,
						now.Add(-2 * time.Minute), now.Add(-2 * time.Minute), nil,
					},
				},
			},
		},
	})
	defer db.Close()

	repo := NewMemoryRepo(db, "", true, "cluster-1")
	memories, total, err := repo.ListAllTypes(context.Background(), domain.MemoryFilter{
		Limit:   2,
		Offset:  1,
		SortDir: "asc",
	})
	if err != nil {
		t.Fatalf("ListAllTypes: %v", err)
	}
	if total != 4 || len(memories) != 2 {
		t.Fatalf("page = total:%d memories:%+v, want 4/2", total, memories)
	}
	if memories[0].ID != "session-1" || memories[1].ID != "session-2" {
		t.Fatalf("memories = %+v, want session-1/session-2", memories)
	}
}

func TestMemoryListAllTypesFallsBackWhenSessionsTableIsMissing(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain: []string{
				"(SELECT COUNT(*) FROM memories WHERE state = 'active')",
				"(SELECT COUNT(*) FROM sessions WHERE state = 'active')",
			},
			err: &mysql.MySQLError{Number: 1146, Message: "Table doesn't exist"},
		},
		{
			mustContain: []string{"SELECT COUNT(*) FROM memories WHERE state = 'active'"},
			rows: &scriptedRows{
				columns: []string{"COUNT(*)"},
				values:  [][]driver.Value{{int64(1)}},
			},
		},
		{
			mustContain: []string{
				"SELECT " + searchColumns + " FROM memories",
				"ORDER BY updated_at DESC, id DESC",
				"LIMIT ? OFFSET ?",
			},
			wantArgs: []any{1, 0},
			rows: &scriptedRows{
				columns: memorySearchColumns(),
				values: [][]driver.Value{
					memorySearchRow("memory-1", "durable memory", "agent-1", "sess-1", "active", []byte(`[]`), now),
				},
			},
		},
	})
	defer db.Close()

	repo := NewMemoryRepo(db, "", true, "cluster-1")
	memories, total, err := repo.ListAllTypes(context.Background(), domain.MemoryFilter{Limit: 1})
	if err != nil {
		t.Fatalf("ListAllTypes: %v", err)
	}
	if total != 1 || len(memories) != 1 || memories[0].ID != "memory-1" {
		t.Fatalf("page = total:%d memories:%+v, want durable fallback", total, memories)
	}
}

func TestMemoryListBootstrapSelectsSearchColumnsWithoutEmbedding(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	db := newScriptedTestDB(t, []*queryExpectation{{
		mustContain: []string{
			"SELECT " + searchColumns + " FROM memories",
			"WHERE state = 'active'",
			"ORDER BY updated_at DESC",
			"LIMIT ?",
		},
		mustNotContain: []string{allColumns},
		wantArgs:       []any{3},
		rows: &scriptedRows{
			columns: memorySearchColumns(),
			values: [][]driver.Value{
				memorySearchRow("m-bootstrap-1", "bootstrap match", "agent-1", "session-1", "active", []byte(`[]`), now),
			},
		},
	}})
	defer db.Close()

	repo := NewMemoryRepo(db, "", true, "cluster-1")
	results, err := repo.ListBootstrap(context.Background(), 3)
	if err != nil {
		t.Fatalf("ListBootstrap: %v", err)
	}
	if len(results) != 1 || results[0].ID != "m-bootstrap-1" {
		t.Fatalf("unexpected ListBootstrap results: %+v", results)
	}
	if len(results[0].Embedding) != 0 {
		t.Fatalf("ListBootstrap hydrated embedding length = %d, want 0", len(results[0].Embedding))
	}
}

func TestMemoryGetEmbeddingsByIDSelectsOnlyEmbedding(t *testing.T) {
	db := newScriptedTestDB(t, []*queryExpectation{{
		mustContain: []string{
			"SELECT id, embedding FROM memories",
			"WHERE id IN (?,?)",
			"state = 'active'",
			"embedding IS NOT NULL",
		},
		mustNotContain: []string{"content", "metadata", "memory_type"},
		wantArgs:       []any{"m-1", "m-2"},
		rows: &scriptedRows{
			columns: []string{"id", "embedding"},
			values: [][]driver.Value{
				{"m-1", []byte("[0.1,0.2]")},
				{"m-2", []byte("[0.3,0.4]")},
			},
		},
	}})
	defer db.Close()

	repo := NewMemoryRepo(db, "", true, "cluster-1")
	embeddings, err := repo.GetEmbeddingsByID(context.Background(), []string{"m-1", "m-2"})
	if err != nil {
		t.Fatalf("GetEmbeddingsByID: %v", err)
	}
	if len(embeddings) != 2 {
		t.Fatalf("len(embeddings) = %d, want 2", len(embeddings))
	}
	if got := embeddings["m-1"]; len(got) != 2 || got[0] != 0.1 || got[1] != 0.2 {
		t.Fatalf("embedding m-1 = %v, want [0.1 0.2]", got)
	}
	if got := embeddings["m-2"]; len(got) != 2 || got[0] != 0.3 || got[1] != 0.4 {
		t.Fatalf("embedding m-2 = %v, want [0.3 0.4]", got)
	}
}

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
				"SELECT " + searchColumns + " FROM memories",
				"WHERE id IN (",
				"AND state = ? AND agent_id = ? AND JSON_CONTAINS(tags, ?)",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       firstPageArgs,
			rows: &scriptedRows{
				columns: memorySearchColumns(),
				values: [][]driver.Value{
					memorySearchRow("m-page-0-0001", "match one", "agent-1", "session-1", "active", []byte(`["tag-a"]`), now),
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
				"SELECT " + searchColumns + " FROM memories",
				"WHERE id IN (",
				"AND state = ? AND agent_id = ? AND JSON_CONTAINS(tags, ?)",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       secondPageArgs,
			rows: &scriptedRows{
				columns: memorySearchColumns(),
				values: [][]driver.Value{
					memorySearchRow("m-page-0-0001", "match one", "agent-1", "session-1", "active", []byte(`["tag-a"]`), now),
					memorySearchRow("m-page-1-0000", "match two", "agent-1", "session-2", "active", []byte(`["tag-a"]`), now),
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
				"SELECT id, session_id, agent_id, app_id, source, seq, role, content, content_type, tags, state, created_at",
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
				"SELECT id, session_id, agent_id, app_id, source, seq, role, content, content_type, tags, state, created_at",
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
				"SELECT " + searchColumns + " FROM memories",
				"WHERE id IN (",
				"AND state = ? AND agent_id = ?",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       candidateArgs,
			rows: &scriptedRows{
				columns: memorySearchColumns(),
				values: [][]driver.Value{
					memorySearchRow("m-full-0000", "match one", "agent-1", "session-1", "active", []byte(`[]`), now),
					memorySearchRow("m-full-0001", "match two", "agent-1", "session-2", "active", []byte(`[]`), now),
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
				"SELECT id, session_id, agent_id, app_id, source, seq, role, content, content_type, tags, state, created_at",
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
			"SELECT " + searchColumns + " FROM memories",
			"WHERE id IN (",
			"AND state = ?",
		},
		mustNotContain: []string{"fts_match_word("},
		wantArgs:       append(initialCandidateArgs, "active"),
		rows: &scriptedRows{
			columns: memorySearchColumns(),
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
				"SELECT " + searchColumns + " FROM memories",
				"WHERE id IN (",
				"AND state = ?",
			},
			mustNotContain: []string{"fts_match_word("},
			wantArgs:       postFilterArgs,
			rows: &scriptedRows{
				columns: memorySearchColumns(),
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
			"SELECT id, session_id, agent_id, app_id, source, seq, role, content, content_type, tags, state, created_at",
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
				"SELECT id, session_id, agent_id, app_id, source, seq, role, content, content_type, tags, state, created_at",
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

func memorySearchColumns() []string {
	return []string{
		"id", "content", "source", "tags", "metadata", "memory_type", "agent_id",
		"session_id", "app_id", "state", "version", "updated_by", "created_at", "updated_at", "superseded_by",
	}
}

func memorySearchRow(id, content, agentID, sessionID, state string, tags []byte, ts time.Time) []driver.Value {
	return []driver.Value{
		id,
		content,
		"chat",
		tags,
		[]byte(`{"k":"v"}`),
		string(domain.TypeInsight),
		agentID,
		sessionID,
		"",
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
		"id", "session_id", "agent_id", "app_id", "source", "seq", "role", "content", "content_type", "tags", "state", "created_at",
	}
}

func sessionRow(id, sessionID, agentID, source string, seq int64, role, content string, tags []byte, state string, ts time.Time) []driver.Value {
	return []driver.Value{
		id,
		sessionID,
		agentID,
		"",
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
