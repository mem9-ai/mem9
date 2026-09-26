package handler

import (
	"math"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

func TestGeneralSessionShortnessCannotDisplaceRelevantFact(t *testing.T) {
	profile := buildRecallQueryProfile("Tell me how delivery changed")
	if profile.shape != recallQueryShapeGeneral {
		t.Fatal("fixture must use a general query")
	}
	factBody := "The revised delivery schedule starts at noon and covers every warehouse in the northern region before the following business day."
	if recallAnswerUnitCount(factBody) <= 18 {
		t.Fatal("fixture must exceed the short-answer range")
	}
	for _, filler := range []string{"Thanks for explaining.", "Can you tell me more?"} {
		t.Run(filler, func(t *testing.T) {
			fact := service.RecallCandidate{Memory: domain.Memory{ID: "fact", MemoryType: domain.TypeSession, Content: "[role:assistant]\n" + factBody, UpdatedAt: time.Now()}, SourcePool: service.RecallSourceSession, RRFScore: 2.0 / 61, RRFRank: 1, InVector: true, VectorSimilarity: .82}
			other := fact
			other.Memory.ID = "brief-turn"
			other.Memory.Content = "[role:user]\n" + filler
			other.VectorSimilarity = .76
			other.RRFRank = 2
			factScore, otherScore := buildRecallConfidence(profile, fact), buildRecallConfidence(profile, other)
			t.Logf("fact=%d short turn=%d", factScore, otherScore)
			if factScore <= otherScore {
				t.Errorf("brief filler displaced better-supported fact: fact=%d short=%d", factScore, otherScore)
			}
			selected, _, _ := selectMixedRecallCandidates(profile, 1, applyRecallConfidence(profile, []service.RecallCandidate{other, fact}), nil)
			if len(selected) != 1 || selected[0].ID != "fact" {
				t.Fatalf("top-1 did not preserve fact: %v", selected)
			}
		})
	}
}

func TestShortnessScopePreservesExtractedAndStructuredAnswers(t *testing.T) {
	general := recallQueryProfile{shape: recallQueryShapeGeneral}
	for _, memoryType := range []domain.MemoryType{domain.TypeInsight, domain.TypePinned, ""} {
		got := answerEvidenceBonus(general, domain.Memory{MemoryType: memoryType, Content: "confirmed"})
		if math.Abs(got-.05) > 1e-9 {
			t.Errorf("memory type %q lost existing shortness evidence: %v", memoryType, got)
		}
	}
	for _, body := range []string{"Thanks.", "More details?", "Delivery starts at noon."} {
		for _, role := range []string{"user", "assistant"} {
			got := answerEvidenceBonus(general, domain.Memory{MemoryType: domain.TypeSession, Content: "[role:" + role + "]\n" + body})
			if got != 0 {
				t.Errorf("general session gained evidence from brevity: role=%s body=%q bonus=%v", role, body, got)
			}
		}
	}
	for _, shape := range []recallQueryShape{recallQueryShapeExact, recallQueryShapeCount, recallQueryShapeTime, recallQueryShapeEntity, recallQueryShapeLocation, recallQueryShapeEnumeration} {
		profile := recallQueryProfile{shape: shape}
		for _, role := range []string{"user", "assistant"} {
			content := "[role:" + role + "]\nconfirmed"
			got := answerEvidenceBonus(profile, domain.Memory{MemoryType: domain.TypeSession, Content: content})
			want := answerEvidenceBonus(profile, domain.Memory{MemoryType: domain.TypeInsight, Content: content})
			if math.Abs(got-want) > 1e-9 {
				t.Errorf("shape=%v role=%s changed structured evidence: %v want %v", shape, role, got, want)
			}
		}
	}
}

func TestGeneralSessionKeepsConcreteDurationAndFrequencyAnswers(t *testing.T) {
	for _, tt := range []struct {
		name    string
		profile recallQueryProfile
		answer  string
		want    float64
	}{
		{"duration", recallQueryProfile{shape: recallQueryShapeGeneral, durationQuery: true}, "for 5 years", .27},
		{"frequency", recallQueryProfile{shape: recallQueryShapeGeneral, frequencyQuery: true}, "daily", .29},
	} {
		t.Run(tt.name, func(t *testing.T) {
			memory := domain.Memory{MemoryType: domain.TypeSession, Content: tt.answer}
			if got := answerEvidenceBonus(tt.profile, memory); math.Abs(got-tt.want) > 1e-9 {
				t.Errorf("concrete %s answer lost its existing evidence: got %.2f want %.2f", tt.name, got, tt.want)
			}
			memory.Content = "No idea."
			if got := answerEvidenceBonus(tt.profile, memory); got != 0 {
				t.Errorf("%s query rewarded brevity without matching evidence: %.2f", tt.name, got)
			}
		})
	}
}
