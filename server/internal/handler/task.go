package handler

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
)

// Maximum file size for uploads (50MB)
const maxUploadSize = 50 << 20

// Maximum agent_id length (matches VARCHAR(100) in schema)
const maxAgentIDLength = 100

// --- Response types ---

type taskResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type taskDetail struct {
	ID     string `json:"id"`
	File   string `json:"file"`
	Status string `json:"status"`
	Total  int    `json:"total"`
	Done   int    `json:"done"`
	Error  string `json:"error,omitempty"`
}

type taskListResponse struct {
	Status string       `json:"status"`
	Tasks  []taskDetail `json:"tasks"`
}

// --- Handlers ---

// createTask accepts a file upload and enqueues it for async ingest.
// POST /v1alpha1/mem9s/{tenantID}/imports
func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	// Limit request body size BEFORE ParseMultipartForm to prevent large temp file creation.
	// This closes the body after maxUploadSize bytes, causing ParseMultipartForm to fail early.
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		s.handleError(w, &domain.ValidationError{Message: "invalid multipart form or file too large: " + err.Error()})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		s.handleError(w, &domain.ValidationError{Field: "file", Message: "file required"})
		return
	}
	defer file.Close()

	agentID := r.FormValue("agent_id")
	if agentID == "" {
		s.handleError(w, &domain.ValidationError{Field: "agent_id", Message: "agent_id is required"})
		return
	}
	// Reject path traversal characters to prevent arbitrary file write/delete.
	if strings.ContainsAny(agentID, "/\\") || strings.Contains(agentID, "..") {
		s.handleError(w, &domain.ValidationError{Field: "agent_id", Message: "invalid characters in agent_id"})
		return
	}
	// Validate length against schema constraint VARCHAR(100)
	if len(agentID) > maxAgentIDLength {
		s.handleError(w, &domain.ValidationError{Field: "agent_id", Message: fmt.Sprintf("agent_id exceeds %d characters", maxAgentIDLength)})
		return
	}
	sessionID := r.FormValue("session_id")
	fileType := r.FormValue("file_type")
	if fileType != string(domain.FileTypeSession) && fileType != string(domain.FileTypeMemory) {
		s.handleError(w, &domain.ValidationError{Field: "file_type", Message: "must be session or memory"})
		return
	}

	auth := authInfo(r)
	taskID := uuid.New().String()

	// Directory: {uploadDir}/{tenantID}/{agentID}/
	dir := filepath.Join(s.uploadDir, auth.TenantID, agentID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		s.handleError(w, err)
		return
	}

	fileName, err := sanitizeFilename(filepath.Base(header.Filename))
	if err != nil {
		s.handleError(w, &domain.ValidationError{Field: "file", Message: err.Error()})
		return
	}

	// Use O_EXCL to atomically create file and detect collisions.
	// If collision, append random suffix and retry.
	var filePath string
	var dst *os.File
	for attempt := 0; attempt < 5; attempt++ {
		candidate := fileName
		if attempt > 0 {
			ext := filepath.Ext(fileName)
			base := strings.TrimSuffix(fileName, ext)
			candidate = fmt.Sprintf("%s_%s%s", base, randomSuffix(6), ext)
		}
		filePath = filepath.Join(dir, candidate)
		f, err := os.OpenFile(filePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err == nil {
			dst = f
			fileName = candidate
			break
		}
		if !errors.Is(err, os.ErrExist) {
			s.handleError(w, err)
			return
		}
		// File exists, retry with new suffix
	}
	if dst == nil {
		s.handleError(w, &domain.ValidationError{Field: "file", Message: "failed to create unique filename after retries"})
		return
	}

	// Enforce file size limit during copy
	limitedReader := io.LimitReader(file, maxUploadSize+1)
	written, err := io.Copy(dst, limitedReader)
	if err != nil {
		dst.Close()
		if removeErr := os.Remove(filePath); removeErr != nil {
			s.logger.Error("failed to remove file after copy failure", "path", filePath, "err", removeErr)
		}
		s.handleError(w, err)
		return
	}
	if written > maxUploadSize {
		dst.Close()
		if removeErr := os.Remove(filePath); removeErr != nil {
			s.logger.Error("failed to remove oversized file", "path", filePath, "err", removeErr)
		}
		s.handleError(w, &domain.ValidationError{Field: "file", Message: fmt.Sprintf("file exceeds maximum size of %d bytes", maxUploadSize)})
		return
	}
	if err := dst.Close(); err != nil {
		if removeErr := os.Remove(filePath); removeErr != nil {
			s.logger.Error("failed to remove file after close failure", "path", filePath, "err", removeErr)
		}
		s.handleError(w, err)
		return
	}

	task := &domain.UploadTask{
		TaskID:    taskID,
		TenantID:  auth.TenantID,
		FileName:  fileName,
		FilePath:  filePath,
		AgentID:   agentID,
		SessionID: sessionID,
		FileType:  domain.FileType(fileType),
		Status:    domain.TaskPending,
	}
	if err := s.uploadTasks.Create(r.Context(), task); err != nil {
		if removeErr := os.Remove(filePath); removeErr != nil {
			s.logger.Error("leaked upload file after task create failure", "path", filePath, "err", removeErr)
		}
		s.handleError(w, err)
		return
	}

	respond(w, http.StatusAccepted, taskResponse{ID: taskID, Status: string(domain.TaskPending)})
}

// listTasks returns all tasks for a tenant with an aggregate status.
// GET /v1alpha1/mem9s/{tenantID}/imports
func (s *Server) listTasks(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	tasks, err := s.uploadTasks.ListByTenant(r.Context(), auth.TenantID)
	if err != nil {
		s.handleError(w, err)
		return
	}

	details := make([]taskDetail, 0, len(tasks))
	done, failed := 0, 0
	for _, t := range tasks {
		switch t.Status {
		case domain.TaskDone:
			done++
		case domain.TaskFailed:
			failed++
		}
		details = append(details, taskDetail{
			ID:     t.TaskID,
			File:   t.FileName,
			Status: string(t.Status),
			Total:  t.TotalChunks,
			Done:   t.DoneChunks,
			Error:  t.ErrorMsg,
		})
	}

	status := "empty"
	if len(tasks) > 0 {
		status = "done"
		if failed > 0 {
			status = "partial"
		} else if done < len(tasks) {
			status = "processing"
		}
	}

	respond(w, http.StatusOK, taskListResponse{Status: status, Tasks: details})
}

// getTask returns a single task by ID.
// GET /v1alpha1/mem9s/{tenantID}/imports/{id}
func (s *Server) getTask(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		s.handleError(w, &domain.ValidationError{Field: "id", Message: "task id required"})
		return
	}

	task, err := s.uploadTasks.GetByID(r.Context(), id)
	if err != nil {
		s.handleError(w, err)
		return
	}

	// Verify tenant ownership.
	auth := authInfo(r)
	if task.TenantID != auth.TenantID {
		s.handleError(w, domain.ErrNotFound)
		return
	}

	respond(w, http.StatusOK, taskDetail{
		ID:     task.TaskID,
		File:   task.FileName,
		Status: string(task.Status),
		Total:  task.TotalChunks,
		Done:   task.DoneChunks,
		Error:  task.ErrorMsg,
	})
}

// randomSuffix returns a hex-encoded random string of n bytes.
func randomSuffix(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func sanitizeFilename(name string) (string, error) {
	name = strings.ReplaceAll(name, "\x00", "")
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." {
		return "", fmt.Errorf("invalid filename")
	}
	if strings.ContainsAny(name, "/\\") {
		return "", fmt.Errorf("invalid filename")
	}
	return name, nil
}
