package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/service"
)

// testMemoryRepo is a minimal MemoryRepo mock for handler tests.
type testMemoryRepo struct {
	createCalls []*domain.Memory
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
func (m *testMemoryRepo) SoftDelete(context.Context, string, string) error             { return nil }
func (m *testMemoryRepo) ArchiveMemory(context.Context, string, string) error          { return nil }
func (m *testMemoryRepo) ArchiveAndCreate(_ context.Context, _, _ string, mem *domain.Memory) error {
	m.createCalls = append(m.createCalls, mem)
	return nil
}
func (m *testMemoryRepo) SetState(context.Context, string, domain.MemoryState) error { return nil }
func (m *testMemoryRepo) List(context.Context, domain.MemoryFilter) ([]domain.Memory, int, error) {
	return nil, 0, nil
}
func (m *testMemoryRepo) Count(context.Context) (int, error)                     { return 0, nil }
func (m *testMemoryRepo) BulkCreate(context.Context, []*domain.Memory) error     { return nil }
func (m *testMemoryRepo) VectorSearch(context.Context, []float32, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}
func (m *testMemoryRepo) AutoVectorSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}
func (m *testMemoryRepo) KeywordSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}
func (m *testMemoryRepo) FTSSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}
func (m *testMemoryRepo) FTSAvailable() bool                                                  { return false }
func (m *testMemoryRepo) ListBootstrap(context.Context, int) ([]domain.Memory, error)         { return nil, nil }

// testSessionRepo is a minimal SessionRepo mock for handler tests.
type testSessionRepo struct {
	bulkCreateCalled bool
	patchTagsCalled  bool
}

func (s *testSessionRepo) BulkCreate(context.Context, []*domain.Session) error {
	s.bulkCreateCalled = true
	return nil
}
func (s *testSessionRepo) PatchTags(context.Context, string, string, []string) error {
	s.patchTagsCalled = true
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
func (s *testSessionRepo) KeywordSearch(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error) {
	return nil, nil
}
func (s *testSessionRepo) FTSAvailable() bool { return false }
func (s *testSessionRepo) ListBySessionIDs(context.Context, []string, int) ([]*domain.Session, error) {
	return nil, nil
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
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{}
	srv := newTestServer(memRepo, sessRepo)

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
	if len(memRepo.createCalls) != 1 {
		t.Errorf("expected 1 create call, got %d", len(memRepo.createCalls))
	}
}

func TestCreateMemory_AsyncContent_Returns202(t *testing.T) {
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{}
	srv := newTestServer(memRepo, sessRepo)

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
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{}
	srv := newTestServer(memRepo, sessRepo)

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
	memRepo := &testMemoryRepo{}
	sessRepo := &testSessionRepo{}
	srv := newTestServer(memRepo, sessRepo)

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

	// Give the async goroutine time to complete.
	time.Sleep(50 * time.Millisecond)
}
