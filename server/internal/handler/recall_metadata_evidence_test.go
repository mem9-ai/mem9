package handler

import (
	"math"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

func TestRecallEvidenceMetadataDoesNotChangeAnswerSignals(t *testing.T) {
	for _, tt := range []struct{ name, query, body, header string }{
		{"count_without_answer", "How many offices?", "No recuerdo.", "[session_timestamp:2025-07-06T11:22:33]"},
		{"count_with_answer", "How many offices?", "There are 3 offices.", "[session_id:123]"},
		{"short_factual_answer", "What changed?", "The customer updated the billing address after moving overseas.", "[session_timestamp:2025-07-06T11:22:33]"},
		{"entity_from_metadata", "Who approved it?", "unknown", "[speaker:Jane Smith][role:Admin]"},
		{"stacked_tags", "What changed?", "The billing address changed.", "[session_timestamp:2025-07-06T11:22:33]\n[source_session_id:123]\n[session_id:99]\n[role:user]"},
		{"literal_number", "How many offices?", "[42]", "[session_timestamp:2025-07-06T11:22:33]"},
		{"literal_place", "Where is the office?", "[New York]", "[session_timestamp:2025-07-06T11:22:33]"},
		{"literal_colon", "How many offices?", "[Answer: 42]", "[session_id:123]"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			profile := buildRecallQueryProfile(tt.query)
			plain := domain.Memory{Content: tt.body}
			tagged := domain.Memory{Content: tt.header + "\n" + tt.body}
			want, got := answerEvidenceBonus(profile, plain), answerEvidenceBonus(profile, tagged)
			candidate := service.RecallCandidate{Memory: plain, SourcePool: service.RecallSourceSession, RRFScore: 1.0 / 61, RRFRank: 1, InVector: true, VectorSimilarity: .65}
			candidate.Memory.UpdatedAt = time.Now()
			plainConfidence := buildRecallConfidence(profile, candidate)
			candidate.Memory.Content = tagged.Content
			t.Logf("answer bonus plain/tagged %.2f/%.2f; confidence plain/tagged %d/%d", want, got, plainConfidence, buildRecallConfidence(profile, candidate))
			if math.Abs(got-want) > 1e-9 {
				t.Fatalf("metadata changed answer evidence: got %.2f want %.2f", got, want)
			}
		})
	}
}

func TestRecallEvidencePreservesTemporalAndSpeakerGrounding(t *testing.T) {
	profile := buildRecallQueryProfile("When did it happen?")
	body := "It happened yesterday."
	plain := answerEvidenceBonus(profile, domain.Memory{Content: body})
	tagged := answerEvidenceBonus(profile, domain.Memory{Content: "[session_timestamp:2025-07-06T11:22:33]\n" + body})
	if math.Abs(tagged-plain-.08) > 1e-9 {
		t.Fatalf("relative date lost its timestamp anchor: delta=%.2f want .08", tagged-plain)
	}
	profile = buildRecallQueryProfile("What did Alice say?")
	matching := answerEvidenceBonus(profile, domain.Memory{Content: "[speaker:Alice]\nThe billing address changed."})
	other := answerEvidenceBonus(profile, domain.Memory{Content: "[speaker:Bob]\nThe billing address changed."})
	if math.Abs(matching-other-.30) > 1e-9 {
		t.Fatalf("speaker signal lost: matching=%.2f other=%.2f", matching, other)
	}
}

func BenchmarkRecallEvidenceHeaderScoring(b *testing.B) {
	for _, tt := range []struct{ name, content string }{
		{"Plain", "The customer updated the billing address after moving overseas."},
		{"Headers", "[session_timestamp:2025-07-06T11:22:33]\n[session_id:123]\n[role:user]\nThe customer updated the billing address after moving overseas."},
	} {
		b.Run(tt.name, func(b *testing.B) {
			profile := buildRecallQueryProfile("What changed?")
			candidate := service.RecallCandidate{Memory: domain.Memory{ID: "m", Content: tt.content, UpdatedAt: time.Now()}, SourcePool: service.RecallSourceSession, RRFScore: 1.0 / 61, InVector: true, VectorSimilarity: .82}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				buildRecallConfidence(profile, candidate)
			}
		})
	}
}
