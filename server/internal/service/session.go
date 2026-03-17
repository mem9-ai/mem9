package service

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/embed"
	"github.com/qiffang/mnemos/server/internal/repository"
	tidb "github.com/qiffang/mnemos/server/internal/repository/tidb"
)

const defaultSessionFetchMultiplier = 3

type SessionService struct {
	sessions  repository.SessionRepo
	embedder  *embed.Embedder
	autoModel string
}

func NewSessionService(sessions repository.SessionRepo, embedder *embed.Embedder, autoModel string) *SessionService {
	return &SessionService{
		sessions:  sessions,
		embedder:  embedder,
		autoModel: autoModel,
	}
}

func (s *SessionService) BulkCreate(ctx context.Context, agentName string, req IngestRequest) error {
	sessions := make([]*domain.Session, 0, len(req.Messages))
	for i, msg := range req.Messages {
		sess := tidb.NewSessionFromIngestMessage(
			req.SessionID, req.AgentID, agentName,
			i, msg.Role, msg.Content,
		)
		sessions = append(sessions, sess)
	}
	if err := s.sessions.BulkCreate(ctx, sessions); err != nil {
		return fmt.Errorf("session bulk create: %w", err)
	}
	return nil
}

func (s *SessionService) Search(ctx context.Context, f domain.MemoryFilter) ([]domain.Memory, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 10
	}
	fetchLimit := limit * defaultSessionFetchMultiplier

	if s.autoModel != "" {
		return s.autoHybridSearch(ctx, f, limit, fetchLimit)
	}
	if s.embedder != nil {
		return s.hybridSearch(ctx, f, limit, fetchLimit)
	}
	if s.sessions.FTSAvailable() {
		return s.ftsSearch(ctx, f, limit, fetchLimit)
	}
	return s.keywordSearch(ctx, f, limit, fetchLimit)
}

func (s *SessionService) autoHybridSearch(ctx context.Context, f domain.MemoryFilter, limit, fetchLimit int) ([]domain.Memory, error) {
	vecResults, err := s.sessions.AutoVectorSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session auto vector search: %w", err)
	}
	vecResults = applyMinScore(vecResults, f.MinScore)

	kwResults, err := s.ftsOrKeyword(ctx, f, fetchLimit)
	if err != nil {
		return nil, err
	}

	slog.Info("session auto hybrid search", "query_len", len(f.Query), "vec", len(vecResults), "kw", len(kwResults))

	scores := rrfMerge(kwResults, vecResults)
	mems := collectMems(kwResults, vecResults)
	merged := sortByScore(mems, scores)
	page, _ := paginateSlice(merged, f.Offset, limit)
	return setScores(page, scores), nil
}

func (s *SessionService) hybridSearch(ctx context.Context, f domain.MemoryFilter, limit, fetchLimit int) ([]domain.Memory, error) {
	queryVec, err := s.embedder.Embed(ctx, f.Query)
	if err != nil {
		return nil, fmt.Errorf("session embed query: %w", err)
	}

	vecResults, err := s.sessions.VectorSearch(ctx, queryVec, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session vector search: %w", err)
	}
	vecResults = applyMinScore(vecResults, f.MinScore)

	kwResults, err := s.ftsOrKeyword(ctx, f, fetchLimit)
	if err != nil {
		return nil, err
	}

	slog.Info("session hybrid search", "query_len", len(f.Query), "vec", len(vecResults), "kw", len(kwResults))

	scores := rrfMerge(kwResults, vecResults)
	mems := collectMems(kwResults, vecResults)
	merged := sortByScore(mems, scores)
	page, _ := paginateSlice(merged, f.Offset, limit)
	return setScores(page, scores), nil
}

func (s *SessionService) ftsSearch(ctx context.Context, f domain.MemoryFilter, limit, fetchLimit int) ([]domain.Memory, error) {
	results, err := s.sessions.FTSSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session fts search: %w", err)
	}
	page, _ := paginateSlice(results, f.Offset, limit)
	return page, nil
}

func (s *SessionService) keywordSearch(ctx context.Context, f domain.MemoryFilter, limit, fetchLimit int) ([]domain.Memory, error) {
	results, err := s.sessions.KeywordSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session keyword search: %w", err)
	}
	page, _ := paginateSlice(results, f.Offset, limit)
	return page, nil
}

func (s *SessionService) ftsOrKeyword(ctx context.Context, f domain.MemoryFilter, fetchLimit int) ([]domain.Memory, error) {
	if s.sessions.FTSAvailable() {
		r, err := s.sessions.FTSSearch(ctx, f.Query, f, fetchLimit)
		if err != nil {
			return nil, fmt.Errorf("session fts search: %w", err)
		}
		return r, nil
	}
	r, err := s.sessions.KeywordSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session keyword search: %w", err)
	}
	return r, nil
}

func applyMinScore(results []domain.Memory, minScore float64) []domain.Memory {
	if minScore == 0 {
		minScore = defaultMinScore
	}
	if minScore <= 0 {
		return results
	}
	filtered := results[:0]
	for _, m := range results {
		if m.Score != nil && *m.Score >= minScore {
			filtered = append(filtered, m)
		}
	}
	return filtered
}

func paginateSlice(results []domain.Memory, offset, limit int) ([]domain.Memory, int) {
	total := len(results)
	if offset >= total {
		return []domain.Memory{}, total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return results[offset:end], total
}
