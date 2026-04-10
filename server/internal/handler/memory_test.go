package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/service"
)

// testMemoryRepo is a minimal MemoryRepo mock for handler tests.
type testMemoryRepo struct {
	createCalls          []*domain.Memory
	keywordSearchResults []domain.Memory
}

func (m *testMemoryRepo) Create(_ context.Context, mem *domain.Memory) error {
	m.createCalls = append(m.createCalls, mem)
	return nil
}

func (m *testMemoryRepo) GetByID(_ context.Context, id string) (*domain.Memory, error) {
	for _, mem := range m.createCalls {
		if mem.ID == id {
			cp := *mem
			return &cp, nil
		}
	}
	return nil, domain.ErrNotFound
}
func (m *testMemoryRepo) UpdateOptimistic(context.Context, *domain.Memory, int) error { return nil }
func (m *testMemoryRepo) SoftDelete(context.Context, string, string) error            { return nil }
func (m *testMemoryRepo) ArchiveMemory(context.Context, string, string) error         { return nil }
func (m *testMemoryRepo) ArchiveAndCreate(_ context.Context, _, _ string, mem *domain.Memory) error {
	m.createCalls = append(m.createCalls, mem)
	return nil
}
func (m *testMemoryRepo) SetState(context.Context, string, domain.MemoryState) error { return nil }
func (m *testMemoryRepo) List(context.Context, domain.MemoryFilter) ([]domain.Memory, int, error) {
	return nil, 0, nil
}
func (m *testMemoryRepo) Count(context.Context) (int, error)                 { return 0, nil }
func (m *testMemoryRepo) BulkCreate(context.Context, []*domain.Memory) error { return nil }
func (m *testMemoryRepo) VectorSearch(context.Context, []float32, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}

func (m *testMemoryRepo) AutoVectorSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}

func (m *testMemoryRepo) KeywordSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return append([]domain.Memory(nil), m.keywordSearchResults...), nil
}

func (m *testMemoryRepo) FTSSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}
func (m *testMemoryRepo) FTSAvailable() bool { return false }
func (m *testMemoryRepo) ListBootstrap(context.Context, int) ([]domain.Memory, error) {
	return nil, nil
}

func (m *testMemoryRepo) NearDupSearch(context.Context, string) (string, float64, error) {
	return "", 0, nil
}

func (m *testMemoryRepo) CountStats(context.Context) (int64, int64, error) { return 0, 0, nil }

type testLinkRepo struct {
	sessionsByMemory map[string][]string
	sessionsErr      error
}

func (t *testLinkRepo) Link(context.Context, string, string) error { return nil }
func (t *testLinkRepo) MemoriesBySession(context.Context, string, int) ([]string, error) {
	return nil, nil
}
func (t *testLinkRepo) SessionsByMemory(_ context.Context, memoryID string, limit int) ([]string, error) {
	if t.sessionsErr != nil {
		return nil, t.sessionsErr
	}
	ids := append([]string(nil), t.sessionsByMemory[memoryID]...)
	if limit > 0 && len(ids) > limit {
		ids = ids[:limit]
	}
	return ids, nil
}

// testSessionRepo is a minimal SessionRepo mock for handler tests.
type testSessionRepo struct {
	bulkCreateCalled     bool
	patchTagsCalled      bool
	sessions             []*domain.Session // captured from BulkCreate
	keywordSearchResults []domain.Memory
	setKeywordResults    []domain.Memory
	neighborResults      []domain.Memory
	routedSearchIDs      []string
	nextSeq              int
}

func (s *testSessionRepo) BulkCreate(_ context.Context, sessions []*domain.Session) error {
	s.bulkCreateCalled = true
	s.sessions = append(s.sessions, sessions...)
	return nil
}

func (s *testSessionRepo) PatchTags(context.Context, string, string, []string) error {
	s.patchTagsCalled = true
	return nil
}

func (s *testSessionRepo) NextSeq(context.Context, string) (int, error) {
	next := s.nextSeq
	s.nextSeq++
	return next, nil
}

func (s *testSessionRepo) AutoVectorSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}

func (s *testSessionRepo) AutoVectorSearchInSessionSet(context.Context, string, domain.MemoryFilter, []string, int) ([]domain.Memory, error) {
	return nil, nil
}

func (s *testSessionRepo) VectorSearch(context.Context, []float32, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}

func (s *testSessionRepo) VectorSearchInSessionSet(context.Context, []float32, domain.MemoryFilter, []string, int) ([]domain.Memory, error) {
	return nil, nil
}

func (s *testSessionRepo) FTSSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}

func (s *testSessionRepo) FTSSearchInSessionSet(context.Context, string, domain.MemoryFilter, []string, int) ([]domain.Memory, error) {
	return nil, nil
}

func (s *testSessionRepo) KeywordSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return append([]domain.Memory(nil), s.keywordSearchResults...), nil
}
func (s *testSessionRepo) KeywordSearchInSessionSet(_ context.Context, _ string, _ domain.MemoryFilter, sessionIDs []string, _ int) ([]domain.Memory, error) {
	s.routedSearchIDs = append([]string(nil), sessionIDs...)
	return append([]domain.Memory(nil), s.setKeywordResults...), nil
}
func (s *testSessionRepo) FTSAvailable() bool { return false }
func (s *testSessionRepo) ListBySessionIDs(context.Context, []string, int) ([]*domain.Session, error) {
	return nil, nil
}
func (s *testSessionRepo) ListNeighbors(context.Context, string, int, int, int) ([]domain.Memory, error) {
	return append([]domain.Memory(nil), s.neighborResults...), nil
}

// newTestServer creates a Server with pre-populated svcCache for testing.
func newTestServer(memRepo *testMemoryRepo, sessRepo *testSessionRepo) *Server {
	return newTestServerWithLinks(memRepo, sessRepo, nil)
}

func newTestServerWithLinks(memRepo *testMemoryRepo, sessRepo *testSessionRepo, linkRepo *testLinkRepo) *Server {
	srv := NewServer(nil, nil, "", nil, nil, "", false, false, service.ModeSmart, "", slog.Default())
	svc := resolvedSvc{
		memory:  service.NewMemoryServiceWithLinks(memRepo, linkRepo, nil, nil, "", service.ModeSmart, false),
		ingest:  service.NewIngestService(memRepo, nil, nil, "", service.ModeSmart),
		session: service.NewSessionService(sessRepo, nil, ""),
	}
	// Pre-populate svcCache so resolveServices returns our test services.
	// Key format matches resolveServices: fmt.Sprintf("db-%p", auth.TenantDB)
	// When TenantDB is nil, %p formats as "0x0".
	srv.svcCache.Store(tenantSvcKey("db-0x0"), svc)
	return srv
}

// makeRequest creates an HTTP request with auth context injected.
func makeRequest(t *testing.T, method, path string, body any) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	// Inject auth context using middleware's context key.
	auth := &domain.AuthInfo{AgentName: "test-agent"}
	ctx := middleware.WithAuthContext(req.Context(), auth)
	return req.WithContext(ctx)
}

func TestCreateMemory_SyncContent_Returns200(t *testing.T) {
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})

	body := map[string]any{
		"content": "test memory content",
		"sync":    true,
	}
	req := makeRequest(t, http.MethodPost, "/memories", body)
	rr := httptest.NewRecorder()

	srv.createMemory(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestCreateMemory_SyncContentWithSession_PreservesProvenance(t *testing.T) {
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{}
	srv := newTestServer(memRepo, sessRepo)

	body := map[string]any{
		"content":    "Speaker 2: test memory content",
		"session_id": "test-session",
		"metadata": map[string]any{
			"speaker":    "assistant",
			"turn_index": 7,
		},
		"sync": true,
	}
	req := makeRequest(t, http.MethodPost, "/memories", body)
	rr := httptest.NewRecorder()

	srv.createMemory(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 memory create, got %d", len(memRepo.createCalls))
	}
	if got := memRepo.createCalls[0].SessionID; got != "test-session" {
		t.Fatalf("expected memory session_id test-session, got %q", got)
	}
	if len(sessRepo.sessions) != 1 {
		t.Fatalf("expected 1 raw session row, got %d", len(sessRepo.sessions))
	}
	session := sessRepo.sessions[0]
	if session.SessionID != "test-session" {
		t.Fatalf("expected raw session_id test-session, got %q", session.SessionID)
	}
	if session.Seq != 7 {
		t.Fatalf("expected raw session seq 7, got %d", session.Seq)
	}
	if session.Role != "assistant" {
		t.Fatalf("expected raw session role assistant, got %q", session.Role)
	}
}

func TestCreateMemory_AsyncContent_Returns202(t *testing.T) {
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})

	body := map[string]any{
		"content": "test memory content",
	}
	req := makeRequest(t, http.MethodPost, "/memories", body)
	rr := httptest.NewRecorder()

	srv.createMemory(rr, req)

	if rr.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp["status"] != "accepted" {
		t.Errorf("expected status=accepted, got %q", resp["status"])
	}
}

func TestCreateMemory_SyncContentWithSession_ValidationErrorDoesNotPersistRawTurn(t *testing.T) {
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{}
	srv := newTestServer(memRepo, sessRepo)

	tags := make([]string, 21)
	for i := range tags {
		tags[i] = "tag"
	}

	req := makeRequest(t, http.MethodPost, "/memories", map[string]any{
		"content":    "invalid tagged content",
		"session_id": "test-session",
		"tags":       tags,
		"sync":       true,
	})
	rr := httptest.NewRecorder()
	srv.createMemory(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
	if len(sessRepo.sessions) != 0 {
		t.Fatalf("expected no raw session rows on validation failure, got %d", len(sessRepo.sessions))
	}
}

func TestCreateMemory_SyncContentWithSession_CreateFailureDoesNotPersistRawTurn(t *testing.T) {
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}))
	defer llmServer.Close()

	llmClient := llm.New(llm.Config{
		APIKey:  "test-key",
		BaseURL: llmServer.URL,
		Model:   "test-model",
	})

	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{}
	srv := NewServer(nil, nil, "", nil, llmClient, "auto-model", false, false, service.ModeSmart, "", slog.Default())
	svc := resolvedSvc{
		memory:  service.NewMemoryService(memRepo, llmClient, nil, "auto-model", service.ModeSmart, false),
		ingest:  service.NewIngestService(memRepo, llmClient, nil, "auto-model", service.ModeSmart),
		session: service.NewSessionService(sessRepo, nil, ""),
	}
	srv.svcCache.Store(tenantSvcKey("db-0x0"), svc)

	req := makeRequest(t, http.MethodPost, "/memories", map[string]any{
		"content":    "valid content",
		"session_id": "test-session",
		"sync":       true,
	})
	rr := httptest.NewRecorder()
	srv.createMemory(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rr.Code, rr.Body.String())
	}
	if len(sessRepo.sessions) != 0 {
		t.Fatalf("expected no raw session rows on create failure, got %d", len(sessRepo.sessions))
	}
}

func TestCreateMemory_SyncContentWithSession_AssignsMonotonicSeqWithoutTurnIndex(t *testing.T) {
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{}
	srv := newTestServer(memRepo, sessRepo)

	for _, content := range []string{"first turn", "second turn"} {
		req := makeRequest(t, http.MethodPost, "/memories", map[string]any{
			"content":    content,
			"session_id": "test-session",
			"sync":       true,
		})
		rr := httptest.NewRecorder()
		srv.createMemory(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
		}
	}

	if len(sessRepo.sessions) != 2 {
		t.Fatalf("expected 2 raw session rows, got %d", len(sessRepo.sessions))
	}
	if sessRepo.sessions[0].Seq != 0 || sessRepo.sessions[1].Seq != 1 {
		t.Fatalf("expected monotonic seq [0 1], got [%d %d]", sessRepo.sessions[0].Seq, sessRepo.sessions[1].Seq)
	}
}

func TestContentSessionFields_DoesNotInferAssistantFromSubstringMention(t *testing.T) {
	seq, role := contentSessionFields("I asked the assistant to review my code", nil)
	if seq != -1 {
		t.Fatalf("expected missing turn_index to yield seq=-1, got %d", seq)
	}
	if role != "user" {
		t.Fatalf("expected fallback role user, got %q", role)
	}
}

func TestCreateMemory_SyncMessages_Returns200(t *testing.T) {
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})

	body := map[string]any{
		"messages": []map[string]string{
			{"role": "user", "content": "hello"},
			{"role": "assistant", "content": "hi there"},
		},
		"session_id": "test-session",
		"sync":       true,
	}
	req := makeRequest(t, http.MethodPost, "/memories", body)
	rr := httptest.NewRecorder()

	srv.createMemory(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestCreateMemory_AsyncMessages_Returns202(t *testing.T) {
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})

	body := map[string]any{
		"messages": []map[string]string{
			{"role": "user", "content": "hello"},
		},
		"session_id": "test-session",
	}
	req := makeRequest(t, http.MethodPost, "/memories", body)
	rr := httptest.NewRecorder()

	srv.createMemory(rr, req)

	if rr.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp["status"] != "accepted" {
		t.Errorf("expected status=accepted, got %q", resp["status"])
	}
}

// failSearchMemoryRepo embeds testMemoryRepo but makes KeywordSearch fail,
// triggering gatherExistingMemories → reconcile → ReconcilePhase2 Status:"failed".
type failSearchMemoryRepo struct {
	testMemoryRepo
}

func (m *failSearchMemoryRepo) KeywordSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, errors.New("simulated search failure")
}

func TestCreateMemory_SyncMessages_Phase1Error_Returns500(t *testing.T) {
	// Mock LLM that always returns 500.
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}))
	defer llmServer.Close()

	llmClient := llm.New(llm.Config{
		APIKey:  "test-key",
		BaseURL: llmServer.URL,
		Model:   "test-model",
	})

	srv := NewServer(nil, nil, "", nil, llmClient, "", false, false, service.ModeSmart, "", slog.Default())
	svc := resolvedSvc{
		memory:  service.NewMemoryService(&testMemoryRepo{}, nil, nil, "", service.ModeSmart, false),
		ingest:  service.NewIngestService(&testMemoryRepo{}, llmClient, nil, "", service.ModeSmart),
		session: service.NewSessionService(&testSessionRepo{}, nil, ""),
	}
	srv.svcCache.Store(tenantSvcKey("db-0x0"), svc)

	body := map[string]any{
		"messages": []map[string]string{
			{"role": "user", "content": "hello"},
		},
		"session_id": "test-session",
		"sync":       true,
	}
	req := makeRequest(t, http.MethodPost, "/memories", body)
	rr := httptest.NewRecorder()

	srv.createMemory(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestCreateMemory_SyncMessages_StripsInjectedContext(t *testing.T) {
	// Mock LLM that captures request bodies to verify no injected context reaches the LLM.
	var llmBodies []string
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bodyBytes, _ := io.ReadAll(r.Body)
		llmBodies = append(llmBodies, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{
					"content": `{"facts":["hello world"],"message_tags":[["greeting"],["reply"]]}`,
				}},
			},
		})
	}))
	defer llmServer.Close()

	llmClient := llm.New(llm.Config{
		APIKey:  "test-key",
		BaseURL: llmServer.URL,
		Model:   "test-model",
	})

	sessRepo := &testSessionRepo{}
	srv := NewServer(nil, nil, "", nil, llmClient, "", false, false, service.ModeSmart, "", slog.Default())
	svc := resolvedSvc{
		memory:  service.NewMemoryService(&testMemoryRepo{}, nil, nil, "", service.ModeSmart, false),
		ingest:  service.NewIngestService(&testMemoryRepo{}, llmClient, nil, "", service.ModeSmart),
		session: service.NewSessionService(sessRepo, nil, ""),
	}
	srv.svcCache.Store(tenantSvcKey("db-0x0"), svc)

	body := map[string]any{
		"messages": []map[string]string{
			{"role": "user", "content": "hello <relevant-memories>\ninjected memory content\n</relevant-memories> world"},
			{"role": "assistant", "content": "hi there"},
		},
		"session_id": "test-session",
		"sync":       true,
	}
	req := makeRequest(t, http.MethodPost, "/memories", body)
	rr := httptest.NewRecorder()

	srv.createMemory(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	// Verify sessions stored via BulkCreate have injected context stripped.
	for _, sess := range sessRepo.sessions {
		if strings.Contains(sess.Content, "<relevant-memories>") {
			t.Errorf("session content still contains injected context: %s", sess.Content)
		}
		if strings.Contains(sess.Content, "injected memory content") {
			t.Errorf("session content still contains injected memory: %s", sess.Content)
		}
	}

	// Verify LLM prompts (ExtractPhase1) don't contain injected context.
	if len(llmBodies) == 0 {
		t.Fatal("expected at least one LLM request, got none")
	}
	for i, llmBody := range llmBodies {
		if strings.Contains(llmBody, "<relevant-memories>") {
			t.Errorf("LLM request %d still contains injected context tag", i)
		}
		if strings.Contains(llmBody, "injected memory content") {
			t.Errorf("LLM request %d still contains injected memory content", i)
		}
	}
}

func TestCreateMemory_SyncMessages_ReconcileFailure_Returns500(t *testing.T) {
	// Mock LLM that returns valid facts for ExtractPhase1.
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{
					"content": `{"facts":["test fact"],"message_tags":[["tag1"],["tag2"]]}`,
				}},
			},
		})
	}))
	defer llmServer.Close()

	llmClient := llm.New(llm.Config{
		APIKey:  "test-key",
		BaseURL: llmServer.URL,
		Model:   "test-model",
	})

	memRepo := &failSearchMemoryRepo{}
	srv := NewServer(nil, nil, "", nil, llmClient, "", false, false, service.ModeSmart, "", slog.Default())
	svc := resolvedSvc{
		memory:  service.NewMemoryService(&memRepo.testMemoryRepo, nil, nil, "", service.ModeSmart, false),
		ingest:  service.NewIngestService(memRepo, llmClient, nil, "", service.ModeSmart),
		session: service.NewSessionService(&testSessionRepo{}, nil, ""),
	}
	srv.svcCache.Store(tenantSvcKey("db-0x0"), svc)

	body := map[string]any{
		"messages": []map[string]string{
			{"role": "user", "content": "hello"},
			{"role": "assistant", "content": "hi there"},
		},
		"session_id": "test-session",
		"sync":       true,
	}
	req := makeRequest(t, http.MethodPost, "/memories", body)
	rr := httptest.NewRecorder()

	srv.createMemory(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestListMemories_QueryWithSessionID_UsesSessionFirstBranch(t *testing.T) {
	memRepo := &testMemoryRepo{
		keywordSearchResults: []domain.Memory{
			{ID: "m1", Content: "insight one"},
			{ID: "m2", Content: "insight two"},
			{ID: "m3", Content: "insight three"},
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchResults: []domain.Memory{
			{ID: "s1", Content: "[dia:D1:3] raw turn one", MemoryType: domain.TypeSession},
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q=who&session_id=session-123&limit=3", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) != 3 {
		t.Fatalf("expected 3 memories, got %d", len(resp.Memories))
	}
	if resp.Memories[0].ID != "s1" || resp.Memories[1].ID != "m1" || resp.Memories[2].ID != "m2" {
		t.Fatalf("expected session-first result order [s1 m1 m2], got [%s %s %s]",
			resp.Memories[0].ID, resp.Memories[1].ID, resp.Memories[2].ID)
	}
}

func TestProvenanceSessionGroundingSearch_UsesRoutedSessionSet(t *testing.T) {
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		setKeywordResults: []domain.Memory{
			{ID: "s-route", Content: "routed session hit", MemoryType: domain.TypeSession},
		},
	}
	linkRepo := &testLinkRepo{
		sessionsByMemory: map[string][]string{
			"m1": {"session-routed"},
		},
	}
	srv := newTestServerWithLinks(memRepo, sessRepo, linkRepo)
	svc := srv.resolveServices(&domain.AuthInfo{AgentName: "test-agent"})

	sessionMems, useFallback, err := srv.provenanceSessionGroundingSearch(context.Background(), &domain.AuthInfo{AgentName: "test-agent"}, svc, []domain.Memory{
		{ID: "m1", MemoryType: domain.TypeInsight},
	}, domain.MemoryFilter{Query: "tell me about it", Limit: 6})
	if err != nil {
		t.Fatalf("provenanceSessionGroundingSearch() error = %v", err)
	}
	if useFallback {
		t.Fatalf("expected routed path, got fallback")
	}
	if len(sessionMems) != 1 || sessionMems[0].ID != "s-route" {
		t.Fatalf("unexpected routed session results: %#v", sessionMems)
	}
	if len(sessRepo.routedSearchIDs) != 1 || sessRepo.routedSearchIDs[0] != "session-routed" {
		t.Fatalf("expected routed session IDs [session-routed], got %v", sessRepo.routedSearchIDs)
	}
}

func TestProvenanceSessionGroundingSearch_ExpandsNeighborsForTemporalQuery(t *testing.T) {
	metaSeed, _ := json.Marshal(map[string]any{"seq": 3, "role": "assistant", "content_type": "text"})
	metaNeighbor, _ := json.Marshal(map[string]any{"seq": 2, "role": "user", "content_type": "text"})

	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		setKeywordResults: []domain.Memory{
			{ID: "seed-1", Content: "He mentioned the launch.", MemoryType: domain.TypeSession, SessionID: "session-routed", Score: floatPtr(0.8), Metadata: metaSeed},
		},
		neighborResults: []domain.Memory{
			{ID: "seed-1", Content: "He mentioned the launch.", MemoryType: domain.TypeSession, SessionID: "session-routed", Metadata: metaSeed},
			{ID: "neighbor-1", Content: "The launch happened in March 2024.", MemoryType: domain.TypeSession, SessionID: "session-routed", Metadata: metaNeighbor},
		},
	}
	linkRepo := &testLinkRepo{
		sessionsByMemory: map[string][]string{
			"m1": {"session-routed"},
		},
	}
	srv := newTestServerWithLinks(memRepo, sessRepo, linkRepo)
	svc := srv.resolveServices(&domain.AuthInfo{AgentName: "test-agent"})

	sessionMems, useFallback, err := srv.provenanceSessionGroundingSearch(context.Background(), &domain.AuthInfo{AgentName: "test-agent"}, svc, []domain.Memory{
		{ID: "m1", MemoryType: domain.TypeInsight},
	}, domain.MemoryFilter{Query: "when did the launch happen", Limit: 7})
	if err != nil {
		t.Fatalf("provenanceSessionGroundingSearch() error = %v", err)
	}
	if useFallback {
		t.Fatalf("expected routed path, got fallback")
	}
	if len(sessionMems) != 2 {
		t.Fatalf("expected seed plus one neighbor, got %d: %#v", len(sessionMems), sessionMems)
	}
	if sessionMems[0].ID != "seed-1" || sessionMems[1].ID != "neighbor-1" {
		t.Fatalf("expected merged order [seed-1 neighbor-1], got [%s %s]", sessionMems[0].ID, sessionMems[1].ID)
	}
}

func TestProvenanceSessionGroundingSearch_ReservesRoomForNeighborWithinBudget(t *testing.T) {
	metaSeed1, _ := json.Marshal(map[string]any{"seq": 3, "role": "assistant", "content_type": "text"})
	metaSeed2, _ := json.Marshal(map[string]any{"seq": 4, "role": "assistant", "content_type": "text"})
	metaNeighbor, _ := json.Marshal(map[string]any{"seq": 2, "role": "user", "content_type": "text"})

	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		setKeywordResults: []domain.Memory{
			{ID: "seed-1", Content: "He mentioned the launch.", MemoryType: domain.TypeSession, SessionID: "session-routed", Score: floatPtr(0.9), Metadata: metaSeed1},
			{ID: "seed-2", Content: "The team discussed launch plans.", MemoryType: domain.TypeSession, SessionID: "session-routed", Score: floatPtr(0.8), Metadata: metaSeed2},
		},
		neighborResults: []domain.Memory{
			{ID: "neighbor-1", Content: "The launch happened in March 2024.", MemoryType: domain.TypeSession, SessionID: "session-routed", Metadata: metaNeighbor},
		},
	}
	linkRepo := &testLinkRepo{
		sessionsByMemory: map[string][]string{
			"m1": {"session-routed"},
		},
	}
	srv := newTestServerWithLinks(memRepo, sessRepo, linkRepo)
	svc := srv.resolveServices(&domain.AuthInfo{AgentName: "test-agent"})

	sessionMems, useFallback, err := srv.provenanceSessionGroundingSearch(context.Background(), &domain.AuthInfo{AgentName: "test-agent"}, svc, []domain.Memory{
		{ID: "m1", MemoryType: domain.TypeInsight},
	}, domain.MemoryFilter{Query: "when did the launch happen", Limit: 10})
	if err != nil {
		t.Fatalf("provenanceSessionGroundingSearch() error = %v", err)
	}
	if useFallback {
		t.Fatalf("expected routed path, got fallback")
	}
	if len(sessionMems) != 2 {
		t.Fatalf("expected 2 supplemental session rows, got %d: %#v", len(sessionMems), sessionMems)
	}
	if sessionMems[0].ID != "seed-1" || sessionMems[1].ID != "neighbor-1" {
		t.Fatalf("expected one seed plus reserved neighbor slot, got [%s %s]", sessionMems[0].ID, sessionMems[1].ID)
	}
}

func TestProvenanceSessionGroundingSearch_SkipsNeighborsWhenSessionIDExplicit(t *testing.T) {
	metaSeed, _ := json.Marshal(map[string]any{"seq": 3, "role": "assistant", "content_type": "text"})
	metaNeighbor, _ := json.Marshal(map[string]any{"seq": 2, "role": "user", "content_type": "text"})

	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		setKeywordResults: []domain.Memory{
			{ID: "seed-1", Content: "He mentioned the launch.", MemoryType: domain.TypeSession, SessionID: "session-routed", Score: floatPtr(0.8), Metadata: metaSeed},
		},
		neighborResults: []domain.Memory{
			{ID: "neighbor-1", Content: "The launch happened in March 2024.", MemoryType: domain.TypeSession, SessionID: "session-routed", Metadata: metaNeighbor},
		},
	}
	linkRepo := &testLinkRepo{
		sessionsByMemory: map[string][]string{
			"m1": {"session-routed"},
		},
	}
	srv := newTestServerWithLinks(memRepo, sessRepo, linkRepo)
	svc := srv.resolveServices(&domain.AuthInfo{AgentName: "test-agent"})

	sessionMems, useFallback, err := srv.provenanceSessionGroundingSearch(context.Background(), &domain.AuthInfo{AgentName: "test-agent"}, svc, []domain.Memory{
		{ID: "m1", MemoryType: domain.TypeInsight},
	}, domain.MemoryFilter{Query: "when did the launch happen", SessionID: "session-routed", Limit: 7})
	if err != nil {
		t.Fatalf("provenanceSessionGroundingSearch() error = %v", err)
	}
	if useFallback {
		t.Fatalf("expected routed path, got fallback")
	}
	if len(sessionMems) != 1 || sessionMems[0].ID != "seed-1" {
		t.Fatalf("expected only routed seed when session_id is explicit, got %#v", sessionMems)
	}
}

func TestBlendMemoriesWithSessionGrounding_PreservesDistinctSessionTurnsWithSameContent(t *testing.T) {
	meta1, _ := json.Marshal(map[string]any{"seq": 1})
	meta2, _ := json.Marshal(map[string]any{"seq": 2})

	got := blendMemoriesWithSessionGrounding(
		[]domain.Memory{{ID: "m1", Content: "insight one", MemoryType: domain.TypeInsight}},
		[]domain.Memory{
			{ID: "s1", Content: "same text", MemoryType: domain.TypeSession, SessionID: "session-1", Metadata: meta1},
			{ID: "s2", Content: "same text", MemoryType: domain.TypeSession, SessionID: "session-1", Metadata: meta2},
		},
		10,
	)

	if len(got) != 3 {
		t.Fatalf("expected all distinct turns to survive, got %d: %#v", len(got), got)
	}
	if got[1].ID != "s1" || got[2].ID != "s2" {
		t.Fatalf("expected both session turns with same content to survive, got [%s %s]", got[1].ID, got[2].ID)
	}
}

func TestListMemories_QueryWithSessionID_PreservesDistinctTurnsWithSameContent(t *testing.T) {
	meta1, _ := json.Marshal(map[string]any{"seq": 1})
	meta2, _ := json.Marshal(map[string]any{"seq": 2})

	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchResults: []domain.Memory{
			{ID: "s1", Content: "same text", MemoryType: domain.TypeSession, SessionID: "session-123", Metadata: meta1},
			{ID: "s2", Content: "same text", MemoryType: domain.TypeSession, SessionID: "session-123", Metadata: meta2},
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q=who&session_id=session-123&limit=3", nil)
	rr := httptest.NewRecorder()
	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) != 2 {
		t.Fatalf("expected both same-content turns to survive, got %d: %#v", len(resp.Memories), resp.Memories)
	}
	if resp.Memories[0].ID != "s1" || resp.Memories[1].ID != "s2" {
		t.Fatalf("unexpected explicit-session results: [%s %s]", resp.Memories[0].ID, resp.Memories[1].ID)
	}
}

func floatPtr(v float64) *float64 { return &v }

func TestRerankExplicitSessionMemories_PrefersTimeBearingRowForWhenQuery(t *testing.T) {
	mems := []domain.Memory{
		{ID: "generic", Content: "Melanie is married and likes painting animals.", MemoryType: domain.TypeSession, Score: floatPtr(1.0)},
		{ID: "dated", Content: "Melanie ran a charity race on Saturday, May 20, 2023.", MemoryType: domain.TypeSession, Score: floatPtr(0.8)},
	}

	got := rerankExplicitSessionMemories("When did Melanie run a charity race?", mems)
	if got[0].ID != "dated" {
		t.Fatalf("expected dated session row to outrank generic fact, got %q", got[0].ID)
	}
}

func TestRerankGroundedMemories_LeavesGeneralQueriesUntouched(t *testing.T) {
	mems := []domain.Memory{
		{ID: "m1", Content: "John enjoys hiking with friends.", MemoryType: domain.TypeInsight},
		{ID: "m2", Content: "John likes outdoor activities.", MemoryType: domain.TypeInsight},
		{ID: "s1", Content: "[dia:D1:3] John bought Under Armour boots last week.", MemoryType: domain.TypeSession},
	}

	got := rerankGroundedMemories("tell me about john", mems)
	if len(got) != len(mems) {
		t.Fatalf("expected %d memories, got %d", len(mems), len(got))
	}
	for i := range got {
		if got[i].ID != mems[i].ID {
			t.Fatalf("expected order to stay unchanged, got %q at slot %d", got[i].ID, i)
		}
	}
}

func TestRerankGroundedMemories_PrefersCanonicalEntityForExactQuery(t *testing.T) {
	mems := []domain.Memory{
		{ID: "m1", Content: "John likes a renowned outdoor gear company.", MemoryType: domain.TypeInsight},
		{ID: "m2", Content: "John bought Under Armour boots last week.", MemoryType: domain.TypeSession},
		{ID: "m3", Content: "John likes outdoor gear in general.", MemoryType: domain.TypeInsight},
	}

	got := rerankGroundedMemories("what company does john like", mems)
	if got[0].ID != "m2" {
		t.Fatalf("expected canonical named answer to move first, got %q", got[0].ID)
	}
}

func TestRerankGroundedMemories_PrefersQuantifiedEvidenceForCountQuery(t *testing.T) {
	mems := []domain.Memory{
		{ID: "m1", Content: "Melanie often goes to the beach.", MemoryType: domain.TypeInsight},
		{ID: "m2", Content: "Melanie went to the beach 3 times in 2023.", MemoryType: domain.TypeSession},
		{ID: "m3", Content: "Melanie enjoys beach trips with friends.", MemoryType: domain.TypeInsight},
	}

	got := rerankGroundedMemories("how many times has melanie gone to the beach in 2023", mems)
	if got[0].ID != "m2" {
		t.Fatalf("expected quantified evidence to move first, got %q", got[0].ID)
	}
}
