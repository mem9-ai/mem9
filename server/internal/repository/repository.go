package repository

import (
	"context"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

// MemoryRepo defines storage operations for memories.
type MemoryRepo interface {
	Create(ctx context.Context, m *domain.Memory) error
	GetByID(ctx context.Context, id string) (*domain.Memory, error)
	UpdateOptimistic(ctx context.Context, m *domain.Memory, expectedVersion int) error
	SoftDelete(ctx context.Context, id, agentName string) error
	ArchiveMemory(ctx context.Context, id, supersededBy string) error
	ArchiveAndCreate(ctx context.Context, archiveID, supersededBy string, newMem *domain.Memory) error
	SetState(ctx context.Context, id string, state domain.MemoryState) error
	List(ctx context.Context, f domain.MemoryFilter) (memories []domain.Memory, total int, err error)
	Count(ctx context.Context) (int, error)
	BulkCreate(ctx context.Context, memories []*domain.Memory) error

	// VectorSearch performs ANN search using cosine distance with a pre-computed vector.
	VectorSearch(ctx context.Context, queryVec []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error)

	// AutoVectorSearch performs ANN search using VEC_EMBED_COSINE_DISTANCE with a plain-text query.
	// TiDB Serverless auto-embeds the query text.
	AutoVectorSearch(ctx context.Context, queryText string, f domain.MemoryFilter, limit int) ([]domain.Memory, error)

	KeywordSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error)

	// FTSSearch performs full-text search using FTS_MATCH_WORD with BM25 ranking.
	// Results include a fts_score field used for RRF merge.
	FTSSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error)
	// FTSAvailable reports whether full-text search is usable on this database.
	FTSAvailable() bool

	ListBootstrap(ctx context.Context, limit int) ([]domain.Memory, error)
	// NearDupSearch finds the nearest active memory to queryText across the tenant.
	// Returns ("", 0, nil) when no vector index is available (e.g. autoModel not
	// configured, or backend does not support auto-embedding).
	// Postgres returns ("", 0, nil) — auto-embedding is not supported.
	// DB9 implements real search when autoModel is configured; returns ("", 0, nil) otherwise.
	NearDupSearch(ctx context.Context, queryText string) (id string, score float64, err error)
	// CountStats returns the total active memory count and the count created in the last 7 days.
	CountStats(ctx context.Context) (total int64, last7d int64, err error)
}

// TenantRepo manages tenant records in the control plane DB.
type TenantRepo interface {
	Create(ctx context.Context, t *domain.Tenant) error
	GetByID(ctx context.Context, id string) (*domain.Tenant, error)
	GetByName(ctx context.Context, name string) (*domain.Tenant, error)
	UpdateStatus(ctx context.Context, id string, status domain.TenantStatus) error
	UpdateSchemaVersion(ctx context.Context, id string, version int) error
}

// UploadTaskRepo manages upload task records in the control plane DB.
type UploadTaskRepo interface {
	Create(ctx context.Context, task *domain.UploadTask) error
	GetByID(ctx context.Context, taskID string) (*domain.UploadTask, error)
	ListByTenant(ctx context.Context, tenantID string) ([]domain.UploadTask, error)
	UpdateStatus(ctx context.Context, taskID string, status domain.TaskStatus, errorMsg string) error
	UpdateProgress(ctx context.Context, taskID string, doneChunks int) error
	UpdateTotalChunks(ctx context.Context, taskID string, totalChunks int) error
	FetchPending(ctx context.Context, limit int) ([]domain.UploadTask, error)
	ResetProcessing(ctx context.Context, staleTimeout time.Duration) (int64, error)
}

// UTMRepo persists marketing attribution data captured at tenant provision time.
type UTMRepo interface {
	Create(ctx context.Context, utm *domain.TenantUTM) error
}

// SessionRepo handles raw session message storage and search.
// Search methods accept domain.MemoryFilter for consistency with MemoryRepo.
// All search methods return []domain.Memory (projected as TypeSession rows).
// BulkCreate silently skips MySQL 1146 (table not yet migrated) at DEBUG level.
type SessionRepo interface {
	BulkCreate(ctx context.Context, sessions []*domain.Session) error
	PatchTags(ctx context.Context, sessionID, contentHash string, tags []string) error
	AutoVectorSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error)
	VectorSearch(ctx context.Context, queryVec []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error)
	FTSSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error)
	KeywordSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error)
	FTSAvailable() bool
	// ListBySessionIDs returns raw session rows for the given session IDs, ordered by
	// session_id ASC, created_at ASC, seq ASC, id ASC. At most limitPerSession rows are
	// returned per session_id. Returns ErrNotSupported on non-TiDB backends.
	ListBySessionIDs(ctx context.Context, sessionIDs []string, limitPerSession int) ([]*domain.Session, error)
}
