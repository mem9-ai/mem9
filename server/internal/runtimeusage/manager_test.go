package runtimeusage

import (
	"context"
	"testing"

	"github.com/qiffang/mnemos/server/internal/metering"
)

type fakeQuotaClient struct {
	reserveOps       []Operation
	finalized        []string
	finalizeSubjects []Subject
	err              error
	reserveErr       error
	finalizeErr      error
}

func (c *fakeQuotaClient) Reserve(_ context.Context, _ Subject, operationID string, op Operation) (*Reservation, error) {
	if c.reserveErr != nil {
		return nil, c.reserveErr
	}
	if c.err != nil {
		return nil, c.err
	}
	c.reserveOps = append(c.reserveOps, op)
	return &Reservation{OperationID: operationID, Meter: op.Meter, Units: op.Units, Status: "reserved"}, nil
}

func (c *fakeQuotaClient) FinalizeReservation(_ context.Context, subject Subject, operationID string, status string, reason string) error {
	if c.finalizeErr != nil {
		return c.finalizeErr
	}
	if c.err != nil {
		return c.err
	}
	c.finalized = append(c.finalized, operationID+":"+status+":"+reason)
	c.finalizeSubjects = append(c.finalizeSubjects, subject)
	return nil
}

type captureWriter struct {
	events []metering.Event
}

func (w *captureWriter) Record(evt metering.Event) {
	w.events = append(w.events, evt)
}

func (w *captureWriter) Close(context.Context) error { return nil }

type fakeOutboxStore struct {
	commitPending  int
	releasePending int
	done           int
	retryable      int
	unknown        int
	commitErr      error
	releaseReasons []string
	retryReasons   []string
}

func (s *fakeOutboxStore) StoreCommitPending(context.Context, *OperationLease, MeteringEvent) error {
	s.commitPending++
	return s.commitErr
}

func (s *fakeOutboxStore) StoreReleasePending(_ context.Context, _ *OperationLease, reason string) error {
	s.releasePending++
	s.releaseReasons = append(s.releaseReasons, reason)
	return nil
}

func (s *fakeOutboxStore) MarkOperationDone(context.Context, string, string) error {
	s.done++
	return nil
}

func (s *fakeOutboxStore) MarkOperationRetryableFailure(_ context.Context, _ string, reason string) error {
	s.retryable++
	s.retryReasons = append(s.retryReasons, reason)
	return nil
}

func (s *fakeOutboxStore) MarkUnknownAfterCrash(context.Context, string, string) error {
	s.unknown++
	return nil
}

func TestManagerRecallCommitsBeforeMetering(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	manager := NewManager(Config{Enabled: true}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeRecall(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	if err := manager.AfterRecallSuccess(context.Background(), lease, RecallResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"}); err != nil {
		t.Fatalf("AfterRecallSuccess: %v", err)
	}

	if len(quota.reserveOps) != 1 || quota.reserveOps[0].Meter != MeterMemoryRecallRequests || quota.reserveOps[0].Units != 1 {
		t.Fatalf("reserve ops = %+v", quota.reserveOps)
	}
	wantFinalize := lease.OperationID + ":" + ReservationStatusCommitted + ":" + reservationCommitReason
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if len(writer.events) != 1 {
		t.Fatalf("metering events = %+v", writer.events)
	}
	evt := writer.events[0]
	if evt.OperationID != lease.OperationID {
		t.Fatalf("event OperationID = %q, want %q", evt.OperationID, lease.OperationID)
	}
	if evt.APIKeySubject != "tenant-a" || evt.EventType != EventTypeMemoryRecall || evt.Meter != MeterMemoryRecallRequests || evt.Units != 1 {
		t.Fatalf("unexpected event: %+v", evt)
	}
}

func TestManagerMemoryDeleteUsesWriteRequestMeter(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	manager := NewManager(Config{Enabled: true}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	if err := manager.AfterMemoryDeleteSuccess(context.Background(), lease, MemoryDeleteResult{
		MemoryIDs:       []string{"mem-1"},
		AgentName:       "Codex",
		ObjectsAffected: 1,
	}); err != nil {
		t.Fatalf("AfterMemoryDeleteSuccess: %v", err)
	}
	if len(quota.reserveOps) != 1 || quota.reserveOps[0].Meter != MeterMemoryWriteRequests || quota.reserveOps[0].Units != 1 {
		t.Fatalf("reserve ops = %+v", quota.reserveOps)
	}
	wantFinalize := lease.OperationID + ":" + ReservationStatusCommitted + ":" + reservationCommitReason
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if len(writer.events) != 1 {
		t.Fatalf("metering events = %+v, want one", writer.events)
	}
	evt := writer.events[0]
	if evt.EventType != EventTypeMemoryDeleted || evt.Meter != MeterMemoryWriteRequests || evt.Units != 1 {
		t.Fatalf("unexpected event: %+v", evt)
	}
	if evt.Metadata["objectsAffected"] != int64(1) {
		t.Fatalf("metadata = %+v, want objectsAffected=1", evt.Metadata)
	}
}

func TestManagerMemoryUpdateUsesWriteRequestMeter(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	manager := NewManager(Config{Enabled: true}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryUpdate(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeMemoryUpdate: %v", err)
	}
	if err := manager.AfterMemoryUpdateSuccess(context.Background(), lease, MemoryUpdateResult{
		MemoryIDs:       []string{"mem-1"},
		AgentName:       "Codex",
		ObjectsAffected: 1,
	}); err != nil {
		t.Fatalf("AfterMemoryUpdateSuccess: %v", err)
	}
	if len(quota.reserveOps) != 1 || quota.reserveOps[0].Meter != MeterMemoryWriteRequests || quota.reserveOps[0].Units != 1 {
		t.Fatalf("reserve ops = %+v", quota.reserveOps)
	}
	wantFinalize := lease.OperationID + ":" + ReservationStatusCommitted + ":" + reservationCommitReason
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if len(writer.events) != 1 {
		t.Fatalf("metering events = %+v, want one", writer.events)
	}
	evt := writer.events[0]
	if evt.EventType != EventTypeMemoryUpdated || evt.Meter != MeterMemoryWriteRequests || evt.Units != 1 {
		t.Fatalf("unexpected event: %+v", evt)
	}
	if evt.Metadata["objectsAffected"] != int64(1) {
		t.Fatalf("metadata = %+v, want objectsAffected=1", evt.Metadata)
	}
}

func TestManagerMemoryDeleteFailureReleasesReservation(t *testing.T) {
	quota := &fakeQuotaClient{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, &captureWriter{}, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	manager.AfterMemoryDeleteFailure(context.Background(), lease, errString("delete commit failed"))

	wantFinalize := lease.OperationID + ":" + ReservationStatusReleased + ":" + reservationReleaseOperationFailed
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if outbox.releasePending != 1 {
		t.Fatalf("outbox = %+v, want release pending", outbox)
	}
}

func TestManagerFailOpenDoesNotBypassQuotaDenied(t *testing.T) {
	quota := &fakeQuotaClient{reserveErr: &QuotaDeniedError{StatusCode: 402}}
	manager := NewManager(Config{Enabled: true, FailOpen: true}, quota, &captureWriter{}, nil)

	lease, err := manager.BeforeRecall(context.Background(), Subject{TenantID: "tenant-a", APIKeySubject: "tenant-a"})
	if err == nil {
		t.Fatal("BeforeRecall error = nil, want quota denied")
	}
	if lease != nil {
		t.Fatalf("lease = %+v, want nil", lease)
	}
}

func TestManagerCommitFailureWithOutboxQueuesRetryAndReturnsSuccess(t *testing.T) {
	quota := &fakeQuotaClient{finalizeErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeRecall(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	err = manager.AfterRecallSuccess(context.Background(), lease, RecallResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"})
	if err != nil {
		t.Fatalf("AfterRecallSuccess: %v", err)
	}

	if outbox.commitPending != 1 || outbox.retryable != 1 {
		t.Fatalf("outbox = %+v, want recall commit pending and retryable without active reservation write", outbox)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before quota commit", writer.events)
	}
}

func TestManagerMemoryCreateCommitFailureWithOutboxQueuesRetryAndReturnsSuccess(t *testing.T) {
	quota := &fakeQuotaClient{finalizeErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryCreate(context.Background(), subject, 1)
	if err != nil {
		t.Fatalf("BeforeMemoryCreate: %v", err)
	}
	err = manager.AfterMemoryCreateSuccess(context.Background(), lease, MemoryCreateResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"})
	if err != nil {
		t.Fatalf("AfterMemoryCreateSuccess: %v", err)
	}

	if outbox.commitPending != 1 || outbox.retryable != 1 {
		t.Fatalf("outbox = %+v, want memory create commit pending and retryable without active reservation write", outbox)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before quota commit", writer.events)
	}
}

func TestManagerCommitFailureWithoutOutboxReturnsError(t *testing.T) {
	quota := &fakeQuotaClient{finalizeErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	manager := NewManager(Config{Enabled: true}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeRecall(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	err = manager.AfterRecallSuccess(context.Background(), lease, RecallResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"})
	if err == nil {
		t.Fatal("AfterRecallSuccess error = nil, want finalize error without outbox")
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before quota commit", writer.events)
	}
}

func TestManagerMemoryDeleteCommitFailureWithOutboxQueuesRetryAndReturnsSuccess(t *testing.T) {
	quota := &fakeQuotaClient{finalizeErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	err = manager.AfterMemoryDeleteSuccess(context.Background(), lease, MemoryDeleteResult{
		MemoryIDs:       []string{"mem-1"},
		AgentName:       "Codex",
		ObjectsAffected: 1,
	})
	if err != nil {
		t.Fatalf("AfterMemoryDeleteSuccess: %v", err)
	}

	if outbox.commitPending != 1 || outbox.retryable != 1 {
		t.Fatalf("outbox = %+v, want commit pending and retryable", outbox)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before quota commit", writer.events)
	}
}

func TestManagerMemoryDeleteCommitFailureWithoutOutboxReturnsError(t *testing.T) {
	quota := &fakeQuotaClient{finalizeErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	manager := NewManager(Config{Enabled: true}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	err = manager.AfterMemoryDeleteSuccess(context.Background(), lease, MemoryDeleteResult{
		MemoryIDs:       []string{"mem-1"},
		AgentName:       "Codex",
		ObjectsAffected: 1,
	})
	if err == nil {
		t.Fatal("AfterMemoryDeleteSuccess error = nil, want commit error without outbox")
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before quota commit", writer.events)
	}
}

func TestManagerRecallCommitPendingFailureCommitsDirectly(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{commitErr: errString("outbox unavailable")}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeRecall(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	err = manager.AfterRecallSuccess(context.Background(), lease, RecallResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"})
	if err != nil {
		t.Fatalf("AfterRecallSuccess: %v", err)
	}

	wantFinalize := lease.OperationID + ":" + ReservationStatusCommitted + ":" + reservationCommitReason
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if outbox.releasePending != 0 || outbox.done != 1 {
		t.Fatalf("outbox release state = %+v, want no release and best-effort done after successful recall", outbox)
	}
	if len(writer.events) != 1 {
		t.Fatalf("metering events = %+v, want direct metering after commit", writer.events)
	}
}

func TestManagerMemoryCreateCommitPendingFailureCommitsDirectly(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{commitErr: errString("outbox unavailable")}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryCreate(context.Background(), subject, 1)
	if err != nil {
		t.Fatalf("BeforeMemoryCreate: %v", err)
	}
	err = manager.AfterMemoryCreateSuccess(context.Background(), lease, MemoryCreateResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"})
	if err != nil {
		t.Fatalf("AfterMemoryCreateSuccess: %v", err)
	}

	wantFinalize := lease.OperationID + ":" + ReservationStatusCommitted + ":" + reservationCommitReason
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if outbox.releasePending != 0 || outbox.done != 1 {
		t.Fatalf("outbox release state = %+v, want no release and done after successful memory create", outbox)
	}
	if len(writer.events) != 1 {
		t.Fatalf("metering events = %+v, want direct metering after commit", writer.events)
	}
}

func TestManagerCommitPendingFailureAndCommitFailureReturnsErrorWithoutRelease(t *testing.T) {
	quota := &fakeQuotaClient{finalizeErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{commitErr: errString("outbox unavailable")}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeRecall(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	err = manager.AfterRecallSuccess(context.Background(), lease, RecallResult{MemoryIDs: []string{"mem-1"}, AgentName: "Codex"})
	if err == nil {
		t.Fatal("AfterRecallSuccess error = nil, want non-durable finalization error")
	}
	if outbox.releasePending != 0 || outbox.done != 0 {
		t.Fatalf("outbox release state = %+v, want no release after successful recall", outbox)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before durable quota commit", writer.events)
	}
}

func TestManagerReleaseUsesConsoleSpecReason(t *testing.T) {
	quota := &fakeQuotaClient{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, &captureWriter{}, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeRecall(context.Background(), subject)
	if err != nil {
		t.Fatalf("BeforeRecall: %v", err)
	}
	manager.AfterRecallFailure(context.Background(), lease, context.DeadlineExceeded)

	wantFinalize := lease.OperationID + ":" + ReservationStatusReleased + ":" + reservationReleaseTimeout
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if len(outbox.releaseReasons) != 1 || outbox.releaseReasons[0] != reservationReleaseTimeout {
		t.Fatalf("release reasons = %+v, want [%s]", outbox.releaseReasons, reservationReleaseTimeout)
	}
	if len(outbox.retryReasons) != 1 || outbox.retryReasons[0] != "recallFailed: context deadline exceeded" {
		t.Fatalf("retry reasons = %+v, want local failure detail", outbox.retryReasons)
	}
}
