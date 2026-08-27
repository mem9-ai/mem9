package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/embed"
)

// updateCaptureRepo records the memory handed to UpdateOptimistic so tests can
// assert what embedding the service intends to persist.
type updateCaptureRepo struct {
	memoryRepoMock
	updated *domain.Memory
}

func (m *updateCaptureRepo) UpdateOptimistic(_ context.Context, mem *domain.Memory, _ int) error {
	cp := *mem
	m.updated = &cp
	return nil
}

func newUpdateCaptureRepo(stored *domain.Memory) *updateCaptureRepo {
	repo := &updateCaptureRepo{}
	repo.getByID = map[string]*domain.Memory{stored.ID: stored}
	return repo
}

func storedEmbeddedMemory() *domain.Memory {
	return &domain.Memory{
		ID:         "mem-1",
		Content:    "old content",
		Tags:       []string{"old"},
		Embedding:  []float32{0.1, 0.2, 0.3},
		MemoryType: domain.TypeInsight,
		State:      domain.StateActive,
		Version:    1,
	}
}

func TestUpdateTagsOnlyPreservesEmbedding(t *testing.T) {
	repo := newUpdateCaptureRepo(storedEmbeddedMemory())
	svc := NewMemoryService(repo, nil, nil, "", ModeSmart)

	if _, err := svc.Update(context.Background(), "agent", "mem-1", "", []string{"new"}, nil, 0); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if repo.updated == nil {
		t.Fatal("UpdateOptimistic was not called")
	}
	if got, want := repo.updated.Embedding, []float32{0.1, 0.2, 0.3}; !equalVec(got, want) {
		t.Fatalf("embedding: got %v want %v", got, want)
	}
	if got := repo.updated.Tags; len(got) != 1 || got[0] != "new" {
		t.Fatalf("tags: got %v want [new]", got)
	}
}

func TestUpdateContentWithoutEmbedderClearsEmbedding(t *testing.T) {
	repo := newUpdateCaptureRepo(storedEmbeddedMemory())
	// No embedder, no autoModel — FTS/keyword-only deployment.
	svc := NewMemoryService(repo, nil, nil, "", ModeSmart)

	if _, err := svc.Update(context.Background(), "agent", "mem-1", "new content", nil, nil, 0); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if repo.updated == nil {
		t.Fatal("UpdateOptimistic was not called")
	}
	if len(repo.updated.Embedding) != 0 {
		t.Fatalf("embedding should be cleared when content changes without an embedder, got %v", repo.updated.Embedding)
	}
}

func TestUpdateContentWithEmbedderReembeds(t *testing.T) {
	embedSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"embedding": []float32{0.9, 0.8, 0.7}}},
		})
	}))
	defer embedSrv.Close()
	embedder := embed.New(embed.Config{BaseURL: embedSrv.URL, Model: "test", Dims: 3})

	repo := newUpdateCaptureRepo(storedEmbeddedMemory())
	svc := NewMemoryService(repo, nil, embedder, "", ModeSmart)

	if _, err := svc.Update(context.Background(), "agent", "mem-1", "new content", nil, nil, 0); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if repo.updated == nil {
		t.Fatal("UpdateOptimistic was not called")
	}
	if got, want := repo.updated.Embedding, []float32{0.9, 0.8, 0.7}; !equalVec(got, want) {
		t.Fatalf("embedding: got %v want %v", got, want)
	}
}

func TestUpdateContentWithAutoModelLeavesEmbeddingToDatabase(t *testing.T) {
	repo := newUpdateCaptureRepo(storedEmbeddedMemory())
	svc := NewMemoryService(repo, nil, nil, "tidbcloud_free/test-model", ModeSmart)

	if _, err := svc.Update(context.Background(), "agent", "mem-1", "new content", nil, nil, 0); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if repo.updated == nil {
		t.Fatal("UpdateOptimistic was not called")
	}
	// With auto-embedding the repository never writes the column; the service
	// must not touch the in-memory value either.
	if got, want := repo.updated.Embedding, []float32{0.1, 0.2, 0.3}; !equalVec(got, want) {
		t.Fatalf("embedding: got %v want %v", got, want)
	}
}

func equalVec(a, b []float32) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
