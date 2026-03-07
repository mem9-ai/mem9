package service

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func floatEqual(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
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
	svc := NewMemoryService(memRepo, nil, "")

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

	svc := NewMemoryService(memRepo, nil, "")

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
	svc := NewMemoryService(memRepo, nil, "")

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

func TestSearchIgnoresSessionAndSourceFilters(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{
		ftsAvail: false,
		kwResults: []domain.Memory{
			{ID: "kw-1", Content: "result from keyword search", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	svc := NewMemoryService(memRepo, nil, "")

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

	if memRepo.lastKeywordFilter.Source != "" {
		t.Fatalf("expected keyword search Source filter cleared, got %q", memRepo.lastKeywordFilter.Source)
	}
	if memRepo.lastKeywordFilter.SessionID != "" {
		t.Fatalf("expected keyword search SessionID filter cleared, got %q", memRepo.lastKeywordFilter.SessionID)
	}
	if memRepo.lastKeywordFilter.AgentID != "agent-1" {
		t.Fatalf("expected keyword search AgentID preserved, got %q", memRepo.lastKeywordFilter.AgentID)
	}
}
