package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
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
	nextSeq         int
	nextSeqErr      error

	keywordResults    []domain.Memory
	keywordErr        error
	ftsResults        []domain.Memory
	ftsErr            error
	vecResults        []domain.Memory
	vecErr            error
	autoVecResults    []domain.Memory
	autoVecByQuery    map[string][]domain.Memory
	autoVecQueries    []string
	autoVecErr        error
	setKeywordResults []domain.Memory
	setKeywordErr     error
	setFTSResults     []domain.Memory
	setFTSErr         error
	setVecResults     []domain.Memory
	setVecErr         error
	setAutoVecResults []domain.Memory
	setAutoVecByQuery map[string][]domain.Memory
	setAutoVecQueries []string
	setAutoVecErr     error
	neighborResults   []domain.Memory
	neighborErr       error
	ftsAvail          bool
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

func (s *stubSessionRepo) NextSeq(_ context.Context, _ string) (int, error) {
	if s.nextSeqErr != nil {
		return 0, s.nextSeqErr
	}
	next := s.nextSeq
	s.nextSeq++
	return next, nil
}

func (s *stubSessionRepo) AutoVectorSearch(_ context.Context, q string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	s.autoVecQueries = append(s.autoVecQueries, q)
	if s.autoVecByQuery != nil {
		if results, ok := s.autoVecByQuery[q]; ok {
			return results, s.autoVecErr
		}
		return nil, s.autoVecErr
	}
	return s.autoVecResults, s.autoVecErr
}

func (s *stubSessionRepo) AutoVectorSearchInSessionSet(_ context.Context, q string, _ domain.MemoryFilter, _ []string, _ int) ([]domain.Memory, error) {
	s.setAutoVecQueries = append(s.setAutoVecQueries, q)
	if s.setAutoVecByQuery != nil {
		if results, ok := s.setAutoVecByQuery[q]; ok {
			return results, s.setAutoVecErr
		}
		return nil, s.setAutoVecErr
	}
	return s.setAutoVecResults, s.setAutoVecErr
}

func (s *stubSessionRepo) VectorSearch(_ context.Context, _ []float32, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	return s.vecResults, s.vecErr
}

func (s *stubSessionRepo) VectorSearchInSessionSet(_ context.Context, _ []float32, _ domain.MemoryFilter, _ []string, _ int) ([]domain.Memory, error) {
	return s.setVecResults, s.setVecErr
}

func (s *stubSessionRepo) FTSSearch(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	return s.ftsResults, s.ftsErr
}

func (s *stubSessionRepo) FTSSearchInSessionSet(_ context.Context, _ string, _ domain.MemoryFilter, _ []string, _ int) ([]domain.Memory, error) {
	return s.setFTSResults, s.setFTSErr
}

func (s *stubSessionRepo) KeywordSearch(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	return s.keywordResults, s.keywordErr
}

func (s *stubSessionRepo) KeywordSearchInSessionSet(_ context.Context, _ string, _ domain.MemoryFilter, _ []string, _ int) ([]domain.Memory, error) {
	return s.setKeywordResults, s.setKeywordErr
}

func (s *stubSessionRepo) FTSAvailable() bool { return s.ftsAvail }

func (s *stubSessionRepo) ListBySessionIDs(_ context.Context, _ []string, _ int) ([]*domain.Session, error) {
	return nil, nil
}

func (s *stubSessionRepo) ListNeighbors(_ context.Context, _ string, _ int, _, _ int) ([]domain.Memory, error) {
	return s.neighborResults, s.neighborErr
}

func newTestSessionService(repo *stubSessionRepo) *SessionService {
	return NewSessionService(repo, nil, "")
}

func intPtr(v int) *int {
	return &v
}

func floatPtr(v float64) *float64 {
	return &v
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

func TestSessionService_BulkCreate_PreservesProvidedSeq(t *testing.T) {
	repo := &stubSessionRepo{nextSeq: 10}
	svc := newTestSessionService(repo)

	req := IngestRequest{
		SessionID: "sess-1",
		AgentID:   "agent-x",
		Messages: []IngestMessage{
			{Role: "user", Content: "first", Seq: intPtr(7)},
			{Role: "assistant", Content: "second", Seq: intPtr(8)},
		},
	}

	if err := svc.BulkCreate(context.Background(), "source-agent", req); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(repo.createdSessions) != 2 {
		t.Fatalf("expected 2 created sessions, got %d", len(repo.createdSessions))
	}
	if repo.createdSessions[0].Seq != 7 || repo.createdSessions[1].Seq != 8 {
		t.Fatalf("expected preserved seq [7 8], got [%d %d]", repo.createdSessions[0].Seq, repo.createdSessions[1].Seq)
	}
	if repo.nextSeq != 10 {
		t.Fatalf("expected NextSeq to remain unused, got nextSeq=%d", repo.nextSeq)
	}
}

func TestSessionService_BulkCreate_MissingSeqSkipsExplicitConflicts(t *testing.T) {
	repo := &stubSessionRepo{nextSeq: 0}
	svc := newTestSessionService(repo)

	req := IngestRequest{
		SessionID: "sess-1",
		AgentID:   "agent-x",
		Messages: []IngestMessage{
			{Role: "user", Content: "first", Seq: intPtr(0)},
			{Role: "assistant", Content: "second"},
			{Role: "user", Content: "third"},
		},
	}

	if err := svc.BulkCreate(context.Background(), "source-agent", req); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(repo.createdSessions) != 3 {
		t.Fatalf("expected 3 created sessions, got %d", len(repo.createdSessions))
	}
	if repo.createdSessions[0].Seq != 0 || repo.createdSessions[1].Seq != 1 || repo.createdSessions[2].Seq != 2 {
		t.Fatalf("expected seq [0 1 2], got [%d %d %d]", repo.createdSessions[0].Seq, repo.createdSessions[1].Seq, repo.createdSessions[2].Seq)
	}
}

func TestSessionService_BulkCreate_RejectsNegativeExplicitSeq(t *testing.T) {
	repo := &stubSessionRepo{nextSeq: 10}
	svc := newTestSessionService(repo)

	req := IngestRequest{
		SessionID: "sess-1",
		AgentID:   "agent-x",
		Messages: []IngestMessage{
			{Role: "user", Content: "first", Seq: intPtr(-1)},
		},
	}

	err := svc.BulkCreate(context.Background(), "source-agent", req)
	var ve *domain.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected ValidationError, got %T", err)
	}
	if ve.Field != "messages.seq" {
		t.Fatalf("expected field messages.seq, got %q", ve.Field)
	}
	if len(repo.createdSessions) != 0 {
		t.Fatalf("expected no created sessions on validation error, got %d", len(repo.createdSessions))
	}
}

func TestSessionService_BulkCreate_RejectsDuplicateExplicitSeq(t *testing.T) {
	repo := &stubSessionRepo{nextSeq: 10}
	svc := newTestSessionService(repo)

	req := IngestRequest{
		SessionID: "sess-1",
		AgentID:   "agent-x",
		Messages: []IngestMessage{
			{Role: "user", Content: "first", Seq: intPtr(7)},
			{Role: "assistant", Content: "second", Seq: intPtr(7)},
		},
	}

	err := svc.BulkCreate(context.Background(), "source-agent", req)
	var ve *domain.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected ValidationError, got %T", err)
	}
	if ve.Field != "messages.seq" {
		t.Fatalf("expected field messages.seq, got %q", ve.Field)
	}
	if len(repo.createdSessions) != 0 {
		t.Fatalf("expected no created sessions on validation error, got %d", len(repo.createdSessions))
	}
}

func TestSessionService_BulkCreate_ManyExplicitSeqsFallsBackToMaxPlusOne(t *testing.T) {
	repo := &stubSessionRepo{nextSeq: 0}
	svc := newTestSessionService(repo)

	msgs := make([]IngestMessage, 0, 102)
	for i := 0; i <= 100; i++ {
		msgs = append(msgs, IngestMessage{Role: "user", Content: "explicit", Seq: intPtr(i)})
	}
	msgs = append(msgs, IngestMessage{Role: "assistant", Content: "implicit"})

	req := IngestRequest{
		SessionID: "sess-1",
		AgentID:   "agent-x",
		Messages:  msgs,
	}

	if err := svc.BulkCreate(context.Background(), "source-agent", req); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(repo.createdSessions) != 102 {
		t.Fatalf("expected 102 created sessions, got %d", len(repo.createdSessions))
	}
	if repo.createdSessions[101].Seq != 101 {
		t.Fatalf("expected fallback seq 101, got %d", repo.createdSessions[101].Seq)
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

func TestSessionService_CreateRawTurn_AssignsNextSeqWhenMissing(t *testing.T) {
	repo := &stubSessionRepo{nextSeq: 5}
	svc := newTestSessionService(repo)

	if err := svc.CreateRawTurn(context.Background(), "sess-1", "agent-x", "source-agent", -1, "user", "hello"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(repo.createdSessions) != 1 {
		t.Fatalf("expected 1 created session, got %d", len(repo.createdSessions))
	}
	if repo.createdSessions[0].Seq != 5 {
		t.Fatalf("expected auto-assigned seq 5, got %d", repo.createdSessions[0].Seq)
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

func TestSessionService_SearchInSessionSet_keywordPath(t *testing.T) {
	repo := &stubSessionRepo{
		setKeywordResults: []domain.Memory{
			{ID: "s1", Content: "hello from routed session", MemoryType: domain.TypeSession},
		},
		ftsAvail: false,
	}
	svc := newTestSessionService(repo)

	results, err := svc.SearchInSessionSet(context.Background(), domain.MemoryFilter{Query: "hello", Limit: 5}, []string{"session-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 1 || results[0].ID != "s1" {
		t.Fatalf("unexpected routed session search results: %#v", results)
	}
}

func TestSessionService_SearchInSessionSet_PreservesRepeatedContentAcrossSessions(t *testing.T) {
	repo := &stubSessionRepo{
		setKeywordResults: []domain.Memory{
			{ID: "s1", SessionID: "session-1", Content: "same text", MemoryType: domain.TypeSession},
			{ID: "s2", SessionID: "session-2", Content: "same text", MemoryType: domain.TypeSession},
		},
		ftsAvail: false,
	}
	svc := newTestSessionService(repo)

	results, err := svc.SearchInSessionSet(context.Background(), domain.MemoryFilter{Query: "same", Limit: 5}, []string{"session-1", "session-2"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected both routed turns to survive, got %d: %#v", len(results), results)
	}
	if results[0].ID != "s1" || results[1].ID != "s2" {
		t.Fatalf("unexpected routed session order: %#v", results)
	}
}

func TestSessionService_Search_WithExplicitSessionID_PreservesRepeatedContentAcrossTurns(t *testing.T) {
	repo := &stubSessionRepo{
		keywordResults: []domain.Memory{
			{ID: "s1", SessionID: "session-1", Content: "same text", MemoryType: domain.TypeSession, Metadata: json.RawMessage(`{"seq":1}`)},
			{ID: "s2", SessionID: "session-1", Content: "same text", MemoryType: domain.TypeSession, Metadata: json.RawMessage(`{"seq":2}`)},
		},
		ftsAvail: false,
	}
	svc := newTestSessionService(repo)

	results, err := svc.Search(context.Background(), domain.MemoryFilter{Query: "same", SessionID: "session-1", Limit: 5})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected both explicit-session turns to survive, got %d: %#v", len(results), results)
	}
	if results[0].ID != "s1" || results[1].ID != "s2" {
		t.Fatalf("unexpected explicit-session order: %#v", results)
	}
}

func TestSessionService_ListNeighbors_delegates(t *testing.T) {
	repo := &stubSessionRepo{
		neighborResults: []domain.Memory{{ID: "neighbor-1", Content: "before turn", MemoryType: domain.TypeSession}},
	}
	svc := newTestSessionService(repo)

	results, err := svc.ListNeighbors(context.Background(), "session-1", 3, 1, 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 1 || results[0].ID != "neighbor-1" {
		t.Fatalf("unexpected neighbor results: %#v", results)
	}
}

func TestSessionService_ListNeighbors_PreservesRepeatedContentAcrossTurns(t *testing.T) {
	repo := &stubSessionRepo{
		neighborResults: []domain.Memory{
			{ID: "neighbor-1", SessionID: "session-1", Content: "same text", MemoryType: domain.TypeSession, Metadata: json.RawMessage(`{"seq":2}`)},
			{ID: "neighbor-2", SessionID: "session-1", Content: "same text", MemoryType: domain.TypeSession, Metadata: json.RawMessage(`{"seq":3}`)},
		},
	}
	svc := newTestSessionService(repo)

	results, err := svc.ListNeighbors(context.Background(), "session-1", 3, 1, 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected both neighbor turns to survive, got %d: %#v", len(results), results)
	}
	if results[0].ID != "neighbor-1" || results[1].ID != "neighbor-2" {
		t.Fatalf("unexpected neighbor order: %#v", results)
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

func TestSessionService_Search_EnableSecondHop_AutoHybrid(t *testing.T) {
	firstHopQuery := "What Console does Nate own?"
	seedContent := "Nate gaming setup competitive RPG"
	secondHopQuery := firstHopQuery + " " + seedContent

	repo := &stubSessionRepo{
		autoVecByQuery: map[string][]domain.Memory{
			firstHopQuery: {
				{ID: "seed", Content: seedContent, MemoryType: domain.TypeSession, Score: floatPtr(0.8)},
			},
			secondHopQuery: {
				{ID: "answer", Content: "Nate owns a Nintendo Switch and loves Xenoblade Chronicles.", MemoryType: domain.TypeSession, Score: floatPtr(0.7)},
			},
		},
	}
	svc := NewSessionService(repo, nil, "auto-model")

	results, err := svc.Search(context.Background(), domain.MemoryFilter{
		Query:           firstHopQuery,
		Limit:           5,
		EnableSecondHop: true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(repo.autoVecQueries) != 2 {
		t.Fatalf("expected 2 auto-vector calls, got %d (%v)", len(repo.autoVecQueries), repo.autoVecQueries)
	}
	if repo.autoVecQueries[1] != secondHopQuery {
		t.Fatalf("expected enriched second-hop query %q, got %q", secondHopQuery, repo.autoVecQueries[1])
	}
	found := false
	for _, mem := range results {
		if mem.ID == "answer" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected second-hop answer in results, got %#v", results)
	}
}

func TestSessionService_Search_DisablesSecondHopWhenFlagFalse(t *testing.T) {
	firstHopQuery := "What Console does Nate own?"
	seedContent := "Nate gaming setup competitive RPG"
	secondHopQuery := firstHopQuery + " " + seedContent

	repo := &stubSessionRepo{
		autoVecByQuery: map[string][]domain.Memory{
			firstHopQuery: {
				{ID: "seed", Content: seedContent, MemoryType: domain.TypeSession, Score: floatPtr(0.8)},
			},
			secondHopQuery: {
				{ID: "answer", Content: "Nate owns a Nintendo Switch and loves Xenoblade Chronicles.", MemoryType: domain.TypeSession, Score: floatPtr(0.7)},
			},
		},
	}
	svc := NewSessionService(repo, nil, "auto-model")

	results, err := svc.Search(context.Background(), domain.MemoryFilter{
		Query: firstHopQuery,
		Limit: 5,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(repo.autoVecQueries) != 1 {
		t.Fatalf("expected only first-hop auto-vector call, got %d (%v)", len(repo.autoVecQueries), repo.autoVecQueries)
	}
	for _, mem := range results {
		if mem.ID == "answer" {
			t.Fatalf("did not expect second-hop answer when flag disabled, got %#v", results)
		}
	}
}

func TestSessionContentHash_differentInputsProduceDifferentHashes(t *testing.T) {
	cases := [][2]string{
		{"sess-a role-user content-x", "sess-a role-user content-y"},
		{"sess-a role-user content-x", "sess-b role-user content-x"},
		{"sess-a role-user content-x", "sess-a role-assistant content-x"},
	}
	for _, c := range cases {
		h1 := SessionContentHash("sess-a", "user", c[0])
		h2 := SessionContentHash("sess-a", "user", c[1])
		if h1 == h2 {
			t.Errorf("expected different hashes for different inputs: %q vs %q", c[0], c[1])
		}
	}
}

func TestSessionContentHash_sameInputProducesSameHash(t *testing.T) {
	h1 := SessionContentHash("sess-1", "user", "hello world")
	h2 := SessionContentHash("sess-1", "user", "hello world")
	if h1 != h2 {
		t.Errorf("expected identical hashes, got %q vs %q", h1, h2)
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
func (c *capturingSessionRepo) NextSeq(ctx context.Context, sessionID string) (int, error) {
	return c.stub.NextSeq(ctx, sessionID)
}
func (c *capturingSessionRepo) AutoVectorSearch(ctx context.Context, q string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	*c.capturedFilter = f
	return c.stub.AutoVectorSearch(ctx, q, f, limit)
}
func (c *capturingSessionRepo) AutoVectorSearchInSessionSet(ctx context.Context, q string, f domain.MemoryFilter, ids []string, limit int) ([]domain.Memory, error) {
	*c.capturedFilter = f
	return c.stub.AutoVectorSearchInSessionSet(ctx, q, f, ids, limit)
}
func (c *capturingSessionRepo) VectorSearch(ctx context.Context, v []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	*c.capturedFilter = f
	return c.stub.VectorSearch(ctx, v, f, limit)
}
func (c *capturingSessionRepo) VectorSearchInSessionSet(ctx context.Context, v []float32, f domain.MemoryFilter, ids []string, limit int) ([]domain.Memory, error) {
	*c.capturedFilter = f
	return c.stub.VectorSearchInSessionSet(ctx, v, f, ids, limit)
}
func (c *capturingSessionRepo) FTSSearch(ctx context.Context, q string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	*c.capturedFilter = f
	return c.stub.FTSSearch(ctx, q, f, limit)
}
func (c *capturingSessionRepo) FTSSearchInSessionSet(ctx context.Context, q string, f domain.MemoryFilter, ids []string, limit int) ([]domain.Memory, error) {
	*c.capturedFilter = f
	return c.stub.FTSSearchInSessionSet(ctx, q, f, ids, limit)
}
func (c *capturingSessionRepo) KeywordSearch(ctx context.Context, q string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	*c.capturedFilter = f
	return c.stub.KeywordSearch(ctx, q, f, limit)
}
func (c *capturingSessionRepo) KeywordSearchInSessionSet(ctx context.Context, q string, f domain.MemoryFilter, ids []string, limit int) ([]domain.Memory, error) {
	*c.capturedFilter = f
	return c.stub.KeywordSearchInSessionSet(ctx, q, f, ids, limit)
}
func (c *capturingSessionRepo) FTSAvailable() bool { return c.stub.FTSAvailable() }

func (c *capturingSessionRepo) ListBySessionIDs(ctx context.Context, ids []string, limit int) ([]*domain.Session, error) {
	return c.stub.ListBySessionIDs(ctx, ids, limit)
}

func (c *capturingSessionRepo) ListNeighbors(ctx context.Context, sessionID string, seq int, before int, after int) ([]domain.Memory, error) {
	return c.stub.ListNeighbors(ctx, sessionID, seq, before, after)
}
