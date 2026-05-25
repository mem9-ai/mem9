package tidb

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestSessionRepoListFiltersAndPaginates(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain: []string{
				"SELECT COUNT(*) FROM sessions WHERE state = ? AND agent_id = ? AND session_id = ? AND source = ? AND JSON_CONTAINS(tags, ?)",
			},
			wantArgs: []any{"active", "agent-1", "sess-1", "chat", `"tag-a"`},
			rows: &scriptedRows{
				columns: []string{"COUNT(*)"},
				values:  [][]driver.Value{{int64(2)}},
			},
		},
		{
			mustContain: []string{
				"SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at",
				"FROM sessions WHERE state = ? AND agent_id = ? AND session_id = ? AND source = ? AND JSON_CONTAINS(tags, ?)",
				"ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
			},
			wantArgs: []any{"active", "agent-1", "sess-1", "chat", `"tag-a"`, int64(10), int64(20)},
			rows: &scriptedRows{
				columns: sessionColumns(),
				values: [][]driver.Value{
					sessionRow("s-2", "sess-1", "agent-1", "chat", 2, "assistant", "second", []byte(`["tag-a"]`), "active", now),
				},
			},
		},
	})
	defer db.Close()

	repo := NewSessionRepo(db, "", false, "cluster-1")
	memories, total, err := repo.List(context.Background(), domain.MemoryFilter{
		State:     "active",
		AgentID:   "agent-1",
		SessionID: "sess-1",
		Source:    "chat",
		Tags:      []string{"tag-a"},
		Limit:     10,
		Offset:    20,
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 2 {
		t.Fatalf("total = %d, want 2", total)
	}
	if len(memories) != 1 || memories[0].ID != "s-2" || memories[0].MemoryType != domain.TypeSession {
		t.Fatalf("memories = %+v, want session s-2", memories)
	}
}

func TestSessionRepoGetByIDMissingTableReturnsNotFound(t *testing.T) {
	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain: []string{
				"SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at",
				"FROM sessions WHERE id = ? AND state = 'active'",
			},
			wantArgs: []any{"missing-session-row"},
			err:      &mysql.MySQLError{Number: 1146, Message: "Table doesn't exist"},
		},
	})
	defer db.Close()

	repo := NewSessionRepo(db, "", false, "cluster-1")
	_, err := repo.GetByID(context.Background(), "missing-session-row")
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("GetByID error = %v, want ErrNotFound", err)
	}
}

func TestSessionRepoSoftDeleteMissingTableReturnsNotFound(t *testing.T) {
	db := newScriptedTestDB(t, []*queryExpectation{
		{
			mustContain: []string{
				"SELECT state FROM sessions WHERE id = ? FOR UPDATE",
			},
			wantArgs: []any{"missing-session-row"},
			err:      &mysql.MySQLError{Number: 1146, Message: "Table doesn't exist"},
		},
	})
	defer db.Close()

	repo := NewSessionRepo(db, "", false, "cluster-1")
	deleted, err := repo.SoftDelete(context.Background(), "missing-session-row", "agent-1")
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("SoftDelete error = %v, want ErrNotFound", err)
	}
	if deleted != 0 {
		t.Fatalf("deleted = %d, want 0", deleted)
	}
}

func TestFillSessionMemory_SetsMemoryType(t *testing.T) {
	var m domain.Memory
	result := fillSessionMemory(
		&m,
		sql.NullString{String: "sess-1", Valid: true},
		sql.NullString{String: "agent-a", Valid: true},
		sql.NullString{String: "src", Valid: true},
		sql.NullString{String: "user", Valid: true},
		sql.NullString{String: "text", Valid: true},
		0,
		[]byte(`[]`),
		sql.NullString{String: "active", Valid: true},
		time.Now(),
	)
	if result.MemoryType != domain.TypeSession {
		t.Errorf("MemoryType = %q, want %q", result.MemoryType, domain.TypeSession)
	}
}

func TestFillSessionMemory_PopulatesFields(t *testing.T) {
	var m domain.Memory
	now := time.Now().Truncate(time.Second)
	result := fillSessionMemory(
		&m,
		sql.NullString{String: "sess-1", Valid: true},
		sql.NullString{String: "agent-a", Valid: true},
		sql.NullString{String: "src", Valid: true},
		sql.NullString{String: "user", Valid: true},
		sql.NullString{String: "text", Valid: true},
		3,
		[]byte(`["tag1"]`),
		sql.NullString{String: "active", Valid: true},
		now,
	)
	if result.SessionID != "sess-1" {
		t.Errorf("SessionID = %q, want %q", result.SessionID, "sess-1")
	}
	if result.AgentID != "agent-a" {
		t.Errorf("AgentID = %q, want %q", result.AgentID, "agent-a")
	}
	if result.State != domain.StateActive {
		t.Errorf("State = %q, want %q", result.State, domain.StateActive)
	}
	if len(result.Tags) != 1 || result.Tags[0] != "tag1" {
		t.Errorf("Tags = %v, want [tag1]", result.Tags)
	}
	if result.UpdatedAt != now {
		t.Errorf("UpdatedAt = %v, want %v", result.UpdatedAt, now)
	}
}
