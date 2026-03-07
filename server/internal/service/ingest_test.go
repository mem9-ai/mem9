package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/llm"
)

type memoryRepoMock struct {
	createCalls    []*domain.Memory
	setStateCalls  []setStateCall // track SetState invocations
	setStateErr    error          // configurable return value for SetState
	vectorResults  []domain.Memory // configurable results for AutoVectorSearch
}

func (m *memoryRepoMock) Create(ctx context.Context, mem *domain.Memory) error {
	m.createCalls = append(m.createCalls, mem)
	return nil
}

func (m *memoryRepoMock) GetByID(ctx context.Context, id string) (*domain.Memory, error) {
	return nil, domain.ErrNotFound
}

func (m *memoryRepoMock) UpdateOptimistic(ctx context.Context, mem *domain.Memory, expectedVersion int) error {
	return nil
}

func (m *memoryRepoMock) SoftDelete(ctx context.Context, id, agentName string) error {
	return nil
}

func (m *memoryRepoMock) ArchiveMemory(ctx context.Context, id, supersededBy string) error {
	return nil
}
func (m *memoryRepoMock) ArchiveAndCreate(ctx context.Context, archiveID, supersededBy string, newMem *domain.Memory) error {
	m.createCalls = append(m.createCalls, newMem)
	return nil
}

func (m *memoryRepoMock) SetState(ctx context.Context, id string, state domain.MemoryState) error {
	m.setStateCalls = append(m.setStateCalls, setStateCall{ID: id, State: state})
	return m.setStateErr
}

	type setStateCall struct {
	ID    string
	State domain.MemoryState
}

func (m *memoryRepoMock) List(ctx context.Context, f domain.MemoryFilter) ([]domain.Memory, int, error) {
	return nil, 0, nil
}

func (m *memoryRepoMock) Count(ctx context.Context) (int, error) {
	return 0, nil
}

func (m *memoryRepoMock) BulkCreate(ctx context.Context, memories []*domain.Memory) error {
	return nil
}

func (m *memoryRepoMock) VectorSearch(ctx context.Context, queryVec []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	return nil, nil
}

func (m *memoryRepoMock) AutoVectorSearch(ctx context.Context, queryText string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	if m.vectorResults != nil {
		return m.vectorResults, nil
	}
	return nil, nil
}

func (m *memoryRepoMock) KeywordSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	return nil, nil
}

func (m *memoryRepoMock) FTSSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	return nil, nil
}

func (m *memoryRepoMock) ListBootstrap(ctx context.Context, limit int) ([]domain.Memory, error) {
	return nil, nil
}

func TestStripInjectedContext(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    []IngestMessage
		expected []IngestMessage
	}{
		{
			name: "removes relevant memories tag",
			input: []IngestMessage{{
				Role:    "user",
				Content: "keep <relevant-memories>remove</relevant-memories> text",
			}},
			expected: []IngestMessage{{Role: "user", Content: "keep  text"}},
		},
		{
			name: "handles no tags",
			input: []IngestMessage{{
				Role:    "assistant",
				Content: "no tags here",
			}},
			expected: []IngestMessage{{Role: "assistant", Content: "no tags here"}},
		},
		{
			name: "handles malformed tag",
			input: []IngestMessage{{
				Role:    "user",
				Content: "keep <relevant-memories>broken",
			}},
			expected: []IngestMessage{{Role: "user", Content: "keep"}},
		},
		{
			name: "drops empty content",
			input: []IngestMessage{{
				Role:    "system",
				Content: "<relevant-memories>only</relevant-memories>",
			}},
			expected: []IngestMessage{},
		},
		{
			name: "handles multiple tags",
			input: []IngestMessage{{
				Role:    "user",
				Content: "a<relevant-memories>x</relevant-memories>b<relevant-memories>y</relevant-memories>c",
			}},
			expected: []IngestMessage{{Role: "user", Content: "abc"}},
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := stripInjectedContext(tt.input)
			if len(got) != len(tt.expected) {
				t.Fatalf("stripInjectedContext() len = %d, expected %d; got %#v", len(got), len(tt.expected), got)
			}
			for i := range got {
				if got[i] != tt.expected[i] {
					t.Fatalf("stripInjectedContext()[%d] = %#v, expected %#v", i, got[i], tt.expected[i])
				}
			}
		})
	}
}

func TestStripMemoryTags(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "single tag",
			input:    "a<relevant-memories>b</relevant-memories>c",
			expected: "ac",
		},
		{
			name:     "multiple tags",
			input:    "a<relevant-memories>b</relevant-memories>c<relevant-memories>d</relevant-memories>e",
			expected: "ace",
		},
		{
			name:     "malformed tag",
			input:    "prefix<relevant-memories>broken",
			expected: "prefix",
		},
		{
			name:     "nested tags",
			input:    "a<relevant-memories>one<relevant-memories>two</relevant-memories>three</relevant-memories>b",
			expected: "athree</relevant-memories>b",
		},
		{
			name:     "no tags",
			input:    "plain text",
			expected: "plain text",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := stripMemoryTags(tt.input)
			if got != tt.expected {
				t.Fatalf("stripMemoryTags() = %q, expected %q", got, tt.expected)
			}
		})
	}
}

func TestFormatConversation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    []IngestMessage
		expected string
	}{
		{
			name: "formats role content pairs",
			input: []IngestMessage{{
				Role:    "user",
				Content: "hi",
			}, {
				Role:    "assistant",
				Content: "hello",
			}},
			expected: "User: hi\n\nAssistant: hello",
		},
		{
			name:     "handles empty messages",
			input:    nil,
			expected: "",
		},
		{
			name: "capitalizes first letter only",
			input: []IngestMessage{{
				Role:    "uSER",
				Content: "case",
			}},
			expected: "USER: case",
		},
		{
			name: "trims trailing whitespace",
			input: []IngestMessage{{
				Role:    "user",
				Content: "trail",
			}},
			expected: "User: trail",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := formatConversation(tt.input)
			if got != tt.expected {
				t.Fatalf("formatConversation() = %q, expected %q", got, tt.expected)
			}
		})
	}
}

func TestParseIntID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		expected int
	}{
		{name: "valid integer", input: "42", expected: 42},
		{name: "negative integer", input: "-7", expected: -7},
		{name: "invalid string", input: "abc", expected: -1},
		{name: "empty string", input: "", expected: -1},
		{name: "trailing text", input: "12x", expected: -1},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := parseIntID(tt.input)
			if got != tt.expected {
				t.Fatalf("parseIntID() = %d, expected %d", got, tt.expected)
			}
		})
	}
}

func TestIngestEmptyMessages(t *testing.T) {
	t.Parallel()

	svc := NewIngestService(&memoryRepoMock{}, nil, nil, "", ModeSmart)
	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{})
	if err == nil {
		t.Fatalf("expected validation error")
	}
	var vErr *domain.ValidationError
	if !errors.As(err, &vErr) {
		t.Fatalf("expected ValidationError, got %T", err)
	}
	if vErr.Field != "messages" {
		t.Fatalf("expected field 'messages', got %q", vErr.Field)
	}
}

func TestIngestModeRawStoresInsight(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{}
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	req := IngestRequest{
		Mode:      ModeRaw,
		SessionID: "session-1",
		AgentID:   "agent-1",
		Messages: []IngestMessage{{
			Role:    "user",
			Content: "hello",
		}, {
			Role:    "assistant",
			Content: "world",
		}},
	}

	res, err := svc.Ingest(context.Background(), "agent-1", req)
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil || res.MemoriesChanged != 1 {
		t.Fatalf("expected 1 insight added, got %#v", res)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 Create call, got %d", len(memRepo.createCalls))
	}

	created := memRepo.createCalls[0]
	expectedContent := "User: hello\n\nAssistant: world"
	if created.Content != expectedContent {
		t.Fatalf("unexpected content: %q", created.Content)
	}
	if created.MemoryType != domain.TypeInsight {
		t.Fatalf("expected memory type insight, got %q", created.MemoryType)
	}
}

func TestIngestNilLLMFallsBackToRaw(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{}
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	req := IngestRequest{
		Mode:      ModeSmart,
		SessionID: "session-2",
		AgentID:   "agent-2",
		Messages: []IngestMessage{{
			Role:    "user",
			Content: "hello",
		}},
	}

	res, err := svc.Ingest(context.Background(), "agent-2", req)
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil || res.MemoriesChanged != 1 {
		t.Fatalf("expected 1 insight added, got %#v", res)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 Create call, got %d", len(memRepo.createCalls))
	}
}

// TestReconcileDeleteErrNotFoundIsNotWarning verifies the DELETE path in reconcile()
// silently skips ErrNotFound (e.g., row already archived by a concurrent operation)
// without counting it as a warning. Uses a mock LLM server to exercise the full path.
func TestReconcileDeleteErrNotFoundIsNotWarning(t *testing.T) {
	t.Parallel()

	// Mock LLM: first call returns extraction with one fact, second returns DELETE action.
	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var resp string
		if callCount == 1 {
			// extractFacts response.
			resp = `{"facts": ["user prefers dark mode"]}`
		} else {
			// reconcile response — DELETE the existing memory.
			resp = `{"memory": [{"id": "0", "text": "user prefers dark mode", "event": "DELETE"}]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": resp}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{
		APIKey:  "test-key",
		BaseURL: mockLLM.URL,
		Model:   "test-model",
	})

	// Repository: SetState returns ErrNotFound (simulating already-archived row).
	// AutoVectorSearch returns an existing memory so reconcile has something to DELETE.
	memRepo := &memoryRepoMock{
		setStateErr: domain.ErrNotFound,
		vectorResults: []domain.Memory{
			{ID: "mem-123", Content: "user prefers dark mode", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}

	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-1",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I prefer dark mode"},
			{Role: "assistant", Content: "Noted, dark mode preference saved."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil {
		t.Fatal("expected non-nil result")
	}

	// ErrNotFound from SetState should NOT count as a warning.
	if res.Warnings != 0 {
		t.Fatalf("expected 0 warnings for ErrNotFound, got %d", res.Warnings)
	}

	// Verify SetState was actually called with the correct ID and state.
	if len(memRepo.setStateCalls) != 1 {
		t.Fatalf("expected 1 SetState call, got %d", len(memRepo.setStateCalls))
	}
	if memRepo.setStateCalls[0].ID != "mem-123" {
		t.Fatalf("expected SetState on mem-123, got %q", memRepo.setStateCalls[0].ID)
	}
	if memRepo.setStateCalls[0].State != domain.StateDeleted {
		t.Fatalf("expected StateDeleted, got %q", memRepo.setStateCalls[0].State)
	}
}

// TestReconcileDeleteRealErrorCountsAsWarning verifies that a real database error
// (not ErrNotFound) during DELETE IS counted as a warning.
func TestReconcileDeleteRealErrorCountsAsWarning(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var resp string
		if callCount == 1 {
			resp = `{"facts": ["user prefers dark mode"]}`
		} else {
			resp = `{"memory": [{"id": "0", "text": "user prefers dark mode", "event": "DELETE"}]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": resp}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{
		APIKey:  "test-key",
		BaseURL: mockLLM.URL,
		Model:   "test-model",
	})

	memRepo := &memoryRepoMock{
		setStateErr: fmt.Errorf("database connection lost"),
		vectorResults: []domain.Memory{
			{ID: "mem-456", Content: "user prefers dark mode", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}

	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-2",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I prefer dark mode"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil {
		t.Fatal("expected non-nil result")
	}

	// Real error from SetState SHOULD count as a warning.
	if res.Warnings != 1 {
		t.Fatalf("expected 1 warning for real error, got %d", res.Warnings)
	}
}

func TestIngestInvalidModeReturnsValidationError(t *testing.T) {
	t.Parallel()

	svc := NewIngestService(&memoryRepoMock{}, nil, nil, "", ModeSmart)
	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:     IngestMode("unknown"),
		Messages: []IngestMessage{{Role: "user", Content: "hello"}},
	})
	if err == nil {
		t.Fatal("expected validation error for invalid mode")
	}
	var vErr *domain.ValidationError
	if !errors.As(err, &vErr) {
		t.Fatalf("expected ValidationError, got %T: %v", err, err)
	}
	if vErr.Field != "mode" {
		t.Fatalf("expected field 'mode', got %q", vErr.Field)
	}
}

func TestTruncateRunes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		max      int
		expected string
	}{
		{name: "short ASCII", input: "hello", max: 10, expected: "hello"},
		{name: "exact ASCII", input: "hello", max: 5, expected: "hello"},
		{name: "truncate ASCII", input: "hello world", max: 5, expected: "hello..."},
		{name: "Chinese no truncate", input: "你好世界", max: 4, expected: "你好世界"},
		{name: "Chinese truncate", input: "你好世界再见", max: 4, expected: "你好世界..."},
		{name: "mixed content", input: "hello你好world", max: 7, expected: "hello你好..."},
		{name: "empty string", input: "", max: 5, expected: ""},
		{name: "zero max", input: "hello", max: 0, expected: "..."},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := truncateRunes(tt.input, tt.max)
			if got != tt.expected {
				t.Fatalf("truncateRunes(%q, %d) = %q, expected %q", tt.input, tt.max, got, tt.expected)
			}
		})
	}
}
