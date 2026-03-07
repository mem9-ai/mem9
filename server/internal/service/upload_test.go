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

func makeMessages(n int) []IngestMessage {
	msgs := make([]IngestMessage, n)
	for i := range msgs {
		msgs[i] = IngestMessage{Role: "user", Content: "msg"}
	}
	return msgs
}
