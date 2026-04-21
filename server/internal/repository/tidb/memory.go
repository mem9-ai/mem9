package tidb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/qiffang/mnemos/server/internal/domain"
)

type MemoryRepo struct {
	db           *sql.DB
	autoModel    string
	ftsAvailable atomic.Bool
	clusterID    string
}

func NewMemoryRepo(db *sql.DB, autoModel string, ftsEnabled bool, clusterID string) *MemoryRepo {
	r := &MemoryRepo{db: db, autoModel: autoModel, clusterID: clusterID}
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
	if r.autoModel != "" {
		_, err := r.db.ExecContext(ctx,
			`INSERT INTO memories (id, content, source, tags, metadata, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NOW(), NOW())`,
			m.ID, m.Content, nullString(m.Source),
			tagsJSON, nullJSON(m.Metadata), memoryType, nullString(m.AgentID), nullString(m.SessionID),
			m.Version, nullString(m.UpdatedBy),
		)
		if err != nil {
			return fmt.Errorf("create memory: %w", err)
		}
		return nil
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO memories (id, content, source, tags, metadata, embedding, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NOW(), NOW())`,
		m.ID, m.Content, nullString(m.Source),
		tagsJSON, nullJSON(m.Metadata), vecToString(m.Embedding), memoryType, nullString(m.AgentID), nullString(m.SessionID),
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
	if r.autoModel != "" {
		query = `UPDATE memories SET content = ?, tags = ?, metadata = ?, version = version + 1, updated_by = ?, updated_at = NOW()
			 WHERE id = ?`
		args = []any{m.Content, tagsJSON, nullJSON(m.Metadata), nullString(m.UpdatedBy), m.ID}
	} else {
		query = `UPDATE memories SET content = ?, tags = ?, metadata = ?, embedding = ?, version = version + 1, updated_by = ?, updated_at = NOW()
			 WHERE id = ?`
		args = []any{m.Content, tagsJSON, nullJSON(m.Metadata), vecToString(m.Embedding), nullString(m.UpdatedBy), m.ID}
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

func (r *MemoryRepo) SoftDelete(ctx context.Context, id, agentName string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("soft delete begin tx: %w", err)
	}
	defer tx.Rollback()

	var state sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT state FROM memories WHERE id = ? FOR UPDATE`,
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
		`UPDATE memories SET state = 'deleted', updated_at = NOW() WHERE id = ?`,
		id,
	)
	if err != nil {
		return fmt.Errorf("soft delete update: %w", err)
	}

	return tx.Commit()
}

func (r *MemoryRepo) BulkSoftDelete(ctx context.Context, ids []string, agentName string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}

	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}

	query := `UPDATE memories SET state = 'deleted', updated_at = NOW()
		 WHERE id IN (` + strings.Join(placeholders, ",") + `) AND state != 'deleted'`

	result, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("bulk soft delete: %w", err)
	}

	n, _ := result.RowsAffected()
	return n, nil
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

func (r *MemoryRepo) ArchiveAndCreate(ctx context.Context, archiveID, supersededBy string, newMem *domain.Memory) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx,
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

	if r.autoModel != "" {
		_, err = tx.ExecContext(ctx,
			`INSERT INTO memories (id, content, source, tags, metadata, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NOW(), NOW())`,
			newMem.ID, newMem.Content, nullString(newMem.Source),
			tagsJSON, nullJSON(newMem.Metadata), memoryType, nullString(newMem.AgentID), nullString(newMem.SessionID),
			newMem.Version, nullString(newMem.UpdatedBy),
		)
	} else {
		_, err = tx.ExecContext(ctx,
			`INSERT INTO memories (id, content, source, tags, metadata, embedding, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NOW(), NOW())`,
			newMem.ID, newMem.Content, nullString(newMem.Source),
			tagsJSON, nullJSON(newMem.Metadata), vecToString(newMem.Embedding), memoryType, nullString(newMem.AgentID), nullString(newMem.SessionID),
			newMem.Version, nullString(newMem.UpdatedBy),
		)
	}
	if err != nil {
		return fmt.Errorf("create new memory: %w", err)
	}

	return tx.Commit()
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

	// Count total matches.
	var total int
	countQuery := "SELECT COUNT(*) FROM memories WHERE " + where
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		slog.Error("list memories: count failed", "cluster_id", r.clusterID, "err", err)
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

	dataQuery := "SELECT " + allColumns + " FROM memories WHERE " +
		where + " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
	// Copy args to avoid mutating the original slice (append may reuse underlying array).
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

func (r *MemoryRepo) BulkCreate(ctx context.Context, memories []*domain.Memory) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	var stmtSQL string
	if r.autoModel != "" {
		stmtSQL = `INSERT INTO memories (id, content, source, tags, metadata, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NOW(), NOW())`
	} else {
		stmtSQL = `INSERT INTO memories (id, content, source, tags, metadata, embedding, memory_type, agent_id, session_id, state, version, updated_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NOW(), NOW())`
	}

	stmt, err := tx.PrepareContext(ctx, stmtSQL)
	if err != nil {
		return fmt.Errorf("prepare: %w", err)
	}
	defer stmt.Close()

	for _, m := range memories {
		tagsJSON := marshalTags(m.Tags)
		memoryType := string(m.MemoryType)
		if memoryType == "" {
			memoryType = string(domain.TypePinned)
		}
		var execErr error
		if r.autoModel != "" {
			_, execErr = stmt.ExecContext(ctx,
				m.ID, m.Content, nullString(m.Source),
				tagsJSON, nullJSON(m.Metadata), memoryType, nullString(m.AgentID), nullString(m.SessionID),
				m.Version, nullString(m.UpdatedBy),
			)
		} else {
			_, execErr = stmt.ExecContext(ctx,
				m.ID, m.Content, nullString(m.Source),
				tagsJSON, nullJSON(m.Metadata), vecToString(m.Embedding), memoryType, nullString(m.AgentID), nullString(m.SessionID),
				m.Version, nullString(m.UpdatedBy),
			)
		}
		if execErr != nil {
			var mysqlErr *mysql.MySQLError
			if errors.As(execErr, &mysqlErr) && mysqlErr.Number == 1062 {
				return fmt.Errorf("bulk insert memory %s: %w", m.ID, domain.ErrDuplicateKey)
			}
			return fmt.Errorf("bulk insert memory %s: %w", m.ID, execErr)
		}
	}
	return tx.Commit()
}

// VectorSearch performs ANN search using cosine distance.
// VEC_COSINE_DISTANCE must appear identically in SELECT and ORDER BY for TiDB VECTOR INDEX usage.
func (r *MemoryRepo) VectorSearch(ctx context.Context, queryVec []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	vecStr := vecToString(queryVec)
	if vecStr == nil {
		return nil, nil
	}

	conds, args := r.buildFilterConds(f)
	conds = append(conds, "embedding IS NOT NULL")

	where := strings.Join(conds, " AND ")

	query := `SELECT ` + allColumns + `, VEC_COSINE_DISTANCE(embedding, ?) AS distance
		 FROM memories
		 WHERE ` + where + `
		 ORDER BY VEC_COSINE_DISTANCE(embedding, ?)
		 LIMIT ?`

	// args order: vecStr (SELECT), filter args..., vecStr (ORDER BY), limit
	fullArgs := make([]any, 0, len(args)+3)
	fullArgs = append(fullArgs, vecStr)
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, vecStr, limit)

	start := time.Now()
	rows, err := r.db.QueryContext(ctx, query, fullArgs...)
	if err != nil {
		slog.ErrorContext(ctx, "vector search failed", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "err", err)
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
	slog.DebugContext(ctx, "vector search done", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "count", len(memories))
	return memories, nil
}

func (r *MemoryRepo) AutoVectorSearch(ctx context.Context, queryText string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	conds, args := r.buildFilterConds(f)
	conds = append(conds, "embedding IS NOT NULL")

	where := strings.Join(conds, " AND ")

	query := `SELECT ` + allColumns + `, VEC_EMBED_COSINE_DISTANCE(embedding, ?) AS distance
		 FROM memories
		 WHERE ` + where + `
		 ORDER BY VEC_EMBED_COSINE_DISTANCE(embedding, ?)
		 LIMIT ?`

	fullArgs := make([]any, 0, len(args)+3)
	fullArgs = append(fullArgs, queryText)
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, queryText, limit)

	start := time.Now()
	rows, err := r.db.QueryContext(ctx, query, fullArgs...)
	if err != nil {
		slog.ErrorContext(ctx, "auto vector search failed", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "err", err)
		return nil, fmt.Errorf("auto vector search: cluster_id=%s: %w", r.clusterID, err)
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
	slog.DebugContext(ctx, "auto vector search done", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "count", len(memories))
	return memories, nil
}

// KeywordSearch performs substring search on content.
func (r *MemoryRepo) KeywordSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	conds, args := r.buildFilterConds(f)
	if query != "" {
		conds = append(conds, "content LIKE CONCAT('%', ?, '%')")
		args = append(args, query)
	}

	where := strings.Join(conds, " AND ")
	sqlQuery := `SELECT ` + allColumns + ` FROM memories WHERE ` + where + ` ORDER BY updated_at DESC LIMIT ?`
	args = append(args, limit)

	start := time.Now()
	rows, err := r.db.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		slog.ErrorContext(ctx, "keyword search failed", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "err", err)
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
	slog.DebugContext(ctx, "keyword search done", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "count", len(memories))
	return memories, nil
}

// ftsSafeLiteral escapes a query string for safe inline use inside a SQL
// single-quoted literal (e.g. fts_match_word('...', content)).
// TiDB requires FTS_MATCH_WORD's first argument to be a constant string, so
// parameterized placeholders (?) are not accepted (Error 1235).
// We escape backslashes and single-quotes per MySQL string literal rules.
func ftsSafeLiteral(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `'`, `''`)
	return s
}

// FTSSearch performs full-text search using FTS_MATCH_WORD with BM25 ranking.
// Server-mode contract: includes state = 'active'.
//
// TiDB does not support parameterized placeholders in FTS_MATCH_WORD (Error 1235
// "match against a non-constant string"), so the query term is inlined as a
// SQL string literal after escaping via ftsSafeLiteral.
func (r *MemoryRepo) FTSSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	start := time.Now()
	memories, err := r.ftsSearchWithPostFilter(ctx, query, f, limit)
	if err != nil {
		slog.ErrorContext(ctx, "fts search failed", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "err", err)
		return nil, fmt.Errorf("fts search: cluster_id=%s: %w", r.clusterID, err)
	}
	slog.DebugContext(ctx, "fts search done", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "count", len(memories))
	return memories, nil
}

type memoryFTSCandidate struct {
	id    string
	score float64
}

func (r *MemoryRepo) ftsSearchWithPostFilter(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	if limit <= 0 {
		return nil, nil
	}

	conds, args := r.buildFilterConds(f)
	where := strings.Join(conds, " AND ")
	safeQ := ftsSafeLiteral(query)
	candidates, err := r.fetchMemoryFTSCandidates(ctx, safeQ, limit)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, nil
	}

	filtered, err := r.fetchFilteredFTSMemories(ctx, candidates, where, args)
	if err != nil {
		return nil, err
	}
	if len(filtered) >= limit || len(candidates) < limit {
		if len(filtered) > limit {
			filtered = filtered[:limit]
		}
		return filtered, nil
	}

	// Bound the FTS-only candidate expansion to a single TopK pass. If selective
	// post-filters drop too many candidates, fall back to the original filtered
	// query shape to preserve completeness without unbounded global pagination.
	return r.filteredFTSSearch(ctx, safeQ, where, args, limit)
}

func (r *MemoryRepo) fetchMemoryFTSCandidates(ctx context.Context, safeQ string, limit int) ([]memoryFTSCandidate, error) {
	sqlQuery := `SELECT id, fts_match_word('` + safeQ + `', content) AS fts_score
		FROM memories
		WHERE fts_match_word('` + safeQ + `', content)
		ORDER BY fts_match_word('` + safeQ + `', content) DESC, id
		LIMIT ?`

	rows, err := r.db.QueryContext(ctx, sqlQuery, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	candidates := make([]memoryFTSCandidate, 0, limit)
	for rows.Next() {
		var candidate memoryFTSCandidate
		if err := rows.Scan(&candidate.id, &candidate.score); err != nil {
			return nil, fmt.Errorf("scan memory fts candidate: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return candidates, nil
}

func (r *MemoryRepo) fetchFilteredFTSMemories(ctx context.Context, candidates []memoryFTSCandidate, where string, filterArgs []any) ([]domain.Memory, error) {
	if len(candidates) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(candidates))
	args := make([]any, 0, len(candidates)+len(filterArgs))
	scoreByID := make(map[string]float64, len(candidates))
	for i, candidate := range candidates {
		placeholders[i] = "?"
		args = append(args, candidate.id)
		scoreByID[candidate.id] = candidate.score
	}
	args = append(args, filterArgs...)

	sqlQuery := `SELECT ` + allColumns + ` FROM memories
		WHERE id IN (` + strings.Join(placeholders, ",") + `) AND ` + where

	rows, err := r.db.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	memoriesByID := make(map[string]domain.Memory, len(candidates))
	for rows.Next() {
		m, err := scanMemoryRows(rows)
		if err != nil {
			return nil, err
		}
		score := scoreByID[m.ID]
		m.Score = &score
		memoriesByID[m.ID] = *m
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	ordered := make([]domain.Memory, 0, len(memoriesByID))
	for _, candidate := range candidates {
		m, ok := memoriesByID[candidate.id]
		if !ok {
			continue
		}
		score := candidate.score
		m.Score = &score
		ordered = append(ordered, m)
	}
	return ordered, nil
}

func (r *MemoryRepo) filteredFTSSearch(ctx context.Context, safeQ, where string, args []any, limit int) ([]domain.Memory, error) {
	sqlQuery := `SELECT ` + allColumns + `, fts_match_word('` + safeQ + `', content) AS fts_score
		FROM memories
		WHERE ` + where + ` AND fts_match_word('` + safeQ + `', content)
		ORDER BY fts_match_word('` + safeQ + `', content) DESC
		LIMIT ?`

	fullArgs := make([]any, 0, len(args)+1)
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, limit)

	rows, err := r.db.QueryContext(ctx, sqlQuery, fullArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	memories := make([]domain.Memory, 0, limit)
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
	return memories, nil
}

func (r *MemoryRepo) buildWhere(f domain.MemoryFilter) (string, []any) {
	conds, args := r.buildFilterConds(f)
	if f.Query != "" {
		conds = append(conds, "content LIKE ?")
		args = append(args, "%"+f.Query+"%")
	}
	return strings.Join(conds, " AND "), args
}

// buildFilterConds builds WHERE conditions without the keyword query (shared by vector/keyword search).
func (r *MemoryRepo) buildFilterConds(f domain.MemoryFilter) ([]string, []any) {
	conds := []string{}
	args := []any{}

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
	for _, tag := range f.Tags {
		tagJSON, err := json.Marshal(tag)
		if err != nil {
			continue
		}
		conds = append(conds, "JSON_CONTAINS(tags, ?)")
		args = append(args, string(tagJSON))
	}
	if len(conds) == 0 {
		conds = append(conds, "1=1")
	}
	return conds, args
}

// scanMemory scans a single row into a Memory.
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

// scanMemoryRows scans from *sql.Rows (used by List and KeywordSearch).
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

// scanMemoryRowsWithDistance scans a row that includes a trailing distance column (used by VectorSearch).
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
	m.Embedding = parseVecString(embeddingStr)
	score := 1 - distance
	m.Score = &score
	return &m, nil
}

// scanMemoryRowsWithFTSScore scans a row that includes a trailing fts_score column (used by FTSSearch).
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

func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

// nullJSON returns nil (NULL) for empty/nil JSON, otherwise the raw bytes.
func nullJSON(data json.RawMessage) any {
	if len(data) == 0 || string(data) == "null" {
		return nil
	}
	return []byte(data)
}

// vecToString converts a float32 slice to the TiDB VECTOR string format: "[0.1,0.2,...]".
// Returns nil for empty/nil slices.
// parseVecString parses a TiDB vector string (e.g. "[0.1,0.2,0.3]") back into []float32.
func parseVecString(b []byte) []float32 {
	s := strings.TrimSpace(string(b))
	if len(s) < 2 || s[0] != '[' || s[len(s)-1] != ']' {
		return nil
	}
	s = s[1 : len(s)-1]
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	vec := make([]float32, 0, len(parts))
	for _, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 32)
		if err != nil {
			return nil
		}
		vec = append(vec, float32(v))
	}
	return vec
}

func vecToString(embedding []float32) any {
	if len(embedding) == 0 {
		return nil
	}
	var sb strings.Builder
	sb.WriteByte('[')
	for i, v := range embedding {
		if i > 0 {
			sb.WriteByte(',')
		}
		sb.WriteString(fmt.Sprintf("%g", v))
	}
	sb.WriteByte(']')
	return sb.String()
}

func (r *MemoryRepo) NearDupSearch(ctx context.Context, queryText string) (string, float64, error) {
	if r.autoModel == "" {
		return "", 0, nil
	}
	var id string
	var dist float64
	err := r.db.QueryRowContext(ctx,
		`SELECT id, VEC_EMBED_COSINE_DISTANCE(embedding, ?) AS dist
		 FROM memories
		 WHERE state = 'active'
		   AND memory_type IN ('insight', 'pinned')
		   AND embedding IS NOT NULL
		 ORDER BY VEC_EMBED_COSINE_DISTANCE(embedding, ?)
		 LIMIT 1`,
		queryText, queryText,
	).Scan(&id, &dist)
	if err == sql.ErrNoRows {
		return "", 0, nil
	}
	if err != nil {
		return "", 0, fmt.Errorf("near dup search: %w", err)
	}
	return id, 1 - dist, nil
}

func (r *MemoryRepo) CountStats(ctx context.Context) (total int64, last7d int64, err error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*), COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END)
		 FROM memories WHERE state = 'active'`,
	)
	if err = row.Scan(&total, &last7d); err != nil {
		return 0, 0, fmt.Errorf("count stats: %w", err)
	}
	return total, last7d, nil
}
