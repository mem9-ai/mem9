package tidb

import (
	"context"
	"database/sql"
	"fmt"

	internaltenant "github.com/qiffang/mnemos/server/internal/tenant"
)

type MemorySessionLinkRepo struct {
	db *sql.DB
}

func NewMemorySessionLinkRepo(db *sql.DB) *MemorySessionLinkRepo {
	return &MemorySessionLinkRepo{db: db}
}

func (r *MemorySessionLinkRepo) Link(ctx context.Context, memoryID, sessionID string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT IGNORE INTO memory_session_links (memory_id, session_id) VALUES (?, ?)`,
		memoryID, sessionID,
	)
	if err != nil && internaltenant.IsTableNotFoundError(err) {
		return nil
	}
	return err
}

func (r *MemorySessionLinkRepo) MemoriesBySession(ctx context.Context, sessionID string, limit int) ([]string, error) {
	var rows *sql.Rows
	var err error
	if limit > 0 {
		rows, err = r.db.QueryContext(ctx,
			`SELECT memory_id FROM memory_session_links WHERE session_id = ? ORDER BY id ASC LIMIT ?`,
			sessionID, limit,
		)
	} else {
		rows, err = r.db.QueryContext(ctx,
			`SELECT memory_id FROM memory_session_links WHERE session_id = ? ORDER BY id ASC`,
			sessionID,
		)
	}
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("memories by session: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("memories by session scan: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *MemorySessionLinkRepo) SessionsByMemory(ctx context.Context, memoryID string, limit int) ([]string, error) {
	var rows *sql.Rows
	var err error
	if limit > 0 {
		rows, err = r.db.QueryContext(ctx,
			`SELECT session_id FROM memory_session_links WHERE memory_id = ? ORDER BY id ASC LIMIT ?`,
			memoryID, limit,
		)
	} else {
		rows, err = r.db.QueryContext(ctx,
			`SELECT session_id FROM memory_session_links WHERE memory_id = ? ORDER BY id ASC`,
			memoryID,
		)
	}
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("sessions by memory: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("sessions by memory scan: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
