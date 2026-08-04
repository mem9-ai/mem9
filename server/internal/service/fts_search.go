package service

import (
	"context"
	"errors"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func resolveFTSSearchResult(ctx context.Context, results []domain.Memory, err error, branch string) ([]domain.Memory, error) {
	if !errors.Is(err, domain.ErrFTSSearchTruncated) {
		return results, err
	}
	recorded := domain.RecordRecallWarning(ctx, domain.RecallWarning{
		Code:   domain.RecallWarningFTSCandidateBudgetExhausted,
		Branch: branch,
	})
	if !recorded {
		return results, err
	}
	return results, nil
}

func memoryFTSRecallBranch(memoryType string) string {
	if memoryType == string(domain.TypeInsight) {
		return string(domain.TypeInsight)
	}
	return string(domain.TypePinned)
}

func (s *MemoryService) repositoryFTSSearch(ctx context.Context, query string, filter domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	results, err := s.memories.FTSSearch(ctx, query, filter, limit)
	return resolveFTSSearchResult(ctx, results, err, memoryFTSRecallBranch(filter.MemoryType))
}

func (s *SessionService) repositoryFTSSearch(ctx context.Context, query string, filter domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	results, err := s.sessions.FTSSearch(ctx, query, filter, limit)
	return resolveFTSSearchResult(ctx, results, err, string(domain.TypeSession))
}
