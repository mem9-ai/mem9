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
	SoftDelete(ctx context.Context, spaceID, id, agentName string) error
	List(ctx context.Context, spaceID string, f domain.MemoryFilter) (memories []domain.Memory, total int, err error)
	Count(ctx context.Context, spaceID string) (int, error)
	BulkCreate(ctx context.Context, memories []*domain.Memory) error

	// VectorSearch performs ANN search using cosine distance with a pre-computed vector.
	VectorSearch(ctx context.Context, spaceID string, queryVec []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error)

	// AutoVectorSearch performs ANN search using VEC_EMBED_COSINE_DISTANCE with a plain-text query.
	// TiDB Serverless auto-embeds the query text.
	AutoVectorSearch(ctx context.Context, spaceID string, queryText string, f domain.MemoryFilter, limit int) ([]domain.Memory, error)

	KeywordSearch(ctx context.Context, spaceID string, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error)

	// CRDTUpsert performs a transactional upsert with vector clock semantics.
	// The decide callback receives the existing row (nil if not found) and returns
	// the memory to write and whether the incoming write was dominated (no-op).
	// The repo handles BEGIN/FOR UPDATE/COMMIT with deadlock retry.
	CRDTUpsert(ctx context.Context, spaceID, keyName string, incoming *domain.Memory,
		decide func(existing *domain.Memory) (toWrite *domain.Memory, dominated bool, err error),
	) (*domain.Memory, bool, error)

	ListBootstrap(ctx context.Context, spaceID string, limit int) ([]domain.Memory, error)
}

type SpaceTokenRepo interface {
	CreateToken(ctx context.Context, st *domain.SpaceToken) error
	GetByToken(ctx context.Context, token string) (*domain.SpaceToken, error)
	ListBySpace(ctx context.Context, spaceID string) ([]domain.SpaceToken, error)
	GetByUserWorkspace(ctx context.Context, userID, workspaceKey string) (*domain.SpaceToken, error)
}

type UserTokenRepo interface {
	CreateToken(ctx context.Context, ut *domain.UserToken) error
	GetByToken(ctx context.Context, token string) (*domain.UserToken, error)
}
