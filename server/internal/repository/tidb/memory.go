package tidb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/qiffang/mnemos/server/internal/domain"
)

type MemoryRepo struct {
	db        *sql.DB
	autoModel string // non-empty = TiDB auto-embedding enabled
}

func NewMemoryRepo(db *sql.DB, autoModel string) *MemoryRepo {
	return &MemoryRepo{db: db, autoModel: autoModel}
}

const allColumns = `id, space_id, content, key_name, source, tags, metadata, embedding, version, updated_by, created_at, updated_at, vector_clock, origin_agent, tombstone`

func (r *MemoryRepo) Create(ctx context.Context, m *domain.Memory) error {
	tagsJSON := marshalTags(m.Tags)
	clockJSON := marshalClock(m.VectorClock)
	if r.autoModel != "" {
		_, err := r.db.ExecContext(ctx,
			`INSERT INTO memories (id, space_id, content, key_name, source, tags, metadata, version, updated_by, created_at, updated_at, vector_clock, origin_agent, tombstone)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, 0)`,
			m.ID, m.SpaceID, m.Content, nullString(m.KeyName), nullString(m.Source),
			tagsJSON, nullJSON(m.Metadata),
			m.Version, nullString(m.UpdatedBy),
			clockJSON, nullString(m.OriginAgent),
		)
		if err != nil {
			return fmt.Errorf("create memory: %w", err)
		}
		return nil
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO memories (id, space_id, content, key_name, source, tags, metadata, embedding, version, updated_by, created_at, updated_at, vector_clock, origin_agent, tombstone)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, 0)`,
		m.ID, m.SpaceID, m.Content, nullString(m.KeyName), nullString(m.Source),
		tagsJSON, nullJSON(m.Metadata), vecToString(m.Embedding),
		m.Version, nullString(m.UpdatedBy),
		clockJSON, nullString(m.OriginAgent),
	)
	if err != nil {
		return fmt.Errorf("create memory: %w", err)
	}
	return nil
}

func (r *MemoryRepo) Upsert(ctx context.Context, m *domain.Memory) error {
	tagsJSON := marshalTags(m.Tags)
	clockJSON := marshalClock(m.VectorClock)
	if r.autoModel != "" {
		_, err := r.db.ExecContext(ctx,
			`INSERT INTO memories (id, space_id, content, key_name, source, tags, metadata, version, updated_by, created_at, updated_at, vector_clock, origin_agent, tombstone)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW(), ?, ?, 0)
			 ON DUPLICATE KEY UPDATE
			   content = VALUES(content),
			   source = VALUES(source),
			   tags = VALUES(tags),
			   metadata = VALUES(metadata),
			   version = version + 1,
			   updated_by = VALUES(updated_by),
			   updated_at = NOW(),
			   origin_agent = VALUES(origin_agent),
			   tombstone = 0`,
			m.ID, m.SpaceID, m.Content, nullString(m.KeyName), nullString(m.Source),
			tagsJSON, nullJSON(m.Metadata),
			nullString(m.UpdatedBy),
			clockJSON, nullString(m.OriginAgent),
		)
		if err != nil {
			return fmt.Errorf("upsert memory: %w", err)
		}
		return nil
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO memories (id, space_id, content, key_name, source, tags, metadata, embedding, version, updated_by, created_at, updated_at, vector_clock, origin_agent, tombstone)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW(), ?, ?, 0)
		 ON DUPLICATE KEY UPDATE
		   content = VALUES(content),
		   source = VALUES(source),
		   tags = VALUES(tags),
		   metadata = VALUES(metadata),
		   embedding = VALUES(embedding),
		   version = version + 1,
		   updated_by = VALUES(updated_by),
		   updated_at = NOW(),
		   origin_agent = VALUES(origin_agent),
		   tombstone = 0`,
		m.ID, m.SpaceID, m.Content, nullString(m.KeyName), nullString(m.Source),
		tagsJSON, nullJSON(m.Metadata), vecToString(m.Embedding),
		nullString(m.UpdatedBy),
		clockJSON, nullString(m.OriginAgent),
	)
	if err != nil {
		return fmt.Errorf("upsert memory: %w", err)
	}
	return nil
}

func (r *MemoryRepo) GetByID(ctx context.Context, spaceID, id string) (*domain.Memory, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT `+allColumns+` FROM memories WHERE id = ? AND space_id = ? AND tombstone = 0`, id, spaceID,
	)
	return scanMemory(row)
}

func (r *MemoryRepo) GetByKey(ctx context.Context, spaceID, keyName string) (*domain.Memory, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT `+allColumns+` FROM memories WHERE space_id = ? AND key_name = ? AND tombstone = 0`, spaceID, keyName,
	)
	return scanMemory(row)
}

func (r *MemoryRepo) UpdateOptimistic(ctx context.Context, m *domain.Memory, expectedVersion int) error {
	tagsJSON := marshalTags(m.Tags)

	var query string
	var args []any
	if r.autoModel != "" {
		query = `UPDATE memories SET content = ?, key_name = ?, tags = ?, metadata = ?, version = version + 1, updated_by = ?, updated_at = NOW()
			 WHERE id = ? AND space_id = ?`
		args = []any{m.Content, nullString(m.KeyName), tagsJSON, nullJSON(m.Metadata), nullString(m.UpdatedBy), m.ID, m.SpaceID}
	} else {
		query = `UPDATE memories SET content = ?, key_name = ?, tags = ?, metadata = ?, embedding = ?, version = version + 1, updated_by = ?, updated_at = NOW()
			 WHERE id = ? AND space_id = ?`
		args = []any{m.Content, nullString(m.KeyName), tagsJSON, nullJSON(m.Metadata), vecToString(m.Embedding), nullString(m.UpdatedBy), m.ID, m.SpaceID}
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

func (r *MemoryRepo) SoftDelete(ctx context.Context, spaceID, id, agentName string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("soft delete begin tx: %w", err)
	}
	defer tx.Rollback()

	var tombstone bool
	var clockJSON []byte
	err = tx.QueryRowContext(ctx,
		`SELECT tombstone, vector_clock FROM memories WHERE id = ? AND space_id = ? FOR UPDATE`,
		id, spaceID,
	).Scan(&tombstone, &clockJSON)
	if err == sql.ErrNoRows {
		return domain.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("soft delete lock row: %w", err)
	}

	if tombstone {
		return nil
	}

	clock := unmarshalClock(clockJSON)
	if clock == nil {
		clock = make(map[string]uint64)
	}
	clock[agentName]++
	newClockJSON := marshalClock(clock)

	_, err = tx.ExecContext(ctx,
		`UPDATE memories SET tombstone = 1, vector_clock = ?, updated_at = NOW() WHERE id = ? AND space_id = ?`,
		newClockJSON, id, spaceID,
	)
	if err != nil {
		return fmt.Errorf("soft delete update: %w", err)
	}

	return tx.Commit()
}

const (
	maxCRDTRetries    = 3
	crdtRetryBaseWait = 50 * time.Millisecond
)

func (r *MemoryRepo) CRDTUpsert(
	ctx context.Context,
	spaceID, keyName string,
	incoming *domain.Memory,
	decide func(existing *domain.Memory) (*domain.Memory, bool, error),
) (*domain.Memory, bool, error) {
	var result *domain.Memory
	var dominated bool

	for attempt := 0; attempt < maxCRDTRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * crdtRetryBaseWait)
		}

		r, d, err := r.crdtUpsertOnce(ctx, spaceID, keyName, incoming, decide)
		if err != nil {
			if isDeadlock(err) {
				continue
			}
			return nil, false, err
		}
		result = r
		dominated = d
		return result, dominated, nil
	}

	return nil, false, domain.ErrWriteConflict
}

func (r *MemoryRepo) crdtUpsertOnce(
	ctx context.Context,
	spaceID, keyName string,
	incoming *domain.Memory,
	decide func(existing *domain.Memory) (*domain.Memory, bool, error),
) (*domain.Memory, bool, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("crdt upsert begin tx: %w", err)
	}
	defer tx.Rollback()

	var existing *domain.Memory
	row := tx.QueryRowContext(ctx,
		`SELECT `+allColumns+`, last_write_id, last_write_snapshot, last_write_status
		 FROM memories WHERE space_id = ? AND key_name = ? FOR UPDATE`,
		spaceID, keyName,
	)

	existing, lastWriteID, lastWriteSnapshot, lastWriteStatus, err := scanMemoryForUpdate(row)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, false, fmt.Errorf("crdt upsert lock: %w", err)
	}

	if incoming.WriteID != "" && existing != nil && lastWriteID == incoming.WriteID {
		snap, snapErr := deserializeSnapshot(lastWriteSnapshot)
		if snapErr == nil && snap != nil {
			return snap, lastWriteStatus == 200, nil
		}
	}

	toWrite, dominated, err := decide(existing)
	if err != nil {
		return nil, false, err
	}

	if dominated && existing != nil {
		if incoming.WriteID != "" {
			_ = r.storeWriteSnapshot(ctx, tx, existing, incoming.WriteID, 200)
		}
		return existing, true, tx.Commit()
	}

	tagsJSON := marshalTags(toWrite.Tags)
	clockJSON := marshalClock(toWrite.VectorClock)

	if existing == nil {
		if r.autoModel != "" {
			_, err = tx.ExecContext(ctx,
				`INSERT INTO memories (id, space_id, content, key_name, source, tags, metadata, version, updated_by, created_at, updated_at, vector_clock, origin_agent, tombstone)
				 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW(), ?, ?, 0)`,
				toWrite.ID, spaceID, toWrite.Content, nullString(keyName), nullString(toWrite.Source),
				tagsJSON, nullJSON(toWrite.Metadata),
				nullString(toWrite.UpdatedBy),
				clockJSON, nullString(toWrite.OriginAgent),
			)
		} else {
			_, err = tx.ExecContext(ctx,
				`INSERT INTO memories (id, space_id, content, key_name, source, tags, metadata, embedding, version, updated_by, created_at, updated_at, vector_clock, origin_agent, tombstone)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW(), ?, ?, 0)`,
				toWrite.ID, spaceID, toWrite.Content, nullString(keyName), nullString(toWrite.Source),
				tagsJSON, nullJSON(toWrite.Metadata), vecToString(toWrite.Embedding),
				nullString(toWrite.UpdatedBy),
				clockJSON, nullString(toWrite.OriginAgent),
			)
		}
	} else {
		if r.autoModel != "" {
			_, err = tx.ExecContext(ctx,
				`UPDATE memories SET content = ?, source = ?, tags = ?, metadata = ?,
				 version = version + 1, updated_by = ?, updated_at = NOW(),
				 vector_clock = ?, origin_agent = ?, tombstone = 0
				 WHERE space_id = ? AND key_name = ?`,
				toWrite.Content, nullString(toWrite.Source), tagsJSON, nullJSON(toWrite.Metadata),
				nullString(toWrite.UpdatedBy),
				clockJSON, nullString(toWrite.OriginAgent),
				spaceID, keyName,
			)
		} else {
			_, err = tx.ExecContext(ctx,
				`UPDATE memories SET content = ?, source = ?, tags = ?, metadata = ?, embedding = ?,
				 version = version + 1, updated_by = ?, updated_at = NOW(),
				 vector_clock = ?, origin_agent = ?, tombstone = 0
				 WHERE space_id = ? AND key_name = ?`,
				toWrite.Content, nullString(toWrite.Source), tagsJSON, nullJSON(toWrite.Metadata),
				vecToString(toWrite.Embedding), nullString(toWrite.UpdatedBy),
				clockJSON, nullString(toWrite.OriginAgent),
				spaceID, keyName,
			)
		}
	}
	if err != nil {
		return nil, false, fmt.Errorf("crdt upsert write: %w", err)
	}

	if incoming.WriteID != "" {
		_ = r.storeWriteSnapshot(ctx, tx, toWrite, incoming.WriteID, 201)
	}

	if err := tx.Commit(); err != nil {
		return nil, false, fmt.Errorf("crdt upsert commit: %w", err)
	}

	written, err := r.GetByKey(ctx, spaceID, keyName)
	if err != nil {
		return toWrite, false, nil
	}
	return written, false, nil
}

func (r *MemoryRepo) storeWriteSnapshot(ctx context.Context, tx *sql.Tx, m *domain.Memory, writeID string, status int) error {
	snapshot, err := json.Marshal(m)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx,
		`UPDATE memories SET last_write_id = ?, last_write_snapshot = ?, last_write_status = ?
		 WHERE id = ?`,
		writeID, snapshot, status, m.ID,
	)
	return err
}

func scanMemoryForUpdate(row *sql.Row) (*domain.Memory, string, []byte, int, error) {
	var m domain.Memory
	var keyName, source, updatedBy, originAgent, lastWriteIDNull sql.NullString
	var tagsJSON, metadataJSON, embeddingStr, clockJSON, snapshotBytes []byte
	var lastWriteStatus sql.NullInt32

	err := row.Scan(&m.ID, &m.SpaceID, &m.Content, &keyName, &source,
		&tagsJSON, &metadataJSON, &embeddingStr, &m.Version, &updatedBy, &m.CreatedAt, &m.UpdatedAt,
		&clockJSON, &originAgent, &m.Tombstone,
		&lastWriteIDNull, &snapshotBytes, &lastWriteStatus)
	if err == sql.ErrNoRows {
		return nil, "", nil, 0, domain.ErrNotFound
	}
	if err != nil {
		return nil, "", nil, 0, fmt.Errorf("scan memory for update: %w", err)
	}
	m.KeyName = keyName.String
	m.Source = source.String
	m.UpdatedBy = updatedBy.String
	m.OriginAgent = originAgent.String
	m.Tags = unmarshalTags(tagsJSON)
	m.Metadata = unmarshalRawJSON(metadataJSON)
	m.VectorClock = unmarshalClock(clockJSON)

	status := 0
	if lastWriteStatus.Valid {
		status = int(lastWriteStatus.Int32)
	}

	return &m, lastWriteIDNull.String, snapshotBytes, status, nil
}

func deserializeSnapshot(data []byte) (*domain.Memory, error) {
	if len(data) == 0 || string(data) == "null" {
		return nil, nil
	}
	var m domain.Memory
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func isDeadlock(err error) bool {
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		return mysqlErr.Number == 1213 || mysqlErr.Number == 1205
	}
	return false
}

func (r *MemoryRepo) List(ctx context.Context, spaceID string, f domain.MemoryFilter) ([]domain.Memory, int, error) {
	where, args := buildWhere(spaceID, f)

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

	dataQuery := "SELECT " + allColumns + " FROM memories WHERE " +
		where + " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
	// Copy args to avoid mutating the original slice (append may reuse underlying array).
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

func (r *MemoryRepo) Count(ctx context.Context, spaceID string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM memories WHERE space_id = ? AND tombstone = 0`, spaceID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count memories: %w", err)
	}
	return count, nil
}

func (r *MemoryRepo) ListBootstrap(ctx context.Context, spaceID string, limit int) ([]domain.Memory, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+allColumns+` FROM memories WHERE space_id = ? AND tombstone = 0 ORDER BY updated_at DESC LIMIT ?`,
		spaceID, limit,
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

	var stmtSQL string
	if r.autoModel != "" {
		stmtSQL = `INSERT INTO memories (id, space_id, content, key_name, source, tags, metadata, version, updated_by, created_at, updated_at, vector_clock, origin_agent, tombstone)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, 0)`
	} else {
		stmtSQL = `INSERT INTO memories (id, space_id, content, key_name, source, tags, metadata, embedding, version, updated_by, created_at, updated_at, vector_clock, origin_agent, tombstone)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, 0)`
	}

	stmt, err := tx.PrepareContext(ctx, stmtSQL)
	if err != nil {
		return fmt.Errorf("prepare: %w", err)
	}
	defer stmt.Close()

	for _, m := range memories {
		tagsJSON := marshalTags(m.Tags)
		clockJSON := marshalClock(m.VectorClock)
		var execErr error
		if r.autoModel != "" {
			_, execErr = stmt.ExecContext(ctx,
				m.ID, m.SpaceID, m.Content, nullString(m.KeyName), nullString(m.Source),
				tagsJSON, nullJSON(m.Metadata),
				m.Version, nullString(m.UpdatedBy),
				clockJSON, nullString(m.OriginAgent),
			)
		} else {
			_, execErr = stmt.ExecContext(ctx,
				m.ID, m.SpaceID, m.Content, nullString(m.KeyName), nullString(m.Source),
				tagsJSON, nullJSON(m.Metadata), vecToString(m.Embedding),
				m.Version, nullString(m.UpdatedBy),
				clockJSON, nullString(m.OriginAgent),
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
func (r *MemoryRepo) VectorSearch(ctx context.Context, spaceID string, queryVec []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	vecStr := vecToString(queryVec)
	if vecStr == nil {
		return nil, nil
	}

	conds, args := buildFilterConds(spaceID, f)
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

func (r *MemoryRepo) AutoVectorSearch(ctx context.Context, spaceID string, queryText string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	conds, args := buildFilterConds(spaceID, f)
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

	rows, err := r.db.QueryContext(ctx, query, fullArgs...)
	if err != nil {
		return nil, fmt.Errorf("auto vector search: %w", err)
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

// KeywordSearch performs substring search on content.
func (r *MemoryRepo) KeywordSearch(ctx context.Context, spaceID string, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	conds, args := buildFilterConds(spaceID, f)
	if query != "" {
		conds = append(conds, "content LIKE CONCAT('%', ?, '%')")
		args = append(args, query)
	}

	where := strings.Join(conds, " AND ")
	sqlQuery := `SELECT ` + allColumns + ` FROM memories WHERE ` + where + ` ORDER BY updated_at DESC LIMIT ?`
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

// buildWhere constructs a WHERE clause from the filter (used by List).
func buildWhere(spaceID string, f domain.MemoryFilter) (string, []any) {
	conds, args := buildFilterConds(spaceID, f)
	if f.Query != "" {
		conds = append(conds, "content LIKE ?")
		args = append(args, "%"+f.Query+"%")
	}
	return strings.Join(conds, " AND "), args
}

// buildFilterConds builds WHERE conditions without the keyword query (shared by vector/keyword search).
func buildFilterConds(spaceID string, f domain.MemoryFilter) ([]string, []any) {
	conds := []string{"space_id = ?", "tombstone = 0"}
	args := []any{spaceID}

	if f.Source != "" {
		conds = append(conds, "source = ?")
		args = append(args, f.Source)
	}
	if f.Key != "" {
		conds = append(conds, "key_name = ?")
		args = append(args, f.Key)
	}
	for _, tag := range f.Tags {
		tagJSON, err := json.Marshal(tag)
		if err != nil {
			continue
		}
		conds = append(conds, "JSON_CONTAINS(tags, ?)")
		args = append(args, string(tagJSON))
	}
	return conds, args
}

// scanMemory scans a single row into a Memory.
func scanMemory(row *sql.Row) (*domain.Memory, error) {
	var m domain.Memory
	var keyName, source, updatedBy, originAgent sql.NullString
	var tagsJSON, metadataJSON, embeddingStr, clockJSON []byte

	err := row.Scan(&m.ID, &m.SpaceID, &m.Content, &keyName, &source,
		&tagsJSON, &metadataJSON, &embeddingStr, &m.Version, &updatedBy, &m.CreatedAt, &m.UpdatedAt,
		&clockJSON, &originAgent, &m.Tombstone)
	if err == sql.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan memory: %w", err)
	}
	m.KeyName = keyName.String
	m.Source = source.String
	m.UpdatedBy = updatedBy.String
	m.OriginAgent = originAgent.String
	m.Tags = unmarshalTags(tagsJSON)
	m.Metadata = unmarshalRawJSON(metadataJSON)
	m.VectorClock = unmarshalClock(clockJSON)
	return &m, nil
}

// scanMemoryRows scans from *sql.Rows (used by List and KeywordSearch).
func scanMemoryRows(rows *sql.Rows) (*domain.Memory, error) {
	var m domain.Memory
	var keyName, source, updatedBy, originAgent sql.NullString
	var tagsJSON, metadataJSON, embeddingStr, clockJSON []byte

	err := rows.Scan(&m.ID, &m.SpaceID, &m.Content, &keyName, &source,
		&tagsJSON, &metadataJSON, &embeddingStr, &m.Version, &updatedBy, &m.CreatedAt, &m.UpdatedAt,
		&clockJSON, &originAgent, &m.Tombstone)
	if err != nil {
		return nil, fmt.Errorf("scan memory row: %w", err)
	}
	m.KeyName = keyName.String
	m.Source = source.String
	m.UpdatedBy = updatedBy.String
	m.OriginAgent = originAgent.String
	m.Tags = unmarshalTags(tagsJSON)
	m.Metadata = unmarshalRawJSON(metadataJSON)
	m.VectorClock = unmarshalClock(clockJSON)
	return &m, nil
}

// scanMemoryRowsWithDistance scans a row that includes a trailing distance column (used by VectorSearch).
func scanMemoryRowsWithDistance(rows *sql.Rows) (*domain.Memory, error) {
	var m domain.Memory
	var keyName, source, updatedBy, originAgent sql.NullString
	var tagsJSON, metadataJSON, embeddingStr, clockJSON []byte
	var distance float64

	err := rows.Scan(&m.ID, &m.SpaceID, &m.Content, &keyName, &source,
		&tagsJSON, &metadataJSON, &embeddingStr, &m.Version, &updatedBy, &m.CreatedAt, &m.UpdatedAt,
		&clockJSON, &originAgent, &m.Tombstone,
		&distance)
	if err != nil {
		return nil, fmt.Errorf("scan memory row with distance: %w", err)
	}
	m.KeyName = keyName.String
	m.Source = source.String
	m.UpdatedBy = updatedBy.String
	m.OriginAgent = originAgent.String
	m.Tags = unmarshalTags(tagsJSON)
	m.Metadata = unmarshalRawJSON(metadataJSON)
	m.VectorClock = unmarshalClock(clockJSON)
	score := 1 - distance
	m.Score = &score
	return &m, nil
}

// marshalTags encodes tags to JSON. Empty/nil tags are stored as JSON `[]` (not NULL)
// for consistent JSON_CONTAINS behavior.
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

func marshalClock(clock map[string]uint64) []byte {
	if len(clock) == 0 {
		return []byte("{}")
	}
	b, err := json.Marshal(clock)
	if err != nil {
		return []byte("{}")
	}
	return b
}

func unmarshalClock(data []byte) map[string]uint64 {
	if len(data) == 0 || string(data) == "{}" || string(data) == "null" {
		return nil
	}
	var clock map[string]uint64
	if err := json.Unmarshal(data, &clock); err != nil {
		return nil
	}
	if len(clock) == 0 {
		return nil
	}
	return clock
}
