package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestChunkMessages(t *testing.T) {
	tests := []struct {
		name     string
		msgs     []IngestMessage
		size     int
		wantLen  int
		wantLast int // length of last chunk
	}{
		{
			name:    "empty",
			msgs:    nil,
			size:    50,
			wantLen: 0,
		},
		{
			name:     "single chunk",
			msgs:     makeMessages(10),
			size:     50,
			wantLen:  1,
			wantLast: 10,
		},
		{
			name:     "exact fit",
			msgs:     makeMessages(100),
			size:     50,
			wantLen:  2,
			wantLast: 50,
		},
		{
			name:     "with remainder",
			msgs:     makeMessages(120),
			size:     50,
			wantLen:  3,
			wantLast: 20,
		},
		{
			name:     "size 1",
			msgs:     makeMessages(3),
			size:     1,
			wantLen:  3,
			wantLast: 1,
		},
		{
			name:     "size 0 falls back to single chunk",
			msgs:     makeMessages(5),
			size:     0,
			wantLen:  1,
			wantLast: 5,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			chunks := chunkMessages(tt.msgs, tt.size)
			if len(chunks) != tt.wantLen {
				t.Errorf("got %d chunks, want %d", len(chunks), tt.wantLen)
			}
			if tt.wantLen > 0 && len(chunks[len(chunks)-1]) != tt.wantLast {
				t.Errorf("last chunk has %d msgs, want %d", len(chunks[len(chunks)-1]), tt.wantLast)
			}
			// Verify total count matches.
			total := 0
			for _, c := range chunks {
				total += len(c)
			}
			if total != len(tt.msgs) {
				t.Errorf("total messages in chunks = %d, want %d", total, len(tt.msgs))
			}
		})
	}
}

func TestMarshalMetadata(t *testing.T) {
	t.Run("nil metadata", func(t *testing.T) {
		raw, err := marshalMetadata(nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if raw != nil {
			t.Errorf("expected nil, got %s", string(raw))
		}
	})

	t.Run("non-nil metadata", func(t *testing.T) {
		m := map[string]any{"key": "value", "num": 42.0}
		raw, err := marshalMetadata(m)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if raw == nil {
			t.Fatal("expected non-nil")
		}
		// Verify it round-trips.
		s := string(raw)
		if s == "" || s == "{}" {
			t.Errorf("unexpected empty result: %s", s)
		}
	})
}

func TestNormalizeUploadAppID(t *testing.T) {
	got, err := normalizeUploadAppID("  app-a  ", "appId")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "app-a" {
		t.Fatalf("appID = %q, want app-a", got)
	}

	got, err = normalizeUploadAppID(" \t ", "appId")
	if err != nil {
		t.Fatalf("unexpected error for blank appID: %v", err)
	}
	if got != "" {
		t.Fatalf("blank appID = %q, want empty", got)
	}

	_, err = normalizeUploadAppID(strings.Repeat("x", 101), "memories[0].appId")
	if err == nil {
		t.Fatal("expected validation error for oversized appID")
	}
	var ve *domain.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("error = %T, want ValidationError", err)
	}
	if ve.Field != "memories[0].appId" {
		t.Fatalf("field = %q, want memories[0].appId", ve.Field)
	}
}

func TestParseMemoryFilePreservesEntryDefaultAppIDOverride(t *testing.T) {
	file, err := parseMemoryFile([]byte(`{
		"agent_id": "agent-a",
		"appId": "file-app",
		"memories": [
			{"content": "inherits file app"},
			{"content": "explicit empty app", "appId": ""},
			{"content": "explicit null app", "appId": null},
			{"content": "explicit legacy empty app", "app_id": ""},
			{"content": "explicit entry app", "appId": "entry-app"}
		]
	}`), "fallback-agent")
	if err != nil {
		t.Fatalf("parse memory file: %v", err)
	}
	fileAppID, ok := resolveUploadAppID(file.AppID, file.appIDSet, file.AppIDLegacy, file.appIDLegacySet)
	if !ok || fileAppID != "file-app" {
		t.Fatalf("file appID = %q, ok = %v, want file-app/true", fileAppID, ok)
	}

	got := make([]string, 0, len(file.Memories))
	for _, entry := range file.Memories {
		appID := fileAppID
		if entryAppID, ok := resolveUploadAppID(entry.AppID, entry.appIDSet, entry.AppIDLegacy, entry.appIDLegacySet); ok {
			appID = entryAppID
		}
		got = append(got, appID)
	}

	want := []string{"file-app", "", "", "", "entry-app"}
	if len(got) != len(want) {
		t.Fatalf("got %d memories, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("memory[%d] appID = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestParseUploadFileAppIDPrefersExplicitDefaultOverLegacy(t *testing.T) {
	memoryFile, err := parseMemoryFile([]byte(`{
		"agent_id": "agent-a",
		"appId": null,
		"app_id": "legacy-app",
		"memories": [{"content": "uses default app"}]
	}`), "fallback-agent")
	if err != nil {
		t.Fatalf("parse memory file: %v", err)
	}
	appID, ok := resolveUploadAppID(memoryFile.AppID, memoryFile.appIDSet, memoryFile.AppIDLegacy, memoryFile.appIDLegacySet)
	if !ok || appID != "" {
		t.Fatalf("memory file appID = %q, ok = %v, want empty/true", appID, ok)
	}

	sessionFile, err := parseSessionFile([]byte(`{
		"agent_id": "agent-a",
		"session_id": "session-a",
		"appId": "",
		"app_id": "legacy-app",
		"messages": [{"role": "user", "content": "hello"}]
	}`))
	if err != nil {
		t.Fatalf("parse session file: %v", err)
	}
	appID, ok = resolveUploadAppID(sessionFile.AppID, sessionFile.appIDSet, sessionFile.AppIDLegacy, sessionFile.appIDLegacySet)
	if !ok || appID != "" {
		t.Fatalf("session file appID = %q, ok = %v, want empty/true", appID, ok)
	}
}

func TestParseSessionFile(t *testing.T) {
	tests := []struct {
		name     string
		data     string
		wantMsgs int
		wantErr  bool
	}{
		{
			name:     "valid JSON SessionFile",
			data:     `{"agent_id":"a1","session_id":"s1","messages":[{"role":"user","content":"hello"},{"role":"assistant","content":"hi"}]}`,
			wantMsgs: 2,
		},
		{
			name:     "JSONL format",
			data:     "{\"role\":\"user\",\"content\":\"hello\"}\n{\"role\":\"assistant\",\"content\":\"hi\"}\n",
			wantMsgs: 2,
		},
		{
			name:     "JSONL with blank lines",
			data:     "{\"role\":\"user\",\"content\":\"hello\"}\n\n{\"role\":\"assistant\",\"content\":\"hi\"}\n\n",
			wantMsgs: 2,
		},
		{
			name:    "empty file",
			data:    "",
			wantErr: true,
		},
		{
			name:    "invalid content",
			data:    "not json at all",
			wantErr: true,
		},
		{
			name:     "JSON SessionFile with empty messages",
			data:     `{"agent_id":"a1","session_id":"s1","messages":[]}`,
			wantMsgs: 0,
		},
		{
			name: "OpenClaw JSONL format",
			data: `{"type":"session","version":3,"id":"abc","timestamp":"2026-03-04T19:24:44.259Z","cwd":"/home/user"}
{"type":"model_change","id":"m1","parentId":null,"timestamp":"2026-03-04T19:24:44.260Z","provider":"anthropic","modelId":"claude-opus-4-6"}
{"type":"message","id":"msg1","parentId":"m1","timestamp":"2026-03-04T19:24:44.263Z","message":{"role":"user","content":[{"type":"text","text":"hello world"}]}}
{"type":"message","id":"msg2","parentId":"msg1","timestamp":"2026-03-04T19:24:45.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hi there"}]}}
{"type":"message","id":"msg3","parentId":"msg2","timestamp":"2026-03-04T19:24:46.000Z","message":{"role":"toolResult","content":[{"type":"text","text":"tool output"}]}}`,
			wantMsgs: 3, // user + assistant + toolResult are all ingested
		},
		{
			name:     "OpenClaw JSONL with multi-block content",
			data:     `{"type":"message","id":"msg1","message":{"role":"assistant","content":[{"type":"thinking","thinking":"let me think"},{"type":"text","text":"first part"},{"type":"text","text":"second part"}]}}`,
			wantMsgs: 1,
		},
		{
			name: "OpenClaw JSONL skips non-message lines gracefully",
			data: `{"type":"session","version":3}
{"type":"custom","customType":"snapshot"}
{"type":"message","id":"m1","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}`,
			wantMsgs: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			file, err := parseSessionFile([]byte(tt.data))
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(file.Messages) != tt.wantMsgs {
				t.Errorf("got %d messages, want %d", len(file.Messages), tt.wantMsgs)
			}
		})
	}
}

func TestParseMemoryFile(t *testing.T) {
	tests := []struct {
		name            string
		data            string
		fallbackAgentID string
		wantAgentID     string
		wantMemories    int
		wantContent     string
	}{
		{
			name:         "valid JSON memory file",
			data:         `{"agent_id":"a1","memories":[{"content":"fact one"},{"content":"fact two"}]}`,
			wantAgentID:  "a1",
			wantMemories: 2,
		},
		{
			name:            "JSON missing agent_id uses fallback",
			data:            `{"memories":[{"content":"fact"}]}`,
			fallbackAgentID: "fallback",
			wantAgentID:     "fallback",
			wantMemories:    1,
		},
		{
			name:         "markdown plain text",
			data:         "# My Notes\n\nThis is a memory stored as markdown.",
			wantMemories: 1,
			wantContent:  "# My Notes\n\nThis is a memory stored as markdown.",
		},
		{
			name:            "markdown uses fallback agent_id",
			data:            "some plain text memory",
			fallbackAgentID: "agent-x",
			wantAgentID:     "agent-x",
			wantMemories:    1,
			wantContent:     "some plain text memory",
		},
		{
			name:         "empty file yields zero memories",
			data:         "   \n  ",
			wantMemories: 0,
		},
		{
			name:         "JSON with empty memories array falls back to plaintext",
			data:         `{"memories":[]}`,
			wantMemories: 1,
			wantContent:  `{"memories":[]}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			file, err := parseMemoryFile([]byte(tt.data), tt.fallbackAgentID)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(file.Memories) != tt.wantMemories {
				t.Errorf("got %d memories, want %d", len(file.Memories), tt.wantMemories)
			}
			if tt.wantAgentID != "" && file.AgentID != tt.wantAgentID {
				t.Errorf("agentID = %q, want %q", file.AgentID, tt.wantAgentID)
			}
			if tt.wantContent != "" && tt.wantMemories == 1 && file.Memories[0].Content != tt.wantContent {
				t.Errorf("content = %q, want %q", file.Memories[0].Content, tt.wantContent)
			}
		})
	}
}

func TestUploadWorkerRecordActivity(t *testing.T) {
	repo := &activityTenantRepo{count: 1}
	worker := &UploadWorker{activity: NewActivityTracker(repo, nil)}

	worker.recordActivity("tenant-a")

	repo.mu.Lock()
	touchCalls := repo.touchCalls
	countCalls := repo.countCalls
	repo.mu.Unlock()
	if touchCalls != 1 || countCalls != 1 {
		t.Fatalf("calls = touch:%d count:%d, want 1/1", touchCalls, countCalls)
	}
}

func TestUploadWorkerRecordActivityOnlyDoesNotRefresh(t *testing.T) {
	repo := &activityTenantRepo{count: 1}
	worker := &UploadWorker{activity: NewActivityTracker(repo, nil)}

	worker.recordActivityOnly("tenant-a")

	repo.mu.Lock()
	touchCalls := repo.touchCalls
	countCalls := repo.countCalls
	sumCalls := repo.sumCalls
	repo.mu.Unlock()
	if touchCalls != 1 || countCalls != 0 || sumCalls != 0 {
		t.Fatalf("calls = touch:%d count:%d sum:%d, want 1/0/0", touchCalls, countCalls, sumCalls)
	}
}

type uploadMemoryStatsRepo struct {
	memoryRepoMock
	total  int64
	last7d int64
	err    error
}

func (r *uploadMemoryStatsRepo) CountStats(context.Context) (int64, int64, error) {
	return r.total, r.last7d, r.err
}

func TestUploadWorkerRecordMemoryStats(t *testing.T) {
	repo := &activityTenantRepo{count: 1, memoryTotal: 7, memoryLast7d: 3}
	worker := &UploadWorker{activity: NewActivityTracker(repo, nil)}
	memRepo := &uploadMemoryStatsRepo{total: 7, last7d: 3}

	worker.recordMemoryStats(context.Background(), "tenant-a", memRepo)

	repo.mu.Lock()
	upsertCalls := repo.upsertCalls
	touchCalls := repo.touchCalls
	statsTotal := repo.lastStatsTotal
	statsLast7d := repo.lastStatsLast7d
	repo.mu.Unlock()
	if upsertCalls != 1 || touchCalls != 0 || statsTotal != 7 || statsLast7d != 3 {
		t.Fatalf("calls = upsert:%d touch:%d stats:%d/%d, want 1/0/7/3", upsertCalls, touchCalls, statsTotal, statsLast7d)
	}
}

func TestUploadWorkerRecordMemoryStatsFallsBackToActivity(t *testing.T) {
	repo := &activityTenantRepo{count: 1}
	worker := &UploadWorker{activity: NewActivityTracker(repo, nil)}
	memRepo := &uploadMemoryStatsRepo{err: errors.New("count failed")}

	worker.recordMemoryStats(context.Background(), "tenant-a", memRepo)

	repo.mu.Lock()
	upsertCalls := repo.upsertCalls
	touchCalls := repo.touchCalls
	repo.mu.Unlock()
	if upsertCalls != 0 || touchCalls != 1 {
		t.Fatalf("calls = upsert:%d touch:%d, want 0/1", upsertCalls, touchCalls)
	}
}

type uploadTaskStatusRepo struct {
	status   domain.TaskStatus
	errorMsg string
}

func (r *uploadTaskStatusRepo) Create(context.Context, *domain.UploadTask) error { return nil }

func (r *uploadTaskStatusRepo) GetByID(context.Context, string) (*domain.UploadTask, error) {
	return nil, nil
}

func (r *uploadTaskStatusRepo) ListByTenant(context.Context, string) ([]domain.UploadTask, error) {
	return nil, nil
}

func (r *uploadTaskStatusRepo) UpdateStatus(_ context.Context, _ string, status domain.TaskStatus, errorMsg string) error {
	r.status = status
	r.errorMsg = errorMsg
	return nil
}

func (r *uploadTaskStatusRepo) UpdateProgress(context.Context, string, int) error { return nil }

func (r *uploadTaskStatusRepo) UpdateTotalChunks(context.Context, string, int) error { return nil }

func (r *uploadTaskStatusRepo) FetchPending(context.Context, int) ([]domain.UploadTask, error) {
	return nil, nil
}

func (r *uploadTaskStatusRepo) ResetProcessing(context.Context, time.Duration) (int64, error) {
	return 0, nil
}

func TestUploadWorkerRequeueTaskKeepsPending(t *testing.T) {
	repo := &uploadTaskStatusRepo{}
	worker := &UploadWorker{tasks: repo}
	task := domain.UploadTask{TaskID: "task-a"}

	err := worker.requeueTask(context.Background(), task, errors.New("schema not ready"), nil)
	if err == nil {
		t.Fatal("expected requeueTask to return original error")
	}
	if repo.status != domain.TaskPending {
		t.Fatalf("status = %q, want pending", repo.status)
	}
	if repo.errorMsg != "" {
		t.Fatalf("error message = %q, want empty", repo.errorMsg)
	}
}

func makeMessages(n int) []IngestMessage {
	msgs := make([]IngestMessage, n)
	for i := range msgs {
		msgs[i] = IngestMessage{Role: "user", Content: "msg"}
	}
	return msgs
}
