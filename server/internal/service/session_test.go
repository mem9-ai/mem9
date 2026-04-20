package service

import (
	"context"
	"errors"
	"github.com/qiffang/mnemos/server/internal/domain"
	"testing"
)

type stubSessionRepo struct {
	bulkCreateCalled bool
	bulkCreateErr    error
	createdSessions  []*domain.Session

	patchTagsCalled bool
	patchTagsErr    error
	patchedSession  string
	patchedHash     string
	patchedTags     []string

	keywordResults []domain.Memory
	keywordErr     error
	ftsResults     []domain.Memory
	ftsErr         error
	vecResults     []domain.Memory
	vecErr         error
	autoVecResults []domain.Memory
	autoVecErr     error
	ftsAvail       bool
}

func intPtr(v int) *int {
	return &v
}

func (s *stubSessionRepo) BulkCreate(_ context.Context, sessions []*domain.Session) error {
	s.bulkCreateCalled = true
	s.createdSessions = sessions
	return s.bulkCreateErr
}

func (s *stubSessionRepo) PatchTags(_ context.Context, sessionID, contentHash string, tags []string) error {
	s.patchTagsCalled = true
	s.patchedSession = sessionID
	s.patchedHash = contentHash
	s.patchedTags = tags
	return s.patchTagsErr
}

func (s *stubSessionRepo) AutoVectorSearch(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	return s.autoVecResults, s.autoVecErr
}

func (s *stubSessionRepo) VectorSearch(_ context.Context, _ []float32, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	return s.vecResults, s.vecErr
}

func (s *stubSessionRepo) FTSSearch(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	return s.ftsResults, s.ftsErr
}

func (s *stubSessionRepo) KeywordSearch(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	return s.keywordResults, s.keywordErr
}

func (s *stubSessionRepo) FTSAvailable() bool { return s.ftsAvail }

func (s *stubSessionRepo) ListBySessionIDs(_ context.Context, _ []string, _ int) ([]*domain.Session, error) {
	return nil, nil
}

func newTestSessionService(repo *stubSessionRepo) *SessionService {
	return NewSessionService(repo, nil, "")
}

func TestSessionService_BulkCreate_buildsCorrectSessions(t *testing.T) {
	repo := &stubSessionRepo{}
	svc := newTestSessionService(repo)

	req := IngestRequest{
		SessionID: "sess-1",
		AgentID:   "agent-x",
		Messages: []IngestMessage{
			{Role: "user", Content: "Hello world"},
			{Role: "assistant", Content: "Hi there"},
		},
	}

	if err := svc.BulkCreate(context.Background(), "source-agent", req); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !repo.bulkCreateCalled {
		t.Fatal("expected BulkCreate to be called")
	}
	if len(repo.createdSessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(repo.createdSessions))
	}

	s0 := repo.createdSessions[0]
	if s0.SessionID != "sess-1" {
		t.Errorf("session[0].SessionID = %q, want %q", s0.SessionID, "sess-1")
	}
	if s0.AgentID != "agent-x" {
		t.Errorf("session[0].AgentID = %q, want %q", s0.AgentID, "agent-x")
	}
	if s0.Role != "user" {
		t.Errorf("session[0].Role = %q, want %q", s0.Role, "user")
	}
	if s0.Seq != 0 {
		t.Errorf("session[0].Seq = %d, want 0", s0.Seq)
	}
	if s0.Content != "Hello world" {
		t.Errorf("session[0].Content = %q, want %q", s0.Content, "Hello world")
	}
	if s0.ContentHash == "" {
		t.Error("session[0].ContentHash must not be empty")
	}

	s1 := repo.createdSessions[1]
	if s1.Seq != 1 {
		t.Errorf("session[1].Seq = %d, want 1", s1.Seq)
	}
	if s1.Role != "assistant" {
		t.Errorf("session[1].Role = %q, want %q", s1.Role, "assistant")
	}

	if s0.ContentHash == s1.ContentHash {
		t.Error("different messages must produce different content hashes")
	}
}

func TestSessionService_BulkCreate_usesExplicitSeqWhenProvided(t *testing.T) {
	repo := &stubSessionRepo{}
	svc := newTestSessionService(repo)

	req := IngestRequest{
		SessionID: "sess-1",
		AgentID:   "agent-x",
		Messages: []IngestMessage{
			{Role: "user", Content: "Hello world", Seq: intPtr(7)},
			{Role: "assistant", Content: "Hi there", Seq: intPtr(11)},
		},
	}

	if err := svc.BulkCreate(context.Background(), "source-agent", req); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(repo.createdSessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(repo.createdSessions))
	}
	if repo.createdSessions[0].Seq != 7 {
		t.Fatalf("session[0].Seq = %d, want 7", repo.createdSessions[0].Seq)
	}
	if repo.createdSessions[1].Seq != 11 {
		t.Fatalf("session[1].Seq = %d, want 11", repo.createdSessions[1].Seq)
	}
}

func TestSessionService_BulkCreate_emptyMessages(t *testing.T) {
	repo := &stubSessionRepo{}
	svc := newTestSessionService(repo)

	req := IngestRequest{SessionID: "sess-1", Messages: []IngestMessage{}}
	if err := svc.BulkCreate(context.Background(), "src", req); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repo.bulkCreateCalled && len(repo.createdSessions) != 0 {
		t.Error("expected no sessions created for empty messages")
	}
}

func TestSessionService_BulkCreate_propagatesRepoError(t *testing.T) {
	sentinel := errors.New("db down")
	repo := &stubSessionRepo{bulkCreateErr: sentinel}
	svc := newTestSessionService(repo)

	req := IngestRequest{
		SessionID: "s",
		Messages:  []IngestMessage{{Role: "user", Content: "hi"}},
	}
	err := svc.BulkCreate(context.Background(), "src", req)
	if !errors.Is(err, sentinel) {
		t.Errorf("expected sentinel error, got %v", err)
	}
}

func TestSessionService_PatchTags_delegates(t *testing.T) {
	repo := &stubSessionRepo{}
	svc := newTestSessionService(repo)

	tags := []string{"tech", "question"}
	if err := svc.PatchTags(context.Background(), "sess-1", "hashval", tags); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !repo.patchTagsCalled {
		t.Fatal("expected PatchTags to be called on repo")
	}
	if repo.patchedSession != "sess-1" {
		t.Errorf("patchedSession = %q, want %q", repo.patchedSession, "sess-1")
	}
	if repo.patchedHash != "hashval" {
		t.Errorf("patchedHash = %q, want %q", repo.patchedHash, "hashval")
	}
	if len(repo.patchedTags) != 2 || repo.patchedTags[0] != "tech" {
		t.Errorf("patchedTags = %v, want [tech question]", repo.patchedTags)
	}
}

func TestSessionService_PatchTags_propagatesError(t *testing.T) {
	sentinel := errors.New("patch fail")
	repo := &stubSessionRepo{patchTagsErr: sentinel}
	svc := newTestSessionService(repo)

	err := svc.PatchTags(context.Background(), "s", "h", []string{"t"})
	if !errors.Is(err, sentinel) {
		t.Errorf("expected sentinel error, got %v", err)
	}
}

func TestSessionService_Search_keywordPath_returnsSessionType(t *testing.T) {
	mem := domain.Memory{
		ID:         "m1",
		Content:    "hello",
		MemoryType: domain.TypeSession,
		State:      domain.StateActive,
	}
	repo := &stubSessionRepo{
		keywordResults: []domain.Memory{mem},
		ftsAvail:       false,
	}
	svc := newTestSessionService(repo)

	f := domain.MemoryFilter{Query: "hello", Limit: 5}
	results, err := svc.Search(context.Background(), f)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].MemoryType != domain.TypeSession {
		t.Errorf("memory_type = %q, want %q", results[0].MemoryType, domain.TypeSession)
	}
}

func TestSessionService_Search_offsetZeroedBeforeRepo(t *testing.T) {
	var capturedFilter domain.MemoryFilter
	repo := &stubSessionRepo{
		keywordResults: []domain.Memory{},
		ftsAvail:       false,
	}
	repo.keywordResults = nil

	capturingRepo := &capturingSessionRepo{stub: repo, capturedFilter: &capturedFilter}
	svc := NewSessionService(capturingRepo, nil, "")

	f := domain.MemoryFilter{Query: "x", Limit: 10, Offset: 5}
	if _, err := svc.Search(context.Background(), f); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if capturedFilter.Offset != 0 {
		t.Errorf("filter.Offset passed to repo = %d, want 0 (sessions reset offset)", capturedFilter.Offset)
	}
}

func TestSessionService_Search_defaultLimit(t *testing.T) {
	repo := &stubSessionRepo{ftsAvail: false}
	svc := newTestSessionService(repo)

	_, err := svc.Search(context.Background(), domain.MemoryFilter{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSessionContentHash_differentInputsProduceDifferentHashes(t *testing.T) {
	cases := [][2]string{
		{"sess-a role-user content-x", "sess-a role-user content-y"},
		{"sess-a role-user content-x", "sess-b role-user content-x"},
		{"sess-a role-user content-x", "sess-a role-assistant content-x"},
	}
	for _, c := range cases {
		h1 := SessionContentHash("sess-a", "user", c[0], nil)
		h2 := SessionContentHash("sess-a", "user", c[1], nil)
		if h1 == h2 {
			t.Errorf("expected different hashes for different inputs: %q vs %q", c[0], c[1])
		}
	}
}

func TestSessionContentHash_sameInputProducesSameHash(t *testing.T) {
	h1 := SessionContentHash("sess-1", "user", "hello world", nil)
	h2 := SessionContentHash("sess-1", "user", "hello world", nil)
	if h1 != h2 {
		t.Errorf("expected identical hashes, got %q vs %q", h1, h2)
	}
}

func TestSessionContentHash_explicitSeqProducesDistinctHashes(t *testing.T) {
	h1 := SessionContentHash("sess-1", "assistant", "Take care, bye!", intPtr(15))
	h2 := SessionContentHash("sess-1", "assistant", "Take care, bye!", intPtr(36))
	if h1 == h2 {
		t.Fatalf("expected distinct hashes for explicit seq values, got %q", h1)
	}
}

type capturingSessionRepo struct {
	stub           *stubSessionRepo
	capturedFilter *domain.MemoryFilter
}

func (c *capturingSessionRepo) BulkCreate(ctx context.Context, s []*domain.Session) error {
	return c.stub.BulkCreate(ctx, s)
}
func (c *capturingSessionRepo) PatchTags(ctx context.Context, sid, hash string, tags []string) error {
	return c.stub.PatchTags(ctx, sid, hash, tags)
}
func (c *capturingSessionRepo) AutoVectorSearch(ctx context.Context, q string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	*c.capturedFilter = f
	return c.stub.AutoVectorSearch(ctx, q, f, limit)
}
func (c *capturingSessionRepo) VectorSearch(ctx context.Context, v []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	*c.capturedFilter = f
	return c.stub.VectorSearch(ctx, v, f, limit)
}
func (c *capturingSessionRepo) FTSSearch(ctx context.Context, q string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	*c.capturedFilter = f
	return c.stub.FTSSearch(ctx, q, f, limit)
}
func (c *capturingSessionRepo) KeywordSearch(ctx context.Context, q string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	*c.capturedFilter = f
	return c.stub.KeywordSearch(ctx, q, f, limit)
}
func (c *capturingSessionRepo) FTSAvailable() bool { return c.stub.FTSAvailable() }

func (c *capturingSessionRepo) ListBySessionIDs(ctx context.Context, ids []string, limit int) ([]*domain.Session, error) {
	return c.stub.ListBySessionIDs(ctx, ids, limit)
}
