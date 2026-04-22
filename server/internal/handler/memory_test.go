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
func (m *testMemoryRepo) BulkSoftDelete(_ context.Context, ids []string, _ string) (int64, error) {
	m.bulkSoftDeleteCalls = append(m.bulkSoftDeleteCalls, append([]string(nil), ids...))
	return m.bulkSoftDeleteResult, nil
}
func (m *testMemoryRepo) ArchiveMemory(context.Context, string, string) error { return nil }
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

func (m *testMemoryRepo) KeywordSearch(ctx context.Context, query string, filter domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	m.lastKeywordFilter = filter
	if m.keywordSearchHook != nil {
		return m.keywordSearchHook(ctx, query, filter, limit)
	}
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

func (m *testMemoryRepo) CountStats(context.Context) (int64, int64, error) {
	return m.countStatsTotal, m.countStatsLast7d, m.countStatsErr
}

// testSessionRepo is a minimal SessionRepo mock for handler tests.
type testSessionRepo struct {
	bulkCreateCalled     bool
	patchTagsCalled      bool
	patchedHash          string
	patchedSessionID     string
	patchedTags          []string
	sessions             []*domain.Session // captured from BulkCreate
	keywordSearchResults []domain.Memory
	keywordSearchHook    func(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error)
	lastKeywordFilter    domain.MemoryFilter
}

func (s *testSessionRepo) BulkCreate(_ context.Context, sessions []*domain.Session) error {
	s.bulkCreateCalled = true
	s.sessions = sessions
	return nil
}

func (s *testSessionRepo) PatchTags(_ context.Context, sessionID, hash string, tags []string) error {
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
	s.lastKeywordFilter = filter
	if s.keywordSearchHook != nil {
		return s.keywordSearchHook(ctx, query, filter, limit)
	}
	return append([]domain.Memory(nil), s.keywordSearchResults...), nil
}
func (s *testSessionRepo) FTSAvailable() bool { return false }
func (s *testSessionRepo) ListBySessionIDs(context.Context, []string, int) ([]*domain.Session, error) {
	return nil, nil
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
