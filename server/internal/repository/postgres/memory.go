package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"

	"github.com/pgvector/pgvector-go"

	"github.com/qiffang/mnemos/server/internal/domain"
)

type MemoryRepo struct {
	db           *sql.DB
	ftsAvailable atomic.Bool
}

func NewMemoryRepo(db *sql.DB, ftsEnabled bool) *MemoryRepo {
	r := &MemoryRepo{db: db}
	r.ftsAvailable.Store(ftsEnabled)
	if ftsEnabled {
		slog.Info("FTS search enabled via MNEMO_FTS_ENABLED")
	}
	return r
}

func (r *MemoryRepo) FTSAvailable() bool { return r.ftsAvailable.Load() }

const allColumns = `id, content, source, tags, metadata, embedding, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at, superseded_by`

func (r *MemoryRepo) Create(ctx context.Context, m *domain.Memory) error {
	tagsJSON := marshalTags(m.Tags)
	memoryType := string(m.MemoryType)
	if memoryType == "" {
		memoryType = string(domain.TypePinned)
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO memories (id, content, source, tags, metadata, embedding, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11, NOW(), NOW())`,
		m.ID, m.Content, nullString(m.Source),
		tagsJSON, nullJSON(m.Metadata), vecToParam(m.Embedding), memoryType, nullString(m.AgentID), nullString(m.SessionID),
		m.Version, nullString(m.UpdatedBy),
	)
	if err != nil {
		return fmt.Errorf("create memory: %w", err)
	}
	return nil
}

func (r *MemoryRepo) GetByID(ctx context.Context, id string) (*domain.Memory, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT `+allColumns+` FROM memories WHERE id = $1 AND state = 'active'`, id,
	)
	return scanMemory(row)
}

func (r *MemoryRepo) UpdateOptimistic(ctx context.Context, m *domain.Memory, expectedVersion int) error {
	tagsJSON := marshalTags(m.Tags)

	query := `UPDATE memories SET content = $1, tags = $2, metadata = $3, embedding = $4, version = version + 1, updated_by = $5, updated_at = NOW()
		 WHERE id = $6`
	args := []any{m.Content, tagsJSON, nullJSON(m.Metadata), vecToParam(m.Embedding), nullString(m.UpdatedBy), m.ID}

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

func (r *MemoryRepo) SoftDelete(ctx context.Context, id, agentName string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("soft delete begin tx: %w", err)
	}
	defer tx.Rollback()

	var state sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT state FROM memories WHERE id = $1 FOR UPDATE`,
		id,
	).Scan(&state)
	if err == sql.ErrNoRows {
		return domain.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("soft delete lock row: %w", err)
	}

	if state.String == string(domain.StateDeleted) {
		return nil
	}
	_, err = tx.ExecContext(ctx,
		`UPDATE memories SET state = 'deleted', updated_at = NOW() WHERE id = $1`,
		id,
	)
	if err != nil {
		return fmt.Errorf("soft delete update: %w", err)
	}

	return tx.Commit()
}

func (r *MemoryRepo) ArchiveMemory(ctx context.Context, id, supersededBy string) error {
	result, err := r.db.ExecContext(ctx,
		`UPDATE memories SET state = 'archived', superseded_by = $1, updated_at = NOW()
		 WHERE id = $2 AND state = 'active'`,
		supersededBy, id,
	)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) ArchiveAndCreate(ctx context.Context, archiveID, supersededBy string, newMem *domain.Memory) error {
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
		`INSERT INTO memories (id, content, source, tags, metadata, embedding, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11, NOW(), NOW())`,
		newMem.ID, newMem.Content, nullString(newMem.Source),
		tagsJSON, nullJSON(newMem.Metadata), vecToParam(newMem.Embedding), memoryType, nullString(newMem.AgentID), nullString(newMem.SessionID),
		newMem.Version, nullString(newMem.UpdatedBy),
	)
	if err != nil {
		return fmt.Errorf("create new memory: %w", err)
	}

	return tx.Commit()
}

func (r *MemoryRepo) SetState(ctx context.Context, id string, state domain.MemoryState) error {
	result, err := r.db.ExecContext(ctx,
		`UPDATE memories SET state = $1, updated_at = NOW() WHERE id = $2 AND state = 'active'`,
		string(state), id,
	)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) List(ctx context.Context, f domain.MemoryFilter) ([]domain.Memory, int, error) {
	where, args := r.buildWhere(f)

	// Count total matches.
	var total int
	countQuery := "SELECT COUNT(*) FROM memories WHERE " + where
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count memories: %w", err)
	}

	// Fetch page.
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}

	nextParam := len(args) + 1
	dataQuery := "SELECT " + allColumns + " FROM memories WHERE " +
		where + fmt.Sprintf(" ORDER BY updated_at DESC LIMIT $%d OFFSET $%d", nextParam, nextParam+1)
	dataArgs := make([]any, len(args), len(args)+2)
	copy(dataArgs, args)
	dataArgs = append(dataArgs, limit, offset)

	rows, err := r.db.QueryContext(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("list memories: %w", err)
	}
	defer rows.Close()

	var memories []domain.Memory
	for rows.Next() {
		m, err := scanMemoryRows(rows)
		if err != nil {
			return nil, 0, err
		}
		memories = append(memories, *m)
	}
	return memories, total, rows.Err()
}

func (r *MemoryRepo) Count(ctx context.Context) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM memories WHERE state = 'active'`,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count memories: %w", err)
	}
	return count, nil
}

func (r *MemoryRepo) ListBootstrap(ctx context.Context, limit int) ([]domain.Memory, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+allColumns+` FROM memories WHERE state = 'active' ORDER BY updated_at DESC LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list bootstrap: %w", err)
	}
	defer rows.Close()

	var memories []domain.Memory
	for rows.Next() {
		m, err := scanMemoryRows(rows)
		if err != nil {
			return nil, err
		}
		memories = append(memories, *m)
	}
	return memories, rows.Err()
}

func (r *MemoryRepo) BulkCreate(ctx context.Context, memories []*domain.Memory) error {
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
			`INSERT INTO memories (id, content, source, tags, metadata, embedding, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11, NOW(), NOW())`,
			m.ID, m.Content, nullString(m.Source),
			tagsJSON, nullJSON(m.Metadata), vecToParam(m.Embedding), memoryType, nullString(m.AgentID), nullString(m.SessionID),
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

// VectorSearch performs ANN search using pgvector's cosine distance operator.
func (r *MemoryRepo) VectorSearch(ctx context.Context, queryVec []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	if len(queryVec) == 0 {
		return nil, nil
	}

	conds, args := r.buildFilterConds(f)
	conds = append(conds, "embedding IS NOT NULL")

	// The query vector is the next parameter
	vecParamIdx := len(args) + 1
	limitParamIdx := vecParamIdx + 1

	where := strings.Join(conds, " AND ")

	query := fmt.Sprintf(`SELECT %s, embedding <=> $%d AS distance
		 FROM memories
		 WHERE %s
		 ORDER BY embedding <=> $%d
		 LIMIT $%d`, allColumns, vecParamIdx, where, vecParamIdx, limitParamIdx)

	fullArgs := make([]any, 0, len(args)+2)
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, pgvector.NewVector(queryVec), limit)

	rows, err := r.db.QueryContext(ctx, query, fullArgs...)
	if err != nil {
		return nil, fmt.Errorf("vector search: %w", err)
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

// AutoVectorSearch is not supported with PostgreSQL (TiDB-specific feature).
// It falls back to returning nil — callers should use VectorSearch with pre-computed embeddings.
func (r *MemoryRepo) AutoVectorSearch(ctx context.Context, queryText string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	return nil, fmt.Errorf("auto vector search not supported with PostgreSQL; use VectorSearch with pre-computed embeddings")
}

// KeywordSearch performs substring search on content.
func (r *MemoryRepo) KeywordSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	conds, args := r.buildFilterConds(f)
	if query != "" {
		nextParam := len(args) + 1
		conds = append(conds, fmt.Sprintf("content ILIKE '%%' || $%d || '%%'", nextParam))
		args = append(args, query)
	}

	where := strings.Join(conds, " AND ")
	limitParam := len(args) + 1
	sqlQuery := fmt.Sprintf(`SELECT %s FROM memories WHERE %s ORDER BY updated_at DESC LIMIT $%d`, allColumns, where, limitParam)
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("keyword search: %w", err)
	}
	defer rows.Close()

	var memories []domain.Memory
	for rows.Next() {
		m, err := scanMemoryRows(rows)
		if err != nil {
			return nil, err
		}
		memories = append(memories, *m)
	}
	return memories, rows.Err()
}

// FTSSearch performs full-text search using PostgreSQL tsvector/tsquery.
func (r *MemoryRepo) FTSSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	conds, args := r.buildFilterConds(f)
	where := strings.Join(conds, " AND ")

	queryParamIdx := len(args) + 1
	limitParamIdx := queryParamIdx + 1
	sqlQuery := fmt.Sprintf(`SELECT %s, ts_rank(to_tsvector('english', content), plainto_tsquery('english', $%d)) AS fts_score
		 FROM memories
		 WHERE %s AND to_tsvector('english', content) @@ plainto_tsquery('english', $%d)
		 ORDER BY fts_score DESC
		 LIMIT $%d`, allColumns, queryParamIdx, where, queryParamIdx, limitParamIdx)

	fullArgs := make([]any, 0, len(args)+2)
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, query, limit)

	rows, err := r.db.QueryContext(ctx, sqlQuery, fullArgs...)
	if err != nil {
		return nil, fmt.Errorf("fts search: %w", err)
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

// ---- WHERE builder ----

func (r *MemoryRepo) buildWhere(f domain.MemoryFilter) (string, []any) {
	conds, args := r.buildFilterConds(f)
	if f.Query != "" {
		nextParam := len(args) + 1
		conds = append(conds, fmt.Sprintf("content ILIKE '%%' || $%d || '%%'", nextParam))
		args = append(args, f.Query)
	}
	return strings.Join(conds, " AND "), args
}

func (r *MemoryRepo) buildFilterConds(f domain.MemoryFilter) ([]string, []any) {
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
		tagJSON, err := json.Marshal(tag)
		if err != nil {
			continue
		}
		conds = append(conds, fmt.Sprintf("tags @> $%d::jsonb", paramIdx))
		args = append(args, "["+string(tagJSON)+"]")
		paramIdx++
	}
	if len(conds) == 0 {
		conds = append(conds, "1=1")
	}
	return conds, args
}

// ---- Helpers ----

func scanMemory(row *sql.Row) (*domain.Memory, error) {
	var m domain.Memory
	var source, memoryType, agentID, sessionID, state, updatedBy, supersededBy sql.NullString
	var tagsJSON, metadataJSON []byte
	var embeddingStr sql.NullString

	err := row.Scan(&m.ID, &m.Content, &source,
		&tagsJSON, &metadataJSON, &embeddingStr, &memoryType, &agentID, &sessionID, &state, &m.Version, &updatedBy,
		&m.CreatedAt, &m.UpdatedAt, &supersededBy)
	if err == sql.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan memory: %w", err)
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
	return &m, nil
}

func scanMemoryRows(rows *sql.Rows) (*domain.Memory, error) {
	var m domain.Memory
	var source, memoryType, agentID, sessionID, state, updatedBy, supersededBy sql.NullString
	var tagsJSON, metadataJSON []byte
	var embeddingStr sql.NullString

	err := rows.Scan(&m.ID, &m.Content, &source,
		&tagsJSON, &metadataJSON, &embeddingStr, &memoryType, &agentID, &sessionID, &state, &m.Version, &updatedBy,
		&m.CreatedAt, &m.UpdatedAt, &supersededBy)
	if err != nil {
		return nil, fmt.Errorf("scan memory row: %w", err)
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
	return &m, nil
}

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
	score := 1 - distance
	m.Score = &score
	return &m, nil
}

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

// vecToParam converts a float32 slice to a pgvector.Vector for use as a query parameter.
func vecToParam(embedding []float32) any {
	if len(embedding) == 0 {
		return nil
	}
	return pgvector.NewVector(embedding)
}

// isDuplicateKey checks if the error is a PostgreSQL unique constraint violation (23505).
func isDuplicateKey(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "23505") || strings.Contains(err.Error(), "duplicate key")
}
