package repository

import (
	"context"

	"github.com/qiffang/mnemos/server/internal/domain"
)

// MemoryRepo defines storage operations for memories.
type MemoryRepo interface {
	Create(ctx context.Context, m *domain.Memory) error
	Upsert(ctx context.Context, m *domain.Memory) error
	GetByID(ctx context.Context, spaceID, id string) (*domain.Memory, error)
	GetByKey(ctx context.Context, spaceID, keyName string) (*domain.Memory, error)
	UpdateOptimistic(ctx context.Context, m *domain.Memory, expectedVersion int) error
	Delete(ctx context.Context, spaceID, id string) error
	List(ctx context.Context, spaceID string, f domain.MemoryFilter) (memories []domain.Memory, total int, err error)
	Count(ctx context.Context, spaceID string) (int, error)
	BulkCreate(ctx context.Context, memories []*domain.Memory) error

	// VectorSearch performs ANN search using cosine distance.
	// Returns memories with Score populated, ordered by distance ascending.
	VectorSearch(ctx context.Context, spaceID string, queryVec []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error)

	// KeywordSearch performs substring search on content, returns memories ordered by updated_at DESC.
	KeywordSearch(ctx context.Context, spaceID string, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error)
}

// SpaceTokenRepo defines storage operations for space tokens.
type SpaceTokenRepo interface {
	CreateToken(ctx context.Context, st *domain.SpaceToken) error
	GetByToken(ctx context.Context, token string) (*domain.SpaceToken, error)
	ListBySpace(ctx context.Context, spaceID string) ([]domain.SpaceToken, error)
}
