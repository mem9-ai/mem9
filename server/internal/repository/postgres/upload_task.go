package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

type UploadTaskRepoImpl struct {
	db *sql.DB
}

func NewUploadTaskRepo(db *sql.DB) *UploadTaskRepoImpl {
	return &UploadTaskRepoImpl{db: db}
}

const uploadTaskColumns = `task_id, tenant_id, file_name, file_path, agent_id, session_id, file_type, total_chunks, done_chunks, status, error_msg, created_at, updated_at`

func (r *UploadTaskRepoImpl) Create(ctx context.Context, task *domain.UploadTask) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO upload_tasks (task_id, tenant_id, file_name, file_path, agent_id, session_id, file_type, total_chunks, done_chunks, status, error_msg, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
		task.TaskID, task.TenantID, task.FileName, task.FilePath,
		toNullString(task.AgentID), toNullString(task.SessionID), string(task.FileType),
		task.TotalChunks, task.DoneChunks, string(task.Status), toNullString(task.ErrorMsg),
	)
	if err != nil {
		return fmt.Errorf("create upload task: %w", err)
	}
	return nil
}

func (r *UploadTaskRepoImpl) GetByID(ctx context.Context, taskID string) (*domain.UploadTask, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT `+uploadTaskColumns+` FROM upload_tasks WHERE task_id = $1`, taskID,
	)
	return scanUploadTask(row)
}

func (r *UploadTaskRepoImpl) ListByTenant(ctx context.Context, tenantID string) ([]domain.UploadTask, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+uploadTaskColumns+` FROM upload_tasks WHERE tenant_id = $1 ORDER BY created_at DESC`, tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("list upload tasks: %w", err)
	}
	defer rows.Close()

	var tasks []domain.UploadTask
	for rows.Next() {
		task, err := scanUploadTaskRow(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, *task)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list upload tasks: %w", err)
	}
	return tasks, nil
}

func (r *UploadTaskRepoImpl) UpdateStatus(ctx context.Context, taskID string, status domain.TaskStatus, errorMsg string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE upload_tasks SET status = $1, error_msg = $2, updated_at = NOW() WHERE task_id = $3`,
		string(status), toNullString(errorMsg), taskID,
	)
	if err != nil {
		return fmt.Errorf("update upload task status: %w", err)
	}
	return nil
}

func (r *UploadTaskRepoImpl) UpdateProgress(ctx context.Context, taskID string, doneChunks int) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE upload_tasks SET done_chunks = $1, updated_at = NOW() WHERE task_id = $2`,
		doneChunks, taskID,
	)
	if err != nil {
		return fmt.Errorf("update upload task progress: %w", err)
	}
	return nil
}

func (r *UploadTaskRepoImpl) UpdateTotalChunks(ctx context.Context, taskID string, totalChunks int) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE upload_tasks SET total_chunks = $1, updated_at = NOW() WHERE task_id = $2`,
		totalChunks, taskID,
	)
	if err != nil {
		return fmt.Errorf("update upload task total chunks: %w", err)
	}
	return nil
}

func (r *UploadTaskRepoImpl) FetchPending(ctx context.Context, limit int) ([]domain.UploadTask, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("fetch pending upload tasks begin tx: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx,
		`SELECT `+uploadTaskColumns+` FROM upload_tasks WHERE status = 'pending' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch pending upload tasks: %w", err)
	}

	var tasks []domain.UploadTask
	for rows.Next() {
		task, err := scanUploadTaskRow(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		tasks = append(tasks, *task)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("fetch pending upload tasks: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("fetch pending upload tasks: %w", err)
	}

	for _, task := range tasks {
		_, err := tx.ExecContext(ctx,
			`UPDATE upload_tasks SET status = 'processing', updated_at = NOW() WHERE task_id = $1`,
			task.TaskID,
		)
		if err != nil {
			return nil, fmt.Errorf("mark upload task processing: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("fetch pending upload tasks commit: %w", err)
	}
	return tasks, nil
}

func (r *UploadTaskRepoImpl) ResetProcessing(ctx context.Context, staleTimeout time.Duration) (int64, error) {
	result, err := r.db.ExecContext(ctx,
		`UPDATE upload_tasks SET status = 'pending', updated_at = NOW() WHERE status = 'processing' AND updated_at < $1`,
		time.Now().Add(-staleTimeout),
	)
	if err != nil {
		return 0, fmt.Errorf("reset upload task processing: %w", err)
	}
	rows, _ := result.RowsAffected()
	return rows, nil
}

func scanUploadTask(row *sql.Row) (*domain.UploadTask, error) {
	var task domain.UploadTask
	var agentID, sessionID, errorMsg sql.NullString
	var status, fileType string
	if err := row.Scan(&task.TaskID, &task.TenantID, &task.FileName, &task.FilePath,
		&agentID, &sessionID, &fileType, &task.TotalChunks, &task.DoneChunks, &status, &errorMsg,
		&task.CreatedAt, &task.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("scan upload task: %w", err)
	}
	task.AgentID = agentID.String
	task.SessionID = sessionID.String
	task.FileType = domain.FileType(fileType)
	task.Status = domain.TaskStatus(status)
	task.ErrorMsg = errorMsg.String
	return &task, nil
}

func scanUploadTaskRow(rows *sql.Rows) (*domain.UploadTask, error) {
	var task domain.UploadTask
	var agentID, sessionID, errorMsg sql.NullString
	var status, fileType string
	if err := rows.Scan(&task.TaskID, &task.TenantID, &task.FileName, &task.FilePath,
		&agentID, &sessionID, &fileType, &task.TotalChunks, &task.DoneChunks, &status, &errorMsg,
		&task.CreatedAt, &task.UpdatedAt); err != nil {
		return nil, fmt.Errorf("scan upload task: %w", err)
	}
	task.AgentID = agentID.String
	task.SessionID = sessionID.String
	task.FileType = domain.FileType(fileType)
	task.Status = domain.TaskStatus(status)
	task.ErrorMsg = errorMsg.String
	return &task, nil
}

func toNullString(value string) sql.NullString {
	if value == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: value, Valid: true}
}
