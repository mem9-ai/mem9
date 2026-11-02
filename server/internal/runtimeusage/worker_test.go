package runtimeusage

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/secrets"
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

func (s *fakeWorkerStore) DecryptAPIKeySubjects(context.Context, *outboxPayload) error {
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

func TestWorkerDecryptsPendingSubjectsBeforeSending(t *testing.T) {
	protector, err := secrets.New(runtimeUsageTestKeyring(t), encrypt.NewPlainEncryptor(), secrets.WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New protector: %v", err)
	}
	subjectEncryptor := protector.For(secrets.FieldOutboxAPIKeySubject)
	stored, err := subjectEncryptor.Encrypt(context.Background(), "api-key-subject")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	payloadJSON, err := json.Marshal(outboxPayload{
		APIKeySubject: stored,
		Reason:        reservationCommitReason,
		Event: &outboxMeteringPayload{
			APIKeySubject: stored,
			EventType:     EventTypeMemoryRecall,
			Meter:         MeterMemoryRecallRequests,
			Units:         1,
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	rec := &recordingStore{}
	store := NewSQLStore(newRecordingDB(t, rec), "tidb", subjectEncryptor)
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	worker := NewWorker(store, quota, writer, nil)
	worker.processRow(context.Background(), outboxRow{
		OperationID:    "op-decrypt",
		TenantID:       "tenant-a",
		SubjectVersion: subjectVersionTenantIDV1,
		Step:           outboxStepCommitReservation,
		Phase:          outboxPhaseCommitPending,
		PayloadJSON:    payloadJSON,
	})

	if len(quota.finalizeSubjects) != 1 || quota.finalizeSubjects[0].APIKeySubject != "api-key-subject" {
		t.Fatalf("finalize subjects = %+v", quota.finalizeSubjects)
	}
	if len(writer.events) != 1 || writer.events[0].APIKeySubject != "api-key-subject" {
		t.Fatalf("events = %+v", writer.events)
	}
}

func TestWorkerDecryptFailureDoesNotSendStoredValue(t *testing.T) {
	protector, err := secrets.New(runtimeUsageTestKeyring(t), encrypt.NewPlainEncryptor(), secrets.WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New protector: %v", err)
	}
	subjectEncryptor := protector.For(secrets.FieldOutboxAPIKeySubject)
	stored, err := subjectEncryptor.Encrypt(context.Background(), "api-key-subject")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	replacement := "A"
	if strings.HasSuffix(stored, replacement) {
		replacement = "B"
	}
	stored = stored[:len(stored)-1] + replacement
	payloadJSON, err := json.Marshal(outboxPayload{APIKeySubject: stored})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	rec := &recordingStore{}
	store := NewSQLStore(newRecordingDB(t, rec), "tidb", subjectEncryptor)
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	worker := NewWorker(store, quota, writer, nil)
	worker.processRow(context.Background(), outboxRow{
		OperationID:    "op-decrypt-failure",
		TenantID:       "tenant-a",
		SubjectVersion: subjectVersionTenantIDV1,
		Step:           outboxStepReleaseReservation,
		Phase:          outboxPhaseReleasePending,
		PayloadJSON:    payloadJSON,
	})

	if len(quota.finalizeSubjects) != 0 || len(writer.events) != 0 {
		t.Fatalf("decrypt failure sent quota=%+v events=%+v", quota.finalizeSubjects, writer.events)
	}
	if len(rec.execs) != 1 {
		t.Fatalf("retry exec count = %d, want 1", len(rec.execs))
	}
	if got := rec.execs[0].args[1].Value; got != "decrypt api key subject failed" {
		t.Fatalf("retry reason = %v", got)
	}
	if strings.Contains(rec.execs[0].query, stored) {
		t.Fatal("retry query leaked stored value")
	}
}
