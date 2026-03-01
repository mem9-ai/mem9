package tidb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/go-sql-driver/mysql"
	"github.com/qiffang/mnemos/server/internal/domain"
)

type MemoryRepo struct {
	db *sql.DB
}

func NewMemoryRepo(db *sql.DB) *MemoryRepo {
	return &MemoryRepo{db: db}
}

func (r *MemoryRepo) Create(ctx context.Context, m *domain.Memory) error {
	tagsJSON := marshalTags(m.Tags)
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO memories (id, space_id, content, key_name, source, tags, version, updated_by, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
		m.ID, m.SpaceID, m.Content, nullString(m.KeyName), nullString(m.Source),
		tagsJSON, m.Version, nullString(m.UpdatedBy),
	)
	if err != nil {
		return fmt.Errorf("create memory: %w", err)
	}
	return nil
}

// Upsert atomically inserts or updates a memory keyed by (space_id, key_name).
// Uses INSERT ... ON DUPLICATE KEY UPDATE to avoid read-then-write races.
func (r *MemoryRepo) Upsert(ctx context.Context, m *domain.Memory) error {
	tagsJSON := marshalTags(m.Tags)
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO memories (id, space_id, content, key_name, source, tags, version, updated_by, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())
		 ON DUPLICATE KEY UPDATE
		   content = VALUES(content),
		   source = VALUES(source),
		   tags = VALUES(tags),
		   version = version + 1,
		   updated_by = VALUES(updated_by),
		   updated_at = NOW()`,
		m.ID, m.SpaceID, m.Content, nullString(m.KeyName), nullString(m.Source),
		tagsJSON, nullString(m.UpdatedBy),
	)
	if err != nil {
		return fmt.Errorf("upsert memory: %w", err)
	}
	return nil
}

func (r *MemoryRepo) GetByID(ctx context.Context, spaceID, id string) (*domain.Memory, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, space_id, content, key_name, source, tags, version, updated_by, created_at, updated_at
		 FROM memories WHERE id = ? AND space_id = ?`, id, spaceID,
	)
	return scanMemory(row)
}

func (r *MemoryRepo) GetByKey(ctx context.Context, spaceID, keyName string) (*domain.Memory, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, space_id, content, key_name, source, tags, version, updated_by, created_at, updated_at
		 FROM memories WHERE space_id = ? AND key_name = ?`, spaceID, keyName,
	)
	return scanMemory(row)
}

// UpdateOptimistic performs an atomic version-checked update.
// The version is incremented in SQL: SET version = version + 1.
// If expectedVersion > 0 and doesn't match, the row won't be updated (returns ErrNotFound).
// If expectedVersion == 0, skips the version check (unconditional update, still atomic increment).
func (r *MemoryRepo) UpdateOptimistic(ctx context.Context, m *domain.Memory, expectedVersion int) error {
	tagsJSON := marshalTags(m.Tags)

	query := `UPDATE memories SET content = ?, key_name = ?, tags = ?, version = version + 1, updated_by = ?, updated_at = NOW()
		 WHERE id = ? AND space_id = ?`
	args := []any{m.Content, nullString(m.KeyName), tagsJSON, nullString(m.UpdatedBy), m.ID, m.SpaceID}

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

func (r *MemoryRepo) Delete(ctx context.Context, spaceID, id string) error {
	result, err := r.db.ExecContext(ctx,
		`DELETE FROM memories WHERE id = ? AND space_id = ?`, id, spaceID,
	)
	if err != nil {
		return fmt.Errorf("delete memory: %w", err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
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

	dataQuery := "SELECT id, space_id, content, key_name, source, tags, version, updated_by, created_at, updated_at FROM memories WHERE " +
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
		`SELECT COUNT(*) FROM memories WHERE space_id = ?`, spaceID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count memories: %w", err)
	}
	return count, nil
}

func (r *MemoryRepo) BulkCreate(ctx context.Context, memories []*domain.Memory) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO memories (id, space_id, content, key_name, source, tags, version, updated_by, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`)
	if err != nil {
		return fmt.Errorf("prepare: %w", err)
	}
	defer stmt.Close()

	for _, m := range memories {
		tagsJSON := marshalTags(m.Tags)
		if _, err := stmt.ExecContext(ctx,
			m.ID, m.SpaceID, m.Content, nullString(m.KeyName), nullString(m.Source),
			tagsJSON, m.Version, nullString(m.UpdatedBy),
		); err != nil {
			// Detect MySQL duplicate entry error (1062) and return a domain error.
			var mysqlErr *mysql.MySQLError
			if errors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
				return fmt.Errorf("bulk insert memory %s: %w", m.ID, domain.ErrDuplicateKey)
			}
			return fmt.Errorf("bulk insert memory %s: %w", m.ID, err)
		}
	}
	return tx.Commit()
}

// buildWhere constructs a WHERE clause from the filter.
func buildWhere(spaceID string, f domain.MemoryFilter) (string, []any) {
	conds := []string{"space_id = ?"}
	args := []any{spaceID}

	if f.Query != "" {
		conds = append(conds, "content LIKE ?")
		args = append(args, "%"+f.Query+"%")
	}
	if f.Source != "" {
		conds = append(conds, "source = ?")
		args = append(args, f.Source)
	}
	if f.Key != "" {
		conds = append(conds, "key_name = ?")
		args = append(args, f.Key)
	}
	for _, tag := range f.Tags {
		// Use json.Marshal to safely encode the tag as a JSON string value,
		// avoiding injection if tag contains special characters like `"`.
		tagJSON, err := json.Marshal(tag)
		if err != nil {
			continue
		}
		conds = append(conds, "JSON_CONTAINS(tags, ?)")
		args = append(args, string(tagJSON))
	}
	return strings.Join(conds, " AND "), args
}

// scanMemory scans a single row into a Memory.
func scanMemory(row *sql.Row) (*domain.Memory, error) {
	var m domain.Memory
	var keyName, source, updatedBy sql.NullString
	var tagsJSON []byte

	err := row.Scan(&m.ID, &m.SpaceID, &m.Content, &keyName, &source,
		&tagsJSON, &m.Version, &updatedBy, &m.CreatedAt, &m.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan memory: %w", err)
	}
	m.KeyName = keyName.String
	m.Source = source.String
	m.UpdatedBy = updatedBy.String
	m.Tags = unmarshalTags(tagsJSON)
	return &m, nil
}

// scanMemoryRows scans from *sql.Rows (used by List).
func scanMemoryRows(rows *sql.Rows) (*domain.Memory, error) {
	var m domain.Memory
	var keyName, source, updatedBy sql.NullString
	var tagsJSON []byte

	err := rows.Scan(&m.ID, &m.SpaceID, &m.Content, &keyName, &source,
		&tagsJSON, &m.Version, &updatedBy, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("scan memory row: %w", err)
	}
	m.KeyName = keyName.String
	m.Source = source.String
	m.UpdatedBy = updatedBy.String
	m.Tags = unmarshalTags(tagsJSON)
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

func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
