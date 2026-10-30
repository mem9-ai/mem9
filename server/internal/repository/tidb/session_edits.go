package tidb

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	internaltenant "github.com/qiffang/mnemos/server/internal/tenant"
)

// session_edits is a display overlay over the immutable `sessions` table:
// at most one row per session row (PK id == sessions.id), upserted in place
// on re-edit. The sessions table is never touched, so these helpers only
// read/write the overlay; retrieval (vector/FTS/keyword) is unaffected.

// UpsertSessionEdit creates the overlay row on first edit (version 1,
// original_content snapshotted) or updates it in place on re-edit (version
// + 1, original_content preserved from the first edit, state reset active).
func (r *SessionRepo) UpsertSessionEdit(ctx context.Context, edit *domain.SessionEdit) error {
	if edit == nil || edit.ID == "" {
		return fmt.Errorf("session edit: id required")
	}
	state := edit.State
	if state == "" {
		state = domain.StateActive
	}
	// edited_tags is NULL when the edit didn't set tags ("leave as-is"),
	// and a JSON array (possibly []) when it did. COALESCE on update keeps
	// any previously-set tag override when a later content-only edit omits
	// tags, so a content-only re-edit never clears tags.
	var editedTags any
	if edit.EditedTagsSet {
		editedTags = marshalTags(edit.EditedTags)
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO session_edits
			(id, app_id, session_id, seq, agent_id, original_content, edited_content, edited_tags, correctness, edited_by, reason, version, state, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())
		 ON DUPLICATE KEY UPDATE
			edited_content = VALUES(edited_content),
			edited_tags    = COALESCE(VALUES(edited_tags), edited_tags),
			correctness    = VALUES(correctness),
			edited_by      = VALUES(edited_by),
			reason         = VALUES(reason),
			version        = version + 1,
			state          = VALUES(state),
			updated_at     = NOW()`,
		edit.ID, edit.AppID, nullStr(edit.SessionID), edit.Seq, nullStr(edit.AgentID),
		edit.OriginalContent, edit.EditedContent, editedTags, nullStr(edit.Correctness),
		nullStr(edit.EditedBy), nullStr(edit.Reason), string(state),
	)
	if err != nil {
		return fmt.Errorf("session edit upsert: %w", err)
	}
	return nil
}

// MarkSessionEdit upserts only the correctness mark for a session row,
// preserving any existing content/tag overlay. On first mark it inserts a
// mark-only row (edited_content = ” sentinel, original_content snapshot);
// on re-mark it updates correctness and bumps version without touching the
// content overlay.
func (r *SessionRepo) MarkSessionEdit(ctx context.Context, edit *domain.SessionEdit) error {
	if edit == nil || edit.ID == "" {
		return fmt.Errorf("session edit: id required")
	}
	state := edit.State
	if state == "" {
		state = domain.StateActive
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO session_edits
			(id, app_id, session_id, seq, agent_id, original_content, edited_content, correctness, edited_by, version, state, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 1, ?, NOW(), NOW())
		 ON DUPLICATE KEY UPDATE
			correctness = VALUES(correctness),
			edited_by   = VALUES(edited_by),
			version     = version + 1,
			state       = VALUES(state),
			updated_at  = NOW()`,
		edit.ID, edit.AppID, nullStr(edit.SessionID), edit.Seq, nullStr(edit.AgentID),
		edit.OriginalContent, nullStr(edit.Correctness), nullStr(edit.EditedBy), string(state),
	)
	if err != nil {
		return fmt.Errorf("session edit mark: %w", err)
	}
	return nil
}

// ClearSessionEditMark removes the correctness mark. If the row carries no
// content override (edited_content = ” sentinel), the whole row is deleted
// so the turn returns to "no overlay record"; otherwise only the mark is
// cleared and the content overlay survives. Returns true if anything changed.
func (r *SessionRepo) ClearSessionEditMark(ctx context.Context, id string) (bool, error) {
	// Delete mark-only rows outright (no content override to keep).
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM session_edits WHERE id = ? AND edited_content = '' AND correctness IS NOT NULL`, id)
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			return false, nil
		}
		return false, fmt.Errorf("session edit clear mark (delete): %w", err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return true, nil
	}
	// Content overlay present: keep the row, just clear the mark.
	res, err = r.db.ExecContext(ctx,
		`UPDATE session_edits SET correctness = NULL, version = version + 1, updated_at = NOW()
		 WHERE id = ? AND correctness IS NOT NULL`, id)
	if err != nil {
		return false, fmt.Errorf("session edit clear mark (update): %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// GetSessionEdit returns the active overlay for id, or domain.ErrNotFound.
func (r *SessionRepo) GetSessionEdit(ctx context.Context, id string) (*domain.SessionEdit, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, app_id, session_id, seq, agent_id, original_content, edited_content, edited_tags, correctness, edited_by, reason, version, state, created_at, updated_at
		 FROM session_edits WHERE id = ? AND state = 'active'`,
		id,
	)
	edit, err := scanSessionEdit(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		if internaltenant.IsTableNotFoundError(err) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("session edit get: %w", err)
	}
	return edit, nil
}

// GetSessionEditsByIDs batch-loads active overlays keyed by id. Missing ids
// are simply absent from the map. A missing table yields an empty map so
// Session Search degrades to original content rather than erroring.
func (r *SessionRepo) GetSessionEditsByIDs(ctx context.Context, ids []string) (map[string]*domain.SessionEdit, error) {
	out := make(map[string]*domain.SessionEdit, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, app_id, session_id, seq, agent_id, original_content, edited_content, edited_tags, correctness, edited_by, reason, version, state, created_at, updated_at
		 FROM session_edits WHERE state = 'active' AND id IN (`+strings.Join(placeholders, ",")+`)`,
		args...,
	)
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			return out, nil
		}
		return nil, fmt.Errorf("session edits batch get: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		edit, err := scanSessionEdit(rows)
		if err != nil {
			return nil, fmt.Errorf("session edits batch scan: %w", err)
		}
		out[edit.ID] = edit
	}
	return out, rows.Err()
}

// DeleteSessionEdit hard-deletes the overlay row (revert to original).
// Returns the number of rows removed (0 if there was no overlay).
func (r *SessionRepo) DeleteSessionEdit(ctx context.Context, id string) (int64, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM session_edits WHERE id = ?`, id)
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			return 0, nil
		}
		return 0, fmt.Errorf("session edit delete: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("session edit delete rows affected: %w", err)
	}
	return n, nil
}

type sessionEditScanner interface {
	Scan(dest ...any) error
}

func scanSessionEdit(s sessionEditScanner) (*domain.SessionEdit, error) {
	var (
		e           domain.SessionEdit
		sessionID   sql.NullString
		agentID     sql.NullString
		correctness sql.NullString
		editedBy    sql.NullString
		reason      sql.NullString
		state       sql.NullString
		tagsJSON    []byte
		createdAt   time.Time
		updatedAt   time.Time
		seqNull     sql.NullInt64
	)
	if err := s.Scan(
		&e.ID, &e.AppID, &sessionID, &seqNull, &agentID,
		&e.OriginalContent, &e.EditedContent, &tagsJSON, &correctness, &editedBy, &reason,
		&e.Version, &state, &createdAt, &updatedAt,
	); err != nil {
		return nil, err
	}
	e.SessionID = sessionID.String
	e.AgentID = agentID.String
	e.Correctness = correctness.String
	e.EditedBy = editedBy.String
	e.Reason = reason.String
	e.Seq = int(seqNull.Int64)
	// edited_content = '' is the "no content override" sentinel (real edits
	// always have non-empty content); only a non-empty value overrides.
	e.EditedContentSet = e.EditedContent != ""
	// NULL edited_tags = no tag override; a non-NULL value (incl. "[]") is
	// an explicit override.
	if tagsJSON != nil {
		e.EditedTags = unmarshalTags(tagsJSON)
		e.EditedTagsSet = true
	}
	e.State = domain.MemoryState(state.String)
	if e.State == "" {
		e.State = domain.StateActive
	}
	e.CreatedAt = createdAt
	e.UpdatedAt = updatedAt
	return &e, nil
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
