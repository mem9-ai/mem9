package handler

import (
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestChainRecallStopDecision_IgnoresRawScore(t *testing.T) {
	score := 1.3
	confidence := 70

	decision := chainRecallStopDecision(
		buildRecallQueryProfile("what timezone does Bosn use"),
		[]domain.Memory{{
			ID:         "mem-high-raw-score",
			Content:    "Bosn uses Asia/Shanghai.",
			Score:      &score,
			Confidence: &confidence,
		}},
		0.8,
	)

	if decision.stop {
		t.Fatal("expected raw score above 1.0 not to stop chain recall when confidence is below threshold")
	}
	if !decision.eligible {
		t.Fatalf("expected specific question to be stop eligible, blocked by %q", decision.blockedReason)
	}
	if decision.confidence != confidence {
		t.Fatalf("stop confidence = %d, want %d", decision.confidence, confidence)
	}
}

func TestChainRecallStopDecision_BlocksSingleTokenQueries(t *testing.T) {
	confidence := 81

	decision := chainRecallStopDecision(
		buildRecallQueryProfile("Bosn"),
		[]domain.Memory{{
			ID:         "mem-bosn",
			Content:    "Bosn每天工作时间是08:00~23:00",
			Confidence: &confidence,
		}},
		0.8,
	)

	if decision.stop {
		t.Fatal("expected single-token keyword query not to stop chain recall")
	}
	if decision.eligible {
		t.Fatal("expected single-token keyword query to be stop ineligible")
	}
	if decision.blockedReason != "single_token_query" {
		t.Fatalf("blocked reason = %q, want single_token_query", decision.blockedReason)
	}
}

func TestChainRecallStopDecision_AllowsSpecificQuestionsAboveThreshold(t *testing.T) {
	confidence := 85

	decision := chainRecallStopDecision(
		buildRecallQueryProfile("what timezone does Bosn use"),
		[]domain.Memory{{ID: "mem-timezone", Confidence: &confidence}},
		0.8,
	)

	if !decision.stop {
		t.Fatalf("expected specific question with confidence %d to stop chain recall", confidence)
	}
	if !decision.eligible {
		t.Fatalf("expected specific question to be stop eligible, blocked by %q", decision.blockedReason)
	}
}

func TestChainRecallStopDecision_RequiresConfiguredConfidenceThreshold(t *testing.T) {
	confidence := 70

	decision := chainRecallStopDecision(
		buildRecallQueryProfile("what timezone does Bosn use"),
		[]domain.Memory{{ID: "mem-timezone", Confidence: &confidence}},
		0.8,
	)
	if decision.stop {
		t.Fatal("expected confidence below the default 80 threshold not to stop chain recall")
	}

	nextConfidence := 72
	decision = chainRecallStopDecision(
		buildRecallQueryProfile("what timezone does Bosn use"),
		[]domain.Memory{{ID: "mem-timezone", Confidence: &nextConfidence}},
		0.7,
	)
	if !decision.stop {
		t.Fatal("expected confidence above configured 70 threshold to stop chain recall")
	}
}

func TestChainRecallStopDecision_BlocksEnumerationQueries(t *testing.T) {
	confidence := 95

	decision := chainRecallStopDecision(
		buildRecallQueryProfile("what projects has Bosn done"),
		[]domain.Memory{{ID: "mem-project", Confidence: &confidence}},
		0.8,
	)

	if decision.stop {
		t.Fatal("expected enumeration query not to stop chain recall")
	}
	if decision.eligible {
		t.Fatal("expected enumeration query to be stop ineligible")
	}
	if decision.blockedReason != "enumeration_query" {
		t.Fatalf("blocked reason = %q, want enumeration_query", decision.blockedReason)
	}
}

func TestChainRecallStopConfidenceThreshold_ConvertsFractionToPercent(t *testing.T) {
	tests := []struct {
		name      string
		threshold float64
		want      int
	}{
		{name: "default", threshold: 0.8, want: 80},
		{name: "recommended floor", threshold: 0.7, want: 70},
		{name: "clamps low", threshold: -1, want: 0},
		{name: "clamps high", threshold: 1.3, want: 100},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := chainRecallStopConfidenceThreshold(tt.threshold); got != tt.want {
				t.Fatalf("threshold = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestFinalizeChainMemories_QueryModeSortsAndClipsByConfidence(t *testing.T) {
	now := time.Now()
	lowConfidence := 55
	lowScore := 99.0
	midConfidence := 75
	midScore := 2.0
	highConfidence := 90
	highScore := 1.0

	got := finalizeChainMemories([]domain.Memory{
		{ID: "low-confidence-high-score", Score: &lowScore, Confidence: &lowConfidence, UpdatedAt: now},
		{ID: "mid-confidence", Score: &midScore, Confidence: &midConfidence, UpdatedAt: now.Add(-time.Minute)},
		{ID: "high-confidence", Score: &highScore, Confidence: &highConfidence, UpdatedAt: now.Add(-2 * time.Minute)},
	}, domain.MemoryFilter{}, 2, 0, true)

	if len(got) != 2 {
		t.Fatalf("memories = %d, want 2", len(got))
	}
	if got[0].ID != "high-confidence" || got[1].ID != "mid-confidence" {
		t.Fatalf("ordered IDs = [%s, %s], want high-confidence then mid-confidence", got[0].ID, got[1].ID)
	}
}
