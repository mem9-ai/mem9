//go:build integration

package tidb

import (
	"context"
	"testing"

	"github.com/google/uuid"
	internaltenant "github.com/qiffang/mnemos/server/internal/tenant"
)

func newLinkRepo() *MemorySessionLinkRepo {
	return NewMemorySessionLinkRepo(testDB)
}

func truncateLinks(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	if _, err := testDB.ExecContext(ctx, "DELETE FROM memory_session_links"); err != nil {
		t.Fatalf("truncate memory_session_links: %v", err)
	}
}

func TestMemorySessionLink_LinkIdempotent(t *testing.T) {
	truncateLinks(t)
	repo := newLinkRepo()
	ctx := context.Background()

	memID := uuid.New().String()
	sesID := uuid.New().String()

	if err := repo.Link(ctx, memID, sesID); err != nil {
		t.Fatalf("first Link: %v", err)
	}
	if err := repo.Link(ctx, memID, sesID); err != nil {
		t.Fatalf("second Link (idempotent): %v", err)
	}

	ids, err := repo.SessionsByMemory(ctx, memID, 0)
	if err != nil {
		t.Fatalf("SessionsByMemory: %v", err)
	}
	if len(ids) != 1 || ids[0] != sesID {
		t.Fatalf("expected [%s], got %v", sesID, ids)
	}
}

func TestMemorySessionLink_MemoriesBySession(t *testing.T) {
	truncateLinks(t)
	repo := newLinkRepo()
	ctx := context.Background()

	sesID := uuid.New().String()
	otherSesID := uuid.New().String()
	mem1 := uuid.New().String()
	mem2 := uuid.New().String()
	mem3 := uuid.New().String()

	for _, m := range []string{mem1, mem2, mem3} {
		if err := repo.Link(ctx, m, sesID); err != nil {
			t.Fatalf("Link %s: %v", m, err)
		}
	}
	if err := repo.Link(ctx, uuid.New().String(), otherSesID); err != nil {
		t.Fatalf("Link other session: %v", err)
	}

	ids, err := repo.MemoriesBySession(ctx, sesID, 0)
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

func TestMemorySessionLink_MemoriesBySession_Limit(t *testing.T) {
	truncateLinks(t)
	repo := newLinkRepo()
	ctx := context.Background()

	sesID := uuid.New().String()
	for i := 0; i < 5; i++ {
		if err := repo.Link(ctx, uuid.New().String(), sesID); err != nil {
			t.Fatalf("Link: %v", err)
		}
	}

	ids, err := repo.MemoriesBySession(ctx, sesID, 3)
	if err != nil {
		t.Fatalf("MemoriesBySession with limit: %v", err)
	}
	if len(ids) != 3 {
		t.Fatalf("expected 3 with limit=3, got %d", len(ids))
	}
}

func TestMemorySessionLink_SessionsByMemory(t *testing.T) {
	truncateLinks(t)
	repo := newLinkRepo()
	ctx := context.Background()

	memID := uuid.New().String()
	ses1 := uuid.New().String()
	ses2 := uuid.New().String()

	if err := repo.Link(ctx, memID, ses1); err != nil {
		t.Fatalf("Link ses1: %v", err)
	}
	if err := repo.Link(ctx, memID, ses2); err != nil {
		t.Fatalf("Link ses2: %v", err)
	}
	if err := repo.Link(ctx, uuid.New().String(), ses1); err != nil {
		t.Fatalf("Link other mem: %v", err)
	}

	ids, err := repo.SessionsByMemory(ctx, memID, 0)
	if err != nil {
		t.Fatalf("SessionsByMemory: %v", err)
	}
	if len(ids) != 2 {
		t.Fatalf("expected 2 sessions, got %d: %v", len(ids), ids)
	}
	if ids[0] != ses1 || ids[1] != ses2 {
		t.Fatalf("expected insertion order [%s %s], got %v", ses1, ses2, ids)
	}
}

func TestMemorySessionLink_EmptyResults(t *testing.T) {
	truncateLinks(t)
	repo := newLinkRepo()
	ctx := context.Background()

	ids, err := repo.MemoriesBySession(ctx, "no-such-session", 0)
	if err != nil {
		t.Fatalf("MemoriesBySession empty: %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("expected empty, got %v", ids)
	}

	ids, err = repo.SessionsByMemory(ctx, "no-such-memory", 0)
	if err != nil {
		t.Fatalf("SessionsByMemory empty: %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("expected empty, got %v", ids)
	}
}

func TestMemorySessionLink_PreMigrationSkip(t *testing.T) {
	ctx := context.Background()

	if _, err := testDB.ExecContext(ctx, "DROP TABLE IF EXISTS memory_session_links"); err != nil {
		t.Fatalf("drop table: %v", err)
	}
	t.Cleanup(func() {
		if _, err := testDB.ExecContext(context.Background(),
			internaltenant.TenantMemorySessionLinksSchema); err != nil {
			t.Logf("recreate memory_session_links after pre-migration test: %v", err)
		}
	})

	repo := NewMemorySessionLinkRepo(testDB)

	if err := repo.Link(ctx, "mem-pre", "ses-pre"); err != nil {
		t.Fatalf("Link on missing table should return nil, got: %v", err)
	}

	ids, err := repo.MemoriesBySession(ctx, "ses-pre", 0)
	if err != nil {
		t.Fatalf("MemoriesBySession on missing table should return nil, got: %v", err)
	}
	if ids != nil {
		t.Fatalf("expected nil ids on missing table, got %v", ids)
	}

	ids, err = repo.SessionsByMemory(ctx, "mem-pre", 0)
	if err != nil {
		t.Fatalf("SessionsByMemory on missing table should return nil, got: %v", err)
	}
	if ids != nil {
		t.Fatalf("expected nil ids on missing table, got %v", ids)
	}
}

func TestMemorySessionLink_EnsureAndLink(t *testing.T) {
	truncateLinks(t)
	repo := newLinkRepo()
	ctx := context.Background()

	memID := uuid.New().String()
	sesID := uuid.New().String()

	if err := repo.Link(ctx, memID, sesID); err != nil {
		t.Fatalf("Link: %v", err)
	}

	ids, err := repo.SessionsByMemory(ctx, memID, 0)
	if err != nil {
		t.Fatalf("SessionsByMemory: %v", err)
	}
	if len(ids) != 1 || ids[0] != sesID {
		t.Fatalf("expected [%s], got %v", sesID, ids)
	}
}
