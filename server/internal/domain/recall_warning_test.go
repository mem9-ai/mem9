package domain

import (
	"context"
	"testing"
)

func TestRecordRecallWarningUsesContextRecorder(t *testing.T) {
	want := RecallWarning{
		Code:   RecallWarningFTSCandidateBudgetExhausted,
		Branch: string(TypeInsight),
	}
	var got []RecallWarning
	ctx := WithRecallWarningRecorder(context.Background(), func(warning RecallWarning) {
		got = append(got, warning)
	})

	if !RecordRecallWarning(ctx, want) {
		t.Fatal("RecordRecallWarning() = false, want true")
	}

	if len(got) != 1 || got[0] != want {
		t.Fatalf("warnings = %+v, want [%+v]", got, want)
	}
}

func TestRecordRecallWarningWithoutRecorderIsNoOp(t *testing.T) {
	if RecordRecallWarning(context.Background(), RecallWarning{
		Code:   RecallWarningFTSCandidateBudgetExhausted,
		Branch: string(TypePinned),
	}) {
		t.Fatal("RecordRecallWarning() = true, want false")
	}
}
