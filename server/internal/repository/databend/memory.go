package databend

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

type MemoryRepo struct {
	db           *sql.DB
	ftsAvailable atomic.Bool
	clusterID    string
}

func NewMemoryRepo(db *sql.DB, ftsEnabled bool, clusterID string) *MemoryRepo {
	r := &MemoryRepo{db: db, clusterID: clusterID}
	r.ftsAvailable.Store(ftsEnabled)
	if ftsEnabled {
		slog.Info("FTS search enabled via MNEMO_FTS_ENABLED (databend)")
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
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NOW(), NOW())`,
		m.ID, m.Content, nullString(m.Source),
		string(tagsJSON), nullJSON(m.Metadata), vecToBytes(m.Embedding), memoryType, nullString(m.AgentID), nullString(m.SessionID),
		m.Version, nullString(m.UpdatedBy),
	)
	if err != nil {
		return fmt.Errorf("create memory: %w", err)
	}
	return nil
}

func (r *MemoryRepo) GetByID(ctx context.Context, id string) (*domain.Memory, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT `+allColumns+` FROM memories WHERE id = ? AND state = 'active'`, id,
	)
	return scanMemory(row)
}

func (r *MemoryRepo) UpdateOptimistic(ctx context.Context, m *domain.Memory, expectedVersion int) error {
	tagsJSON := marshalTags(m.Tags)

	var query string
	var args []any
	if len(m.Embedding) > 0 {
		query = `UPDATE memories SET content = ?, tags = ?, metadata = ?, embedding = ?, version = version + 1, updated_by = ?, updated_at = NOW()
			 WHERE id = ?`
		args = []any{m.Content, string(tagsJSON), nullJSON(m.Metadata), vecToBytes(m.Embedding), nullString(m.UpdatedBy), m.ID}
	} else {
		// Skip embedding: GetByID does not populate Embedding, so callers that
		// load-then-patch (e.g. smart ingest tag patching) would overwrite it with NULL.
		query = `UPDATE memories SET content = ?, tags = ?, metadata = ?, version = version + 1, updated_by = ?, updated_at = NOW()
			 WHERE id = ?`
		args = []any{m.Content, string(tagsJSON), nullJSON(m.Metadata), nullString(m.UpdatedBy), m.ID}
	}

	if expectedVersion > 0 {
		query += " AND version = ?"
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

// SoftDelete marks a memory as deleted.
func (r *MemoryRepo) SoftDelete(ctx context.Context, id, agentName string) error {
	result, err := r.db.ExecContext(ctx,
		`UPDATE memories SET state = 'deleted', updated_at = NOW() WHERE id = ?`,
		id,
	)
	if err != nil {
		return fmt.Errorf("soft delete: %w", err)
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) ArchiveMemory(ctx context.Context, id, supersededBy string) error {
	result, err := r.db.ExecContext(ctx,
		`UPDATE memories SET state = 'archived', superseded_by = ?, updated_at = NOW()
		 WHERE id = ? AND state = 'active'`,
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

// ArchiveAndCreate archives an old memory and creates a new one.
// Databend has limited transaction support, so this uses two separate statements.
func (r *MemoryRepo) ArchiveAndCreate(ctx context.Context, archiveID, supersededBy string, newMem *domain.Memory) error {
	result, err := r.db.ExecContext(ctx,
		`UPDATE memories SET state = 'archived', superseded_by = ?, updated_at = NOW()
		 WHERE id = ? AND state = 'active'`,
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

	_, err = r.db.ExecContext(ctx,
		`INSERT INTO memories (id, content, source, tags, metadata, embedding, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NOW(), NOW())`,
		newMem.ID, newMem.Content, nullString(newMem.Source),
		string(tagsJSON), nullJSON(newMem.Metadata), vecToBytes(newMem.Embedding), memoryType, nullString(newMem.AgentID), nullString(newMem.SessionID),
		newMem.Version, nullString(newMem.UpdatedBy),
	)
	if err != nil {
		return fmt.Errorf("create new memory: %w", err)
	}
	return nil
}

func (r *MemoryRepo) SetState(ctx context.Context, id string, state domain.MemoryState) error {
	result, err := r.db.ExecContext(ctx,
		`UPDATE memories SET state = ?, updated_at = NOW() WHERE id = ? AND state = 'active'`,
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

	var total int
	countQuery := "SELECT COUNT(*) FROM memories WHERE " + where
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		slog.Error("list memories: count failed", "cluster_id", r.clusterID, "err", err)
		return nil, 0, fmt.Errorf("count memories: %w", err)
	}

	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}

	dataQuery := "SELECT " + allColumns + " FROM memories WHERE " + where + " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
	dataArgs := make([]any, len(args), len(args)+2)
	copy(dataArgs, args)
	dataArgs = append(dataArgs, limit, offset)

	rows, err := r.db.QueryContext(ctx, dataQuery, dataArgs...)
	if err != nil {
		slog.Error("list memories: query failed", "cluster_id", r.clusterID, "err", err)
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
		slog.Error("count memories failed", "cluster_id", r.clusterID, "err", err)
		return 0, fmt.Errorf("count memories: %w", err)
	}
	return count, nil
}

func (r *MemoryRepo) ListBootstrap(ctx context.Context, limit int) ([]domain.Memory, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+allColumns+` FROM memories WHERE state = 'active' ORDER BY updated_at DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		slog.Error("list bootstrap failed", "cluster_id", r.clusterID, "err", err)
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

// BulkCreate inserts multiple memories without a transaction.
// Databend has limited transaction support; using individual INSERTs is more reliable.
func (r *MemoryRepo) BulkCreate(ctx context.Context, memories []*domain.Memory) error {
	for _, m := range memories {
		tagsJSON := marshalTags(m.Tags)
		memoryType := string(m.MemoryType)
		if memoryType == "" {
			memoryType = string(domain.TypePinned)
		}
		_, err := r.db.ExecContext(ctx,
			`INSERT INTO memories (id, content, source, tags, metadata, embedding, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NOW(), NOW())`,
			m.ID, m.Content, nullString(m.Source),
			string(tagsJSON), nullJSON(m.Metadata), vecToBytes(m.Embedding), memoryType, nullString(m.AgentID), nullString(m.SessionID),
			m.Version, nullString(m.UpdatedBy),
		)
		if err != nil {
			return fmt.Errorf("bulk insert memory %s: %w", m.ID, err)
		}
	}
	return nil
}

// VectorSearch performs ANN search using Databend's COSINE_DISTANCE function.
// Optional vector index for better performance:
//
// CREATE VECTOR INDEX IF NOT EXISTS idx_embedding ON memories(embedding) distance = 'cosine';
func (r *MemoryRepo) VectorSearch(ctx context.Context, queryVec []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	if len(queryVec) == 0 {
		return nil, nil
	}

	conds, args := r.buildFilterConds(f)
	conds = append(conds, "embedding IS NOT NULL")

	where := strings.Join(conds, " AND ")

	query := `SELECT ` + allColumns + `, COSINE_DISTANCE(embedding, ?::VECTOR(?)) AS distance
		 FROM memories
		 WHERE ` + where + `
		 ORDER BY distance
		 LIMIT ?`

	// Arg order: vec, dimension, filter args..., limit.
	fullArgs := make([]any, 0, len(args)+3)
	fullArgs = append(fullArgs, vecToBytes(queryVec), len(queryVec))
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, limit)

	start := time.Now()
	rows, err := r.db.QueryContext(ctx, query, fullArgs...)
	if err != nil {
		slog.Error("vector search failed", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "err", err)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	slog.Debug("vector search done", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "count", len(memories))
	return memories, nil
}

// AutoVectorSearch is not supported on Databend (no built-in EMBED_TEXT).
func (r *MemoryRepo) AutoVectorSearch(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
	return nil, fmt.Errorf("auto vector search: %w", domain.ErrNotSupported)
}

// KeywordSearch performs substring search on content using LIKE.
func (r *MemoryRepo) KeywordSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	conds, args := r.buildFilterConds(f)
	if query != "" {
		conds = append(conds, "content LIKE CONCAT('%', ?, '%')")
		args = append(args, query)
	}

	where := strings.Join(conds, " AND ")
	sqlQuery := "SELECT " + allColumns + " FROM memories WHERE " + where + " ORDER BY updated_at DESC LIMIT ?"
	args = append(args, limit)

	start := time.Now()
	rows, err := r.db.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		slog.Error("keyword search failed", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "err", err)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	slog.Debug("keyword search done", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "count", len(memories))
	return memories, nil
}

// FTSSearch performs full-text search using Databend's inverted index MATCH + SCORE.
// Requires an inverted index on the content column:
//
// CREATE INVERTED INDEX idx_content ON memories(content);
// REFRESH INVERTED INDEX idx_content ON memories;
func (r *MemoryRepo) FTSSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	if query == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 10
	}

	conds, args := r.buildFilterConds(f)
	where := strings.Join(conds, " AND ")

	sqlQuery := `SELECT ` + allColumns + `, SCORE() AS fts_score
		 FROM memories
		 WHERE ` + where + ` AND MATCH(content, ?)
		 ORDER BY fts_score DESC
		 LIMIT ?`

	fullArgs := make([]any, 0, len(args)+2)
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, query, limit)

	start := time.Now()
	rows, err := r.db.QueryContext(ctx, sqlQuery, fullArgs...)
	if err != nil {
		slog.Error("fts search failed", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "err", err)
		return nil, fmt.Errorf("fts search: cluster_id=%s: %w", r.clusterID, err)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	slog.Debug("fts search done", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "count", len(memories))
	return memories, nil
}


func (r *MemoryRepo) buildWhere(f domain.MemoryFilter) (string, []any) {
	conds, args := r.buildFilterConds(f)
	if f.Query != "" {
		conds = append(conds, "content LIKE CONCAT('%', ?, '%')")
		args = append(args, f.Query)
	}
	return strings.Join(conds, " AND "), args
}

func (r *MemoryRepo) buildFilterConds(f domain.MemoryFilter) ([]string, []any) {
	var conds []string
	var args []any

	if f.State == "all" {
		// no state filter
	} else if f.State != "" {
		conds = append(conds, "state = ?")
		args = append(args, f.State)
	} else {
		conds = append(conds, "state = 'active'")
	}

	if f.MemoryType != "" {
		types := strings.Split(f.MemoryType, ",")
		if len(types) == 1 {
			conds = append(conds, "memory_type = ?")
			args = append(args, types[0])
		} else {
			placeholders := make([]string, len(types))
			for i, t := range types {
				placeholders[i] = "?"
				args = append(args, strings.TrimSpace(t))
			}
			conds = append(conds, "memory_type IN ("+strings.Join(placeholders, ",")+")")
		}
	}

	if f.AgentID != "" {
		conds = append(conds, "agent_id = ?")
		args = append(args, f.AgentID)
	}
	if f.SessionID != "" {
		conds = append(conds, "session_id = ?")
		args = append(args, f.SessionID)
	}
	if f.Source != "" {
		conds = append(conds, "source = ?")
		args = append(args, f.Source)
	}
	// Databend uses VARIANT for tags; use JSON_ARRAY_CONTAINS for tag filtering.
	for _, tag := range f.Tags {
		tagJSON, err := json.Marshal(tag)
		if err != nil {
			continue
		}
		conds = append(conds, "JSON_ARRAY_CONTAINS(tags, ?)")
		args = append(args, string(tagJSON))
	}
	if len(conds) == 0 {
		conds = append(conds, "1=1")
	}
	return conds, args
}

func scanMemory(row *sql.Row) (*domain.Memory, error) {
	var m domain.Memory
	var source, memoryType, agentID, sessionID, state, updatedBy, supersededBy sql.NullString
	var tagsJSON, metadataJSON, embeddingStr []byte

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
	var tagsJSON, metadataJSON, embeddingStr []byte

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
	var tagsJSON, metadataJSON, embeddingStr []byte
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
	var tagsJSON, metadataJSON, embeddingStr []byte
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

// nullJSON returns nil (NULL) for empty/nil JSON, otherwise the JSON string.
// Databend driver requires string (not []byte) for VARIANT columns to be quoted correctly.
func nullJSON(data json.RawMessage) any {
	if len(data) == 0 || string(data) == "null" {
		return nil
	}
	return string(data)
}

// vecToBytes converts a float32 slice to "[0.1,0.2,...]" as []byte for use with ? placeholder.
// Returns nil for empty/nil slices.
func vecToBytes(embedding []float32) any {
	if len(embedding) == 0 {
		return nil
	}
	var sb strings.Builder
	sb.WriteByte('[')
	for i, v := range embedding {
		if i > 0 {
			sb.WriteByte(',')
		}
		fmt.Fprintf(&sb, "%g", v)
	}
	sb.WriteByte(']')
	return []byte(sb.String())
}

// NearDupSearch is not supported on Databend (no built-in auto-embedding).
func (r *MemoryRepo) NearDupSearch(_ context.Context, _ string) (string, float64, error) {
	return "", 0, nil
}
