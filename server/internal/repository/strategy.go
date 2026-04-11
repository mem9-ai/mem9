package repository

import (
	"context"

	"github.com/qiffang/mnemos/server/internal/domain"
)

// RecallStrategyPrototypeRepo searches the control-plane prototype table.
type RecallStrategyPrototypeRepo interface {
	VectorSearch(ctx context.Context, query string, limit int) ([]domain.RecallStrategyPrototypeMatch, error)
	FTSSearch(ctx context.Context, query string, limit int) ([]domain.RecallStrategyPrototypeMatch, error)
}
