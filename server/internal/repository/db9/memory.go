package db9

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/repository/postgres"
)

// DB9MemoryRepo provides db9-specific memory operations.
// It embeds postgres.MemoryRepo to reuse CRUD operations and overrides
// AutoVectorSearch and FTSSearch to leverage db9's native capabilities.
type DB9MemoryRepo struct {
	*postgres.MemoryRepo
	db        *sql.DB
	autoModel string
}

// NewMemoryRepo creates the db9 memory repository.
// When autoModel is set, it enables db9's native VEC_EMBED_COSINE_DISTANCE.
func NewMemoryRepo(db *sql.DB, autoModel string, ftsEnabled bool) *DB9MemoryRepo {
	if autoModel != "" {
		slog.Info("db9 auto-embedding enabled", "model", autoModel)
	}
	return &DB9MemoryRepo{
		MemoryRepo: postgres.NewMemoryRepo(db, ftsEnabled),
		db:         db,
		autoModel:  autoModel,
	}
}

const allColumns = `id, content, source, tags, metadata, embedding, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at, superseded_by`

// AutoVectorSearch performs semantic search using db9's native VEC_EMBED_COSINE_DISTANCE.
// The query text is automatically embedded by db9 — no client-side embedding required.
func (r *DB9MemoryRepo) AutoVectorSearch(ctx context.Context, queryText string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	if r.autoModel == "" {
		return nil, fmt.Errorf("auto vector search not enabled: autoModel not configured")
	}

	conds, args := r.buildFilterConds(f)
	conds = append(conds, "embedding IS NOT NULL")

	where := strings.Join(conds, " AND ")

	// db9 uses VEC_EMBED_COSINE_DISTANCE(embedding, query_text) for auto-embedding search.
	// PostgreSQL-style $N placeholders.
	queryParamIdx := len(args) + 1
	limitParamIdx := queryParamIdx + 1

	query := fmt.Sprintf(`SELECT %s, VEC_EMBED_COSINE_DISTANCE(embedding, $%d) AS distance
		FROM memories
		WHERE %s
		ORDER BY VEC_EMBED_COSINE_DISTANCE(embedding, $%d)
		LIMIT $%d`, allColumns, queryParamIdx, where, queryParamIdx, limitParamIdx)

	fullArgs := make([]any, 0, len(args)+2)
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, queryText, limit)

	rows, err := r.db.QueryContext(ctx, query, fullArgs...)
	if err != nil {
		return nil, fmt.Errorf("db9 auto vector search: %w", err)
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
func (r *DB9MemoryRepo) FTSSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	conds, args := r.buildFilterConds(f)
	where := strings.Join(conds, " AND ")

	queryParamIdx := len(args) + 1
	limitParamIdx := queryParamIdx + 1

	// Use 'jieba' tokenizer for better Chinese + English support.
	// Falls back gracefully if jieba is not available (standard tsvector still works).
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
		// If jieba is not available, fall back to parent's FTSSearch (english tokenizer)
		if strings.Contains(err.Error(), "jieba") {
			slog.Warn("db9 jieba tokenizer not available, falling back to english", "error", err)
			return r.MemoryRepo.FTSSearch(ctx, query, f, limit)
		}
		return nil, fmt.Errorf("db9 fts search: %w", err)
	}
	defer rows.Close()

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

// buildFilterConds builds WHERE conditions without the keyword query.
// Mirrors postgres.MemoryRepo.buildFilterConds but uses $N placeholders.
func (r *DB9MemoryRepo) buildFilterConds(f domain.MemoryFilter) ([]string, []any) {
	conds := []string{}
	args := []any{}
	paramIdx := 1

	if f.State == "all" {
		// no state filter
	} else if f.State != "" {
		conds = append(conds, fmt.Sprintf("state = $%d", paramIdx))
		args = append(args, f.State)
		paramIdx++
	} else {
		conds = append(conds, "state = 'active'")
	}

	if f.MemoryType != "" {
		types := strings.Split(f.MemoryType, ",")
		if len(types) == 1 {
			conds = append(conds, fmt.Sprintf("memory_type = $%d", paramIdx))
			args = append(args, types[0])
			paramIdx++
		} else {
			placeholders := make([]string, len(types))
			for i, t := range types {
				placeholders[i] = fmt.Sprintf("$%d", paramIdx)
				args = append(args, strings.TrimSpace(t))
				paramIdx++
			}
			conds = append(conds, "memory_type IN ("+strings.Join(placeholders, ",")+")")
		}
	}

	if f.AgentID != "" {
		conds = append(conds, fmt.Sprintf("agent_id = $%d", paramIdx))
		args = append(args, f.AgentID)
		paramIdx++
	}
	if f.SessionID != "" {
		conds = append(conds, fmt.Sprintf("session_id = $%d", paramIdx))
		args = append(args, f.SessionID)
		paramIdx++
	}
	if f.Source != "" {
		conds = append(conds, fmt.Sprintf("source = $%d", paramIdx))
		args = append(args, f.Source)
		paramIdx++
	}
	for _, tag := range f.Tags {
		conds = append(conds, fmt.Sprintf("tags @> $%d::jsonb", paramIdx))
		args = append(args, `["`+tag+`"]`)
		paramIdx++
	}
	if len(conds) == 0 {
		conds = append(conds, "1=1")
	}
	return conds, args
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

// Helper functions for JSON unmarshaling (duplicated from postgres for package isolation)
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
