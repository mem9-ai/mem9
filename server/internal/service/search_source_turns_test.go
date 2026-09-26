package service

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestFormatSearchMemoryWithSourceTurnsLabelsAssistant(t *testing.T) {
	t.Parallel()

	got := formatSearchMemoryWithSourceTurns("The API is authoritative", []sourceTurnMetadata{
		{Seq: 2, Role: "assistant", Content: "The mem9 Go API is authoritative."},
	})
	want := "The API is authoritative\n[source-turns]\nAssistant: The mem9 Go API is authoritative."
	if got != want {
		t.Fatalf("formatted source turns = %q, want %q", got, want)
	}
}

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

func TestFinalizeSearchResultsBoundsUnicodeSourceEvidence(t *testing.T) {
	content := "profile detail " + strings.Repeat("证据ñ🙂", 500)
	memories := make([]domain.Memory, 5)
	confidence := 87
	for i := range memories {
		memories[i] = domain.Memory{ID: string(rune('a' + i)), Content: "profile fact remains intact", MemoryType: domain.TypeInsight, Confidence: &confidence,
			Metadata: SetSourceProvenanceMetadata(nil, []int{1, 2, 3}, []sourceTurnMetadata{{Seq: 1, Content: content}, {Seq: 2, Role: "assistant", Content: content}, {Seq: 3, Content: content}})}
	}
	before, _ := json.Marshal(memories)
	out := FinalizeSearchResults(memories, "profile detail")
	added, turns := 0, 0
	for i := range out {
		if out[i].ID != memories[i].ID || out[i].Confidence != memories[i].Confidence || !strings.HasPrefix(out[i].Content, memories[i].Content) {
			t.Fatalf("selected memory changed: %+v", out[i])
		}
		added += len([]rune(out[i].Content)) - len([]rune(memories[i].Content))
		selected := parseSourceTurnsFromMetadata(out[i].Metadata)
		if len(selected) > defaultSearchSourceTurnPerMemoryCap {
			t.Fatalf("per-memory turn count=%d", len(selected))
		}
		for _, turn := range selected {
			turns++
			if len([]rune(turn.Content))+searchSourceRoleRunes(turn) > maxSearchSourceTurnRunes {
				t.Fatal("source fragment exceeded rune budget")
			}
			if !strings.HasSuffix(turn.Content, searchSourceTruncationMarker) {
				t.Fatalf("missing truncation marker: %q", turn.Content)
			}
			if !utf8.ValidString(turn.Content) {
				t.Fatal("invalid UTF-8 in clipped source")
			}
		}
	}
	if added == 0 || added > maxSearchSourceResponseRunes || turns > defaultSearchSourceTurnTotalCap {
		t.Fatalf("response evidence budget violated: addedRunes=%d turns=%d", added, turns)
	}
	after, _ := json.Marshal(memories)
	if string(before) != string(after) {
		t.Fatal("input content or stored metadata mutated")
	}
}

func TestFinalizeSearchResultsDoesNotSelectEvidenceOutsideVisiblePrefix(t *testing.T) {
	memory := domain.Memory{ID: "m", Content: "A fact.", MemoryType: domain.TypeInsight, Metadata: SetSourceProvenanceMetadata(nil, []int{1}, []sourceTurnMetadata{{Seq: 1, Content: strings.Repeat("unrelated ", 5000) + "rareword"}})}
	out := FinalizeSearchResults([]domain.Memory{memory}, "rareword")
	if out[0].Content != memory.Content {
		t.Fatal("invisible tail match selected unrelated evidence")
	}
}

func TestFinalizeSearchResultsSkipsOversizedSourceMetadata(t *testing.T) {
	metadata := SetSourceProvenanceMetadata(nil, []int{1}, []sourceTurnMetadata{{Seq: 1, Content: "profile " + strings.Repeat("x", maxSearchSourceMetadataBytes)}})
	memory := domain.Memory{ID: "m", Content: "profile", MemoryType: domain.TypeInsight, Metadata: metadata}
	out := FinalizeSearchResults([]domain.Memory{memory}, "profile")
	if out[0].Content != memory.Content || string(out[0].Metadata) != string(metadata) {
		t.Fatal("oversized metadata should pass through without decoration")
	}
}

func TestFinalizeSearchResultsPreservesMalformedSourceMetadata(t *testing.T) {
	metadata := json.RawMessage(`{"source_turns":[`)
	memory := domain.Memory{ID: "m", Content: "profile", MemoryType: domain.TypeInsight, Metadata: metadata}
	out := FinalizeSearchResults([]domain.Memory{memory}, "profile")
	if out[0].Content != memory.Content || string(out[0].Metadata) != string(metadata) {
		t.Fatal("malformed metadata should pass through without decoration")
	}
}

func BenchmarkFinalizeSearchResultsOversizedMetadata(b *testing.B) {
	metadata := json.RawMessage(`{"source_turns":"` + strings.Repeat("x", 1<<20) + `"}`)
	memories := []domain.Memory{{ID: "m", Content: "profile", MemoryType: domain.TypeInsight, Metadata: metadata}}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		FinalizeSearchResults(memories, "profile")
	}
}
