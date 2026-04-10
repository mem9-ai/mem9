package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/llm"
)

type linkCall struct {
	memoryID  string
	sessionID string
}

type memorySessionLinkRepoMock struct {
	calls            []linkCall
	sessionsByMemory map[string][]string
	sessionsErr      error
}

func (m *memorySessionLinkRepoMock) Link(_ context.Context, memoryID, sessionID string) error {
	m.calls = append(m.calls, linkCall{memoryID: memoryID, sessionID: sessionID})
	return nil
}

func (m *memorySessionLinkRepoMock) MemoriesBySession(context.Context, string, int) ([]string, error) {
	return nil, nil
}

func (m *memorySessionLinkRepoMock) SessionsByMemory(_ context.Context, memoryID string, limit int) ([]string, error) {
	if m.sessionsErr != nil {
		return nil, m.sessionsErr
	}
	ids := append([]string(nil), m.sessionsByMemory[memoryID]...)
	if limit > 0 && len(ids) > limit {
		ids = ids[:limit]
	}
	return ids, nil
}

func TestIngestRawLinksSession(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{}
	linkRepo := &memorySessionLinkRepoMock{}
	svc := NewIngestServiceWithLinks(memRepo, linkRepo, nil, nil, "", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeRaw,
		SessionID: "session-raw",
		AgentID:   "agent-1",
		Messages:  []IngestMessage{{Role: "user", Content: "hello"}},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 memory create, got %d", len(memRepo.createCalls))
	}
	assertLinkCall(t, linkRepo, memRepo.createCalls[0].ID, "session-raw")
}

func TestIngestReconcileAddLinksSession(t *testing.T) {
	t.Parallel()

	llmClient := newTwoStepLLM(t,
		`{"facts": [{"text": "Uses Go 1.22", "tags": ["tech"]}]}`,
		`{"memory": [{"id": "new", "text": "Uses Go 1.22", "event": "ADD", "tags": ["tech"]}]}`,
	)
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "existing-1", Content: "Works remotely", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	linkRepo := &memorySessionLinkRepoMock{}
	svc := NewIngestServiceWithLinks(memRepo, linkRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "session-add",
		AgentID:   "agent-1",
		Messages:  []IngestMessage{{Role: "user", Content: "I use Go 1.22"}},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 memory create, got %d", len(memRepo.createCalls))
	}
	assertLinkCall(t, linkRepo, memRepo.createCalls[0].ID, "session-add")
}

func TestIngestReconcileUpdateLinksReplacementSession(t *testing.T) {
	t.Parallel()

	llmClient := newTwoStepLLM(t,
		`{"facts": [{"text": "Works at company Y", "tags": ["work"]}]}`,
		`{"memory": [{"id": "0", "text": "Works at company Y", "event": "UPDATE", "old_memory": "Works at startup X", "tags": ["work"]}]}`,
	)
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "mem-startup", Content: "Works at startup X", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	linkRepo := &memorySessionLinkRepoMock{}
	svc := NewIngestServiceWithLinks(memRepo, linkRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "session-update",
		AgentID:   "agent-1",
		Messages:  []IngestMessage{{Role: "user", Content: "I now work at company Y"}},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 replacement memory create, got %d", len(memRepo.createCalls))
	}
	assertLinkCall(t, linkRepo, memRepo.createCalls[0].ID, "session-update")
}

func TestMemoryCreateWithSessionLinksNoLLM(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{}
	linkRepo := &memorySessionLinkRepoMock{}
	svc := NewMemoryServiceWithLinks(memRepo, linkRepo, nil, nil, "", ModeSmart, false)

	mem, written, err := svc.CreateWithSession(context.Background(), "agent-1", "session-content", "user prefers dark mode", nil, nil)
	if err != nil {
		t.Fatalf("CreateWithSession() error = %v", err)
	}
	if written != 1 {
		t.Fatalf("expected 1 write, got %d", written)
	}
	if mem.SessionID != "session-content" {
		t.Fatalf("expected memory session_id to be preserved, got %q", mem.SessionID)
	}
	assertLinkCall(t, linkRepo, mem.ID, "session-content")
}

func TestMemoryCreateWithSession_EventOnlyDualWriteReturnsPatchedEventMemory(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")

		resp := `{"facts": [{"text": "Caroline attended an LGBTQ support group on May 7, 2023", "tags": ["event", "timeline"]}]}`
		if callCount == 2 {
			resp = `{"memory": [{"id": "0", "text": "Caroline promotes LGBTQ rights", "event": "NOOP"}]}`
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": resp}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "existing-1", Content: "Caroline promotes LGBTQ rights", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
		listResults: []domain.Memory{
			{ID: "existing-1", Content: "Caroline promotes LGBTQ rights", MemoryType: domain.TypeInsight, SessionID: "session-content", State: domain.StateActive},
		},
	}
	linkRepo := &memorySessionLinkRepoMock{}
	svc := NewMemoryServiceWithLinks(memRepo, linkRepo, llmClient, nil, "auto-model", ModeSmart, false)

	meta := json.RawMessage(`{"source":"caller-meta"}`)
	mem, written, err := svc.CreateWithSession(context.Background(), "agent-1", "session-content", "[date:1:56 pm on 8 May, 2023] I went to a LGBTQ support group yesterday and it was so powerful.", []string{"benchmark"}, meta)
	if err != nil {
		t.Fatalf("CreateWithSession() error = %v", err)
	}
	if written != 2 {
		t.Fatalf("expected 2 writes counted (event + patch), got %d", written)
	}
	if mem == nil {
		t.Fatal("expected returned memory for event-only dual-write, got nil")
	}
	if mem.Content != "Caroline attended an LGBTQ support group on May 7, 2023" {
		t.Fatalf("unexpected returned memory content: %q", mem.Content)
	}
	if len(mem.Tags) != 1 || mem.Tags[0] != "benchmark" {
		t.Fatalf("expected caller tags to be patched onto event memory, got %v", mem.Tags)
	}
	var merged map[string]any
	if err := json.Unmarshal(mem.Metadata, &merged); err != nil {
		t.Fatalf("unmarshal merged event metadata: %v", err)
	}
	if merged["kind"] != eventFactMetadataKind {
		t.Fatalf("expected event metadata kind to be preserved, got %+v", merged)
	}
	if merged["source_mode"] != eventFactSourceMode {
		t.Fatalf("expected event source_mode to be preserved, got %+v", merged)
	}
	if merged["source"] != "caller-meta" {
		t.Fatalf("expected caller metadata to be merged into event metadata, got %+v", merged)
	}
	if len(linkRepo.calls) != 1 {
		t.Fatalf("expected event dual-write to link once, got %d", len(linkRepo.calls))
	}
}

func TestMemoryService_RoutedSessionIDs_UsesTopInsightHits(t *testing.T) {
	t.Parallel()

	linkRepo := &memorySessionLinkRepoMock{
		sessionsByMemory: map[string][]string{
			"insight-1": {"session-a", "session-b"},
			"insight-2": {"session-b", "session-c"},
		},
	}
	svc := NewMemoryServiceWithLinks(&memoryRepoMock{}, linkRepo, nil, nil, "", ModeSmart, false)

	got, err := svc.RoutedSessionIDs(context.Background(), []domain.Memory{
		{ID: "pinned-1", MemoryType: domain.TypePinned},
		{ID: "insight-1", MemoryType: domain.TypeInsight},
		{ID: "insight-2", MemoryType: domain.TypeInsight},
	}, 3, 3, 6)
	if err != nil {
		t.Fatalf("RoutedSessionIDs() error = %v", err)
	}

	want := []string{"session-a", "session-b", "session-c"}
	if len(got) != len(want) {
		t.Fatalf("expected %d routed sessions, got %d: %v", len(want), len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("routedSessionIDs[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func newTwoStepLLM(t *testing.T, first, second string) *llm.Client {
	t.Helper()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		resp := first
		if callCount > 1 {
			resp = second
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		}); err != nil {
			t.Errorf("encode LLM response: %v", err)
		}
	}))
	t.Cleanup(mockLLM.Close)

	return llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
}

func assertLinkCall(t *testing.T, repo *memorySessionLinkRepoMock, memoryID, sessionID string) {
	t.Helper()
	if len(repo.calls) != 1 {
		t.Fatalf("expected 1 link call, got %d: %#v", len(repo.calls), repo.calls)
	}
	if repo.calls[0].memoryID != memoryID || repo.calls[0].sessionID != sessionID {
		t.Fatalf("expected link (%s, %s), got (%s, %s)",
			memoryID, sessionID, repo.calls[0].memoryID, repo.calls[0].sessionID)
	}
}
