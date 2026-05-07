package service

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/llm"
)

func floatEqual(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
}

type bulkCreateCaptureRepo struct {
	memoryRepoMock
	bulkCreateCalls [][]domain.Memory
}

func (m *bulkCreateCaptureRepo) BulkCreate(_ context.Context, memories []*domain.Memory) error {
	copied := make([]domain.Memory, len(memories))
	for i, memory := range memories {
		copied[i] = *memory
	}
	m.bulkCreateCalls = append(m.bulkCreateCalls, copied)
	return nil
}

func TestApplyTypeWeights(t *testing.T) {
	tests := []struct {
		name   string
		mems   map[string]domain.Memory
		scores map[string]float64
		want   map[string]float64
	}{
		{
			name: "mixed types weighted",
			mems: map[string]domain.Memory{
				"pinned":  {ID: "pinned", MemoryType: domain.TypePinned},
				"insight": {ID: "insight", MemoryType: domain.TypeInsight},
			},
			scores: map[string]float64{
				"pinned":  1.0,
				"insight": 2.0,
			},
			want: map[string]float64{
				"pinned":  1.5,
				"insight": 2.0,
			},
		},
		{
			name:   "empty input",
			mems:   map[string]domain.Memory{},
			scores: map[string]float64{},
			want:   map[string]float64{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			applyTypeWeights(tt.mems, tt.scores)
			if len(tt.scores) != len(tt.want) {
				t.Fatalf("scores size mismatch: got %d want %d", len(tt.scores), len(tt.want))
			}
			for id, want := range tt.want {
				got, ok := tt.scores[id]
				if !ok {
					t.Fatalf("missing score for %s", id)
				}
				if !floatEqual(got, want) {
					t.Fatalf("score mismatch for %s: got %.12f want %.12f", id, got, want)
				}
			}
		})
	}
}

func TestRrfMerge(t *testing.T) {
	tests := []struct {
		name        string
		ftsResults  []domain.Memory
		vecResults  []domain.Memory
		wantScores  map[string]float64
		wantLen     int
		checkScores bool
	}{
		{
			name:       "disjoint results",
			ftsResults: []domain.Memory{{ID: "a"}, {ID: "b"}},
			vecResults: []domain.Memory{{ID: "c"}},
			wantScores: map[string]float64{
				"a": 1.0 / (rrfK + 1.0),
				"b": 1.0 / (rrfK + 2.0),
				"c": 1.0 / (rrfK + 1.0),
			},
			wantLen:     3,
			checkScores: true,
		},
		{
			name:       "overlapping results",
			ftsResults: []domain.Memory{{ID: "a"}, {ID: "b"}},
			vecResults: []domain.Memory{{ID: "b"}, {ID: "c"}},
			wantScores: map[string]float64{
				"a": 1.0 / (rrfK + 1.0),
				"b": 1.0/(rrfK+2.0) + 1.0/(rrfK+1.0),
				"c": 1.0 / (rrfK + 2.0),
			},
			wantLen:     3,
			checkScores: true,
		},
		{
			name:        "both empty",
			ftsResults:  nil,
			vecResults:  nil,
			wantScores:  map[string]float64{},
			wantLen:     0,
			checkScores: false,
		},
		{
			name:        "one empty",
			ftsResults:  []domain.Memory{{ID: "a"}},
			vecResults:  nil,
			wantScores:  map[string]float64{"a": 1.0 / (rrfK + 1.0)},
			wantLen:     1,
			checkScores: true,
		},
		{
			name:        "single in each",
			ftsResults:  []domain.Memory{{ID: "a"}},
			vecResults:  []domain.Memory{{ID: "b"}},
			wantScores:  map[string]float64{"a": 1.0 / (rrfK + 1.0), "b": 1.0 / (rrfK + 1.0)},
			wantLen:     2,
			checkScores: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scores := rrfMerge(tt.ftsResults, tt.vecResults)
			if len(scores) != tt.wantLen {
				t.Fatalf("score size mismatch: got %d want %d", len(scores), tt.wantLen)
			}
			if !tt.checkScores {
				return
			}
			for id, want := range tt.wantScores {
				got, ok := scores[id]
				if !ok {
					t.Fatalf("missing score for %s", id)
				}
				if !floatEqual(got, want) {
					t.Fatalf("score mismatch for %s: got %.12f want %.12f", id, got, want)
				}
			}
		})
	}
}

func TestLemmatizeForBM25NormalizesCommonInflections(t *testing.T) {
	got := lemmatizeForBM25("Who recommended books about running businesses?")
	want := "who recommend book about run business"
	if got != want {
		t.Fatalf("lemmatizeForBM25() = %q, want %q", got, want)
	}
}

func TestMem0RankMemoriesUsesSemanticCandidateSetOnly(t *testing.T) {
	svc := NewMemoryService(&memoryRepoMock{}, nil, nil, "auto-model", ModeSmart)
	semScore := 0.80
	kwScore := 14.0
	ranked, scores := svc.mem0RankMemories(context.Background(), domain.MemoryFilter{
		Query: "Which books did Melanie recommend?",
		Limit: 2,
	}, []domain.Memory{
		{ID: "keyword-only", Content: "Melanie recommended a book.", Score: &kwScore},
		{ID: "semantic", Content: "Melanie recommended Becoming Nicole.", Score: &kwScore},
	}, []domain.Memory{
		{ID: "semantic", Content: "Melanie recommended Becoming Nicole.", Score: &semScore},
	}, 2)

	if len(ranked) != 1 || ranked[0].ID != "semantic" {
		t.Fatalf("ranked = %+v, want only semantic candidate", ranked)
	}
	if _, ok := scores["keyword-only"]; ok {
		t.Fatalf("keyword-only candidate should not be scored: %+v", scores)
	}
}

func TestTextSearchUsesBM25LemmatizedQuery(t *testing.T) {
	var gotQuery string
	repo := &memoryRepoMock{
		ftsAvail: true,
		ftsSearchHook: func(_ context.Context, query string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			gotQuery = query
			return nil, nil
		},
	}
	svc := NewMemoryService(repo, nil, nil, "auto-model", ModeSmart)
	if _, _, err := svc.textSearch(context.Background(), domain.MemoryFilter{Query: "recommended books"}, 10); err != nil {
		t.Fatalf("textSearch() error = %v", err)
	}
	if gotQuery != "recommend book" {
		t.Fatalf("FTS query = %q, want lemmatized query", gotQuery)
	}
}

func TestValidateMemoryInput(t *testing.T) {
	tooLongContent := strings.Repeat("a", maxContentLen+1)
	tooManyTags := make([]string, maxTags+1)
	for i := range tooManyTags {
		tooManyTags[i] = "tag"
	}

	tests := []struct {
		name        string
		content     string
		tags        []string
		wantErr     bool
		wantField   string
		wantMessage string
	}{
		{
			name:    "valid input",
			content: "ok",
			tags:    []string{"a", "b"},
			wantErr: false,
		},
		{
			name:        "empty content",
			content:     "",
			tags:        nil,
			wantErr:     true,
			wantField:   "content",
			wantMessage: "required",
		},
		{
			name:        "content too long",
			content:     tooLongContent,
			tags:        nil,
			wantErr:     true,
			wantField:   "content",
			wantMessage: "too long (max 50000)",
		},
		{
			name:        "too many tags",
			content:     "ok",
			tags:        tooManyTags,
			wantErr:     true,
			wantField:   "tags",
			wantMessage: "too many (max 20)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateMemoryInput(tt.content, tt.tags)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error")
				}
				var ve *domain.ValidationError
				if !errors.As(err, &ve) {
					t.Fatalf("expected ValidationError, got %T", err)
				}
				if !errors.Is(err, domain.ErrValidation) {
					t.Fatalf("expected ErrValidation unwrap")
				}
				if ve.Field != tt.wantField {
					t.Fatalf("field mismatch: got %s want %s", ve.Field, tt.wantField)
				}
				if ve.Message != tt.wantMessage {
					t.Fatalf("message mismatch: got %s want %s", ve.Message, tt.wantMessage)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestCollectMems(t *testing.T) {
	tests := []struct {
		name       string
		kwResults  []domain.Memory
		vecResults []domain.Memory
		wantLen    int
		wantIDs    []string
		wantKWID   string
		wantKWText string
	}{
		{
			name: "collects from both and dedupes",
			kwResults: []domain.Memory{
				{ID: "shared", Content: "kw"},
				{ID: "kw-only", Content: "kw2"},
			},
			vecResults: []domain.Memory{
				{ID: "shared", Content: "vec"},
				{ID: "vec-only", Content: "vec2"},
			},
			wantLen:    3,
			wantIDs:    []string{"shared", "kw-only", "vec-only"},
			wantKWID:   "shared",
			wantKWText: "kw",
		},
		{
			name:       "empty inputs",
			kwResults:  nil,
			vecResults: nil,
			wantLen:    0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mems := collectMems(tt.kwResults, tt.vecResults)
			if len(mems) != tt.wantLen {
				t.Fatalf("map size mismatch: got %d want %d", len(mems), tt.wantLen)
			}
			for _, id := range tt.wantIDs {
				if _, ok := mems[id]; !ok {
					t.Fatalf("missing memory %s", id)
				}
			}
			if tt.wantKWID != "" {
				if got := mems[tt.wantKWID].Content; got != tt.wantKWText {
					t.Fatalf("kw precedence mismatch: got %s want %s", got, tt.wantKWText)
				}
			}
		})
	}
}

func TestSortByScore(t *testing.T) {
	mems := map[string]domain.Memory{
		"high": {ID: "high"},
		"tie1": {ID: "tie1"},
		"tie2": {ID: "tie2"},
		"low":  {ID: "low"},
	}
	scores := map[string]float64{
		"high": 0.9,
		"tie1": 0.5,
		"tie2": 0.5,
		"low":  0.1,
	}

	result := sortByScore(mems, scores)
	if len(result) != 4 {
		t.Fatalf("result size mismatch: got %d want %d", len(result), 4)
	}
	if result[0].ID != "high" {
		t.Fatalf("expected high score first, got %s", result[0].ID)
	}
	if !floatEqual(scores[result[1].ID], 0.5) || !floatEqual(scores[result[2].ID], 0.5) {
		t.Fatalf("expected tie scores in positions 2 and 3")
	}
	seenTie1 := result[1].ID == "tie1" || result[2].ID == "tie1"
	seenTie2 := result[1].ID == "tie2" || result[2].ID == "tie2"
	if !seenTie1 || !seenTie2 {
		t.Fatalf("expected tie1 and tie2 in top ties, got %s and %s", result[1].ID, result[2].ID)
	}
	if result[3].ID != "low" {
		t.Fatalf("expected low score last, got %s", result[3].ID)
	}
}

// TestSearchColdStartFallbackToKeyword verifies that when no embedder and no
// autoModel are configured and FTS is not yet available (cold start), Search()
// falls back to KeywordSearch instead of returning a hard error.
func TestSearchColdStartFallbackToKeyword(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{
		ftsAvail: false, // FTS probe still running
		kwResults: []domain.Memory{
			{ID: "kw-1", Content: "result from keyword search", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}

	// No embedder, no autoModel — cold start, FTS not yet available.
	svc := NewMemoryService(memRepo, nil, nil, "", ModeSmart)

	results, total, err := svc.Search(context.Background(), domain.MemoryFilter{
		Query: "test query",
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("Search() should fall back to keyword, got error: %v", err)
	}
	if total != 1 {
		t.Fatalf("expected total=1, got %d", total)
	}
	if len(results) != 1 || results[0].ID != "kw-1" {
		t.Fatalf("expected kw-1 result from keyword fallback, got %v", results)
	}
}

// TestSearchFTSOnlyWhenAvailable verifies that when FTS is available and no
// vector search is configured, Search() uses FTS (not keyword fallback).
func TestSearchFTSOnlyWhenAvailable(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{
		ftsAvail: true,
		ftsResults: []domain.Memory{
			{ID: "fts-1", Content: "result from FTS", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
		kwResults: []domain.Memory{
			{ID: "kw-1", Content: "should not appear"},
		},
	}

	svc := NewMemoryService(memRepo, nil, nil, "", ModeSmart)

	results, total, err := svc.Search(context.Background(), domain.MemoryFilter{
		Query: "test query",
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("Search() FTS-only error: %v", err)
	}
	if total != 1 {
		t.Fatalf("expected total=1, got %d", total)
	}
	if len(results) != 1 || results[0].ID != "fts-1" {
		t.Fatalf("expected fts-1 from FTS search, got %v", results)
	}
}

// TestSearchEmptyQueryReturnsList verifies that Search() with empty query
// delegates to List() instead of any search path.
func TestSearchEmptyQueryReturnsList(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{}
	svc := NewMemoryService(memRepo, nil, nil, "", ModeSmart)

	results, total, err := svc.Search(context.Background(), domain.MemoryFilter{
		Query: "",
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("Search() empty query error: %v", err)
	}
	// List returns nil, 0, nil from mock.
	if total != 0 || len(results) != 0 {
		t.Fatalf("expected empty results from List(), got total=%d results=%d", total, len(results))
	}
}

func TestSearchEmptyQueryPopulatesRelativeAge(t *testing.T) {
	t.Parallel()

	past := time.Now().Add(-5 * time.Minute)
	memRepo := &memoryRepoMock{
		listResults: []domain.Memory{
			{ID: "m1", Content: "hello", UpdatedAt: past, MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	svc := NewMemoryService(memRepo, nil, nil, "", ModeSmart)

	results, total, err := svc.Search(context.Background(), domain.MemoryFilter{
		Query: "",
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("Search() error: %v", err)
	}
	if total != 1 || len(results) != 1 {
		t.Fatalf("expected 1 result, got total=%d results=%d", total, len(results))
	}
	if results[0].RelativeAge == "" {
		t.Fatal("expected RelativeAge to be populated, got empty string")
	}
}

func TestSearchPreservesSessionAndSourceFilters(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{
		ftsAvail: false,
		kwResults: []domain.Memory{
			{ID: "kw-1", Content: "result from keyword search", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	svc := NewMemoryService(memRepo, nil, nil, "", ModeSmart)

	_, _, err := svc.Search(context.Background(), domain.MemoryFilter{
		Query:     "test query",
		Source:    "legacy-source",
		SessionID: "session-123",
		AgentID:   "agent-1",
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("Search() error: %v", err)
	}

	if memRepo.lastKeywordFilter.Source != "legacy-source" {
		t.Fatalf("expected keyword search Source filter preserved, got %q", memRepo.lastKeywordFilter.Source)
	}
	if memRepo.lastKeywordFilter.SessionID != "session-123" {
		t.Fatalf("expected keyword search SessionID filter preserved, got %q", memRepo.lastKeywordFilter.SessionID)
	}
	if memRepo.lastKeywordFilter.AgentID != "agent-1" {
		t.Fatalf("expected keyword search AgentID preserved, got %q", memRepo.lastKeywordFilter.AgentID)
	}
}

func TestAutoHybridCandidatesFallsBackToKeywordWhenVectorFails(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{
		vectorErr: errors.New("invalid connection"),
		kwResults: []domain.Memory{
			{ID: "kw-1", Content: "keyword result", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
		ftsAvail: false,
	}
	svc := NewMemoryService(memRepo, nil, nil, "auto-model", ModeSmart)

	candidates, err := svc.SearchCandidates(context.Background(), domain.MemoryFilter{
		Query:   "keyword result",
		AgentID: "agent-1",
		Limit:   5,
	}, RecallSourceInsight, RecallCandidateOptions{})
	if err != nil {
		t.Fatalf("SearchCandidates() should fall back to keyword, got error: %v", err)
	}
	if len(candidates) != 1 || candidates[0].Memory.ID != "kw-1" {
		t.Fatalf("expected keyword candidate, got %+v", candidates)
	}
	if !candidates[0].InKeyword || candidates[0].InVector {
		t.Fatalf("expected keyword-only candidate, got %+v", candidates[0])
	}
}

func TestAutoHybridCandidatesFallsBackToVectorWhenTextSearchFails(t *testing.T) {
	t.Parallel()

	score := 0.9
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "vec-1", Content: "semantic result", Score: &score, MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
		ftsErr:   errors.New("invalid connection"),
		ftsAvail: true,
	}
	svc := NewMemoryService(memRepo, nil, nil, "auto-model", ModeSmart)

	candidates, err := svc.SearchCandidates(context.Background(), domain.MemoryFilter{
		Query:   "semantic result",
		AgentID: "agent-1",
		Limit:   5,
	}, RecallSourceInsight, RecallCandidateOptions{})
	if err != nil {
		t.Fatalf("SearchCandidates() should fall back to vector, got error: %v", err)
	}
	if len(candidates) != 1 || candidates[0].Memory.ID != "vec-1" {
		t.Fatalf("expected vector candidate, got %+v", candidates)
	}
	if !candidates[0].InVector || candidates[0].InKeyword {
		t.Fatalf("expected vector-only candidate, got %+v", candidates[0])
	}
}

func TestAutoHybridCandidatesReturnsErrorWhenAllBranchesFail(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{
		vectorErr: errors.New("vector down"),
		kwErr:     errors.New("keyword down"),
		ftsAvail:  false,
	}
	svc := NewMemoryService(memRepo, nil, nil, "auto-model", ModeSmart)

	_, err := svc.SearchCandidates(context.Background(), domain.MemoryFilter{
		Query:   "no route",
		AgentID: "agent-1",
		Limit:   5,
	}, RecallSourceInsight, RecallCandidateOptions{})
	if err == nil {
		t.Fatal("expected error when both vector and text branches fail")
	}
	if !strings.Contains(err.Error(), "memory recall branches failed") {
		t.Fatalf("expected joined branch error, got %v", err)
	}
}

func TestSearchCandidatesExpandsLinkedMemoryIDs(t *testing.T) {
	t.Parallel()

	seed := domain.Memory{
		ID:         "seed",
		Content:    "Melanie read a book recommended by Caroline.",
		AgentID:    "agent-1",
		State:      domain.StateActive,
		MemoryType: domain.TypeInsight,
		Metadata:   json.RawMessage(`{"linked_memory_ids":["linked-book"]}`),
	}
	linked := &domain.Memory{
		ID:         "linked-book",
		Content:    `Caroline's favorite book is "Becoming Nicole".`,
		AgentID:    "agent-1",
		State:      domain.StateActive,
		MemoryType: domain.TypeInsight,
	}
	memRepo := &memoryRepoMock{
		kwResults: []domain.Memory{seed},
		getByID: map[string]*domain.Memory{
			"linked-book": linked,
		},
		ftsAvail: false,
	}
	svc := NewMemoryService(memRepo, nil, nil, "", ModeSmart)

	candidates, err := svc.SearchCandidates(context.Background(), domain.MemoryFilter{
		Query:   "What book did Melanie read from Caroline's suggestion?",
		AgentID: "agent-1",
		Limit:   5,
	}, RecallSourceInsight, RecallCandidateOptions{})
	if err != nil {
		t.Fatalf("SearchCandidates() error: %v", err)
	}

	var linkedCandidate *RecallCandidate
	for i := range candidates {
		if candidates[i].Memory.ID == "linked-book" {
			linkedCandidate = &candidates[i]
			break
		}
	}
	if linkedCandidate == nil {
		t.Fatalf("expected linked memory candidate, got %+v", candidates)
	}
	if linkedCandidate.SourcePool != RecallSourceInsight {
		t.Fatalf("expected linked candidate to keep insight source pool, got %q", linkedCandidate.SourcePool)
	}
	if linkedCandidate.RRFScore <= 0 {
		t.Fatalf("expected linked candidate to receive recall score, got %+v", linkedCandidate)
	}
}

func TestSearchCandidatesSkipsInvalidLinkedMemoryIDs(t *testing.T) {
	t.Parallel()

	seed := domain.Memory{
		ID:         "seed",
		Content:    "Joanna named the stuffed animal dog Tilly.",
		AgentID:    "agent-1",
		State:      domain.StateActive,
		MemoryType: domain.TypeInsight,
		Metadata:   json.RawMessage(`{"linked_memory_ids":["missing","other-agent","archived","valid"]}`),
	}
	memRepo := &memoryRepoMock{
		kwResults: []domain.Memory{seed},
		getByID: map[string]*domain.Memory{
			"other-agent": {
				ID:         "other-agent",
				Content:    "Other agent memory",
				AgentID:    "agent-2",
				State:      domain.StateActive,
				MemoryType: domain.TypeInsight,
			},
			"archived": {
				ID:         "archived",
				Content:    "Archived memory",
				AgentID:    "agent-1",
				State:      domain.StateArchived,
				MemoryType: domain.TypeInsight,
			},
			"valid": {
				ID:         "valid",
				Content:    "Nate gave Joanna a stuffed animal dog on May 25, 2022.",
				AgentID:    "agent-1",
				State:      domain.StateActive,
				MemoryType: domain.TypeInsight,
			},
		},
		ftsAvail: false,
	}
	svc := NewMemoryService(memRepo, nil, nil, "", ModeSmart)

	candidates, err := svc.SearchCandidates(context.Background(), domain.MemoryFilter{
		Query:   "When did Nate get Tilly for Joanna?",
		AgentID: "agent-1",
		Limit:   5,
	}, RecallSourceInsight, RecallCandidateOptions{})
	if err != nil {
		t.Fatalf("SearchCandidates() error: %v", err)
	}

	ids := map[string]bool{}
	for _, candidate := range candidates {
		ids[candidate.Memory.ID] = true
	}
	if !ids["valid"] {
		t.Fatalf("expected valid linked memory, got ids=%v", ids)
	}
	for _, invalid := range []string{"missing", "other-agent", "archived"} {
		if ids[invalid] {
			t.Fatalf("did not expect invalid linked memory %q, got ids=%v", invalid, ids)
		}
	}
}

func TestCreateFallsBackToRawWhenLLMUnavailable(t *testing.T) {
	t.Parallel()

	repo := &memoryRepoMock{}
	svc := NewMemoryService(repo, nil, nil, "", ModeSmart)

	mem, _, err := svc.Create(context.Background(), "agent-1", "user prefers dark mode", []string{"prefs"}, json.RawMessage(`{"source":"manual"}`))
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if mem == nil {
		t.Fatal("expected created memory")
	}
	if len(repo.createCalls) != 1 {
		t.Fatalf("expected 1 raw memory create, got %d", len(repo.createCalls))
	}
	if mem.Content != "user prefers dark mode" {
		t.Fatalf("expected raw content unchanged, got %q", mem.Content)
	}
	if mem.MemoryType != domain.TypeInsight {
		t.Fatalf("expected insight memory type, got %s", mem.MemoryType)
	}
}

func TestCreatePinnedUsesBulkCreateSemantics(t *testing.T) {
	t.Parallel()

	repo := &bulkCreateCaptureRepo{}
	svc := NewMemoryService(repo, nil, nil, "", ModeSmart)

	mem, written, err := svc.CreatePinned(
		context.Background(),
		"agent-1",
		"user prefers pour-over coffee",
		[]string{"preference", "coffee"},
		json.RawMessage(`{"source":"manual"}`),
	)
	if err != nil {
		t.Fatalf("CreatePinned() error = %v", err)
	}
	if mem == nil {
		t.Fatal("expected created memory")
	}
	if written != 1 {
		t.Fatalf("expected 1 written memory, got %d", written)
	}
	if len(repo.bulkCreateCalls) != 1 {
		t.Fatalf("expected 1 bulk create call, got %d", len(repo.bulkCreateCalls))
	}

	created := repo.bulkCreateCalls[0][0]
	if created.MemoryType != domain.TypePinned {
		t.Fatalf("expected pinned memory type, got %s", created.MemoryType)
	}
	if created.Source != "agent-1" {
		t.Fatalf("expected source agent-1, got %q", created.Source)
	}
	if created.UpdatedBy != "agent-1" {
		t.Fatalf("expected updated_by agent-1, got %q", created.UpdatedBy)
	}
	if created.State != domain.StateActive {
		t.Fatalf("expected active state, got %q", created.State)
	}
	if created.Content != "user prefers pour-over coffee" {
		t.Fatalf("expected content preserved, got %q", created.Content)
	}
	if len(created.Tags) != 2 || created.Tags[0] != "preference" || created.Tags[1] != "coffee" {
		t.Fatalf("expected tags preserved, got %v", created.Tags)
	}
	if string(created.Metadata) != `{"source":"manual"}` {
		t.Fatalf("expected metadata preserved, got %s", string(created.Metadata))
	}
	if mem.MemoryType != domain.TypePinned {
		t.Fatalf("expected returned memory type pinned, got %s", mem.MemoryType)
	}
}

func TestCreateRunsReconcilePipeline(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		resp := `{"facts": [{"text": "Uses Go 1.22", "tags": ["tech"]}]}`
		if callCount == 2 {
			resp = `{"memory": [{"id": "new", "text": "Uses Go 1.22", "event": "ADD"}]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	repo := &memoryRepoMock{}
	svc := NewMemoryService(repo, llmClient, nil, "auto-model", ModeSmart)

	mem, _, err := svc.Create(context.Background(), "agent-1", "I use Go 1.22", nil, nil)
	if err != nil {
		t.Fatalf("Create() error: %v", err)
	}
	if mem == nil {
		t.Fatal("expected created memory")
	}
	if len(repo.createCalls) != 1 {
		t.Fatalf("expected 1 created memory, got %d", len(repo.createCalls))
	}
	if repo.createCalls[0].MemoryType != domain.TypeInsight {
		t.Fatalf("expected insight memory type, got %s", repo.createCalls[0].MemoryType)
	}
}

func TestRelativeAge(t *testing.T) {
	now := time.Now()

	cases := []struct {
		name string
		t    time.Time
		want string
	}{
		{
			name: "future returns just now",
			t:    now.Add(10 * time.Minute),
			want: "just now",
		},
		{
			name: "30 seconds returns just now",
			t:    now.Add(-30 * time.Second),
			want: "just now",
		},
		{
			name: "1 minute singular",
			t:    now.Add(-90 * time.Second),
			want: "1 minute ago",
		},
		{
			name: "45 minutes plural",
			t:    now.Add(-45 * time.Minute),
			want: "45 minutes ago",
		},
		{
			name: "1 hour singular",
			t:    now.Add(-90 * time.Minute),
			want: "1 hour ago",
		},
		{
			name: "5 hours plural",
			t:    now.Add(-5 * time.Hour),
			want: "5 hours ago",
		},
		{
			name: "1 day singular",
			t:    now.Add(-36 * time.Hour),
			want: "1 day ago",
		},
		{
			name: "3 days plural",
			t:    now.Add(-3 * 24 * time.Hour),
			want: "3 days ago",
		},
		{
			name: "1 week singular",
			t:    now.Add(-10 * 24 * time.Hour),
			want: "1 week ago",
		},
		{
			name: "3 weeks plural",
			t:    now.Add(-25 * 24 * time.Hour),
			want: "3 weeks ago",
		},
		{
			name: "1 month singular",
			t:    now.Add(-45 * 24 * time.Hour),
			want: "1 month ago",
		},
		{
			name: "6 months plural",
			t:    now.Add(-180 * 24 * time.Hour),
			want: "6 months ago",
		},
		{
			name: "364 days caps at 1 year ago",
			t:    now.Add(-364 * 24 * time.Hour),
			want: "1 year ago",
		},
		{
			name: "400 days is 1 year ago",
			t:    now.Add(-400 * 24 * time.Hour),
			want: "1 year ago",
		},
		{
			name: "3 years plural",
			t:    now.Add(-3 * 365 * 24 * time.Hour),
			want: "3 years ago",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := relativeAge(tc.t)
			if got != tc.want {
				t.Errorf("relativeAge() = %q, want %q", got, tc.want)
			}
		})
	}
}
