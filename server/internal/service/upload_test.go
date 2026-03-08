package service

import (
	"testing"
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
			wantMsgs: 2, // only user + assistant, not toolResult
		},
		{
			name: "OpenClaw JSONL with multi-block content",
			data: `{"type":"message","id":"msg1","message":{"role":"assistant","content":[{"type":"thinking","thinking":"let me think"},{"type":"text","text":"first part"},{"type":"text","text":"second part"}]}}`,
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

func makeMessages(n int) []IngestMessage {
	msgs := make([]IngestMessage, n)
	for i := range msgs {
		msgs[i] = IngestMessage{Role: "user", Content: "msg"}
	}
	return msgs
}
