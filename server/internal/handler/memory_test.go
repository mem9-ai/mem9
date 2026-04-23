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
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/metering"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/service"
)

// testMemoryRepo is a minimal MemoryRepo mock for handler tests.
type testMemoryRepo struct {
	mu                   sync.Mutex
	createCalls          []*domain.Memory
	keywordSearchResults []domain.Memory
	keywordSearchHook    func(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error)
	lastKeywordFilter    domain.MemoryFilter
	bulkSoftDeleteCalls  [][]string
	bulkSoftDeleteResult int64
	countStatsTotal      int64
	countStatsLast7d     int64
	countStatsErr        error
}

func (m *testMemoryRepo) Create(_ context.Context, mem *domain.Memory) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.createCalls = append(m.createCalls, mem)
	return nil
}

func (m *testMemoryRepo) GetByID(_ context.Context, id string) (*domain.Memory, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
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
func (m *testMemoryRepo) BulkSoftDelete(_ context.Context, ids []string, _ string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.bulkSoftDeleteCalls = append(m.bulkSoftDeleteCalls, append([]string(nil), ids...))
	return m.bulkSoftDeleteResult, nil
}
func (m *testMemoryRepo) ArchiveMemory(context.Context, string, string) error { return nil }
func (m *testMemoryRepo) ArchiveAndCreate(_ context.Context, _, _ string, mem *domain.Memory) error {
	m.mu.Lock()
	defer m.mu.Unlock()
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

func (m *testMemoryRepo) KeywordSearch(ctx context.Context, query string, filter domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	m.mu.Lock()
	m.lastKeywordFilter = filter
	hook := m.keywordSearchHook
	results := append([]domain.Memory(nil), m.keywordSearchResults...)
	m.mu.Unlock()
	if hook != nil {
		return hook(ctx, query, filter, limit)
	}
	return results, nil
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

func (m *testMemoryRepo) CountStats(context.Context) (int64, int64, error) {
	return m.countStatsTotal, m.countStatsLast7d, m.countStatsErr
}

// testSessionRepo is a minimal SessionRepo mock for handler tests.
type testSessionRepo struct {
	mu                   sync.Mutex
	bulkCreateCalled     bool
	patchTagsCalled      bool
	patchedHash          string
	patchedSessionID     string
	patchedTags          []string
	sessions             []*domain.Session // captured from BulkCreate
	keywordSearchResults []domain.Memory
	keywordSearchHook    func(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error)
	lastKeywordFilter    domain.MemoryFilter
	sessionListResults   []*domain.Session
	lastSessionIDs       []string
	lastSessionLimit     int
}

func (s *testSessionRepo) BulkCreate(_ context.Context, sessions []*domain.Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bulkCreateCalled = true
	s.sessions = sessions
	return nil
}

func (s *testSessionRepo) PatchTags(_ context.Context, sessionID, hash string, tags []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.patchTagsCalled = true
	s.patchedSessionID = sessionID
	s.patchedHash = hash
	s.patchedTags = append([]string(nil), tags...)
	return nil
}

func (s *testSessionRepo) AutoVectorSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}

func (s *testSessionRepo) VectorSearch(context.Context, []float32, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}

func (s *testSessionRepo) FTSSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}

func (s *testSessionRepo) KeywordSearch(ctx context.Context, query string, filter domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	s.mu.Lock()
	s.lastKeywordFilter = filter
	hook := s.keywordSearchHook
	results := append([]domain.Memory(nil), s.keywordSearchResults...)
	s.mu.Unlock()
	if hook != nil {
		return hook(ctx, query, filter, limit)
	}
	return results, nil
}
func (s *testSessionRepo) FTSAvailable() bool { return false }
func (s *testSessionRepo) ListBySessionIDs(_ context.Context, sessionIDs []string, limit int) ([]*domain.Session, error) {
	s.lastSessionIDs = append([]string(nil), sessionIDs...)
	s.lastSessionLimit = limit
	return append([]*domain.Session(nil), s.sessionListResults...), nil
}

func intPtr(v int) *int {
	return &v
}

type captureMeteringWriter struct {
	mu     sync.Mutex
	events []metering.Event
}

func (w *captureMeteringWriter) Record(evt metering.Event) {
	w.mu.Lock()
	defer w.mu.Unlock()
	evt.Data = cloneMap(evt.Data)
	w.events = append(w.events, evt)
}

func (w *captureMeteringWriter) Close(context.Context) error { return nil }

func (w *captureMeteringWriter) snapshot() []metering.Event {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make([]metering.Event, len(w.events))
	copy(out, w.events)
	return out
}

type blockingMeteringWriter struct {
	started chan struct{}
	release chan struct{}
}

func (w *blockingMeteringWriter) Record(evt metering.Event) {
	close(w.started)
	<-w.release
}

func (w *blockingMeteringWriter) Close(context.Context) error { return nil }

func cloneMap(in map[string]any) map[string]any {
	if in == nil {
		return nil
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func waitForMeteringEvents(t *testing.T, writer *captureMeteringWriter, want int, timeout time.Duration) []metering.Event {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		events := writer.snapshot()
		if len(events) == want {
			return events
		}
		time.Sleep(5 * time.Millisecond)
	}
	events := writer.snapshot()
	t.Fatalf("timed out waiting for %d metering events, got %d", want, len(events))
	return nil
}

func ensureNoMeteringEvents(t *testing.T, writer *captureMeteringWriter, timeout time.Duration) {
	t.Helper()
	time.Sleep(timeout)
	events := writer.snapshot()
	if len(events) != 0 {
		t.Fatalf("expected no metering events, got %+v", events)
	}
}

// newTestServer creates a Server with pre-populated svcCache for testing.
func newTestServer(memRepo *testMemoryRepo, sessRepo *testSessionRepo) *Server {
	srv := NewServer(nil, nil, "", nil, nil, "", false, service.ModeSmart, "", slog.Default())
	svc := resolvedSvc{
		memory:  service.NewMemoryService(memRepo, nil, nil, "", service.ModeSmart),
		ingest:  service.NewIngestService(memRepo, nil, nil, "", service.ModeSmart),
		session: service.NewSessionService(sessRepo, nil, ""),
	}
	// Pre-populate svcCache so resolveServices returns our test services.
	// Key format matches resolveServices: fmt.Sprintf("db-%p", auth.TenantDB)
	// When TenantDB is nil, %p formats as "0x0".
	srv.svcCache.Store(tenantSvcKey("db-0x0"), svc)
	srv.svcCache.Store(tenantSvcKey("tenant-a-0x0"), svc)
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

func makeTenantRequest(t *testing.T, method, path string, body any) *http.Request {
	t.Helper()
	req := makeRequest(t, method, path, body)
	auth := &domain.AuthInfo{
		AgentName: "test-agent",
		TenantID:  "tenant-a",
		ClusterID: "10006636",
	}
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

func TestCreateMemory_SyncContent_WithSessionID_DoesNotPersistRawSession(t *testing.T) {
	sessRepo := &testSessionRepo{}
	srv := newTestServer(&testMemoryRepo{}, sessRepo)

	body := map[string]any{
		"content":    "[speaker:Speaker 2] hello there",
		"session_id": "session-123",
		"metadata": map[string]any{
			"speaker":    "Speaker 2",
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
	if sessRepo.bulkCreateCalled {
		t.Fatal("did not expect session bulk create for content-based create path")
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

func TestCreateMemory_SyncMessages_RecordsIngestMetering(t *testing.T) {
	memRepo := &testMemoryRepo{countStatsTotal: 126}
	meteringWriter := &captureMeteringWriter{}
	srv := newTestServer(memRepo, &testSessionRepo{}).WithMetering(meteringWriter)

	body := map[string]any{
		"messages": []map[string]string{
			{"role": "user", "content": "hello"},
			{"role": "assistant", "content": "hi there"},
		},
		"session_id": "test-session",
		"sync":       true,
	}
	req := makeTenantRequest(t, http.MethodPost, "/memories", body)
	rr := httptest.NewRecorder()

	srv.createMemory(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	events := waitForMeteringEvents(t, meteringWriter, 1, time.Second)
	if events[0].Category != meteringCategoryAPI {
		t.Fatalf("event category = %q, want %q", events[0].Category, meteringCategoryAPI)
	}
	if events[0].TenantID != "tenant-a" || events[0].ClusterID != "10006636" {
		t.Fatalf("unexpected event identity: %+v", events[0])
	}
	if got := events[0].Data["event_type"]; got != "ingest" {
		t.Fatalf("event_type = %v, want ingest", got)
	}
	if got := events[0].Data["active_memory_count"]; got != int64(126) {
		t.Fatalf("active_memory_count = %v, want 126", got)
	}
}

func TestCreateMemory_SyncMessages_WaitsForMeteringBeforeReturning(t *testing.T) {
	memRepo := &testMemoryRepo{countStatsTotal: 126}
	blockingWriter := &blockingMeteringWriter{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	srv := newTestServer(memRepo, &testSessionRepo{}).WithMetering(blockingWriter)

	body := map[string]any{
		"messages": []map[string]string{
			{"role": "user", "content": "hello"},
			{"role": "assistant", "content": "hi there"},
		},
		"session_id": "test-session",
		"sync":       true,
	}
	req := makeTenantRequest(t, http.MethodPost, "/memories", body)
	rr := httptest.NewRecorder()
	done := make(chan struct{})

	go func() {
		srv.createMemory(rr, req)
		close(done)
	}()

	select {
	case <-blockingWriter.started:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for sync ingest metering to start")
	}

	select {
	case <-done:
		t.Fatal("sync createMemory returned before metering Record completed")
	case <-time.After(50 * time.Millisecond):
	}

	close(blockingWriter.release)

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for createMemory to return after metering completed")
	}

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestCreateMemory_SyncMessages_WithExplicitSeq_PersistsSessionSeq(t *testing.T) {
	sessRepo := &testSessionRepo{}
	srv := newTestServer(&testMemoryRepo{}, sessRepo)

	body := map[string]any{
		"messages": []map[string]any{
			{"role": "user", "content": "hello", "seq": 7},
			{"role": "assistant", "content": "hi there", "seq": 9},
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
	if len(sessRepo.sessions) != 2 {
		t.Fatalf("expected 2 persisted sessions, got %d", len(sessRepo.sessions))
	}
	if sessRepo.sessions[0].Seq != 7 {
		t.Fatalf("session[0].Seq = %d, want 7", sessRepo.sessions[0].Seq)
	}
	if sessRepo.sessions[1].Seq != 9 {
		t.Fatalf("session[1].Seq = %d, want 9", sessRepo.sessions[1].Seq)
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

func TestCreateMemory_AsyncMessages_ReconcileFailed_DoesNotRecordIngestMetering(t *testing.T) {
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
	meteringWriter := &captureMeteringWriter{}
	srv := NewServer(nil, nil, "", nil, llmClient, "", false, service.ModeSmart, "", slog.Default()).WithMetering(meteringWriter)
	svc := resolvedSvc{
		memory:  service.NewMemoryService(&memRepo.testMemoryRepo, nil, nil, "", service.ModeSmart),
		ingest:  service.NewIngestService(memRepo, llmClient, nil, "", service.ModeSmart),
		session: service.NewSessionService(&testSessionRepo{}, nil, ""),
	}
	srv.svcCache.Store(tenantSvcKey("tenant-a-0x0"), svc)

	body := map[string]any{
		"messages": []map[string]string{
			{"role": "user", "content": "hello"},
			{"role": "assistant", "content": "hi there"},
		},
		"session_id": "test-session",
	}
	req := makeTenantRequest(t, http.MethodPost, "/memories", body)
	rr := httptest.NewRecorder()

	srv.createMemory(rr, req)

	if rr.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rr.Code, rr.Body.String())
	}
	ensureNoMeteringEvents(t, meteringWriter, 100*time.Millisecond)
}

// failSearchMemoryRepo embeds testMemoryRepo but makes KeywordSearch fail,
// triggering gatherExistingMemories → reconcile → ReconcilePhase2 Status:"failed".
type failSearchMemoryRepo struct {
	testMemoryRepo
}

func (m *failSearchMemoryRepo) KeywordSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, errors.New("simulated search failure")
}

func TestCreateMemory_SyncMessages_Phase1Error_FallsBackToSuccess(t *testing.T) {
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

	srv := NewServer(nil, nil, "", nil, llmClient, "", false, service.ModeSmart, "", slog.Default())
	svc := resolvedSvc{
		memory:  service.NewMemoryService(&testMemoryRepo{}, nil, nil, "", service.ModeSmart),
		ingest:  service.NewIngestService(&testMemoryRepo{}, llmClient, nil, "", service.ModeSmart),
		session: service.NewSessionService(&testSessionRepo{}, nil, ""),
	}
	srv.svcCache.Store(tenantSvcKey("db-0x0"), svc)

	body := map[string]any{
		"messages": []map[string]string{
			{"role": "user", "content": "hello"},
			{"role": "assistant", "content": "noted"},
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
	srv := NewServer(nil, nil, "", nil, llmClient, "", false, service.ModeSmart, "", slog.Default())
	svc := resolvedSvc{
		memory:  service.NewMemoryService(&testMemoryRepo{}, nil, nil, "", service.ModeSmart),
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
	srv := NewServer(nil, nil, "", nil, llmClient, "", false, service.ModeSmart, "", slog.Default())
	svc := resolvedSvc{
		memory:  service.NewMemoryService(&memRepo.testMemoryRepo, nil, nil, "", service.ModeSmart),
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

func TestCreateMemory_SyncMessages_Timeout_FallsBackToSuccess(t *testing.T) {
	oldTimeout := syncIngestTimeout
	syncIngestTimeout = 10 * time.Millisecond
	defer func() { syncIngestTimeout = oldTimeout }()

	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
	}))
	defer llmServer.Close()

	llmClient := llm.New(llm.Config{
		APIKey:  "test-key",
		BaseURL: llmServer.URL,
		Model:   "test-model",
	})

	srv := NewServer(nil, nil, "", nil, llmClient, "", false, service.ModeSmart, "", slog.Default())
	svc := resolvedSvc{
		memory:  service.NewMemoryService(&testMemoryRepo{}, nil, nil, "", service.ModeSmart),
		ingest:  service.NewIngestService(&testMemoryRepo{}, llmClient, nil, "", service.ModeSmart),
		session: service.NewSessionService(&testSessionRepo{}, nil, ""),
	}
	srv.svcCache.Store(tenantSvcKey("db-0x0"), svc)

	body := map[string]any{
		"messages": []map[string]string{
			{"role": "user", "content": "hello"},
			{"role": "assistant", "content": "noted"},
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
}

func TestCreateMemory_SyncMessages_ExplicitSeqUsesSeqAwarePatchHash(t *testing.T) {
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{
					"content": `{"facts":[{"text":"test fact"}],"message_tags":[["tag1"],[]]}`,
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

	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{}
	srv := NewServer(nil, nil, "", nil, llmClient, "", false, service.ModeSmart, "", slog.Default())
	svc := resolvedSvc{
		memory:  service.NewMemoryService(memRepo, llmClient, nil, "", service.ModeSmart),
		ingest:  service.NewIngestService(memRepo, llmClient, nil, "", service.ModeSmart),
		session: service.NewSessionService(sessRepo, nil, ""),
	}
	srv.svcCache.Store(tenantSvcKey("db-0x0"), svc)

	body := map[string]any{
		"messages": []map[string]any{
			{"role": "assistant", "content": "Take care, bye!", "seq": 36},
			{"role": "assistant", "content": "See you soon", "seq": 37},
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
	if !sessRepo.patchTagsCalled {
		t.Fatal("expected PatchTags to be called")
	}
	wantHash := service.SessionContentHash("test-session", "assistant", "Take care, bye!", intPtr(36))
	if sessRepo.patchedHash != wantHash {
		t.Fatalf("patched hash = %q, want %q", sessRepo.patchedHash, wantHash)
	}
	if sessRepo.patchedSessionID != "test-session" {
		t.Fatalf("patched session_id = %q, want test-session", sessRepo.patchedSessionID)
	}
	if len(sessRepo.patchedTags) != 1 || sessRepo.patchedTags[0] != "tag1" {
		t.Fatalf("patched tags = %v, want [tag1]", sessRepo.patchedTags)
	}
}

func TestListMemories_DefaultRecall_PrefersSessionForExactQuery(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			switch filter.MemoryType {
			case string(domain.TypePinned):
				return nil, nil
			case string(domain.TypeInsight):
				return []domain.Memory{
					{ID: "m1", Content: "John likes a renowned outdoor gear company.", MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-48 * time.Hour), State: domain.StateActive},
				}, nil
			default:
				return nil, nil
			}
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "s1", Content: `John bought "Under Armour" boots last week.`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q=what%20company%20does%20john%20like&limit=10", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) != 1 {
		t.Fatalf("expected underfilled result set with 1 memory, got %d", len(resp.Memories))
	}
	if resp.Memories[0].ID != "s1" {
		t.Fatalf("expected session answer first, got %q", resp.Memories[0].ID)
	}
	if resp.Memories[0].Confidence == nil || *resp.Memories[0].Confidence < defaultMixedMinConfidence {
		t.Fatalf("expected confidence >= %d, got %+v", defaultMixedMinConfidence, resp.Memories[0].Confidence)
	}
}

func TestListMemories_DefaultRecall_RecordsMetering(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			switch filter.MemoryType {
			case string(domain.TypePinned):
				return nil, nil
			case string(domain.TypeInsight):
				return []domain.Memory{
					{ID: "m1", Content: `"Under Armour"`, MemoryType: domain.TypeInsight, UpdatedAt: now, State: domain.StateActive},
				}, nil
			default:
				return nil, nil
			}
		},
	}
	meteringWriter := &captureMeteringWriter{}
	srv := newTestServer(memRepo, &testSessionRepo{}).WithMetering(meteringWriter)

	req := makeTenantRequest(t, http.MethodGet, "/memories?q=what%20company%20does%20john%20like&limit=10", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	events := waitForMeteringEvents(t, meteringWriter, 1, time.Second)
	if events[0].Category != meteringCategoryAPI {
		t.Fatalf("event category = %q, want %q", events[0].Category, meteringCategoryAPI)
	}
	if events[0].TenantID != "tenant-a" || events[0].ClusterID != "10006636" {
		t.Fatalf("unexpected event identity: %+v", events[0])
	}
	if got := events[0].Data["event_type"]; got != "recall" {
		t.Fatalf("event_type = %v, want recall", got)
	}
	if got := events[0].Data["recall_call_count"]; got != 1 {
		t.Fatalf("recall_call_count = %v, want 1", got)
	}
}

func TestListMemories_DefaultRecall_ExactKeepsComplementaryInsightEvidence(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			switch filter.MemoryType {
			case string(domain.TypePinned):
				return nil, nil
			case string(domain.TypeInsight):
				return []domain.Memory{
					{ID: "m1", Content: `Caroline wants to provide "trans-focused counseling and mental health support".`, MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-90 * time.Minute), State: domain.StateActive},
				}, nil
			default:
				return nil, nil
			}
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "s1", Content: `[date:10:37 am on 27 June, 2023] [speaker:Caroline] Lately, I've been looking into counseling and mental health as a career. I want to help people who have gone through the same things as me.`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What career path has Caroline decided to pursue?")+"&limit=3", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) < 2 {
		t.Fatalf("expected complementary exact recall to keep at least 2 memories, got %d", len(resp.Memories))
	}

	ids := map[string]struct{}{}
	for _, mem := range resp.Memories {
		ids[mem.ID] = struct{}{}
	}
	if _, ok := ids["s1"]; !ok {
		t.Fatalf("expected session evidence to be retained, got %+v", resp.Memories)
	}
	if _, ok := ids["m1"]; !ok {
		t.Fatalf("expected complementary insight evidence to be retained, got %+v", resp.Memories)
	}
	if resp.Memories[0].ID != "s1" {
		t.Fatalf("expected direct session evidence first for exact query, got %q", resp.Memories[0].ID)
	}
}

func TestListMemories_DefaultRecall_PrefersTargetSpeakerForSpeechQuestion(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "m1", Content: `[date:12:48 am on 1 February, 2023] [speaker:Gina] I'm so proud of the new store location.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-1 * time.Minute), State: domain.StateActive},
				{ID: "m2", Content: `[date:12:48 am on 1 February, 2023] [speaker:Jon] Way to go, hard work's paying off!`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What did Jon say about Gina's progress with her store?")+"&limit=2", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatal("expected at least one memory")
	}
	if resp.Memories[0].ID != "m2" {
		t.Fatalf("expected target-speaker session first, got %q", resp.Memories[0].ID)
	}
}

func TestListMemories_DefaultRecall_DownranksCaptionHeavyNonVisualSessionNoise(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "m1", Content: "[date:1:26 pm on 3 April, 2023] [speaker:Jon] Gina, good luck with your store!\n[image-caption: a photo of a dress with a sign on it that says june bunty]", MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
				{ID: "m2", Content: "[date:12:48 am on 1 February, 2023] [speaker:Jon] Wow, Gina! You found the perfect spot for your store. Way to go, hard work's paying off!", MemoryType: domain.TypeSession, UpdatedAt: now.Add(-1 * time.Minute), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What did Jon say about Gina's progress with her store?")+"&limit=2", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatal("expected at least one memory")
	}
	if resp.Memories[0].ID != "m2" {
		t.Fatalf("expected direct spoken session first, got %q", resp.Memories[0].ID)
	}
}

func TestListMemories_DefaultRecall_PrefersSubjectSpeakerForPersonalPreferenceQuestion(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "m1", Content: `[date:11:41 am on 6 November, 2023] [speaker:John] LeBron's moments of determination and heart are incredible.`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
				{ID: "m2", Content: `[date:3:00 pm on 2 October, 2023] [speaker:Tim] The Wolves are solid and LeBron's skills and leadership are amazing.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-1 * time.Minute), State: domain.StateActive},
				{ID: "m3", Content: `[date:3:00 pm on 2 October, 2023] [speaker:Tim] LeBron is incredible. Have you ever had the opportunity to meet him or see him play live?`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-2 * time.Minute), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What does John like about Lebron James?")+"&limit=3", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatal("expected at least one memory")
	}
	if resp.Memories[0].ID != "m1" {
		t.Fatalf("expected subject speaker answer first, got %q", resp.Memories[0].ID)
	}
}

func TestListMemories_DefaultRecall_PrefersSubjectAnswerForResearchQuestion(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "m1", Content: `[date:10:31 am on 13 October, 2023] [speaker:Melanie] Hey Caroline! Great to hear from you! Wow, what an amazing journey. Congrats!`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
				{ID: "m2", Content: `[date:10:31 am on 13 October, 2023] [speaker:Caroline] I researched adoption agencies and lawyers so I can understand the process better.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-1 * time.Minute), State: domain.StateActive},
				{ID: "m3", Content: `Caroline wants to adopt children and build a family.`, MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-2 * time.Minute), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What did Caroline research?")+"&limit=3", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatal("expected at least one memory")
	}
	if resp.Memories[0].ID != "m2" {
		t.Fatalf("expected subject research answer first, got %q", resp.Memories[0].ID)
	}
}

func TestListMemories_DefaultRecall_PrefersSelfIdentityStatement(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "m1", Content: `[date:10:31 am on 13 October, 2023] [speaker:Melanie] That's awesome, Caroline! You drew it? What does it mean to you?`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
				{ID: "m2", Content: `[date:10:31 am on 13 October, 2023] [speaker:Caroline] I'm a transgender woman, and that painting is about accepting who I am.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-1 * time.Minute), State: domain.StateActive},
				{ID: "m3", Content: `Caroline volunteers for the LGBTQ+ community.`, MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-2 * time.Minute), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What is Caroline's identity?")+"&limit=3", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatal("expected at least one memory")
	}
	if resp.Memories[0].ID != "m2" {
		t.Fatalf("expected self-identity statement first, got %q", resp.Memories[0].ID)
	}
}

func TestListMemories_DefaultRecall_PrefersRelationshipStatusSelfStatement(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "m1", Content: `[date:8:56 pm on 20 July, 2023] [speaker:Melanie] Hey Caroline! Good to talk to you again. What's up? Anything new since last time?`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
				{ID: "m2", Content: `[date:8:56 pm on 20 July, 2023] [speaker:Caroline] I'm single right now and focusing on getting ready to adopt.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-1 * time.Minute), State: domain.StateActive},
				{ID: "m3", Content: `Caroline is ready to be a mom and adopt children.`, MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-2 * time.Minute), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What is Caroline's relationship status?")+"&limit=3", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatal("expected at least one memory")
	}
	if resp.Memories[0].ID != "m2" {
		t.Fatalf("expected relationship-status self statement first, got %q", resp.Memories[0].ID)
	}
}

func TestListMemories_DefaultRecall_DemotesNonSubjectPromptForSymbolQuestion(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "m1", Content: `[date:10:31 am on 13 October, 2023] [speaker:Melanie] That's awesome, Caroline! You drew it? What does it mean to you?`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
				{ID: "m2", Content: `[date:3:31 pm on 23 August, 2023] [speaker:Caroline] Thanks, Melanie. Art gives me a sense of freedom, but so does having supportive people around, promoting LGBTQ rights and being true to myself.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-1 * time.Minute), State: domain.StateActive},
				{ID: "m3", Content: `Caroline views abstract art as a form of self-expression.`, MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-2 * time.Minute), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What does Caroline's drawing symbolize for her?")+"&limit=3", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatal("expected at least one memory")
	}
	if resp.Memories[0].ID != "m2" {
		t.Fatalf("expected subject answer turn first, got %q", resp.Memories[0].ID)
	}
}

func TestListMemories_DefaultRecall_ExpandsAdjacentSessionAnswerTurn(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			switch filter.MemoryType {
			case string(domain.TypePinned):
				return nil, nil
			case string(domain.TypeInsight):
				return []domain.Memory{
					{ID: "m1", Content: "John likes outdoor gear brands.", MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-2 * time.Hour), State: domain.StateActive},
				}, nil
			default:
				return nil, nil
			}
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{
					ID:         "s-question",
					SessionID:  "sess-1",
					Content:    "[speaker:Melanie] Which company do you like the most these days?",
					MemoryType: domain.TypeSession,
					Metadata:   json.RawMessage(`{"role":"user","seq":7,"content_type":"text"}`),
					UpdatedAt:  now,
					State:      domain.StateActive,
				},
			}, nil
		},
		sessionListResults: []*domain.Session{
			{ID: "s-before", SessionID: "sess-1", Seq: 6, Role: "assistant", Content: "I finally replaced my old hiking boots.", ContentType: "text", State: domain.StateActive, CreatedAt: now.Add(-2 * time.Minute), UpdatedAt: now.Add(-2 * time.Minute)},
			{ID: "s-question", SessionID: "sess-1", Seq: 7, Role: "user", Content: "Which company do you like the most these days?", ContentType: "text", State: domain.StateActive, CreatedAt: now.Add(-1 * time.Minute), UpdatedAt: now.Add(-1 * time.Minute)},
			{ID: "s-answer", SessionID: "sess-1", Seq: 8, Role: "assistant", Content: `Definitely "Under Armour" right now.`, ContentType: "text", State: domain.StateActive, CreatedAt: now, UpdatedAt: now},
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What company does John like?")+"&limit=3", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatal("expected at least one memory")
	}
	if resp.Memories[0].ID != "s-answer" {
		t.Fatalf("expected adjacent session answer first, got %q", resp.Memories[0].ID)
	}
	if resp.Memories[0].Confidence == nil || *resp.Memories[0].Confidence < defaultMixedMinConfidence {
		t.Fatalf("expected adjacent answer confidence >= %d, got %+v", defaultMixedMinConfidence, resp.Memories[0].Confidence)
	}
	if len(sessRepo.lastSessionIDs) != 1 || sessRepo.lastSessionIDs[0] != "sess-1" {
		t.Fatalf("expected adjacent expansion to inspect sess-1, got %+v", sessRepo.lastSessionIDs)
	}
}

func TestListMemories_DefaultRecall_KeepsQualifiedPinnedFirst(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			switch filter.MemoryType {
			case string(domain.TypePinned):
				return []domain.Memory{
					{ID: "p1", Content: `Acme standardizes on "Go" for backend services.`, MemoryType: domain.TypePinned, UpdatedAt: now, State: domain.StateActive},
				}, nil
			case string(domain.TypeInsight):
				return []domain.Memory{
					{ID: "m1", Content: "Acme likes backend tooling.", MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-24 * time.Hour), State: domain.StateActive},
				}, nil
			default:
				return nil, nil
			}
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "s1", Content: "Acme migrated billing to Rust last quarter.", MemoryType: domain.TypeSession, UpdatedAt: now.Add(-2 * time.Hour), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q=what%20language%20does%20acme%20use&limit=10", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatal("expected at least one memory")
	}
	if resp.Memories[0].ID != "p1" {
		t.Fatalf("expected pinned memory first, got %q", resp.Memories[0].ID)
	}
	if resp.Memories[0].MemoryType != domain.TypePinned {
		t.Fatalf("expected pinned memory type, got %q", resp.Memories[0].MemoryType)
	}
	if resp.Memories[0].Confidence == nil || *resp.Memories[0].Confidence < defaultPinnedMinConfidence {
		t.Fatalf("expected pinned confidence >= %d, got %+v", defaultPinnedMinConfidence, resp.Memories[0].Confidence)
	}
}

func TestListMemories_DefaultRecall_UnderfillsOnConfidenceGap(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			switch filter.MemoryType {
			case string(domain.TypePinned):
				return nil, nil
			case string(domain.TypeInsight):
				return []domain.Memory{
					{ID: "m1", Content: `"Under Armour"`, MemoryType: domain.TypeInsight, UpdatedAt: now, State: domain.StateActive},
					{ID: "m2", Content: "John likes outdoor gear in general.", MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-72 * time.Hour), State: domain.StateActive},
				}, nil
			default:
				return nil, nil
			}
		},
	}
	sessRepo := &testSessionRepo{}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q=what%20company%20does%20john%20like&limit=10", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) != 1 {
		t.Fatalf("expected confidence-gap underfill to keep 1 memory, got %d", len(resp.Memories))
	}
	if resp.Memories[0].ID != "m1" {
		t.Fatalf("expected highest-confidence memory retained, got %q", resp.Memories[0].ID)
	}
}

func TestListMemories_DefaultRecall_EnumerationCanExpandBeyondRequestedLimit(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			switch filter.MemoryType {
			case string(domain.TypePinned):
				return nil, nil
			case string(domain.TypeInsight):
				return []domain.Memory{
					{ID: "m1", Content: "Melanie enjoys pottery, camping, and painting.", MemoryType: domain.TypeInsight, UpdatedAt: now, State: domain.StateActive},
					{ID: "m2", Content: "Melanie regularly goes swimming.", MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-1 * time.Hour), State: domain.StateActive},
				}, nil
			default:
				return nil, nil
			}
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "s1", Content: "Melanie went hiking with her family last weekend.", MemoryType: domain.TypeSession, UpdatedAt: now.Add(-2 * time.Hour), State: domain.StateActive},
				{ID: "s2", Content: "Melanie takes pottery classes on weekends.", MemoryType: domain.TypeSession, UpdatedAt: now.Add(-3 * time.Hour), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What activities does Melanie partake in?")+"&limit=2", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) != 4 {
		t.Fatalf("expected enumeration recall to expand limit=2 into 4 returned memories, got %d", len(resp.Memories))
	}

	typeCounts := map[domain.MemoryType]int{}
	for _, mem := range resp.Memories {
		typeCounts[mem.MemoryType]++
		if mem.Confidence == nil || *mem.Confidence < enumerationMinConfidence {
			t.Fatalf("expected enumeration confidence >= %d for %q, got %+v", enumerationMinConfidence, mem.ID, mem.Confidence)
		}
	}
	if typeCounts[domain.TypeInsight] == 0 || typeCounts[domain.TypeSession] == 0 {
		t.Fatalf("expected mixed enumeration recall to include both insight and session memories, got %+v", typeCounts)
	}
}

func TestListMemories_DefaultRecall_ExactStillHonorsRequestedLimit(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			switch filter.MemoryType {
			case string(domain.TypePinned):
				return nil, nil
			case string(domain.TypeInsight):
				return []domain.Memory{
					{ID: "m1", Content: `"Under Armour"`, MemoryType: domain.TypeInsight, UpdatedAt: now, State: domain.StateActive},
					{ID: "m2", Content: `"Patagonia"`, MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-1 * time.Hour), State: domain.StateActive},
				}, nil
			default:
				return nil, nil
			}
		},
	}
	sessRepo := &testSessionRepo{}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What company does John like?")+"&limit=1", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) != 1 {
		t.Fatalf("expected exact recall to honor limit=1, got %d", len(resp.Memories))
	}
}

func TestListMemories_DefaultRecall_EnumerationFiltersLowConfidenceNoise(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			switch filter.MemoryType {
			case string(domain.TypePinned):
				return nil, nil
			case string(domain.TypeInsight):
				return []domain.Memory{
					{ID: "m1", Content: "it was", MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-24 * time.Hour), State: domain.StateActive},
				}, nil
			default:
				return nil, nil
			}
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "s1", Content: "they did", MemoryType: domain.TypeSession, UpdatedAt: now.Add(-48 * time.Hour), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What activities does Melanie partake in?")+"&limit=2", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) != 0 {
		t.Fatalf("expected low-confidence enumeration noise to be filtered out, got %d memories", len(resp.Memories))
	}
}

func TestClassifyRecallQueryShape_ExpandedEnumerationQueries(t *testing.T) {
	tests := []struct {
		query string
		want  recallQueryShape
	}{
		{query: "What instruments does Melanie play?", want: recallQueryShapeEnumeration},
		{query: "What are John's goals for his career?", want: recallQueryShapeEnumeration},
		{query: "In what ways is Caroline participating in the LGBTQ community?", want: recallQueryShapeEnumeration},
		{query: "How many times has Melanie gone to the beach in 2023?", want: recallQueryShapeEnumeration},
	}

	for _, tt := range tests {
		if got := classifyRecallQueryShape(tt.query); got != tt.want {
			t.Fatalf("classifyRecallQueryShape(%q) = %v, want %v", tt.query, got, tt.want)
		}
	}
}

func TestListMemories_DefaultRecall_EnumerationPrefersFocusMatchedMemories(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "m1", Content: `[date:6:55 pm on 20 October, 2023] [speaker:Melanie] Our camping trip got off to a bad start and the whole family was shaken up.`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
				{ID: "m2", Content: `[date:9:55 am on 22 October, 2023] [speaker:Melanie] These figurines I bought yesterday remind me of family love.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-1 * time.Minute), State: domain.StateActive},
				{ID: "m3", Content: `[date:11:54 am on 2 May, 2023] [speaker:Melanie] I bought a new pair of hiking shoes last week and they already feel broken in.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-2 * time.Minute), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("What items has Melanie bought?")+"&limit=2", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) < 2 {
		t.Fatalf("expected at least 2 memories, got %d", len(resp.Memories))
	}

	got := map[string]struct{}{
		resp.Memories[0].ID: {},
		resp.Memories[1].ID: {},
	}
	if _, ok := got["m2"]; !ok {
		t.Fatalf("expected figurines memory in top 2, got %+v", resp.Memories[:2])
	}
	if _, ok := got["m3"]; !ok {
		t.Fatalf("expected shoes memory in top 2, got %+v", resp.Memories[:2])
	}
}

func TestListMemories_DefaultRecall_RepeatCountIncludesConcreteEvents(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "m1", Content: `[date:8:56 pm on 20 July, 2023] [speaker:Melanie] Seeing my kids' faces so happy at the beach was the best! We don't go often, usually only once or twice a year.`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
				{ID: "m2", Content: `[date:8:56 pm on 20 July, 2023] [speaker:Melanie] We went to the beach recently and the kids had such a blast.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-1 * time.Minute), State: domain.StateActive},
				{ID: "m3", Content: `[date:1:33 pm on 25 August, 2023] [speaker:Melanie] We spent the afternoon at the beach again and I loved how peaceful it felt.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-2 * time.Minute), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("How many times has Melanie gone to the beach in 2023?")+"&limit=2", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) < 3 {
		t.Fatalf("expected expanded repeat-count recall to return at least 3 memories, got %d", len(resp.Memories))
	}

	got := map[string]struct{}{}
	for _, mem := range resp.Memories {
		got[mem.ID] = struct{}{}
	}
	if _, ok := got["m2"]; !ok {
		t.Fatalf("expected first beach event memory in returned set, got %+v", resp.Memories)
	}
	if _, ok := got["m3"]; !ok {
		t.Fatalf("expected second beach event memory in returned set, got %+v", resp.Memories)
	}
}

func TestListMemories_DefaultRecall_DurationPrefersExactSpanMemory(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "m1", Content: `[date:5:33 pm on 26 August, 2023] [speaker:Jolene] I've been into yoga lately and it helps me recharge.`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
				{ID: "m2", Content: `[date:7:18 pm on 2 March, 2023] [speaker:Jolene] I've been doing yoga for 3 years now and it keeps me grounded.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-1 * time.Minute), State: domain.StateActive},
				{ID: "m3", Content: `[date:7:39 pm on 8 September, 2023] [speaker:Jolene] Since February 2023, yoga has been part of my routine.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-2 * time.Minute), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("How long has Jolene been doing yoga?")+"&limit=2", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatalf("expected memories, got none")
	}
	if resp.Memories[0].ID != "m2" {
		t.Fatalf("expected exact duration memory first, got %+v", resp.Memories)
	}
}

func TestListMemories_DefaultRecall_FrequencyPrefersCadenceOverDuration(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "m1", Content: `[date:5:23 pm on 13 June, 2023] [speaker:Audrey] I take my dogs for walks multiple times a day.`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
				{ID: "m2", Content: `[date:5:23 pm on 13 June, 2023] [speaker:Audrey] We usually walk for about an hour and let them explore.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-1 * time.Minute), State: domain.StateActive},
				{ID: "m3", Content: `[date:7:09 pm on 1 October, 2023] [speaker:Audrey] Taking the dogs out for a walk in the park helps clear my mind.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-2 * time.Minute), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("How often does Audrey take her dogs for walks?")+"&limit=2", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatalf("expected memories, got none")
	}
	if resp.Memories[0].ID != "m1" {
		t.Fatalf("expected explicit cadence memory first, got %+v", resp.Memories)
	}
}

func TestListMemories_DefaultRecall_DurationDemotesQuestionTurns(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "m1", Content: `[date:7:55 pm on 9 June, 2023] [speaker:Caroline] Wow, what an amazing family pic! How long have you been married?`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
				{ID: "m2", Content: `[date:7:55 pm on 9 June, 2023] [speaker:Melanie] We've been married for 5 years now.`, MemoryType: domain.TypeSession, UpdatedAt: now.Add(-1 * time.Minute), State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("How long have Mel and her husband been married?")+"&limit=2", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatalf("expected memories, got none")
	}
	if resp.Memories[0].ID != "m2" {
		t.Fatalf("expected direct duration answer first, got %+v", resp.Memories)
	}
}

func TestDefaultConfidenceRecallSearch_FansOutPoolSearchesConcurrently(t *testing.T) {
	release := make(chan struct{})
	allStarted := make(chan struct{})
	var (
		mu          sync.Mutex
		started     int
		inFlight    int
		maxInFlight int
	)

	enter := func(ctx context.Context) error {
		mu.Lock()
		started++
		inFlight++
		if inFlight > maxInFlight {
			maxInFlight = inFlight
		}
		if started == 3 {
			close(allStarted)
		}
		mu.Unlock()

		defer func() {
			mu.Lock()
			inFlight--
			mu.Unlock()
		}()

		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	memRepo := &testMemoryRepo{
		keywordSearchHook: func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			if err := enter(ctx); err != nil {
				return nil, err
			}
			return nil, nil
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(ctx context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			if err := enter(ctx); err != nil {
				return nil, err
			}
			return nil, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)
	auth := &domain.AuthInfo{ClusterID: "cluster-a"}
	svc := srv.resolveServices(auth)
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()

	go func() {
		select {
		case <-allStarted:
			close(release)
		case <-ctx.Done():
		}
	}()

	if _, _, err := srv.defaultConfidenceRecallSearch(ctx, auth, svc, domain.MemoryFilter{
		Query: "tell me about john",
		Limit: 10,
	}); err != nil {
		t.Fatalf("expected concurrent recall fan-out to complete, got %v", err)
	}

	mu.Lock()
	gotStarted := started
	gotMaxInFlight := maxInFlight
	mu.Unlock()

	if gotStarted != 3 {
		t.Fatalf("expected 3 pool searches to start, got %d", gotStarted)
	}
	if gotMaxInFlight != 3 {
		t.Fatalf("expected all 3 pool searches to overlap, max_in_flight=%d", gotMaxInFlight)
	}
}

func TestListMemories_DefaultRecall_PrefersSessionForChineseExactQuery(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			switch filter.MemoryType {
			case string(domain.TypePinned):
				return nil, nil
			case string(domain.TypeInsight):
				return []domain.Memory{
					{ID: "m1", Content: "约翰喜欢户外品牌。", MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-48 * time.Hour), State: domain.StateActive},
				}, nil
			default:
				return nil, nil
			}
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "s1", Content: `约翰上周买了“Under Armour”靴子。`, MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("什么品牌是约翰喜欢的")+"&limit=10", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) != 1 {
		t.Fatalf("expected underfilled result set with 1 memory, got %d", len(resp.Memories))
	}
	if resp.Memories[0].ID != "s1" {
		t.Fatalf("expected Chinese exact-answer session first, got %q", resp.Memories[0].ID)
	}
	if resp.Memories[0].Confidence == nil || *resp.Memories[0].Confidence < defaultMixedMinConfidence {
		t.Fatalf("expected confidence >= %d, got %+v", defaultMixedMinConfidence, resp.Memories[0].Confidence)
	}
}

func TestListMemories_DefaultRecall_PrefersQuantifiedEvidenceForChineseCountQuery(t *testing.T) {
	now := time.Now()
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, filter domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			switch filter.MemoryType {
			case string(domain.TypePinned):
				return nil, nil
			case string(domain.TypeInsight):
				return []domain.Memory{
					{ID: "m1", Content: "Melanie 经常去海边。", MemoryType: domain.TypeInsight, UpdatedAt: now.Add(-24 * time.Hour), State: domain.StateActive},
				}, nil
			default:
				return nil, nil
			}
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return []domain.Memory{
				{ID: "s1", Content: "Melanie 在2023年去了3次海边。", MemoryType: domain.TypeSession, UpdatedAt: now, State: domain.StateActive},
			}, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape("多少次去过海边")+"&limit=10", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) == 0 {
		t.Fatal("expected at least one memory")
	}
	if resp.Memories[0].ID != "s1" {
		t.Fatalf("expected Chinese quantified session answer first, got %q", resp.Memories[0].ID)
	}
	if resp.Memories[0].Confidence == nil || *resp.Memories[0].Confidence < defaultMixedMinConfidence {
		t.Fatalf("expected confidence >= %d, got %+v", defaultMixedMinConfidence, resp.Memories[0].Confidence)
	}
}

func TestNormalizeRecallQuery_ChineseRelativeDates(t *testing.T) {
	now := time.Date(2026, time.April, 11, 9, 0, 0, 0, time.Local)

	tests := []struct {
		query string
		want  string
	}{
		{
			query: "我昨天开心吗",
			want:  "我昨天开心吗 2026-04-10 2026年4月10日 10 April 2026",
		},
		{
			query: "上周一部署了吗",
			want:  "上周一部署了吗 2026-03-30 2026年3月30日 30 March 2026",
		},
		{
			query: "下个月要不要去旅游",
			want:  "下个月要不要去旅游 2026-05 2026年5月 May 2026",
		},
		{
			query: "去年开心吗",
			want:  "去年开心吗 2025 2025年",
		},
	}

	for _, tt := range tests {
		if got := normalizeRecallQuery(tt.query, now); got != tt.want {
			t.Fatalf("normalizeRecallQuery(%q) = %q, want %q", tt.query, got, tt.want)
		}
	}
}

func TestNormalizeRecallQuery_EnglishQueryExpanded(t *testing.T) {
	now := time.Date(2026, time.April, 11, 9, 0, 0, 0, time.Local)
	query := "Was I happy yesterday?"

	if got := normalizeRecallQuery(query, now); got != "Was I happy yesterday? 2026-04-10 2026年4月10日 10 April 2026" {
		t.Fatalf("normalizeRecallQuery(%q) = %q, want expanded query", query, got)
	}
}

func TestNormalizeRecallQuery_LocalAnchorRemainsUnchanged(t *testing.T) {
	now := time.Date(2026, time.April, 11, 9, 0, 0, 0, time.Local)
	query := "4月23日的前一天发生了什么"

	if got := normalizeRecallQuery(query, now); got != query {
		t.Fatalf("normalizeRecallQuery(%q) = %q, want unchanged", query, got)
	}
}

func TestListMemories_DefaultRecall_NormalizesChineseRelativeQuery(t *testing.T) {
	memRepo := &testMemoryRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return nil, nil
		},
	}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return nil, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	rawQuery := "我昨天开心吗"
	expected := normalizeRecallQuery(rawQuery, time.Now())
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape(rawQuery)+"&limit=10", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if memRepo.lastKeywordFilter.Query != expected {
		t.Fatalf("memory filter query = %q, want %q", memRepo.lastKeywordFilter.Query, expected)
	}
	if sessRepo.lastKeywordFilter.Query != expected {
		t.Fatalf("session filter query = %q, want %q", sessRepo.lastKeywordFilter.Query, expected)
	}
}

func TestListMemories_SinglePoolRecall_NormalizesChineseRelativeQuery(t *testing.T) {
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{
		keywordSearchHook: func(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			return nil, nil
		},
	}
	srv := newTestServer(memRepo, sessRepo)

	rawQuery := "下个月要不要去旅游"
	expected := normalizeRecallQuery(rawQuery, time.Now())
	req := makeRequest(t, http.MethodGet, "/memories?q="+url.QueryEscape(rawQuery)+"&memory_type=session&limit=10", nil)
	rr := httptest.NewRecorder()

	srv.listMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if sessRepo.lastKeywordFilter.Query != expected {
		t.Fatalf("session filter query = %q, want %q", sessRepo.lastKeywordFilter.Query, expected)
	}
}
