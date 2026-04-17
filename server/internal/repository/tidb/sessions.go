package tidb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/qiffang/mnemos/server/internal/domain"
	internaltenant "github.com/qiffang/mnemos/server/internal/tenant"
)

type SessionRepo struct {
	db           *sql.DB
	autoModel    string
	ftsAvailable atomic.Bool
	clusterID    string
}

func NewSessionRepo(db *sql.DB, autoModel string, ftsEnabled bool, clusterID string) *SessionRepo {
	r := &SessionRepo{db: db, autoModel: autoModel, clusterID: clusterID}
	r.ftsAvailable.Store(ftsEnabled)
	return r
}

func (r *SessionRepo) FTSAvailable() bool { return r.ftsAvailable.Load() }

func (r *SessionRepo) BulkCreate(ctx context.Context, sessions []*domain.Session) error {
	if len(sessions) == 0 {
		return nil
	}

	var stmtSQL string
	if r.autoModel != "" {
		stmtSQL = `INSERT IGNORE INTO sessions
			(id, session_id, agent_id, source, seq, role, content, content_type, content_hash, tags, state, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())`
	} else {
		stmtSQL = `INSERT IGNORE INTO sessions
			(id, session_id, agent_id, source, seq, role, content, content_type, content_hash, tags, embedding, state, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())`
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sessions bulk create begin tx: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, stmtSQL)
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			slog.Debug("sessions table not yet ready, skipping raw save", "cluster_id", r.clusterID)
			return nil
		}
		return fmt.Errorf("sessions bulk create prepare: %w", err)
	}
	defer stmt.Close()

	for _, s := range sessions {
		tagsJSON := marshalTags(s.Tags)
		var execErr error
		if r.autoModel != "" {
			_, execErr = stmt.ExecContext(ctx,
				s.ID, nullString(s.SessionID), nullString(s.AgentID), nullString(s.Source),
				s.Seq, s.Role, s.Content, s.ContentType, s.ContentHash, tagsJSON,
			)
		} else {
			_, execErr = stmt.ExecContext(ctx,
				s.ID, nullString(s.SessionID), nullString(s.AgentID), nullString(s.Source),
				s.Seq, s.Role, s.Content, s.ContentType, s.ContentHash, tagsJSON,
				vecToString(s.Embedding),
			)
		}
		if execErr != nil {
			var mysqlErr *mysql.MySQLError
			if errors.As(execErr, &mysqlErr) && mysqlErr.Number == 1146 {
				slog.Debug("sessions table not yet ready, skipping raw save", "cluster_id", r.clusterID)
				return nil
			}
			return fmt.Errorf("sessions bulk insert: %w", execErr)
		}
	}
	return tx.Commit()
}

func (r *SessionRepo) PatchTags(ctx context.Context, sessionID, contentHash string, tags []string) error {
	tagsJSON := marshalTags(tags)
	_, err := r.db.ExecContext(ctx,
		`UPDATE sessions SET tags = ? WHERE session_id = ? AND content_hash = ? AND JSON_LENGTH(COALESCE(tags, '[]')) = 0`,
		tagsJSON, sessionID, contentHash,
	)
	if err != nil && internaltenant.IsTableNotFoundError(err) {
		return nil
	}
	return err
}

func (r *SessionRepo) buildSessionFilterConds(f domain.MemoryFilter) ([]string, []any) {
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

func (r *SessionRepo) AutoVectorSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	conds, args := r.buildSessionFilterConds(f)
	conds = append(conds, "embedding IS NOT NULL")
	where := strings.Join(conds, " AND ")

	sqlQuery := `SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at,
		VEC_EMBED_COSINE_DISTANCE(embedding, ?) AS distance
		FROM sessions
		WHERE ` + where + `
		ORDER BY VEC_EMBED_COSINE_DISTANCE(embedding, ?)
		LIMIT ?`

	fullArgs := make([]any, 0, len(args)+3)
	fullArgs = append(fullArgs, query)
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, query, limit)

	start := time.Now()
	rows, err := r.db.QueryContext(ctx, sqlQuery, fullArgs...)
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			return nil, nil
		}
		slog.ErrorContext(ctx, "sessions auto vector search failed", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "err", err)
		return nil, fmt.Errorf("sessions auto vector search: cluster_id=%s: %w", r.clusterID, err)
	}
	defer rows.Close()
	memories, err := scanSessionRowsWithDistance(rows)
	if err != nil {
		return nil, err
	}
	slog.DebugContext(ctx, "sessions auto vector search done", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "count", len(memories))
	return memories, nil
}

func (r *SessionRepo) VectorSearch(ctx context.Context, queryVec []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	vecStr := vecToString(queryVec)
	if vecStr == nil {
		return nil, nil
	}

	conds, args := r.buildSessionFilterConds(f)
	conds = append(conds, "embedding IS NOT NULL")
	where := strings.Join(conds, " AND ")

	sqlQuery := `SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at,
		VEC_COSINE_DISTANCE(embedding, ?) AS distance
		FROM sessions
		WHERE ` + where + `
		ORDER BY VEC_COSINE_DISTANCE(embedding, ?)
		LIMIT ?`

	fullArgs := make([]any, 0, len(args)+3)
	fullArgs = append(fullArgs, vecStr)
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, vecStr, limit)

	start := time.Now()
	rows, err := r.db.QueryContext(ctx, sqlQuery, fullArgs...)
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			return nil, nil
		}
		slog.ErrorContext(ctx, "sessions vector search failed", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "err", err)
		return nil, fmt.Errorf("sessions vector search: %w", err)
	}
	defer rows.Close()
	memories, err := scanSessionRowsWithDistance(rows)
	if err != nil {
		return nil, err
	}
	slog.DebugContext(ctx, "sessions vector search done", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "count", len(memories))
	return memories, nil
}

func (r *SessionRepo) FTSSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	conds, args := r.buildSessionFilterConds(f)
	where := strings.Join(conds, " AND ")

	safeQ := ftsSafeLiteral(query)
	sqlQuery := `SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at,
		fts_match_word('` + safeQ + `', content) AS fts_score
		FROM sessions
		WHERE ` + where + ` AND fts_match_word('` + safeQ + `', content)
		ORDER BY fts_match_word('` + safeQ + `', content) DESC
		LIMIT ?`

	fullArgs := make([]any, 0, len(args)+1)
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, limit)

	start := time.Now()
	rows, err := r.db.QueryContext(ctx, sqlQuery, fullArgs...)
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			return nil, nil
		}
		slog.ErrorContext(ctx, "sessions fts search failed", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "err", err)
		return nil, fmt.Errorf("sessions fts search: cluster_id=%s: %w", r.clusterID, err)
	}
	defer rows.Close()
	memories, err := scanSessionRowsWithFTSScore(rows)
	if err != nil {
		return nil, err
	}
	slog.DebugContext(ctx, "sessions fts search done", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "count", len(memories))
	return memories, nil
}

func (r *SessionRepo) KeywordSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	conds, args := r.buildSessionFilterConds(f)
	if query != "" {
		conds = append(conds, "content LIKE CONCAT('%', ?, '%')")
		args = append(args, query)
	}
	where := strings.Join(conds, " AND ")

	sqlQuery := `SELECT id, session_id, agent_id, source, seq, role, content, content_type, tags, state, created_at
		FROM sessions
		WHERE ` + where + `
		ORDER BY created_at DESC
		LIMIT ?`
	args = append(args, limit)

	start := time.Now()
	rows, err := r.db.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			return nil, nil
		}
		slog.ErrorContext(ctx, "sessions keyword search failed", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "err", err)
		return nil, fmt.Errorf("sessions keyword search: %w", err)
	}
	defer rows.Close()
	memories, err := scanSessionRows(rows)
	if err != nil {
		return nil, err
	}
	slog.DebugContext(ctx, "sessions keyword search done", "cluster_id", r.clusterID, "duration_ms", time.Since(start).Milliseconds(), "count", len(memories))
	return memories, nil
}

func scanSessionRows(rows *sql.Rows) ([]domain.Memory, error) {
	var result []domain.Memory
	for rows.Next() {
		m, err := scanSessionRowNoScore(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *m)
	}
	return result, rows.Err()
}

func scanSessionRowsWithDistance(rows *sql.Rows) ([]domain.Memory, error) {
	var result []domain.Memory
	for rows.Next() {
		m, err := scanSessionRowWithDistance(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *m)
	}
	return result, rows.Err()
}

func scanSessionRowsWithFTSScore(rows *sql.Rows) ([]domain.Memory, error) {
	var result []domain.Memory
	for rows.Next() {
		m, err := scanSessionRowWithFTSScore(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *m)
	}
	return result, rows.Err()
}

func scanSessionRowNoScore(rows *sql.Rows) (*domain.Memory, error) {
	var (
		sessionID, agentID, source, role, contentType sql.NullString
		tagsJSON                                      []byte
		state                                         sql.NullString
		seq                                           int
		createdAt                                     time.Time
		m                                             domain.Memory
	)
	if err := rows.Scan(
		&m.ID, &sessionID, &agentID, &source,
		&seq, &role, &m.Content, &contentType,
		&tagsJSON, &state, &createdAt,
	); err != nil {
		return nil, fmt.Errorf("scan session row: %w", err)
	}
	return fillSessionMemory(&m, sessionID, agentID, source, role, contentType, seq, tagsJSON, state, createdAt), nil
}

func scanSessionRowWithDistance(rows *sql.Rows) (*domain.Memory, error) {
	var (
		sessionID, agentID, source, role, contentType sql.NullString
		tagsJSON                                      []byte
		state                                         sql.NullString
		seq                                           int
		createdAt                                     time.Time
		distance                                      float64
		m                                             domain.Memory
	)
	if err := rows.Scan(
		&m.ID, &sessionID, &agentID, &source,
		&seq, &role, &m.Content, &contentType,
		&tagsJSON, &state, &createdAt,
		&distance,
	); err != nil {
		return nil, fmt.Errorf("scan session row with distance: %w", err)
	}
	m = *fillSessionMemory(&m, sessionID, agentID, source, role, contentType, seq, tagsJSON, state, createdAt)
	sc := 1 - distance
	m.Score = &sc
	return &m, nil
}

func scanSessionRowWithFTSScore(rows *sql.Rows) (*domain.Memory, error) {
	var (
		sessionID, agentID, source, role, contentType sql.NullString
		tagsJSON                                      []byte
		state                                         sql.NullString
		seq                                           int
		createdAt                                     time.Time
		ftsScore                                      float64
		m                                             domain.Memory
	)
	if err := rows.Scan(
		&m.ID, &sessionID, &agentID, &source,
		&seq, &role, &m.Content, &contentType,
		&tagsJSON, &state, &createdAt,
		&ftsScore,
	); err != nil {
		return nil, fmt.Errorf("scan session row with fts score: %w", err)
	}
	m = *fillSessionMemory(&m, sessionID, agentID, source, role, contentType, seq, tagsJSON, state, createdAt)
	m.Score = &ftsScore
	return &m, nil
}

func (r *SessionRepo) ListBySessionIDs(ctx context.Context, sessionIDs []string, limitPerSession int) ([]*domain.Session, error) {
	if len(sessionIDs) == 0 {
		return nil, nil
	}

	placeholders := strings.Repeat("?,", len(sessionIDs))
	placeholders = placeholders[:len(placeholders)-1]

	args := make([]any, 0, len(sessionIDs)+1)
	for _, id := range sessionIDs {
		args = append(args, id)
	}
	args = append(args, limitPerSession)

	sqlQuery := `SELECT id, session_id, agent_id, source, seq, role, content, content_type,
		content_hash, tags, state, created_at, updated_at
		FROM (
			SELECT *,
				ROW_NUMBER() OVER (
					PARTITION BY session_id
					ORDER BY created_at ASC, seq ASC, id ASC
				) AS rn
			FROM sessions
			WHERE session_id IN (` + placeholders + `) AND state = 'active'
		) t
		WHERE rn <= ?
		ORDER BY session_id ASC, created_at ASC, seq ASC, id ASC`

	rows, err := r.db.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("sessions list by session ids: cluster_id=%s: %w", r.clusterID, err)
	}
	defer rows.Close()
	return scanSessionDomainRows(rows)
}

func scanSessionDomainRows(rows *sql.Rows) ([]*domain.Session, error) {
	var result []*domain.Session
	for rows.Next() {
		s, err := scanSessionDomainRow(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

func scanSessionDomainRow(rows *sql.Rows) (*domain.Session, error) {
	var (
		sessionID, agentID, source, role, contentType, contentHash sql.NullString
		tagsJSON                                                   []byte
		state                                                      sql.NullString
		s                                                          domain.Session
	)
	if err := rows.Scan(
		&s.ID, &sessionID, &agentID, &source,
		&s.Seq, &role, &s.Content, &contentType,
		&contentHash, &tagsJSON, &state,
		&s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return nil, fmt.Errorf("scan session domain row: %w", err)
	}
	s.SessionID = sessionID.String
	s.AgentID = agentID.String
	s.Source = source.String
	s.Role = role.String
	s.ContentType = contentType.String
	s.ContentHash = contentHash.String
	s.Tags = unmarshalTags(tagsJSON)
	s.State = domain.MemoryState(state.String)
	if s.State == "" {
		s.State = domain.StateActive
	}
	return &s, nil
}
func fillSessionMemory(m *domain.Memory, sessionID, agentID, source, role, contentType sql.NullString,
	seq int, tagsJSON []byte, state sql.NullString, createdAt time.Time) *domain.Memory {
	m.MemoryType = domain.TypeSession
	m.SessionID = sessionID.String
	m.AgentID = agentID.String
	m.Source = source.String
	m.State = domain.MemoryState(state.String)
	if m.State == "" {
		m.State = domain.StateActive
	}
	m.Tags = unmarshalTags(tagsJSON)
	m.CreatedAt = createdAt
	m.UpdatedAt = createdAt // sessions are immutable; updated_at always equals created_at
	metaBytes, _ := json.Marshal(map[string]any{
		"role":         role.String,
		"seq":          seq,
		"content_type": contentType.String,
	})
	m.Metadata = metaBytes
	return m
}
