package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/llm"
)

type memoryRepoMock struct {
	createCalls          []*domain.Memory
	getByID              map[string]*domain.Memory
	getByIDErr           error
	updateOptimisticErr  error
	setStateCalls        []setStateCall  // track SetState invocations
	setStateErr          error           // configurable return value for SetState
	vectorResults        []domain.Memory // configurable results for AutoVectorSearch
	vectorErr            error           // configurable error for AutoVectorSearch / VectorSearch
	ftsResults           []domain.Memory // configurable results for FTSSearch
	ftsErr               error           // configurable error for FTSSearch
	kwResults            []domain.Memory // configurable results for KeywordSearch
	kwErr                error           // configurable error for KeywordSearch
	ftsAvail             bool            // configurable FTSAvailable() return
	lastVectorFilter     domain.MemoryFilter
	lastAutoVectorFilter domain.MemoryFilter
	lastKeywordFilter    domain.MemoryFilter
	lastFTSFilter        domain.MemoryFilter
}

type setStateCall struct {
	ID    string
	State domain.MemoryState
}

func (m *memoryRepoMock) Create(ctx context.Context, mem *domain.Memory) error {
	m.createCalls = append(m.createCalls, mem)
	return nil
}

func (m *memoryRepoMock) GetByID(ctx context.Context, id string) (*domain.Memory, error) {
	if m.getByIDErr != nil {
		return nil, m.getByIDErr
	}
	if mem, ok := m.getByID[id]; ok {
		cp := *mem
		return &cp, nil
	}
	for _, mem := range m.createCalls {
		if mem.ID == id {
			cp := *mem
			return &cp, nil
		}
	}
	return nil, domain.ErrNotFound
}

func (m *memoryRepoMock) UpdateOptimistic(ctx context.Context, mem *domain.Memory, expectedVersion int) error {
	return m.updateOptimisticErr
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
	m.lastVectorFilter = f
	return nil, nil
}

func (m *memoryRepoMock) AutoVectorSearch(ctx context.Context, queryText string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	m.lastAutoVectorFilter = f
	if m.vectorErr != nil {
		return nil, m.vectorErr
	}
	if m.vectorResults != nil {
		return m.vectorResults, nil
	}
	return nil, nil
}

func (m *memoryRepoMock) KeywordSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	m.lastKeywordFilter = f
	if m.kwErr != nil {
		return nil, m.kwErr
	}
	if m.kwResults != nil {
		return m.kwResults, nil
	}
	return nil, nil
}

func (m *memoryRepoMock) FTSSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	m.lastFTSFilter = f
	if m.ftsErr != nil {
		return nil, m.ftsErr
	}
	if m.ftsResults != nil {
		return m.ftsResults, nil
	}
	return nil, nil
}

func (m *memoryRepoMock) FTSAvailable() bool { return m.ftsAvail }

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
	if got := memRepo.createCalls[0].Content; got != "User: hello" {
		t.Fatalf("unexpected content: %q", got)
	}
}

func TestIngestRawStripsInjectedContextWithoutLLM(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{}
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-3", IngestRequest{
		Mode:    ModeSmart,
		AgentID: "agent-3",
		Messages: []IngestMessage{{
			Role:    "user",
			Content: "<relevant-memories>remove this</relevant-memories>keep this",
		}},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil || res.MemoriesChanged != 1 {
		t.Fatalf("expected 1 insight added, got %#v", res)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 Create call, got %d", len(memRepo.createCalls))
	}
	if got := memRepo.createCalls[0].Content; got != "User: keep this" {
		t.Fatalf("unexpected sanitized content: %q", got)
	}
}

func TestIngestStripsInjectedContextAcrossModes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name               string
		mode               IngestMode
		withLLM            bool
		wantCreatedContent string
		wantLLMCalls       int
	}{
		{name: "raw mode without llm", mode: ModeRaw, withLLM: false, wantCreatedContent: "User: keep this", wantLLMCalls: 0},
		{name: "smart mode without llm", mode: ModeSmart, withLLM: false, wantCreatedContent: "User: keep this", wantLLMCalls: 0},
		{name: "raw mode with llm", mode: ModeRaw, withLLM: true, wantCreatedContent: "User: keep this", wantLLMCalls: 0},
		{name: "smart mode with llm", mode: ModeSmart, withLLM: true, wantCreatedContent: "keep this", wantLLMCalls: 2},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			memRepo := &memoryRepoMock{}
			if tt.withLLM && tt.mode == ModeSmart {
				memRepo.vectorResults = []domain.Memory{{ID: "mem-1", Content: "existing", MemoryType: domain.TypeInsight, State: domain.StateActive}}
			}
			var llmClient *llm.Client
			llmBodies := make([]string, 0, 2)
			var mu sync.Mutex
			callCount := 0

			if tt.withLLM {
				mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					body, _ := io.ReadAll(r.Body)
					mu.Lock()
					llmBodies = append(llmBodies, string(body))
					callCount++
					currentCall := callCount
					mu.Unlock()

					resp := `{"facts": ["keep this"]}`
					if currentCall == 2 {
						resp = `{"memory": [{"id": "new", "text": "keep this", "event": "ADD"}]}`
					}
					w.Header().Set("Content-Type", "application/json")
					json.NewEncoder(w).Encode(map[string]any{
						"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
					})
				}))
				defer mockLLM.Close()

				llmClient = llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
			}

			svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)
			res, err := svc.Ingest(context.Background(), "agent-strip", IngestRequest{
				Mode:    tt.mode,
				AgentID: "agent-strip",
				Messages: []IngestMessage{{
					Role:    "user",
					Content: "<relevant-memories>drop this</relevant-memories>keep this",
				}},
			})
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
			if created.Content != tt.wantCreatedContent {
				t.Fatalf("unexpected content: %q", created.Content)
			}
			if strings.Contains(created.Content, "<relevant-memories>") {
				t.Fatalf("injected context leaked into stored content: %q", created.Content)
			}

			if callCount != tt.wantLLMCalls {
				t.Fatalf("unexpected llm call count: got %d want %d", callCount, tt.wantLLMCalls)
			}
			for _, reqBody := range llmBodies {
				if strings.Contains(reqBody, "<relevant-memories>") {
					t.Fatalf("injected context leaked into llm request: %s", reqBody)
				}
			}
		})
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
		{name: "multibyte no truncate", input: "caf\u00e9", max: 4, expected: "caf\u00e9"},
		{name: "multibyte truncate", input: "caf\u00e9 latt\u00e9", max: 4, expected: "caf\u00e9..."},
		{name: "emoji content", input: "hello\U0001F600world", max: 7, expected: "hello\U0001F600w..."},
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

// TestReconcileFallbackWritesNothing verifies that when the LLM fails during
// reconciliation (with existing memories present), the system writes nothing
// instead of blindly adding all facts as duplicates.
func TestReconcileFallbackWritesNothing(t *testing.T) {
	t.Parallel()

	// Mock LLM: first call (extractFacts) succeeds, second call (reconcile) fails with 500.
	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if callCount == 1 {
			// extractFacts response.
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{"message": map[string]string{"content": `{"facts": ["user prefers dark mode"]}`}},
				},
			})
			return
		}
		// All subsequent calls fail (reconcile + retry).
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error": "service unavailable"}`))
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{
		APIKey:  "test-key",
		BaseURL: mockLLM.URL,
		Model:   "test-model",
	})

	// Repo has existing memories so reconcile path is taken (not addAllFacts bypass).
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "mem-existing", Content: "user prefers light mode", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}

	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-fallback",
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

	// With the safer fallback, nothing should be written on LLM failure.
	if res.MemoriesChanged != 0 {
		t.Fatalf("expected 0 memories changed (safe fallback), got %d", res.MemoriesChanged)
	}
	// No Create calls should have been made.
	if len(memRepo.createCalls) != 0 {
		t.Fatalf("expected 0 Create calls (safe fallback), got %d", len(memRepo.createCalls))
	}
	// LLM failure should produce warnings=1 and status="partial" so callers
	// can distinguish "nothing to remember" from "reconciliation failed."
	if res.Warnings != 1 {
		t.Fatalf("expected 1 warning for reconciliation LLM failure, got %d", res.Warnings)
	}
	if res.Status != "partial" {
		t.Fatalf("expected status 'partial' for reconciliation LLM failure, got %q", res.Status)
	}
}

// TestGatherExistingMemoriesFiltersLowScoreVectorResults verifies that vector
// search results with scores below the minimum threshold are excluded from the
// gathered memories, preventing low-relevance candidates from wasting LLM context.
func TestGatherExistingMemoriesFiltersLowScoreVectorResults(t *testing.T) {
	t.Parallel()

	// Pin scores close to the 0.3 boundary to catch accidental threshold changes.
	highScore := 0.31
	lowScore := 0.29

	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "high-relevance", Content: "relevant memory", MemoryType: domain.TypeInsight, State: domain.StateActive, Score: &highScore},
			{ID: "low-relevance", Content: "unrelated memory", MemoryType: domain.TypeInsight, State: domain.StateActive, Score: &lowScore},
		},
	}

	svc := NewIngestService(memRepo, nil, nil, "auto-model", ModeSmart)

	result, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"test fact"})
	if err != nil {
		t.Fatalf("gatherExistingMemories() error = %v", err)
	}

	// Only the high-score result should be included.
	if len(result) != 1 {
		t.Fatalf("expected 1 memory (filtered by threshold), got %d", len(result))
	}
	if result[0].ID != "high-relevance" {
		t.Fatalf("expected high-relevance memory, got %s", result[0].ID)
	}
}

// TestGatherExistingMemoriesFTSOnlyMode verifies that when no embedder and no
// autoModel are configured but FTS is available, gatherExistingMemories runs
// per-fact FTS search instead of falling back to List().
func TestGatherExistingMemoriesFTSOnlyMode(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{
		ftsAvail: true,
		ftsResults: []domain.Memory{
			{ID: "fts-1", Content: "user likes Go", MemoryType: domain.TypeInsight, State: domain.StateActive},
			{ID: "fts-2", Content: "user uses TiDB", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}

	// No embedder, no autoModel — FTS-only deployment.
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	result, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"Go programming", "TiDB database"})
	if err != nil {
		t.Fatalf("gatherExistingMemories() error = %v", err)
	}

	// FTS results should appear (2 unique memories, returned for both facts but deduped).
	if len(result) != 2 {
		t.Fatalf("expected 2 memories from FTS-only mode, got %d", len(result))
	}
	// Verify both FTS results are present.
	ids := map[string]bool{}
	for _, m := range result {
		ids[m.ID] = true
	}
	if !ids["fts-1"] || !ids["fts-2"] {
		t.Fatalf("expected fts-1 and fts-2, got %v", ids)
	}
}

// TestGatherExistingMemoriesHybridDedup verifies that overlapping vector and
// FTS results are deduplicated (same ID appears only once).
func TestGatherExistingMemoriesHybridDedup(t *testing.T) {
	t.Parallel()

	highScore := 0.8
	memRepo := &memoryRepoMock{
		ftsAvail: true,
		vectorResults: []domain.Memory{
			{ID: "shared-1", Content: "user prefers dark mode", MemoryType: domain.TypeInsight, State: domain.StateActive, Score: &highScore},
			{ID: "vec-only", Content: "user is a backend engineer", MemoryType: domain.TypeInsight, State: domain.StateActive, Score: &highScore},
		},
		ftsResults: []domain.Memory{
			{ID: "shared-1", Content: "user prefers dark mode", MemoryType: domain.TypeInsight, State: domain.StateActive},
			{ID: "fts-only", Content: "uses Go 1.22", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}

	svc := NewIngestService(memRepo, nil, nil, "auto-model", ModeSmart)

	result, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"dark mode preference"})
	if err != nil {
		t.Fatalf("gatherExistingMemories() error = %v", err)
	}

	// shared-1 should appear once (deduped), vec-only and fts-only each once = 3 total.
	if len(result) != 3 {
		t.Fatalf("expected 3 deduplicated memories, got %d", len(result))
	}
	ids := map[string]bool{}
	for _, m := range result {
		ids[m.ID] = true
	}
	if !ids["shared-1"] || !ids["vec-only"] || !ids["fts-only"] {
		t.Fatalf("expected shared-1, vec-only, fts-only; got %v", ids)
	}
}

// TestGatherExistingMemoriesTotalOutageReturnsError verifies that when every
// single search attempt fails (total outage), gatherExistingMemories returns
// an error instead of silently returning an empty list (which would cause
// addAllFacts to create duplicate memories).
func TestGatherExistingMemoriesTotalOutageReturnsError(t *testing.T) {
	t.Parallel()

	// All search backends fail.
	memRepo := &memoryRepoMock{
		vectorErr: errors.New("connection refused"),
		kwErr:     errors.New("connection refused"),
	}

	svc := NewIngestService(memRepo, nil, nil, "auto-model", ModeSmart)

	_, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"test fact"})
	if err == nil {
		t.Fatal("expected error on total search outage, got nil")
	}
	if !errors.Is(err, err) { // sanity check
		t.Fatalf("unexpected error type: %v", err)
	}
}

// TestGatherExistingMemoriesPartialLegFailureContinues verifies that when one
// search leg fails but the other succeeds, results from the successful leg are
// returned (no hard abort).
func TestGatherExistingMemoriesPartialLegFailureContinues(t *testing.T) {
	t.Parallel()

	highScore := 0.8
	// Vector succeeds, keyword/FTS fails.
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "vec-1", Content: "from vector", MemoryType: domain.TypeInsight, State: domain.StateActive, Score: &highScore},
		},
		kwErr: errors.New("FTS temporarily unavailable"),
	}

	svc := NewIngestService(memRepo, nil, nil, "auto-model", ModeSmart)

	result, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"test fact"})
	if err != nil {
		t.Fatalf("expected partial success, got error: %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 memory from vector leg, got %d", len(result))
	}
	if result[0].ID != "vec-1" {
		t.Fatalf("expected vec-1, got %s", result[0].ID)
	}
}

// TestGatherExistingMemoriesFTSOnlyTotalOutage verifies the no-vector path
// also detects total outage when all keyword/FTS searches fail.
func TestGatherExistingMemoriesFTSOnlyTotalOutage(t *testing.T) {
	t.Parallel()

	// No vector configured, FTS available but all FTS searches fail.
	memRepo := &memoryRepoMock{
		ftsAvail: true,
		ftsErr:   errors.New("connection refused"),
	}

	// No embedder, no autoModel — FTS-only deployment.
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	_, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"test fact"})
	if err == nil {
		t.Fatal("expected error on FTS-only total outage, got nil")
	}
}

func TestReconcileContentRequiresLLM(t *testing.T) {
	t.Parallel()

	svc := NewIngestService(&memoryRepoMock{}, nil, nil, "", ModeSmart)
	_, err := svc.ReconcileContent(context.Background(), "agent", "agent", "", []string{"prefers dark mode"})
	if err == nil {
		t.Fatal("expected error when llm is nil")
	}
	var ve *domain.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected ValidationError, got %T", err)
	}
	if ve.Field != "llm" {
		t.Fatalf("expected field llm, got %s", ve.Field)
	}
}

func TestReconcileContentValidatesInput(t *testing.T) {
	t.Parallel()

	svc := NewIngestService(&memoryRepoMock{}, nil, nil, "", ModeSmart)
	_, err := svc.ReconcileContent(context.Background(), "agent", "agent", "", nil)
	if err == nil {
		t.Fatal("expected validation error for empty contents")
	}
	var ve *domain.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected ValidationError, got %T", err)
	}
	if ve.Field != "content" {
		t.Fatalf("expected field content, got %s", ve.Field)
	}
}

// TestReconcileIncludesMemoryAge verifies that the reconciliation prompt sent to
// the LLM includes the "age" field for existing memories, giving the LLM temporal
// context to resolve conflicts (e.g., stale "Lives in Beijing" vs new "Lives in Shanghai").
func TestReconcileIncludesMemoryAge(t *testing.T) {
	t.Parallel()

	var reconcileBody string
	var mu sync.Mutex

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodyStr := string(body)

		var resp string
		if strings.Contains(bodyStr, "Current memory contents:") {
			mu.Lock()
			reconcileBody = bodyStr
			mu.Unlock()
			resp = `{"memory": [{"id": "0", "text": "Lives in Shanghai", "event": "UPDATE", "old_memory": "Lives in Beijing"}]}`
		} else {
			resp = `{"facts": ["Lives in Shanghai"]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})

	// Existing memory has a non-zero UpdatedAt so age will be populated.
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{
				ID:         "mem-old",
				Content:    "Lives in Beijing",
				MemoryType: domain.TypeInsight,
				State:      domain.StateActive,
				UpdatedAt:  time.Now().Add(-365 * 24 * time.Hour), // ~1 year ago
			},
		},
	}

	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-age",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I moved to Shanghai last month"},
			{Role: "assistant", Content: "Got it!"},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil {
		t.Fatal("expected non-nil result")
	}

	// Verify the reconciliation LLM call includes "age" in the prompt body.
	mu.Lock()
	body := reconcileBody
	mu.Unlock()

	if !strings.Contains(body, `"age"`) && !strings.Contains(body, `\"age\"`) {
		t.Fatalf("expected reconciliation prompt to contain age field, got: %s", body)
	}
	if !strings.Contains(body, "year") {
		t.Fatalf("expected age to contain 'year' for a 1-year-old memory, got: %s", body)
	}

	if len(memRepo.createCalls) == 0 {
		t.Fatal("expected ArchiveAndCreate to create a new memory")
	}
}

// TestReconcileOmitsAgeForZeroTimestamp verifies that when a memory has a zero
// UpdatedAt (e.g., from test fixtures without timestamps), the "age" field is
// omitted from the JSON sent to the LLM rather than showing a nonsensical value.
func TestReconcileOmitsAgeForZeroTimestamp(t *testing.T) {
	t.Parallel()

	var reconcileBody string
	var mu sync.Mutex

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodyStr := string(body)

		var resp string
		if strings.Contains(bodyStr, "Current memory contents:") {
			mu.Lock()
			reconcileBody = bodyStr
			mu.Unlock()
			resp = `{"memory": [{"id": "0", "text": "Prefers dark mode", "event": "NOOP"}]}`
		} else {
			resp = `{"facts": ["Prefers dark mode"]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})

	// Zero UpdatedAt — age should be omitted.
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{
				ID:         "mem-notime",
				Content:    "Prefers light mode",
				MemoryType: domain.TypeInsight,
				State:      domain.StateActive,
				// UpdatedAt is zero value
			},
		},
	}

	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-noage",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I prefer dark mode"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}

	mu.Lock()
	body := reconcileBody
	mu.Unlock()

	// Check only the memory data section (system prompt examples contain "age").
	if idx := strings.Index(body, "Current memory contents:"); idx >= 0 {
		endIdx := strings.Index(body[idx:], "New facts")
		if endIdx < 0 {
			t.Fatal("could not find 'New facts' marker in reconciliation body")
		}
		memorySection := body[idx : idx+endIdx]
		if strings.Contains(memorySection, "age") {
			t.Fatalf("expected no age in memory data for zero timestamp, but found it in: %s", memorySection)
		}
	} else {
		t.Fatal("could not find 'Current memory contents:' marker in reconciliation body")
	}
}
