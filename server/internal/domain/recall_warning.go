package domain

import "context"

const RecallWarningFTSCandidateBudgetExhausted = "fts_candidate_budget_exhausted"

type RecallWarning struct {
	Code   string `json:"code"`
	Branch string `json:"branch"`
}

type recallWarningRecorderKey struct{}

func WithRecallWarningRecorder(ctx context.Context, record func(RecallWarning)) context.Context {
	return context.WithValue(ctx, recallWarningRecorderKey{}, record)
}

func RecordRecallWarning(ctx context.Context, warning RecallWarning) {
	record, _ := ctx.Value(recallWarningRecorderKey{}).(func(RecallWarning))
	if record != nil {
		record(warning)
	}
}
