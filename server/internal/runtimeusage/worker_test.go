package runtimeusage

import (
	"context"
	"testing"
)

type fakeWorkerStore struct {
	rows      []outboxRow
	done      []string
	retryable []string
	terminal  []string
	unknown   []string
	deferred  []string
}

func (s *fakeWorkerStore) PendingRows(context.Context, int) ([]outboxRow, error) {
	return append([]outboxRow(nil), s.rows...), nil
}

func (s *fakeWorkerStore) MarkOperationDone(_ context.Context, operationID string, _ string) error {
	s.done = append(s.done, operationID)
	return nil
}

func (s *fakeWorkerStore) MarkOperationRetryableFailure(_ context.Context, operationID string, _ string) error {
	s.retryable = append(s.retryable, operationID)
	return nil
}

func (s *fakeWorkerStore) MarkOperationTerminalFailed(_ context.Context, operationID string, _ string) error {
	s.terminal = append(s.terminal, operationID)
	return nil
}

func (s *fakeWorkerStore) MarkUnknownAfterCrash(_ context.Context, operationID string, _ string) error {
	s.unknown = append(s.unknown, operationID)
	return nil
}

func (s *fakeWorkerStore) DeferPending(_ context.Context, operationID string, _ string) error {
	s.deferred = append(s.deferred, operationID)
	return nil
}

func TestWorkerCommitPendingFinalizesQuotaBeforeMetering(t *testing.T) {
	row := outboxRow{
		OperationID:    "018f7f3a-7b8c-7c2d-9a5b-6d7e8f901234",
		TenantID:       "tenant-a",
		ClusterID:      "cluster-a",
		SubjectVersion: subjectVersionTenantIDV1,
		Step:           outboxStepCommitReservation,
		Phase:          outboxPhaseCommitPending,
		PayloadJSON: []byte(`{
			"meter":"memory_recall_requests",
			"units":1,
			"status":"committed",
			"reason":"operationSucceeded",
			"event":{
				"eventType":"memoryRecall",
				"meter":"memory_recall_requests",
				"units":1,
				"occurredAt":"2026-05-13T00:00:00Z",
				"agentName":"Codex",
				"memoryIds":["mem-1"]
			}
		}`),
	}
	store := &fakeWorkerStore{rows: []outboxRow{row}}
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	worker := newWorker(store, quota, writer, nil)

	if err := worker.runOnce(context.Background()); err != nil {
		t.Fatalf("runOnce: %v", err)
	}
	if len(quota.finalized) != 1 {
		t.Fatalf("finalized = %+v, want one commit", quota.finalized)
	}
	if len(writer.events) != 1 {
		t.Fatalf("events = %+v, want one metering event", writer.events)
	}
	if writer.events[0].OperationID != row.OperationID || writer.events[0].APIKeySubject != "tenant-a" {
		t.Fatalf("event = %+v", writer.events[0])
	}
	if len(store.retryable) != 0 || len(store.unknown) != 0 {
		t.Fatalf("store retryable=%+v unknown=%+v, want none", store.retryable, store.unknown)
	}
}

func TestWorkerCommitPendingReplaysStoredAPIKeySubject(t *testing.T) {
	row := outboxRow{
		OperationID:    "018f7f3a-7b8c-7c2d-9a5b-6d7e8f901234",
		TenantID:       "tenant-a",
		ClusterID:      "cluster-a",
		SubjectVersion: subjectVersionTenantIDV1,
		Step:           outboxStepCommitReservation,
		Phase:          outboxPhaseCommitPending,
		PayloadJSON: []byte(`{
			"apiKeySubject":"api-key-subject",
			"meter":"memory_recall_requests",
			"units":1,
			"status":"committed",
			"reason":"operationSucceeded",
			"event":{
				"apiKeySubject":"api-key-subject",
				"eventType":"memoryRecall",
				"meter":"memory_recall_requests",
				"units":1,
				"occurredAt":"2026-05-13T00:00:00Z",
				"agentName":"Codex",
				"memoryIds":["mem-1"]
			}
		}`),
	}
	store := &fakeWorkerStore{rows: []outboxRow{row}}
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	worker := newWorker(store, quota, writer, nil)

	if err := worker.runOnce(context.Background()); err != nil {
		t.Fatalf("runOnce: %v", err)
	}
	if len(quota.finalizeSubjects) != 1 || quota.finalizeSubjects[0].APIKeySubject != "api-key-subject" {
		t.Fatalf("finalize subjects = %+v, want stored API key subject", quota.finalizeSubjects)
	}
	if len(writer.events) != 1 || writer.events[0].APIKeySubject != "api-key-subject" {
		t.Fatalf("events = %+v, want stored API key subject", writer.events)
	}
}

func TestWorkerCommitConflictMarksTerminalFailed(t *testing.T) {
	row := outboxRow{
		OperationID:    "018f7f3a-7b8c-7c2d-9a5b-6d7e8f901234",
		TenantID:       "tenant-a",
		ClusterID:      "cluster-a",
		SubjectVersion: subjectVersionTenantIDV1,
		Step:           outboxStepCommitReservation,
		Phase:          outboxPhaseCommitPending,
		PayloadJSON:    []byte(`{"meter":"memory_recall_requests","units":1,"status":"committed","reason":"operationSucceeded"}`),
	}
	store := &fakeWorkerStore{rows: []outboxRow{row}}
	quota := &fakeQuotaClient{finalizeErr: &ConflictError{StatusCode: 409}}
	worker := newWorker(store, quota, &captureWriter{}, nil)

	if err := worker.runOnce(context.Background()); err != nil {
		t.Fatalf("runOnce: %v", err)
	}
	if len(store.terminal) != 1 || store.terminal[0] != row.OperationID {
		t.Fatalf("terminal = %+v, want operation marked terminal", store.terminal)
	}
	if len(store.retryable) != 0 {
		t.Fatalf("retryable = %+v, want none", store.retryable)
	}
}
