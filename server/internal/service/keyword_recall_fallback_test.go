package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestAutoRecallRetainsKeywordEvidenceWhenFTSDisabledAndVectorsExist(t *testing.T) {
	for _, query := range []string{"Where is the library?", "¿Dónde está la biblioteca?"} {
		t.Run(query, func(t *testing.T) {
			similarity := 0.8
			memory := domain.Memory{ID: "m", Content: "The library / biblioteca is in Centro.", Score: &similarity, UpdatedAt: time.Now()}
			repo := &memoryRepoMock{vectorResults: []domain.Memory{memory}, keywordSearchHook: func(_ context.Context, q string, f domain.MemoryFilter, _ int) ([]domain.Memory, error) {
				if f.AgentID != "isolated-agent" {
					t.Fatal("lost scope")
				}
				if strings.Contains(strings.ToLower(memory.Content), strings.ToLower(q)) {
					return []domain.Memory{memory}, nil
				}
				return nil, nil
			}}
			svc := NewMemoryService(repo, nil, nil, "embedding-model", ModeSmart)
			got, err := svc.SearchCandidates(context.Background(), domain.MemoryFilter{Query: query, AgentID: "isolated-agent", Limit: 5}, RecallSourceInsight, RecallCandidateOptions{})
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != 1 || !got[0].InVector || !got[0].InKeyword {
				t.Fatalf("missing independent lexical/vector evidence: %+v", got)
			}
		})
	}
}

type lexicalSessionRepo struct {
	stubSessionRepo
	fail bool
}

func (r *lexicalSessionRepo) KeywordSearch(_ context.Context, q string, f domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	if f.AgentID != "isolated-agent" {
		return nil, errors.New("scope lost")
	}
	if r.fail && q == "biblioteca" {
		return nil, errors.New("token lookup failed")
	}
	if q == "biblioteca" {
		return r.autoVecResults, nil
	}
	return nil, nil
}
func TestSessionRecallUsesBoundedTokensWithoutChangingContentFilter(t *testing.T) {
	similarity := 0.8
	repo := &lexicalSessionRepo{stubSessionRepo: stubSessionRepo{autoVecResults: []domain.Memory{{ID: "s", Content: "biblioteca en Centro", Score: &similarity}}}}
	svc := NewSessionService(repo, nil, "embedding-model")
	filter := domain.MemoryFilter{Query: "¿Dónde está la biblioteca?", AgentID: "isolated-agent", Limit: 5}
	got, err := svc.SearchCandidates(context.Background(), filter, RecallSourceSession, RecallCandidateOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !got[0].InKeyword || !got[0].InVector {
		t.Fatalf("missing lexical evidence: %+v", got)
	}
	exact, _, err := svc.ContentKeywordSearch(context.Background(), filter)
	if err != nil || len(exact) != 0 {
		t.Fatalf("explicit substring search changed: %v %v", exact, err)
	}
	repo.fail = true
	if _, err := svc.SearchCandidates(context.Background(), filter, RecallSourceSession, RecallCandidateOptions{}); err == nil {
		t.Fatal("lookup failure hidden")
	}
}
