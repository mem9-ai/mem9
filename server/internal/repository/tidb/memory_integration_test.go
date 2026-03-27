//go:build integration

package tidb

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestCreate(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	m := newTestMemory()
	if err := repo.Create(ctx, m); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := repo.GetByID(ctx, m.ID)
	if err != nil {
		t.Fatalf("GetByID after Create: %v", err)
	}
	if got.Content != m.Content {
		t.Fatalf("content mismatch: got %q want %q", got.Content, m.Content)
	}
	if got.Source != m.Source {
		t.Fatalf("source mismatch: got %q want %q", got.Source, m.Source)
	}
	if got.MemoryType != domain.TypePinned {
		t.Fatalf("memory_type mismatch: got %q want %q", got.MemoryType, domain.TypePinned)
	}
	if got.State != domain.StateActive {
		t.Fatalf("state mismatch: got %q want %q", got.State, domain.StateActive)
	}
	if got.Version != 1 {
		t.Fatalf("version mismatch: got %d want 1", got.Version)
	}
}

func TestCreateDuplicateID(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	m := newTestMemory()
	if err := repo.Create(ctx, m); err != nil {
		t.Fatalf("first Create: %v", err)
	}
	// Same ID should fail.
	err := repo.Create(ctx, m)
	if err == nil {
		t.Fatal("expected error on duplicate ID")
	}
}

func TestGetByID(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	// Non-existent.
	_, err := repo.GetByID(ctx, "nonexistent-id")
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}

	// Create and retrieve.
	m := newTestMemory()
	if err := repo.Create(ctx, m); err != nil {
		t.Fatalf("Create: %v", err)
	}
	got, err := repo.GetByID(ctx, m.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.ID != m.ID {
		t.Fatalf("ID mismatch: got %q want %q", got.ID, m.ID)
	}
}

func TestGetByIDDeletedState(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	m := newTestMemory()
	if err := repo.Create(ctx, m); err != nil {
		t.Fatalf("Create: %v", err)
	}
	// Soft delete.
	if _, err := repo.SoftDelete(ctx, m.ID, "test-agent"); err != nil {
		t.Fatalf("SoftDelete: %v", err)
	}
	// GetByID filters state='active', so deleted should return ErrNotFound.
	_, err := repo.GetByID(ctx, m.ID)
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for deleted memory, got %v", err)
	}
}

func TestUpdateOptimistic(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	m := newTestMemory()
	if err := repo.Create(ctx, m); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Update without version check (expectedVersion=0).
	m.Content = "updated content"
	m.UpdatedBy = "updater"
	if err := repo.UpdateOptimistic(ctx, m, 0); err != nil {
		t.Fatalf("UpdateOptimistic: %v", err)
	}

	got, err := repo.GetByID(ctx, m.ID)
	if err != nil {
		t.Fatalf("GetByID after update: %v", err)
	}
	if got.Content != "updated content" {
		t.Fatalf("content not updated: got %q", got.Content)
	}
	if got.Version != 2 {
		t.Fatalf("version not incremented: got %d want 2", got.Version)
	}

	// Update with wrong version — should return ErrNotFound (0 rows affected).
	m.Content = "should fail"
	err = repo.UpdateOptimistic(ctx, m, 999)
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for version mismatch, got %v", err)
	}
}

func TestSoftDelete(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	m := newTestMemory()
	if err := repo.Create(ctx, m); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if _, err := repo.SoftDelete(ctx, m.ID, "deleter"); err != nil {
		t.Fatalf("SoftDelete: %v", err)
	}

	// Verify state is deleted (query directly since GetByID filters active only).
	var state string
	err := testDB.QueryRowContext(ctx, "SELECT state FROM memories WHERE id = ?", m.ID).Scan(&state)
	if err != nil {
		t.Fatalf("query state: %v", err)
	}
	if state != "deleted" {
		t.Fatalf("state mismatch: got %q want deleted", state)
	}

	if _, err := repo.SoftDelete(ctx, m.ID, "deleter"); err != nil {
		t.Fatalf("idempotent SoftDelete: %v", err)
	}

	// Non-existent.
	_, err = repo.SoftDelete(ctx, "nonexistent-id", "agent")
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for nonexistent delete, got %v", err)
	}
}

func TestArchiveMemory(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	m := newTestMemory()
	if err := repo.Create(ctx, m); err != nil {
		t.Fatalf("Create: %v", err)
	}

	supersededBy := uuid.New().String()
	if err := repo.ArchiveMemory(ctx, m.ID, supersededBy); err != nil {
		t.Fatalf("ArchiveMemory: %v", err)
	}

	// Verify state and superseded_by directly.
	var state, superseded string
	err := testDB.QueryRowContext(ctx,
		"SELECT state, superseded_by FROM memories WHERE id = ?", m.ID).
		Scan(&state, &superseded)
	if err != nil {
		t.Fatalf("query archived: %v", err)
	}
	if state != "archived" {
		t.Fatalf("state mismatch: got %q want archived", state)
	}
	if superseded != supersededBy {
		t.Fatalf("superseded_by mismatch: got %q want %q", superseded, supersededBy)
	}
}

func TestSetState(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	m := newTestMemory()
	if err := repo.Create(ctx, m); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// active → paused should succeed (SetState only transitions from active).
	if err := repo.SetState(ctx, m.ID, domain.StatePaused); err != nil {
		t.Fatalf("SetState(paused): %v", err)
	}

	// paused → deleted should fail — row is not active.
	if err := repo.SetState(ctx, m.ID, domain.StateDeleted); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("SetState on non-active row: got %v, want ErrNotFound", err)
	}

	// Reset to active via raw SQL so we can test more transitions.
	if _, err := testDB.ExecContext(ctx, "UPDATE memories SET state = 'active' WHERE id = ?", m.ID); err != nil {
		t.Fatalf("reset state: %v", err)
	}

	// active → archived should succeed.
	if err := repo.SetState(ctx, m.ID, domain.StateArchived); err != nil {
		t.Fatalf("SetState(archived): %v", err)
	}

	// archived → deleted should fail — row is not active.
	if err := repo.SetState(ctx, m.ID, domain.StateDeleted); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("SetState on archived row: got %v, want ErrNotFound", err)
	}

	// Non-existent ID should return ErrNotFound.
	if err := repo.SetState(ctx, "nonexistent-id", domain.StateDeleted); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("SetState on missing ID: got %v, want ErrNotFound", err)
	}
}

func TestList(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	// Create 5 memories with varied attributes.
	mems := []*domain.Memory{
		newTestMemory(func(m *domain.Memory) {
			m.MemoryType = domain.TypePinned
			m.AgentID = "agent-a"
			m.SessionID = "sess-1"
			m.Source = "src-a"
			m.Tags = []string{"go", "backend"}
		}),
		newTestMemory(func(m *domain.Memory) {
			m.MemoryType = domain.TypeInsight
			m.AgentID = "agent-a"
			m.SessionID = "sess-1"
			m.Source = "src-a"
			m.Tags = []string{"go"}
		}),
		newTestMemory(func(m *domain.Memory) {
			m.MemoryType = domain.TypeInsight
			m.AgentID = "agent-b"
			m.SessionID = "sess-2"
			m.Source = "src-b"
			m.Tags = []string{"python"}
		}),
		newTestMemory(func(m *domain.Memory) {
			m.MemoryType = domain.TypeInsight
			m.AgentID = "agent-b"
			m.SessionID = "sess-2"
			m.Source = "src-a"
			m.Tags = []string{"go", "python"}
		}),
		newTestMemory(func(m *domain.Memory) {
			m.MemoryType = domain.TypePinned
			m.AgentID = "agent-c"
			m.SessionID = "sess-3"
			m.Source = "src-c"
			m.Tags = []string{"rust"}
		}),
	}
	for _, m := range mems {
		if err := repo.Create(ctx, m); err != nil {
			t.Fatalf("Create: %v", err)
		}
		// Small sleep so updated_at differs for ordering tests.
		time.Sleep(10 * time.Millisecond)
	}

	t.Run("all active", func(t *testing.T) {
		result, total, err := repo.List(ctx, domain.MemoryFilter{Limit: 50})
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if total != 5 {
			t.Fatalf("total mismatch: got %d want 5", total)
		}
		if len(result) != 5 {
			t.Fatalf("result len mismatch: got %d want 5", len(result))
		}
	})

	t.Run("filter by memory_type", func(t *testing.T) {
		result, total, err := repo.List(ctx, domain.MemoryFilter{
			MemoryType: "insight",
			Limit:      50,
		})
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if total != 2 {
			t.Fatalf("total mismatch: got %d want 2", total)
		}
		for _, m := range result {
			if m.MemoryType != domain.TypeInsight {
				t.Fatalf("unexpected type: %s", m.MemoryType)
			}
		}
	})

	t.Run("filter by agent_id", func(t *testing.T) {
		result, _, err := repo.List(ctx, domain.MemoryFilter{
			AgentID: "agent-b",
			Limit:   50,
		})
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if len(result) != 2 {
			t.Fatalf("result len mismatch: got %d want 2", len(result))
		}
	})

	t.Run("filter by session_id", func(t *testing.T) {
		result, _, err := repo.List(ctx, domain.MemoryFilter{
			SessionID: "sess-2",
			Limit:     50,
		})
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if len(result) != 2 {
			t.Fatalf("result len mismatch: got %d want 2", len(result))
		}
	})

	t.Run("filter by source", func(t *testing.T) {
		result, _, err := repo.List(ctx, domain.MemoryFilter{
			Source: "src-a",
			Limit:  50,
		})
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if len(result) != 3 {
			t.Fatalf("result len mismatch: got %d want 3", len(result))
		}
	})

	t.Run("filter by tags", func(t *testing.T) {
		result, _, err := repo.List(ctx, domain.MemoryFilter{
			Tags:  []string{"go"},
			Limit: 50,
		})
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if len(result) != 3 {
			t.Fatalf("result len mismatch: got %d want 3 (for tag 'go')", len(result))
		}
	})

	t.Run("pagination", func(t *testing.T) {
		page1, total, err := repo.List(ctx, domain.MemoryFilter{Limit: 2, Offset: 0})
		if err != nil {
			t.Fatalf("List page 1: %v", err)
		}
		if total != 5 {
			t.Fatalf("total mismatch: got %d want 5", total)
		}
		if len(page1) != 2 {
			t.Fatalf("page 1 len: got %d want 2", len(page1))
		}

		page2, _, err := repo.List(ctx, domain.MemoryFilter{Limit: 2, Offset: 2})
		if err != nil {
			t.Fatalf("List page 2: %v", err)
		}
		if len(page2) != 2 {
			t.Fatalf("page 2 len: got %d want 2", len(page2))
		}

		// Pages should not overlap.
		ids := map[string]bool{}
		for _, m := range page1 {
			ids[m.ID] = true
		}
		for _, m := range page2 {
			if ids[m.ID] {
				t.Fatalf("overlapping pages: %s appears in both", m.ID)
			}
		}
	})
}

func TestCount(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	// Initially zero.
	count, err := repo.Count(ctx)
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0, got %d", count)
	}

	// Create 3, delete 1.
	for i := 0; i < 3; i++ {
		m := newTestMemory()
		if err := repo.Create(ctx, m); err != nil {
			t.Fatalf("Create: %v", err)
		}
		if i == 0 {
			if _, err := repo.SoftDelete(ctx, m.ID, "agent"); err != nil {
				t.Fatalf("SoftDelete: %v", err)
			}
		}
	}

	count, err = repo.Count(ctx)
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 active, got %d", count)
	}
}

func TestBulkCreate(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	mems := []*domain.Memory{
		newTestMemory(func(m *domain.Memory) { m.Content = "bulk-1" }),
		newTestMemory(func(m *domain.Memory) { m.Content = "bulk-2" }),
		newTestMemory(func(m *domain.Memory) { m.Content = "bulk-3" }),
	}

	if err := repo.BulkCreate(ctx, mems); err != nil {
		t.Fatalf("BulkCreate: %v", err)
	}

	// Verify all readable.
	for _, m := range mems {
		got, err := repo.GetByID(ctx, m.ID)
		if err != nil {
			t.Fatalf("GetByID(%s): %v", m.ID, err)
		}
		if got.Content != m.Content {
			t.Fatalf("content mismatch: got %q want %q", got.Content, m.Content)
		}
	}

	// Duplicate ID should fail.
	dupes := []*domain.Memory{mems[0]} // reuse first ID
	err := repo.BulkCreate(ctx, dupes)
	if err == nil {
		t.Fatal("expected error on duplicate bulk create")
	}
	if !errors.Is(err, domain.ErrDuplicateKey) {
		t.Fatalf("expected ErrDuplicateKey, got %v", err)
	}
}

func TestKeywordSearch(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	// Create memories with distinct content.
	contents := []string{
		"user prefers Go for backend services",
		"the deployment uses Kubernetes on AWS",
		"Go modules require go.sum file",
		"Python is used for data analysis scripts",
	}
	for _, c := range contents {
		m := newTestMemory(func(m *domain.Memory) { m.Content = c })
		if err := repo.Create(ctx, m); err != nil {
			t.Fatalf("Create: %v", err)
		}
	}

	// Search for "Go" — should match 2 memories.
	results, err := repo.KeywordSearch(ctx, "Go", domain.MemoryFilter{}, 50)
	if err != nil {
		t.Fatalf("KeywordSearch: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results for 'Go', got %d", len(results))
	}

	// Search for "Kubernetes" — should match 1.
	results, err = repo.KeywordSearch(ctx, "Kubernetes", domain.MemoryFilter{}, 50)
	if err != nil {
		t.Fatalf("KeywordSearch: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result for 'Kubernetes', got %d", len(results))
	}

	// Search with limit.
	results, err = repo.KeywordSearch(ctx, "Go", domain.MemoryFilter{}, 1)
	if err != nil {
		t.Fatalf("KeywordSearch: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result with limit=1, got %d", len(results))
	}

	// Search with memory_type filter that doesn't match any test data.
	results, err = repo.KeywordSearch(ctx, "Go", domain.MemoryFilter{MemoryType: "pinned"}, 50)
	if err != nil {
		t.Fatalf("KeywordSearch with filter: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("expected 0 results for type=pinned, got %d", len(results))
	}
}

func TestListBootstrap(t *testing.T) {
	truncateMemories(t)
	repo := newMemoryRepo()
	ctx := context.Background()

	// Create 5 memories with staggered updated_at.
	var ids []string
	for i := 0; i < 5; i++ {
		m := newTestMemory(func(m *domain.Memory) {
			m.Content = "bootstrap-" + uuid.New().String()[:8]
		})
		if err := repo.Create(ctx, m); err != nil {
			t.Fatalf("Create: %v", err)
		}
		ids = append(ids, m.ID)
		time.Sleep(50 * time.Millisecond)
	}

	// Bootstrap with limit=3 — should get the 3 most recent.
	results, err := repo.ListBootstrap(ctx, 3)
	if err != nil {
		t.Fatalf("ListBootstrap: %v", err)
	}
	if len(results) != 3 {
		t.Fatalf("expected 3, got %d", len(results))
	}

	// Verify ordered by updated_at DESC (most recent first).
	for i := 1; i < len(results); i++ {
		if results[i].UpdatedAt.After(results[i-1].UpdatedAt) {
			t.Fatalf("not ordered DESC: %v > %v at index %d", results[i].UpdatedAt, results[i-1].UpdatedAt, i)
		}
	}

	// The 3 most recent should be the last 3 created.
	resultIDs := map[string]bool{}
	for _, r := range results {
		resultIDs[r.ID] = true
	}
	for _, id := range ids[2:] { // last 3
		if !resultIDs[id] {
			t.Fatalf("expected recent ID %s in bootstrap results", id)
		}
	}
}

// NOTE: VectorSearch, AutoVectorSearch, and FTSSearch are NOT tested here.
// These require TiDB-specific features (VECTOR column type, VEC_COSINE_DISTANCE,
// VEC_EMBED_COSINE_DISTANCE, fts_match_word) that are not available in plain MySQL.
// To test these, use a real TiDB Serverless instance.
