package service

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/embed"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/tenant"
)

const uploadChunkSize = 50
const uploadMemoryBatchSize = 100
const defaultTaskTimeout = 30 * time.Minute

// SessionFile is the expected JSON format for session file uploads.
type SessionFile struct {
	AgentID     string          `json:"agent_id"`
	AppID       string          `json:"appId"`
	AppIDLegacy string          `json:"app_id"`
	SessionID   string          `json:"session_id"`
	Messages    []IngestMessage `json:"messages"`

	appIDSet       bool
	appIDLegacySet bool
}

// MemoryFile is the expected JSON format for memory file uploads.
type MemoryFile struct {
	AgentID     string            `json:"agent_id"`
	AppID       string            `json:"appId"`
	AppIDLegacy string            `json:"app_id"`
	Memories    []MemoryFileEntry `json:"memories"`

	appIDSet       bool
	appIDLegacySet bool
}

// MemoryFileEntry is a single memory entry in a memory file.
type MemoryFileEntry struct {
	Content     string         `json:"content"`
	AppID       string         `json:"appId,omitempty"`
	AppIDLegacy string         `json:"app_id,omitempty"`
	Source      string         `json:"source,omitempty"`
	Tags        []string       `json:"tags,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	MemoryType  string         `json:"memory_type,omitempty"`

	appIDSet       bool
	appIDLegacySet bool
}

type sessionFileJSON SessionFile

func (f *SessionFile) UnmarshalJSON(data []byte) error {
	var parsed sessionFileJSON
	if err := json.Unmarshal(data, &parsed); err != nil {
		return err
	}
	*f = SessionFile(parsed)
	return decodeUploadAppIDFields(data, &f.AppID, &f.appIDSet, &f.AppIDLegacy, &f.appIDLegacySet)
}

type memoryFileJSON MemoryFile

func (f *MemoryFile) UnmarshalJSON(data []byte) error {
	var parsed memoryFileJSON
	if err := json.Unmarshal(data, &parsed); err != nil {
		return err
	}
	*f = MemoryFile(parsed)
	return decodeUploadAppIDFields(data, &f.AppID, &f.appIDSet, &f.AppIDLegacy, &f.appIDLegacySet)
}

type memoryFileEntryJSON MemoryFileEntry

func (e *MemoryFileEntry) UnmarshalJSON(data []byte) error {
	var parsed memoryFileEntryJSON
	if err := json.Unmarshal(data, &parsed); err != nil {
		return err
	}
	*e = MemoryFileEntry(parsed)
	return decodeUploadAppIDFields(data, &e.AppID, &e.appIDSet, &e.AppIDLegacy, &e.appIDLegacySet)
}

// UploadWorker processes queued upload tasks.
type UploadWorker struct {
	tasks        repository.UploadTaskRepo
	tenants      repository.TenantRepo
	pool         *tenant.TenantPool
	embedder     *embed.Embedder
	llmClient    *llm.Client
	autoModel    string
	autoDims     int
	clientDims   int
	ftsEnabled   bool
	mode         IngestMode
	logger       *slog.Logger
	pollInterval time.Duration
	concurrency  int
	encryptor    encrypt.Encryptor
	activity     *ActivityTracker
}

// NewUploadWorker creates a new UploadWorker.
func NewUploadWorker(
	tasks repository.UploadTaskRepo,
	tenants repository.TenantRepo,
	pool *tenant.TenantPool,
	embedder *embed.Embedder,
	llmClient *llm.Client,
	autoModel string,
	autoDims int,
	clientDims int,
	ftsEnabled bool,
	mode IngestMode,
	logger *slog.Logger,
	concurrency int,
	encryptor encrypt.Encryptor,
	activity *ActivityTracker,
) *UploadWorker {
	if logger == nil {
		logger = slog.Default()
	}
	if concurrency <= 0 {
		concurrency = 5
	}
	return &UploadWorker{
		tasks:        tasks,
		tenants:      tenants,
		pool:         pool,
		embedder:     embedder,
		llmClient:    llmClient,
		autoModel:    autoModel,
		autoDims:     autoDims,
		clientDims:   clientDims,
		ftsEnabled:   ftsEnabled,
		mode:         mode,
		logger:       logger,
		pollInterval: 5 * time.Second,
		concurrency:  concurrency,
		encryptor:    encryptor,
		activity:     activity,
	}
}

// Run starts the background worker loop.
func (w *UploadWorker) Run(ctx context.Context) error {
	logger := w.logger
	if logger == nil {
		logger = slog.Default()
	}
	logger.Info("upload worker started")
	defer logger.Info("upload worker stopped")

	resetCount, err := w.tasks.ResetProcessing(ctx, defaultTaskTimeout)
	if err != nil {
		return fmt.Errorf("reset processing tasks: %w", err)
	}
	if resetCount > 0 {
		logger.Info("reset processing upload tasks", "count", resetCount)
	}

	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			tasks, err := w.tasks.FetchPending(ctx, w.concurrency)
			if err != nil {
				logger.Error("fetch pending upload tasks failed", "err", err)
				continue
			}
			if len(tasks) == 0 {
				continue
			}
			logger.Info("processing upload tasks", "count", len(tasks))
			var wg sync.WaitGroup
			for _, task := range tasks {
				wg.Add(1)
				go func(t domain.UploadTask) {
					defer wg.Done()
					if err := w.processTask(ctx, t); err != nil {
						logger.Error("task processing error", "task_id", t.TaskID, "err", err)
					}
				}(task)
			}
			wg.Wait()
		}
	}
}

func (w *UploadWorker) processTask(ctx context.Context, task domain.UploadTask) error {
	logger := w.logger
	if logger == nil {
		logger = slog.Default()
	}

	// Per-task timeout to prevent indefinite blocking.
	// Use parent ctx for terminal status updates so they succeed even after timeout.
	taskCtx, cancel := context.WithTimeout(ctx, defaultTaskTimeout)
	defer cancel()

	tenantInfo, err := w.tenants.GetByID(taskCtx, task.TenantID)
	if err != nil {
		// Use parent ctx for failTask so status update succeeds even after timeout
		return w.failTask(ctx, task, fmt.Errorf("resolve tenant: %w", err), logger)
	}

	// Decrypt password before using
	decryptedPassword, err := w.encryptor.Decrypt(taskCtx, tenantInfo.DBPassword)
	if err != nil {
		// Decrypt failure may be due to encryption type change - don't delete file
		// so operator can fix config and retry
		if updateErr := w.tasks.UpdateStatus(ctx, task.TaskID, domain.TaskFailed, fmt.Sprintf("decrypt tenant password: %v", err)); updateErr != nil {
			logger.Error("failed to update upload task status", "task_id", task.TaskID, "err", updateErr)
		}
		logger.Error("upload task failed: decrypt error (file retained for retry)", "task_id", task.TaskID, "err", err)
		return fmt.Errorf("decrypt tenant password: %w", err)
	}
	tenantInfo.DBPassword = decryptedPassword

	db, err := w.pool.Get(taskCtx, tenantInfo.ID, tenantInfo.DSNForBackend(w.pool.Backend()))
	if err != nil {
		return w.failTask(ctx, task, fmt.Errorf("get tenant db: %w", err), logger)
	}
	if err := w.ensureRuntimeSchema(taskCtx, db); err != nil {
		return w.requeueTask(ctx, task, fmt.Errorf("ensure runtime schema: %w", err), logger)
	}

	memRepo := repository.NewMemoryRepo(w.pool.Backend(), db, w.autoModel, w.ftsEnabled, tenantInfo.ClusterID)
	ingestSvc := NewIngestService(memRepo, w.llmClient, w.embedder, w.autoModel, w.mode)

	data, err := os.ReadFile(task.FilePath)
	if err != nil {
		if os.IsNotExist(err) {
			// File not on this instance — requeue so the instance that has the file can pick it up.
			logger.Info("upload file not found locally, requeueing task", "task_id", task.TaskID, "path", task.FilePath)
			if reqErr := w.tasks.UpdateStatus(ctx, task.TaskID, domain.TaskPending, ""); reqErr != nil {
				logger.Error("failed to requeue task", "task_id", task.TaskID, "err", reqErr)
			}
			return nil
		}
		return w.failTask(ctx, task, fmt.Errorf("read upload file: %w", err), logger)
	}

	doneChunks := task.DoneChunks
	agentName := task.AgentID
	if agentName == "" {
		agentName = "upload-worker"
	}

	switch task.FileType {
	case domain.FileTypeSession:
		file, err := parseSessionFile(data)
		if err != nil {
			return w.failTask(ctx, task, fmt.Errorf("parse session file: %w", err), logger)
		}
		if file.AgentID == "" {
			file.AgentID = task.AgentID
		}
		rawFileAppID, _ := resolveUploadAppID(file.AppID, file.appIDSet, file.AppIDLegacy, file.appIDLegacySet)
		fileAppID, err := normalizeUploadAppID(rawFileAppID, "appId")
		if err != nil {
			return w.failTask(ctx, task, fmt.Errorf("validate session app_id: %w", err), logger)
		}
		if file.SessionID == "" {
			file.SessionID = task.SessionID
		}

		chunks := chunkMessages(file.Messages, uploadChunkSize)
		// Handle empty file: mark done immediately
		if len(chunks) == 0 {
			if err := w.tasks.UpdateTotalChunks(taskCtx, task.TaskID, 0); err != nil {
				return w.failTask(ctx, task, fmt.Errorf("update total chunks: %w", err), logger)
			}
			// Empty file: skip to done
			break
		}

		// Set total_chunks after parsing so progress reporting works correctly.
		if err := w.tasks.UpdateTotalChunks(taskCtx, task.TaskID, len(chunks)); err != nil {
			return w.failTask(ctx, task, fmt.Errorf("update total chunks: %w", err), logger)
		}

		// Process chunks with checkpoint-before-work pattern to prevent duplicates on crash.
		// We increment done_chunks BEFORE processing so replay skips this chunk.
		for i, chunk := range chunks {
			if i < doneChunks {
				continue // Already processed before crash
			}
			// Checkpoint: mark this chunk as "in progress" before doing work.
			// On crash, replay will skip chunks where done_chunks > i.
			if err := w.tasks.UpdateProgress(taskCtx, task.TaskID, i+1); err != nil {
				return w.failTask(ctx, task, fmt.Errorf("checkpoint progress: %w", err), logger)
			}
			_, err := ingestSvc.Ingest(taskCtx, agentName, IngestRequest{
				AgentID:   file.AgentID,
				AppID:     fileAppID,
				SessionID: file.SessionID,
				Messages:  chunk,
				Mode:      w.mode,
			})
			if err != nil {
				return w.failTask(ctx, task, fmt.Errorf("ingest session chunk: %w", err), logger)
			}
			if i == len(chunks)-1 {
				w.recordMemoryStats(taskCtx, task.TenantID, memRepo)
			} else {
				w.recordActivityOnly(task.TenantID)
			}
			doneChunks = i + 1
		}

	case domain.FileTypeMemory:
		file, err := parseMemoryFile(data, task.AgentID)
		if err != nil {
			return w.failTask(ctx, task, fmt.Errorf("parse memory file: %w", err), logger)
		}
		rawFileAppID, _ := resolveUploadAppID(file.AppID, file.appIDSet, file.AppIDLegacy, file.appIDLegacySet)
		fileAppID, err := normalizeUploadAppID(rawFileAppID, "appId")
		if err != nil {
			return w.failTask(ctx, task, fmt.Errorf("validate memory app_id: %w", err), logger)
		}

		// Handle empty file: mark done immediately
		if len(file.Memories) == 0 {
			if err := w.tasks.UpdateTotalChunks(taskCtx, task.TaskID, 0); err != nil {
				return w.failTask(ctx, task, fmt.Errorf("update total chunks: %w", err), logger)
			}
			// Empty file: skip to done
			break
		}

		// Set total_chunks after parsing so progress reporting works correctly.
		totalBatches := (len(file.Memories) + uploadMemoryBatchSize - 1) / uploadMemoryBatchSize
		if err := w.tasks.UpdateTotalChunks(taskCtx, task.TaskID, totalBatches); err != nil {
			return w.failTask(ctx, task, fmt.Errorf("update total chunks: %w", err), logger)
		}

		// Process batches with checkpoint-before-work pattern to prevent duplicates on crash.
		batchIdx := 0
		for i := 0; i < len(file.Memories); i += uploadMemoryBatchSize {
			if batchIdx < doneChunks {
				batchIdx++
				continue // Already processed before crash
			}
			// Checkpoint: mark this batch as "in progress" before doing work.
			if err := w.tasks.UpdateProgress(taskCtx, task.TaskID, batchIdx+1); err != nil {
				return w.failTask(ctx, task, fmt.Errorf("checkpoint progress: %w", err), logger)
			}
			end := i + uploadMemoryBatchSize
			if end > len(file.Memories) {
				end = len(file.Memories)
			}
			batch := file.Memories[i:end]
			memories := make([]*domain.Memory, 0, len(batch))
			for j, entry := range batch {
				appID := fileAppID
				if entryAppID, ok := resolveUploadAppID(entry.AppID, entry.appIDSet, entry.AppIDLegacy, entry.appIDLegacySet); ok {
					appID, err = normalizeUploadAppID(entryAppID, fmt.Sprintf("memories[%d].appId", i+j))
					if err != nil {
						return w.failTask(ctx, task, fmt.Errorf("validate memory app_id: %w", err), logger)
					}
				}
				metadata, err := marshalMetadata(entry.Metadata)
				if err != nil {
					return w.failTask(ctx, task, fmt.Errorf("marshal memory metadata: %w", err), logger)
				}
				memType := domain.TypeInsight
				if entry.MemoryType != "" {
					memType = domain.MemoryType(entry.MemoryType)
				}
				memories = append(memories, &domain.Memory{
					ID:         uuid.New().String(),
					Content:    entry.Content,
					Source:     entry.Source,
					Tags:       entry.Tags,
					Metadata:   metadata,
					MemoryType: memType,
					AgentID:    file.AgentID,
					AppID:      appID,
					State:      domain.StateActive,
					Version:    1,
					UpdatedBy:  agentName,
				})
			}
			writeStart := time.Now()
			bulkErr := memRepo.BulkCreate(taskCtx, memories)
			metrics.MemoryWriteDuration.WithLabelValues("bulk_create", metricStatus(bulkErr)).Observe(time.Since(writeStart).Seconds())
			if bulkErr != nil {
				return w.failTask(ctx, task, fmt.Errorf("bulk create memories: %w", bulkErr), logger)
			}
			clusterID := tenantInfo.ClusterID
			if clusterID == "" {
				clusterID = "default"
			}
			metrics.MemoryChangesTotal.WithLabelValues(clusterID).Add(float64(len(memories)))
			if batchIdx == totalBatches-1 {
				w.recordMemoryStats(taskCtx, task.TenantID, memRepo)
			} else {
				w.recordActivityOnly(task.TenantID)
			}
			batchIdx++
			doneChunks = batchIdx
		}

	default:
		return w.failTask(ctx, task, fmt.Errorf("unsupported file type %q", task.FileType), logger)
	}
	// Use parent ctx for terminal status update so it succeeds even after taskCtx timeout
	if err := w.tasks.UpdateStatus(ctx, task.TaskID, domain.TaskDone, ""); err != nil {
		// Task succeeded but finalization failed - do NOT delete file so retry is possible
		logger.Error("task completed but status update failed - file retained for retry", "task_id", task.TaskID, "err", err)
		return fmt.Errorf("update task status done: %w", err)
	}

	// Only delete file after successful finalization
	w.cleanupFile(task, logger)
	logger.Info("upload task completed", "task_id", task.TaskID)
	return nil

}

func (w *UploadWorker) recordActivity(tenantID string) {
	if w == nil || w.activity == nil {
		return
	}
	w.activity.RecordMemoryActivity(tenantID, time.Now().UTC())
}

func (w *UploadWorker) ensureRuntimeSchema(ctx context.Context, db *sql.DB) error {
	backend := "tidb"
	if w.pool != nil {
		backend = w.pool.Backend()
	}
	switch backend {
	case "tidb":
		return tenant.EnsureTiDBTenantRuntimeSchema(ctx, db, w.autoModel, w.autoDims, w.clientDims, w.ftsEnabled)
	case "postgres", "db9":
		return tenant.ValidatePostgresMemoryRuntimeSchema(ctx, db, backend)
	default:
		return fmt.Errorf("unsupported backend %q", backend)
	}
}

func (w *UploadWorker) requeueTask(ctx context.Context, task domain.UploadTask, err error, logger *slog.Logger) error {
	if logger == nil {
		logger = slog.Default()
	}
	if updateErr := w.tasks.UpdateStatus(ctx, task.TaskID, domain.TaskPending, ""); updateErr != nil {
		logger.Error("failed to requeue upload task", "task_id", task.TaskID, "err", updateErr)
		return err
	}
	logger.Warn("upload task requeued", "task_id", task.TaskID, "err", err)
	return err
}

func (w *UploadWorker) recordActivityOnly(tenantID string) {
	if w == nil || w.activity == nil {
		return
	}
	w.activity.RecordMemoryActivityOnly(tenantID, time.Now().UTC())
}

func (w *UploadWorker) recordMemoryStats(ctx context.Context, tenantID string, memRepo repository.MemoryRepo) {
	if w == nil || w.activity == nil || memRepo == nil {
		return
	}

	observedAt := time.Now().UTC()
	total, last7d, err := memRepo.CountStats(ctx)
	if err != nil {
		logger := w.logger
		if logger == nil {
			logger = slog.Default()
		}
		logger.Warn("upload memory stats skipped: count stats failed", "tenant_id", tenantID, "err", err)
		w.recordActivity(tenantID)
		return
	}
	w.activity.RecordMemoryStats(ctx, tenantID, observedAt, total, last7d, observedAt)
}

// failTask marks task as failed and cleans up the file.
// Uses provided ctx (should be parent ctx, not taskCtx) so status update succeeds even after timeout.
func (w *UploadWorker) failTask(ctx context.Context, task domain.UploadTask, err error, logger *slog.Logger) error {
	if logger == nil {
		logger = slog.Default()
	}
	// Update status first, then cleanup file - ensures terminal state is durable
	if updateErr := w.tasks.UpdateStatus(ctx, task.TaskID, domain.TaskFailed, err.Error()); updateErr != nil {
		logger.Error("failed to update upload task status", "task_id", task.TaskID, "err", updateErr)
		// Don't cleanup file if we couldn't mark as failed - allows retry
		return err
	}
	// Only delete file after status is durably failed
	w.cleanupFile(task, logger)
	logger.Error("upload task failed", "task_id", task.TaskID, "err", err)
	return err
}

// cleanupFile removes the upload file after task reaches terminal state.
func (w *UploadWorker) cleanupFile(task domain.UploadTask, logger *slog.Logger) {
	if task.FilePath == "" {
		return
	}
	if err := os.Remove(task.FilePath); err != nil && !os.IsNotExist(err) {
		if logger == nil {
			logger = slog.Default()
		}
		logger.Error("failed to remove upload file", "task_id", task.TaskID, "path", task.FilePath, "err", err)
	}
}

func marshalMetadata(metadata map[string]any) (json.RawMessage, error) {
	if metadata == nil {
		return nil, nil
	}
	b, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(b), nil
}

// parseMemoryFile parses upload data as a MemoryFile.
// It accepts two formats:
//   - JSON: {"agent_id":"...","memories":[{"content":"..."},...]}
//   - Markdown/plain-text: the entire file becomes a single memory entry.
func parseMemoryFile(data []byte, fallbackAgentID string) (MemoryFile, error) {
	var file MemoryFile
	if err := json.Unmarshal(data, &file); err == nil && len(file.Memories) > 0 {
		if file.AgentID == "" {
			file.AgentID = fallbackAgentID
		}
		return file, nil
	}

	// Fall back: treat the entire payload as Markdown / plain-text.
	content := strings.TrimSpace(string(data))
	if content == "" {
		return MemoryFile{AgentID: fallbackAgentID}, nil
	}
	return MemoryFile{
		AgentID: fallbackAgentID,
		Memories: []MemoryFileEntry{
			{Content: content},
		},
	}, nil
}

func normalizeUploadAppID(value string, field string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) > 100 {
		return "", &domain.ValidationError{Field: field, Message: "too long (max 100)"}
	}
	return value, nil
}

func decodeUploadAppIDFields(data []byte, appID *string, appIDSet *bool, legacyAppID *string, legacyAppIDSet *bool) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if rawAppID, ok := raw["appId"]; ok {
		value, err := decodeUploadAppIDField(rawAppID)
		if err != nil {
			return err
		}
		*appID = value
		*appIDSet = true
	}
	if rawAppID, ok := raw["app_id"]; ok {
		value, err := decodeUploadAppIDField(rawAppID)
		if err != nil {
			return err
		}
		*legacyAppID = value
		*legacyAppIDSet = true
	}
	return nil
}

func decodeUploadAppIDField(raw json.RawMessage) (string, error) {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return "", nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	return value, nil
}

func resolveUploadAppID(appID string, appIDSet bool, legacyAppID string, legacyAppIDSet bool) (string, bool) {
	if appIDSet {
		return appID, true
	}
	if legacyAppIDSet {
		return legacyAppID, true
	}
	return "", false
}

// parseSessionFile tries to parse data as a JSON SessionFile first.
// If that fails, it tries JSONL format (one JSON object per line).
// Supports both simple {role, content} lines and OpenClaw's nested
// format: {"type":"message","message":{"role":"...","content":[...]}}.
func parseSessionFile(data []byte) (SessionFile, error) {
	var file SessionFile
	if err := json.Unmarshal(data, &file); err == nil && (len(file.Messages) > 0 || file.AgentID != "" || file.SessionID != "" || file.appIDSet || file.appIDLegacySet) {
		return file, nil
	}

	// Try JSONL: parse each line, skipping non-message lines.
	var messages []IngestMessage
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024) // up to 10MB per line
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}

		// Try simple {role, content} format first.
		var simple IngestMessage
		if err := json.Unmarshal(line, &simple); err != nil {
			// Skip lines that aren't valid JSON (metadata, etc.)
			continue
		}
		if simple.Role != "" && simple.Content != "" {
			messages = append(messages, simple)
			continue
		}

		// Try OpenClaw format: {"type":"message","message":{"role":"...","content":[...]}}
		msg := parseOpenClawLine(line)
		if msg != nil {
			messages = append(messages, *msg)
		}
	}
	if err := scanner.Err(); err != nil {
		return SessionFile{}, fmt.Errorf("JSONL scan: %w", err)
	}
	if len(messages) == 0 {
		return SessionFile{}, fmt.Errorf("no valid messages found in file")
	}

	return SessionFile{Messages: messages}, nil
}

// parseOpenClawLine extracts an IngestMessage from an OpenClaw JSONL line.
// OpenClaw format: {"type":"message","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
func parseOpenClawLine(line []byte) *IngestMessage {
	var entry struct {
		Type    string `json:"type"`
		Message struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(line, &entry); err != nil {
		return nil
	}
	if entry.Type != "message" || entry.Message.Role == "" {
		return nil
	}
	role := entry.Message.Role

	content := flattenContentBlocks(entry.Message.Content)
	if content == "" {
		return nil
	}
	return &IngestMessage{Role: role, Content: content}
}

// flattenContentBlocks converts a content field to a plain string.
// Handles both string content and array-of-blocks content
// (e.g. [{"type":"text","text":"..."},{"type":"thinking","thinking":"..."}]).
func flattenContentBlocks(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	// Try plain string first.
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}

	// Try array of content blocks.
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}

	var sb strings.Builder
	for _, b := range blocks {
		if b.Type == "text" && b.Text != "" {
			if sb.Len() > 0 {
				sb.WriteString("\n\n")
			}
			sb.WriteString(b.Text)
		}
	}
	return sb.String()
}

func chunkMessages(msgs []IngestMessage, size int) [][]IngestMessage {
	if size <= 0 {
		if len(msgs) == 0 {
			return nil
		}
		return [][]IngestMessage{msgs}
	}
	chunks := make([][]IngestMessage, 0, (len(msgs)+size-1)/size)
	for i := 0; i < len(msgs); i += size {
		end := i + size
		if end > len(msgs) {
			end = len(msgs)
		}
		chunks = append(chunks, msgs[i:end])
	}
	return chunks
}
