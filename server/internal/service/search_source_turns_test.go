package service

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func withSearchEnv(t *testing.T, values map[string]string, fn func()) {
	t.Helper()
	previous := make(map[string]string, len(values))
	missing := make(map[string]bool, len(values))
	for key, value := range values {
		if current, ok := os.LookupEnv(key); ok {
			previous[key] = current
		} else {
			missing[key] = true
		}
		if err := os.Setenv(key, value); err != nil {
			t.Fatalf("Setenv(%q) error = %v", key, err)
		}
	}
	defer func() {
		for key := range values {
			if missing[key] {
				_ = os.Unsetenv(key)
				continue
			}
			_ = os.Setenv(key, previous[key])
		}
	}()
	fn()
}

func TestDecorateSearchResultsWithSourceTurnsSelectsSpeakerAwareTurn(t *testing.T) {
	t.Parallel()

	withSearchEnv(t, map[string]string{
		"MEM9_SOURCE_TURN_PER_MEMORY_LIMIT": "1",
		"MEM9_SOURCE_TURN_TOTAL_LIMIT":      "1",
	}, func() {
		memories := decorateSearchResultsWithSourceTurns([]domain.Memory{
			{
				ID:         "m1",
				Content:    "Jon opened a dance studio after losing his job.",
				MemoryType: domain.TypeInsight,
				Metadata: SetSourceProvenanceMetadata(nil, []int{1, 2}, []sourceTurnMetadata{
					{Seq: 1, Content: "[date:19 June 2023] [speaker:Jon] Thanks, Gina. Still working on opening a dance studio."},
					{Seq: 2, Content: "[date:19 June 2023] [speaker:Gina] Congrats, Jon! The studio looks amazing."},
				}),
			},
		}, "How does Gina describe the studio that Jon has opened?")

		if len(memories) != 1 {
			t.Fatalf("expected 1 memory, got %d", len(memories))
		}
		if strings.Contains(memories[0].Content, "[speaker:Jon]") {
			t.Fatalf("expected Jon source turn pruned, got content %q", memories[0].Content)
		}
		if !strings.Contains(memories[0].Content, "[speaker:Gina]") {
			t.Fatalf("expected Gina source turn included, got content %q", memories[0].Content)
		}

		var metadata struct {
			SourceSeqs []int `json:"source_seqs"`
		}
		if err := json.Unmarshal(memories[0].Metadata, &metadata); err != nil {
			t.Fatalf("metadata unmarshal error = %v", err)
		}
		if len(metadata.SourceSeqs) != 1 || metadata.SourceSeqs[0] != 2 {
			t.Fatalf("source_seqs = %v, want [2]", metadata.SourceSeqs)
		}
	})
}

func TestDecorateSearchResultsWithSourceTurnsClearsUnselectedProvenance(t *testing.T) {
	t.Parallel()

	withSearchEnv(t, map[string]string{
		"MEM9_SOURCE_TURN_MIN_SCORE": "7",
	}, func() {
		memories := decorateSearchResultsWithSourceTurns([]domain.Memory{
			{
				ID:         "m1",
				Content:    "Jon opened a dance studio after losing his job.",
				MemoryType: domain.TypeInsight,
				Metadata: SetSourceProvenanceMetadata(nil, []int{1}, []sourceTurnMetadata{
					{Seq: 1, Content: "[date:19 June 2023] [speaker:Jon] Thanks, Gina. Still working on opening a dance studio."},
				}),
			},
		}, "Where did Maria buy the cake?")

		if len(memories) != 1 {
			t.Fatalf("expected 1 memory, got %d", len(memories))
		}
		if strings.Contains(memories[0].Content, "[source-turns]") {
			t.Fatalf("expected no source-turn append, got content %q", memories[0].Content)
		}

		if len(memories[0].Metadata) == 0 {
			return
		}

		var decoded map[string]any
		if err := json.Unmarshal(memories[0].Metadata, &decoded); err != nil {
			t.Fatalf("metadata unmarshal error = %v", err)
		}
		if _, ok := decoded["source_seqs"]; ok {
			t.Fatalf("source_seqs should be cleared from decorated response metadata: %s", memories[0].Metadata)
		}
		if _, ok := decoded["source_turns"]; ok {
			t.Fatalf("source_turns should be cleared from decorated response metadata: %s", memories[0].Metadata)
		}
	})
}
