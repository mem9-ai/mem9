package tidb

import (
	"database/sql"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

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
