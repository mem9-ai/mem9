//go:build integration

package tidb

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestSessionRepo_BulkCreateSeedsAllocatorFromExistingMaxSeq(t *testing.T) {
	ctx := context.Background()

	if _, err := testDB.ExecContext(ctx, "DELETE FROM session_sequences"); err != nil {
		t.Fatalf("truncate session_sequences: %v", err)
	}
	if _, err := testDB.ExecContext(ctx, "DELETE FROM sessions"); err != nil {
		t.Fatalf("truncate sessions: %v", err)
	}

	repo := NewSessionRepo(testDB, "", false, "test-cluster")

	if _, err := testDB.ExecContext(ctx,
		`INSERT INTO sessions (id, session_id, agent_id, source, seq, role, content, content_type, content_hash, tags, state, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'active', NOW(), NOW())`,
		uuid.NewString(), "sess-upgrade", "agent", "source", 10, "user", "historic turn", "text", "historic-hash",
	); err != nil {
		t.Fatalf("insert historic session row: %v", err)
	}

	if err := repo.BulkCreate(ctx, []*domain.Session{
		{
			ID:          uuid.NewString(),
			SessionID:   "sess-upgrade",
			AgentID:     "agent",
			Source:      "source",
			Seq:         1,
			Role:        "assistant",
			Content:     "overlapping replay turn",
			ContentType: "text",
			ContentHash: "replay-hash",
			Tags:        []string{},
			State:       domain.StateActive,
		},
	}); err != nil {
		t.Fatalf("BulkCreate: %v", err)
	}

	nextSeq, err := repo.NextSeq(ctx, "sess-upgrade")
	if err != nil {
		t.Fatalf("NextSeq: %v", err)
	}
	if nextSeq != 11 {
		t.Fatalf("expected allocator to seed from existing max seq 10, got %d", nextSeq)
	}
}
