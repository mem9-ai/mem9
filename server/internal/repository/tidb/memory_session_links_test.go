//go:build integration

package tidb

import (
	"context"
	"testing"

	"github.com/google/uuid"
	internaltenant "github.com/qiffang/mnemos/server/internal/tenant"
)

func newTestMemorySessionLinkRepo() *MemorySessionLinkRepo {
	return NewMemorySessionLinkRepo(testDB)
}

func truncateMemorySessionLinks(t *testing.T) {
	t.Helper()
	if _, err := testDB.ExecContext(context.Background(), "DELETE FROM memory_session_links"); err != nil {
		t.Fatalf("truncate memory_session_links: %v", err)
	}
}

func TestMemorySessionLink_LinkIdempotent(t *testing.T) {
	truncateMemorySessionLinks(t)
	repo := newTestMemorySessionLinkRepo()
	ctx := context.Background()

	memID := uuid.New().String()
	sessionID := uuid.New().String()

	if err := repo.Link(ctx, memID, sessionID); err != nil {
		t.Fatalf("first Link: %v", err)
	}
	if err := repo.Link(ctx, memID, sessionID); err != nil {
		t.Fatalf("second Link: %v", err)
	}

	ids, err := repo.SessionsByMemory(ctx, memID, 0)
	if err != nil {
		t.Fatalf("SessionsByMemory: %v", err)
	}
	if len(ids) != 1 || ids[0] != sessionID {
		t.Fatalf("expected [%s], got %v", sessionID, ids)
	}
}

func TestMemorySessionLink_MemoriesBySession(t *testing.T) {
	truncateMemorySessionLinks(t)
	repo := newTestMemorySessionLinkRepo()
	ctx := context.Background()

	sessionID := uuid.New().String()
	mem1 := uuid.New().String()
	mem2 := uuid.New().String()
	mem3 := uuid.New().String()

	for _, memID := range []string{mem1, mem2, mem3} {
		if err := repo.Link(ctx, memID, sessionID); err != nil {
			t.Fatalf("Link %s: %v", memID, err)
		}
	}
	if err := repo.Link(ctx, uuid.New().String(), uuid.New().String()); err != nil {
		t.Fatalf("Link other session: %v", err)
	}

	ids, err := repo.MemoriesBySession(ctx, sessionID, 0)
	if err != nil {
		t.Fatalf("MemoriesBySession: %v", err)
	}
	if len(ids) != 3 {
		t.Fatalf("expected 3 IDs, got %d: %v", len(ids), ids)
	}
	if ids[0] != mem1 || ids[1] != mem2 || ids[2] != mem3 {
		t.Fatalf("expected insertion order [%s %s %s], got %v", mem1, mem2, mem3, ids)
	}
}

func TestMemorySessionLink_MemoriesBySessionLimit(t *testing.T) {
	truncateMemorySessionLinks(t)
	repo := newTestMemorySessionLinkRepo()
	ctx := context.Background()

	sessionID := uuid.New().String()
	for i := 0; i < 5; i++ {
		if err := repo.Link(ctx, uuid.New().String(), sessionID); err != nil {
			t.Fatalf("Link: %v", err)
		}
	}

	ids, err := repo.MemoriesBySession(ctx, sessionID, 3)
	if err != nil {
		t.Fatalf("MemoriesBySession with limit: %v", err)
	}
	if len(ids) != 3 {
		t.Fatalf("expected 3 IDs with limit=3, got %d", len(ids))
	}
}

func TestMemorySessionLink_SessionsByMemory(t *testing.T) {
	truncateMemorySessionLinks(t)
	repo := newTestMemorySessionLinkRepo()
	ctx := context.Background()

	memID := uuid.New().String()
	session1 := uuid.New().String()
	session2 := uuid.New().String()

	if err := repo.Link(ctx, memID, session1); err != nil {
		t.Fatalf("Link session1: %v", err)
	}
	if err := repo.Link(ctx, memID, session2); err != nil {
		t.Fatalf("Link session2: %v", err)
	}
	if err := repo.Link(ctx, uuid.New().String(), session1); err != nil {
		t.Fatalf("Link other memory: %v", err)
	}

	ids, err := repo.SessionsByMemory(ctx, memID, 0)
	if err != nil {
		t.Fatalf("SessionsByMemory: %v", err)
	}
	if len(ids) != 2 {
		t.Fatalf("expected 2 sessions, got %d: %v", len(ids), ids)
	}
	if ids[0] != session1 || ids[1] != session2 {
		t.Fatalf("expected insertion order [%s %s], got %v", session1, session2, ids)
	}
}

func TestMemorySessionLink_PreMigrationSkip(t *testing.T) {
	ctx := context.Background()

	if _, err := testDB.ExecContext(ctx, "DROP TABLE IF EXISTS memory_session_links"); err != nil {
		t.Fatalf("drop table: %v", err)
	}
	t.Cleanup(func() {
		if _, err := testDB.ExecContext(context.Background(), internaltenant.TenantMemorySessionLinksSchema); err != nil {
			t.Logf("recreate memory_session_links after pre-migration test: %v", err)
		}
	})

	repo := NewMemorySessionLinkRepo(testDB)
	if err := repo.Link(ctx, "mem-pre", "session-pre"); err != nil {
		t.Fatalf("Link on missing table should return nil, got: %v", err)
	}

	ids, err := repo.MemoriesBySession(ctx, "session-pre", 0)
	if err != nil {
		t.Fatalf("MemoriesBySession on missing table should return nil error, got: %v", err)
	}
	if ids != nil {
		t.Fatalf("expected nil ids on missing table, got %v", ids)
	}

	ids, err = repo.SessionsByMemory(ctx, "mem-pre", 0)
	if err != nil {
		t.Fatalf("SessionsByMemory on missing table should return nil error, got: %v", err)
	}
	if ids != nil {
		t.Fatalf("expected nil ids on missing table, got %v", ids)
	}
}
