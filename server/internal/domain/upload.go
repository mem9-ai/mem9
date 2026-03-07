package domain

import "time"

type TaskStatus string

const (
	TaskPending    TaskStatus = "pending"
	TaskProcessing TaskStatus = "processing"
	TaskDone       TaskStatus = "done"
	TaskFailed     TaskStatus = "failed"
)

type FileType string

const (
	FileTypeSession FileType = "session"
	FileTypeMemory  FileType = "memory"
)

type UploadTask struct {
	TaskID      string     `json:"task_id"`
	TenantID    string     `json:"tenant_id"`
	FileName    string     `json:"file_name"`
	FilePath    string     `json:"-"` // Never expose disk paths in API
	AgentID     string     `json:"agent_id,omitempty"`
	SessionID   string     `json:"session_id,omitempty"`
	FileType    FileType   `json:"file_type"`
	TotalChunks int        `json:"total_chunks"`
	DoneChunks  int        `json:"done_chunks"`
	Status      TaskStatus `json:"status"`
	ErrorMsg    string     `json:"error_msg,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}
