package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

type stubSessionRepo struct {
	bulkCreateCalled bool
	bulkCreateErr    error
	createdSessions  []*domain.Session

	patchTagsCalled bool
	patchTagsErr    error
	patchedAppID    string
	patchedSession  string
	patchedHash     string
	patchedTags     []string

	keywordResults []domain.Memory
	keywordErr     error
	keywordQuery   string
	keywordFilter  domain.MemoryFilter
	keywordLimit   int
	ftsResults     []domain.Memory
	ftsErr         error
	vecResults     []domain.Memory
	vecErr         error
	autoVecResults []domain.Memory
	autoVecErr     error
	ftsAvail       bool
	sessionRows    []*domain.Session
	listAppID      *string
	listSessionIDs []string
	listLimit      int
	listCalls      []sessionListCall
	getResult      *domain.Memory
	getErr         error
	listResults    []domain.Memory
	listTotal      int
	listFilter     domain.MemoryFilter
	softDeleteID   string
	bulkDeleteIDs  []string
	overlays       map[string]*domain.SessionEdit
}

type sessionListCall struct {
	ids   []string
	appID *string
	limit int
}

func intPtr(v int) *int {
	return &v
}

func (s *stubSessionRepo) BulkCreate(_ context.Context, sessions []*domain.Session) error {
	s.bulkCreateCalled = true
	s.createdSessions = sessions
	return s.bulkCreateErr
}

func (s *stubSessionRepo) PatchTags(_ context.Context, appID, sessionID, contentHash string, tags []string) error {
	s.patchTagsCalled = true
	s.patchedAppID = appID
	s.patchedSession = sessionID
	s.patchedHash = contentHash
	s.patchedTags = tags
	return s.patchTagsErr
}

func (s *stubSessionRepo) GetByID(_ context.Context, _ string) (*domain.Memory, error) {
	return s.getResult, s.getErr
}

func (s *stubSessionRepo) List(_ context.Context, f domain.MemoryFilter) ([]domain.Memory, int, error) {
	s.listFilter = f
	return append([]domain.Memory(nil), s.listResults...), s.listTotal, nil
}

func (s *stubSessionRepo) SoftDelete(_ context.Context, id, _ string) (int64, error) {
	s.softDeleteID = id
	return 1, nil
}

func (s *stubSessionRepo) BulkSoftDelete(_ context.Context, ids []string, _ string) (int64, error) {
	s.bulkDeleteIDs = append([]string(nil), ids...)
	return int64(len(ids)), nil
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

func (s *stubSessionRepo) KeywordSearch(_ context.Context, query string, filter domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	s.keywordQuery = query
	s.keywordFilter = filter
	s.keywordLimit = limit
	return s.keywordResults, s.keywordErr
}

func (s *stubSessionRepo) FTSAvailable() bool { return s.ftsAvail }

func (s *stubSessionRepo) ListBySessionIDs(_ context.Context, ids []string, appID *string, limit int) ([]*domain.Session, error) {
	if appID != nil {
		v := *appID
		s.listAppID = &v
	} else {
		s.listAppID = nil
	}
	s.listSessionIDs = append([]string(nil), ids...)
	s.listLimit = limit
	call := sessionListCall{
		ids:   append([]string(nil), ids...),
		limit: limit,
	}
	if appID != nil {
		v := *appID
		call.appID = &v
	}
	s.listCalls = append(s.listCalls, call)
	return append([]*domain.Session(nil), s.sessionRows...), nil
}

func (s *stubSessionRepo) UpsertSessionEdit(_ context.Context, edit *domain.SessionEdit) error {
	if s.overlays == nil {
		s.overlays = map[string]*domain.SessionEdit{}
	}
	cp := *edit
	if existing, ok := s.overlays[edit.ID]; ok {
		cp.Version = existing.Version + 1
		cp.OriginalContent = existing.OriginalContent
		if !cp.EditedTagsSet {
			cp.EditedTags = existing.EditedTags
			cp.EditedTagsSet = existing.EditedTagsSet
		}
	} else {
		cp.Version = 1
	}
	if cp.State == "" {
		cp.State = domain.StateActive
	}
	s.overlays[edit.ID] = &cp
	return nil
}

func (s *stubSessionRepo) GetSessionEdit(_ context.Context, id string) (*domain.SessionEdit, error) {
	if ov, ok := s.overlays[id]; ok && ov.State == domain.StateActive {
		cp := *ov
		return &cp, nil
	}
	return nil, domain.ErrNotFound
}

func (s *stubSessionRepo) GetSessionEditsByIDs(_ context.Context, ids []string) (map[string]*domain.SessionEdit, error) {
	out := map[string]*domain.SessionEdit{}
	for _, id := range ids {
		if ov, ok := s.overlays[id]; ok && ov.State == domain.StateActive {
			cp := *ov
			out[id] = &cp
		}
	}
	return out, nil
}

func (s *stubSessionRepo) DeleteSessionEdit(_ context.Context, id string) (int64, error) {
	if _, ok := s.overlays[id]; ok {
		delete(s.overlays, id)
		return 1, nil
	}
	return 0, nil
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
		AppID:     "chat-app",
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
	if s0.AppID != "chat-app" {
		t.Errorf("session[0].AppID = %q, want %q", s0.AppID, "chat-app")
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
	if err := svc.PatchTags(context.Background(), "chat-app", "sess-1", "hashval", tags); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !repo.patchTagsCalled {
		t.Fatal("expected PatchTags to be called on repo")
	}
	if repo.patchedSession != "sess-1" {
		t.Errorf("patchedSession = %q, want %q", repo.patchedSession, "sess-1")
	}
	if repo.patchedAppID != "chat-app" {
		t.Errorf("patchedAppID = %q, want %q", repo.patchedAppID, "chat-app")
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

	err := svc.PatchTags(context.Background(), "", "s", "h", []string{"t"})
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

func TestSessionService_ContentKeywordSearchBypassesFTS(t *testing.T) {
	memories := []domain.Memory{
		{ID: "s1", Content: "old mem9小组 session", MemoryType: domain.TypeSession, State: domain.StateActive},
		{ID: "s2", Content: "new mem9小组 session", MemoryType: domain.TypeSession, State: domain.StateActive},
	}
	repo := &stubSessionRepo{
		keywordResults: memories,
		ftsAvail:       true,
	}
	svc := newTestSessionService(repo)

	results, total, err := svc.ContentKeywordSearch(context.Background(), domain.MemoryFilter{
		Query:     "mem9小组",
		Source:    "console",
		SessionID: "session-1",
		Limit:     1,
		Offset:    1,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if total != 2 || len(results) != 1 || results[0].ID != "s2" {
		t.Fatalf("unexpected page: total=%d results=%+v", total, results)
	}
	if repo.keywordQuery != "mem9小组" {
		t.Fatalf("keyword query = %q, want mem9小组", repo.keywordQuery)
	}
	if repo.keywordFilter.Source != "console" || repo.keywordFilter.SessionID != "session-1" {
		t.Fatalf("keyword filter = %+v", repo.keywordFilter)
	}
	if repo.keywordLimit != 3 {
		t.Fatalf("keyword limit = %d, want 3", repo.keywordLimit)
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

func TestSessionService_ListDelegatesToRepo(t *testing.T) {
	repo := &stubSessionRepo{
		listResults: []domain.Memory{{ID: "s-1", MemoryType: domain.TypeSession}},
		listTotal:   3,
	}
	svc := newTestSessionService(repo)

	results, total, err := svc.List(context.Background(), domain.MemoryFilter{
		MemoryType: "session",
		Limit:      10,
		Offset:     20,
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 3 || len(results) != 1 || results[0].ID != "s-1" {
		t.Fatalf("results=%+v total=%d, want s-1 total 3", results, total)
	}
	if repo.listFilter.Limit != 10 || repo.listFilter.Offset != 20 {
		t.Fatalf("repo list filter = %+v", repo.listFilter)
	}
}

func TestSessionService_BulkDeleteDeduplicatesIDs(t *testing.T) {
	repo := &stubSessionRepo{}
	svc := newTestSessionService(repo)

	deleted, err := svc.BulkDelete(context.Background(), []string{"s-1", "s-1", "", "s-2"}, "agent")
	if err != nil {
		t.Fatalf("BulkDelete: %v", err)
	}
	if deleted != 2 {
		t.Fatalf("deleted = %d, want 2", deleted)
	}
	if len(repo.bulkDeleteIDs) != 2 || repo.bulkDeleteIDs[0] != "s-1" || repo.bulkDeleteIDs[1] != "s-2" {
		t.Fatalf("bulk delete ids = %+v", repo.bulkDeleteIDs)
	}
}

func TestSessionService_SearchCandidates_ExpandsAdjacentTurns(t *testing.T) {
	now := time.Now()
	repo := &stubSessionRepo{
		keywordResults: []domain.Memory{
			{
				ID:         "s-question",
				SessionID:  "sess-1",
				Content:    "Which company do you like the most these days?",
				MemoryType: domain.TypeSession,
				Metadata:   json.RawMessage(`{"role":"user","seq":7,"content_type":"text"}`),
				UpdatedAt:  now,
				State:      domain.StateActive,
			},
		},
		sessionRows: []*domain.Session{
			{ID: "s-question", SessionID: "sess-1", Seq: 7, Role: "user", Content: "Which company do you like the most these days?", ContentType: "text", State: domain.StateActive, CreatedAt: now.Add(-1 * time.Minute), UpdatedAt: now.Add(-1 * time.Minute)},
			{ID: "s-answer", SessionID: "sess-1", Seq: 8, Role: "assistant", Content: `Definitely "Under Armour" right now.`, ContentType: "text", State: domain.StateActive, CreatedAt: now, UpdatedAt: now},
		},
	}
	svc := newTestSessionService(repo)

	candidates, err := svc.SearchCandidates(context.Background(), domain.MemoryFilter{Query: "What company does John like?", Limit: 5}, RecallSourceSession, RecallCandidateOptions{
		EnableAdjacentTurns: true,
		AdjacentTurnRadius:  1,
		AdjacentTurnTopN:    2,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(candidates) != 2 {
		t.Fatalf("expected 2 candidates, got %d", len(candidates))
	}
	if candidates[0].Memory.ID != "s-question" {
		t.Fatalf("expected seed candidate to remain present, got %q", candidates[0].Memory.ID)
	}
	if candidates[1].Memory.ID != "s-answer" {
		t.Fatalf("expected adjacent answer candidate to be appended, got %q", candidates[1].Memory.ID)
	}
	if len(repo.listSessionIDs) != 1 || repo.listSessionIDs[0] != "sess-1" {
		t.Fatalf("expected ListBySessionIDs to request sess-1, got %+v", repo.listSessionIDs)
	}
}

func TestSessionService_SearchCandidates_AdjacentTurnsUseSeedAppID(t *testing.T) {
	now := time.Now()
	repo := &stubSessionRepo{
		keywordResults: []domain.Memory{
			{
				ID:         "s-question",
				SessionID:  "sess-1",
				AppID:      "app-a",
				Content:    "Which company do you like the most these days?",
				MemoryType: domain.TypeSession,
				Metadata:   json.RawMessage(`{"role":"user","seq":7,"content_type":"text"}`),
				UpdatedAt:  now,
				State:      domain.StateActive,
			},
		},
		sessionRows: []*domain.Session{
			{ID: "s-question", SessionID: "sess-1", AppID: "app-a", Seq: 7, Role: "user", Content: "Which company do you like the most these days?", ContentType: "text", State: domain.StateActive, CreatedAt: now.Add(-1 * time.Minute), UpdatedAt: now.Add(-1 * time.Minute)},
			{ID: "s-answer", SessionID: "sess-1", AppID: "app-a", Seq: 8, Role: "assistant", Content: `Definitely "Under Armour" right now.`, ContentType: "text", State: domain.StateActive, CreatedAt: now, UpdatedAt: now},
		},
	}
	svc := newTestSessionService(repo)

	candidates, err := svc.SearchCandidates(context.Background(), domain.MemoryFilter{Query: "What company does John like?", Limit: 5}, RecallSourceSession, RecallCandidateOptions{
		EnableAdjacentTurns: true,
		AdjacentTurnRadius:  1,
		AdjacentTurnTopN:    2,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(candidates) != 2 {
		t.Fatalf("expected 2 candidates, got %d", len(candidates))
	}
	if repo.listAppID == nil || *repo.listAppID != "app-a" {
		t.Fatalf("expected ListBySessionIDs to scope app-a, got %#v", repo.listAppID)
	}
}

func TestAdjacentTurnMemoriesSeparatesSharedSessionIDByAppID(t *testing.T) {
	now := time.Now()
	seeds := []RecallCandidate{
		{
			Memory: domain.Memory{
				ID:        "app-a-question",
				SessionID: "shared-session",
				AppID:     "app-a",
			},
		},
	}
	sessions := []*domain.Session{
		{ID: "app-a-question", SessionID: "shared-session", AppID: "app-a", Seq: 1, Role: "user", Content: "question", ContentType: "text", State: domain.StateActive, CreatedAt: now, UpdatedAt: now},
		{ID: "app-b-answer", SessionID: "shared-session", AppID: "app-b", Seq: 2, Role: "assistant", Content: "wrong app answer", ContentType: "text", State: domain.StateActive, CreatedAt: now.Add(time.Second), UpdatedAt: now.Add(time.Second)},
	}

	got := adjacentTurnMemories(seeds, sessions, 1)
	if len(got) != 0 {
		t.Fatalf("expected no adjacent memories from another app, got %+v", got)
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
func (c *capturingSessionRepo) PatchTags(ctx context.Context, appID, sid, hash string, tags []string) error {
	return c.stub.PatchTags(ctx, appID, sid, hash, tags)
}
func (c *capturingSessionRepo) GetByID(ctx context.Context, id string) (*domain.Memory, error) {
	return c.stub.GetByID(ctx, id)
}
func (c *capturingSessionRepo) List(ctx context.Context, f domain.MemoryFilter) ([]domain.Memory, int, error) {
	return c.stub.List(ctx, f)
}
func (c *capturingSessionRepo) SoftDelete(ctx context.Context, id, agentName string) (int64, error) {
	return c.stub.SoftDelete(ctx, id, agentName)
}
func (c *capturingSessionRepo) BulkSoftDelete(ctx context.Context, ids []string, agentName string) (int64, error) {
	return c.stub.BulkSoftDelete(ctx, ids, agentName)
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

func (c *capturingSessionRepo) ListBySessionIDs(ctx context.Context, ids []string, appID *string, limit int) ([]*domain.Session, error) {
	return c.stub.ListBySessionIDs(ctx, ids, appID, limit)
}
func (c *capturingSessionRepo) UpsertSessionEdit(ctx context.Context, edit *domain.SessionEdit) error {
	return c.stub.UpsertSessionEdit(ctx, edit)
}
func (c *capturingSessionRepo) GetSessionEdit(ctx context.Context, id string) (*domain.SessionEdit, error) {
	return c.stub.GetSessionEdit(ctx, id)
}
func (c *capturingSessionRepo) GetSessionEditsByIDs(ctx context.Context, ids []string) (map[string]*domain.SessionEdit, error) {
	return c.stub.GetSessionEditsByIDs(ctx, ids)
}
func (c *capturingSessionRepo) DeleteSessionEdit(ctx context.Context, id string) (int64, error) {
	return c.stub.DeleteSessionEdit(ctx, id)
}
