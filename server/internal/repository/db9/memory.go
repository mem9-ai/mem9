package db9

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/repository/postgres"
)

// DB9MemoryRepo provides db9-specific memory operations.
// It embeds postgres.MemoryRepo to reuse most operations and overrides
// Create, Update, AutoVectorSearch and FTSSearch to leverage db9's native capabilities.
type DB9MemoryRepo struct {
	*postgres.MemoryRepo
	db            *sql.DB
	autoModel     string
	jiebaChecked  atomic.Bool
	jiebaDisabled atomic.Bool
	clusterID     string
}

// NewMemoryRepo creates the db9 memory repository.
// When autoModel is set, it enables db9's native EMBED_TEXT auto-embedding.
func NewMemoryRepo(db *sql.DB, autoModel string, ftsEnabled bool, clusterID string) *DB9MemoryRepo {
	if autoModel != "" {
		slog.Info("db9 auto-embedding enabled", "model", autoModel)
	}
	return &DB9MemoryRepo{
		MemoryRepo: postgres.NewMemoryRepo(db, ftsEnabled, clusterID),
		db:         db,
		autoModel:  autoModel,
		clusterID:  clusterID,
	}
}

const allColumns = `id, content, source, tags, metadata, embedding, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at, superseded_by`

// Create inserts a new memory. When autoModel is set, embedding column is omitted
// (db9's GENERATED ALWAYS AS will auto-compute it).
func (r *DB9MemoryRepo) Create(ctx context.Context, m *domain.Memory) error {
	if r.autoModel == "" {
		// No auto-embedding, use parent's implementation
		return r.MemoryRepo.Create(ctx, m)
	}

	// Auto-embedding mode: don't write embedding column (GENERATED ALWAYS AS)
	tagsJSON := marshalTags(m.Tags)
	memoryType := string(m.MemoryType)
	if memoryType == "" {
		memoryType = string(domain.TypePinned)
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO memories (id, content, source, tags, metadata, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, NOW(), NOW())`,
		m.ID, m.Content, nullString(m.Source),
		tagsJSON, nullJSON(m.Metadata), memoryType, nullString(m.AgentID), nullString(m.SessionID),
		m.Version, nullString(m.UpdatedBy),
	)
	if err != nil {
		return fmt.Errorf("create memory: %w", err)
	}
	return nil
}

// UpdateOptimistic updates a memory with optimistic locking.
// When autoModel is set, embedding column is omitted.
func (r *DB9MemoryRepo) UpdateOptimistic(ctx context.Context, m *domain.Memory, expectedVersion int) error {
	if r.autoModel == "" {
		return r.MemoryRepo.UpdateOptimistic(ctx, m, expectedVersion)
	}

	// Auto-embedding mode: don't write embedding column
	tagsJSON := marshalTags(m.Tags)

	query := `UPDATE memories SET content = $1, tags = $2, metadata = $3, version = version + 1, updated_by = $4, updated_at = NOW()
		 WHERE id = $5`
	args := []any{m.Content, tagsJSON, nullJSON(m.Metadata), nullString(m.UpdatedBy), m.ID}

	if expectedVersion > 0 {
		query += fmt.Sprintf(" AND version = $%d", len(args)+1)
		args = append(args, expectedVersion)
	}

	result, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("update memory: %w", err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// BulkCreate inserts multiple memories. When autoModel is set, embedding column is omitted.
func (r *DB9MemoryRepo) BulkCreate(ctx context.Context, memories []*domain.Memory) error {
	if r.autoModel == "" {
		return r.MemoryRepo.BulkCreate(ctx, memories)
	}

	// Auto-embedding mode
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	for _, m := range memories {
		tagsJSON := marshalTags(m.Tags)
		memoryType := string(m.MemoryType)
		if memoryType == "" {
			memoryType = string(domain.TypePinned)
		}
		_, execErr := tx.ExecContext(ctx,
			`INSERT INTO memories (id, content, source, tags, metadata, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, NOW(), NOW())`,
			m.ID, m.Content, nullString(m.Source),
			tagsJSON, nullJSON(m.Metadata), memoryType, nullString(m.AgentID), nullString(m.SessionID),
			m.Version, nullString(m.UpdatedBy),
		)
		if execErr != nil {
			if isDuplicateKey(execErr) {
				return fmt.Errorf("bulk insert memory %s: %w", m.ID, domain.ErrDuplicateKey)
			}
			return fmt.Errorf("bulk insert memory %s: %w", m.ID, execErr)
		}
	}
	return tx.Commit()
}

// ArchiveAndCreate archives an old memory and creates a new one atomically.
// When autoModel is set, embedding column is omitted for the new memory.
func (r *DB9MemoryRepo) ArchiveAndCreate(ctx context.Context, archiveID, supersededBy string, newMem *domain.Memory) error {
	if r.autoModel == "" {
		return r.MemoryRepo.ArchiveAndCreate(ctx, archiveID, supersededBy, newMem)
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx,
		`UPDATE memories SET state = 'archived', superseded_by = $1, updated_at = NOW()
		 WHERE id = $2 AND state = 'active'`,
		supersededBy, archiveID,
	)
	if err != nil {
		return fmt.Errorf("archive old memory: %w", err)
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}

	tagsJSON := marshalTags(newMem.Tags)
	memoryType := string(newMem.MemoryType)
	if memoryType == "" {
		memoryType = string(domain.TypePinned)
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO memories (id, content, source, tags, metadata, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, NOW(), NOW())`,
		newMem.ID, newMem.Content, nullString(newMem.Source),
		tagsJSON, nullJSON(newMem.Metadata), memoryType, nullString(newMem.AgentID), nullString(newMem.SessionID),
		newMem.Version, nullString(newMem.UpdatedBy),
	)
	if err != nil {
		return fmt.Errorf("create new memory: %w", err)
	}

	return tx.Commit()
}

// AutoVectorSearch performs semantic search using db9's native VEC_EMBED_COSINE_DISTANCE.
// The query text is automatically embedded by db9 — no client-side embedding required.
// Uses CTE to avoid duplicate VEC_EMBED_COSINE_DISTANCE calls.
func (r *DB9MemoryRepo) AutoVectorSearch(ctx context.Context, queryText string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	if r.autoModel == "" {
		return nil, fmt.Errorf("auto vector search not enabled: autoModel not configured")
	}
	if queryText == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 10
	}

	conds, args := r.BuildFilterConds(f)
	conds = append(conds, "embedding IS NOT NULL")

	where := strings.Join(conds, " AND ")

	// Use CTE to compute distance once per row, avoiding duplicate function calls.
	queryParamIdx := len(args) + 1
	limitParamIdx := queryParamIdx + 1

	query := fmt.Sprintf(`WITH scored AS (
		SELECT %s, VEC_EMBED_COSINE_DISTANCE(embedding, $%d) AS distance
		FROM memories
		WHERE %s
	)
	SELECT * FROM scored ORDER BY distance LIMIT $%d`, allColumns, queryParamIdx, where, limitParamIdx)

	fullArgs := make([]any, 0, len(args)+2)
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, queryText, limit)

	rows, err := r.db.QueryContext(ctx, query, fullArgs...)
	if err != nil {
		return nil, fmt.Errorf("db9 auto vector search: cluster_id=%s: %w", r.clusterID, err)
	}
	defer rows.Close()

	var memories []domain.Memory
	for rows.Next() {
		m, err := scanMemoryRowsWithDistance(rows)
		if err != nil {
			return nil, err
		}
		memories = append(memories, *m)
	}
	return memories, rows.Err()
}

// FTSSearch performs full-text search using db9's jieba tokenizer.
// jieba provides better Chinese and English tokenization than the default 'english' config.
// Jieba availability is probed once and cached to avoid repeated failure queries.
func (r *DB9MemoryRepo) FTSSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	if query == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 10
	}
	// Fast path: if jieba was already found unavailable, skip directly to parent.
	if r.jiebaChecked.Load() && r.jiebaDisabled.Load() {
		return r.MemoryRepo.FTSSearch(ctx, query, f, limit)
	}

	conds, args := r.BuildFilterConds(f)
	where := strings.Join(conds, " AND ")

	queryParamIdx := len(args) + 1
	limitParamIdx := queryParamIdx + 1

	// Use 'jieba' tokenizer for better Chinese + English support.
	sqlQuery := fmt.Sprintf(`SELECT %s, ts_rank(to_tsvector('jieba', content), plainto_tsquery('jieba', $%d)) AS fts_score
		FROM memories
		WHERE %s AND to_tsvector('jieba', content) @@ plainto_tsquery('jieba', $%d)
		ORDER BY fts_score DESC
		LIMIT $%d`, allColumns, queryParamIdx, where, queryParamIdx, limitParamIdx)

	fullArgs := make([]any, 0, len(args)+2)
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, query, limit)

	rows, err := r.db.QueryContext(ctx, sqlQuery, fullArgs...)
	if err != nil {
		// If jieba is not available, cache the result and fall back to parent's FTSSearch (english tokenizer)
		if strings.Contains(err.Error(), "text search configuration") && strings.Contains(err.Error(), "jieba") {
			slog.Warn("db9 jieba tokenizer not available, falling back to english (cached)", "error", err)
			r.jiebaChecked.Store(true)
			r.jiebaDisabled.Store(true)
			return r.MemoryRepo.FTSSearch(ctx, query, f, limit)
		}
		return nil, fmt.Errorf("db9 fts search: cluster_id=%s: %w", r.clusterID, err)
	}
	defer rows.Close()

	// Mark jieba as available on first successful query.
	if !r.jiebaChecked.Load() {
		r.jiebaChecked.Store(true)
	}

	var memories []domain.Memory
	for rows.Next() {
		m, err := scanMemoryRowsWithFTSScore(rows)
		if err != nil {
			return nil, err
		}
		memories = append(memories, *m)
	}
	return memories, rows.Err()
}

// scanMemoryRowsWithDistance scans a row with distance score appended.
func scanMemoryRowsWithDistance(rows *sql.Rows) (*domain.Memory, error) {
	var m domain.Memory
	var source, memoryType, agentID, sessionID, state, updatedBy, supersededBy sql.NullString
	var tagsJSON, metadataJSON []byte
	var embeddingStr sql.NullString
	var distance float64

	err := rows.Scan(&m.ID, &m.Content, &source,
		&tagsJSON, &metadataJSON, &embeddingStr, &memoryType, &agentID, &sessionID, &state, &m.Version, &updatedBy,
		&m.CreatedAt, &m.UpdatedAt, &supersededBy,
		&distance)
	if err != nil {
		return nil, fmt.Errorf("scan memory row with distance: %w", err)
	}
	m.Source = source.String
	m.MemoryType = domain.MemoryType(memoryType.String)
	if m.MemoryType == "" {
		m.MemoryType = domain.TypePinned
	}
	m.AgentID = agentID.String
	m.SessionID = sessionID.String
	m.State = domain.MemoryState(state.String)
	if m.State == "" {
		m.State = domain.StateActive
	}
	m.UpdatedBy = updatedBy.String
	m.SupersededBy = supersededBy.String
	m.Tags = unmarshalTags(tagsJSON)
	m.Metadata = unmarshalRawJSON(metadataJSON)
	// Convert distance to similarity score (1 - distance for cosine)
	score := 1 - distance
	m.Score = &score
	return &m, nil
}

// scanMemoryRowsWithFTSScore scans a row with FTS score appended.
func scanMemoryRowsWithFTSScore(rows *sql.Rows) (*domain.Memory, error) {
	var m domain.Memory
	var source, memoryType, agentID, sessionID, state, updatedBy, supersededBy sql.NullString
	var tagsJSON, metadataJSON []byte
	var embeddingStr sql.NullString
	var ftsScore float64

	err := rows.Scan(&m.ID, &m.Content, &source,
		&tagsJSON, &metadataJSON, &embeddingStr, &memoryType, &agentID, &sessionID, &state, &m.Version, &updatedBy,
		&m.CreatedAt, &m.UpdatedAt, &supersededBy,
		&ftsScore)
	if err != nil {
		return nil, fmt.Errorf("scan memory row with fts score: %w", err)
	}
	m.Source = source.String
	m.MemoryType = domain.MemoryType(memoryType.String)
	if m.MemoryType == "" {
		m.MemoryType = domain.TypePinned
	}
	m.AgentID = agentID.String
	m.SessionID = sessionID.String
	m.State = domain.MemoryState(state.String)
	if m.State == "" {
		m.State = domain.StateActive
	}
	m.UpdatedBy = updatedBy.String
	m.SupersededBy = supersededBy.String
	m.Tags = unmarshalTags(tagsJSON)
	m.Metadata = unmarshalRawJSON(metadataJSON)
	m.Score = &ftsScore
	return &m, nil
}

// Helper functions
func marshalTags(tags []string) []byte {
	if len(tags) == 0 {
		return []byte("[]")
	}
	b, err := json.Marshal(tags)
	if err != nil {
		return []byte("[]")
	}
	return b
}

func unmarshalTags(data []byte) []string {
	if len(data) == 0 {
		return nil
	}
	var tags []string
	if err := json.Unmarshal(data, &tags); err != nil {
		return nil
	}
	return tags
}

func unmarshalRawJSON(data []byte) json.RawMessage {
	if len(data) == 0 || string(data) == "null" {
		return nil
	}
	return json.RawMessage(data)
}

func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

func nullJSON(data json.RawMessage) any {
	if len(data) == 0 || string(data) == "null" {
		return nil
	}
	return []byte(data)
}

func isDuplicateKey(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "23505") || strings.Contains(err.Error(), "duplicate key")
}
