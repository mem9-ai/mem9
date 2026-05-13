package runtimeusage

import (
	"context"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metering"
)

type fakeQuotaClient struct {
	reserveOps       []Operation
	finalized        []string
	adjusted         []Adjustment
	finalizeSubjects []Subject
	adjustSubjects   []Subject
	err              error
	reserveErr       error
	finalizeErr      error
	adjustErr        error
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

func (c *fakeQuotaClient) ApplyAdjustment(_ context.Context, subject Subject, adj Adjustment) error {
	if c.adjustErr != nil {
		return c.adjustErr
	}
	if c.err != nil {
		return c.err
	}
	c.adjusted = append(c.adjusted, adj)
	c.adjustSubjects = append(c.adjustSubjects, subject)
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
	reservedActive    int
	commitPending     int
	releasePending    int
	adjustmentIntent  int
	adjustmentDone    int
	adjustmentPending int
	done              int
	retryable         int
	unknown           int
	commitErr         error
}

func (s *fakeOutboxStore) StoreReservedActive(context.Context, *OperationLease, *Reservation, time.Time) error {
	s.reservedActive++
	return nil
}

func (s *fakeOutboxStore) StoreCommitPending(context.Context, *OperationLease, MeteringEvent) error {
	s.commitPending++
	return s.commitErr
}

func (s *fakeOutboxStore) StoreReleasePending(context.Context, *OperationLease, string) error {
	s.releasePending++
	return nil
}

func (s *fakeOutboxStore) StoreAdjustmentIntent(context.Context, *OperationLease, MemoryDeleteTarget, time.Time) error {
	s.adjustmentIntent++
	return nil
}

func (s *fakeOutboxStore) StoreAdjustmentDone(context.Context, string, string) error {
	s.adjustmentDone++
	return nil
}

func (s *fakeOutboxStore) StoreAdjustmentPending(context.Context, *OperationLease, Adjustment, MeteringEvent) error {
	s.adjustmentPending++
	return nil
}

func (s *fakeOutboxStore) MarkOperationDone(context.Context, string, string) error {
	s.done++
	return nil
}

func (s *fakeOutboxStore) MarkOperationRetryableFailure(context.Context, string, string) error {
	s.retryable++
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

	if len(quota.reserveOps) != 1 || quota.reserveOps[0].Meter != MeterRecalls || quota.reserveOps[0].Units != 1 {
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
	if evt.APIKeySubject != "tenant-a" || evt.EventType != EventTypeRecall || evt.Meter != MeterRecalls || evt.Units != 1 {
		t.Fatalf("unexpected event: %+v", evt)
	}
}

func TestManagerDeleteZeroDeltaSkipsAdjustmentAndMetering(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	manager := NewManager(Config{Enabled: true}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject, MemoryDeleteTarget{MemoryIDs: []string{"mem-1"}})
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	if err := manager.AfterMemoryDeleteSuccess(context.Background(), lease, MemoryDeleteResult{MemorySlotsDelta: 0}); err != nil {
		t.Fatalf("AfterMemoryDeleteSuccess: %v", err)
	}
	if len(quota.adjusted) != 0 {
		t.Fatalf("adjustments = %+v, want none", quota.adjusted)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none", writer.events)
	}
}

func TestManagerDeletePositiveDeltaMarksUnknownAndSkipsAdjustment(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject, MemoryDeleteTarget{MemoryIDs: []string{"mem-1"}})
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	err = manager.AfterMemoryDeleteSuccess(context.Background(), lease, MemoryDeleteResult{
		MemoryIDs:        []string{"mem-1"},
		MemorySlotsDelta: 1,
		AgentName:        "Codex",
	})
	if err == nil {
		t.Fatal("AfterMemoryDeleteSuccess error = nil, want positive delta error")
	}
	if len(quota.adjusted) != 0 {
		t.Fatalf("adjustments = %+v, want none", quota.adjusted)
	}
	if outbox.adjustmentIntent != 1 || outbox.adjustmentPending != 0 || outbox.unknown != 1 {
		t.Fatalf("outbox = %+v, want adjustment intent marked unknown without pending adjustment", outbox)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none", writer.events)
	}
}

func TestManagerMemoryDeleteFailureNotFoundMarksAdjustmentDone(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject, MemoryDeleteTarget{MemoryIDs: []string{"mem-1"}})
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	manager.AfterMemoryDeleteFailure(context.Background(), lease, domain.ErrNotFound)

	if outbox.adjustmentIntent != 1 || outbox.adjustmentDone != 1 || outbox.unknown != 0 {
		t.Fatalf("outbox = %+v, want adjustment intent done without unknown", outbox)
	}
}

func TestManagerMemoryDeleteFailureAmbiguousMarksUnknown(t *testing.T) {
	quota := &fakeQuotaClient{}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject, MemoryDeleteTarget{MemoryIDs: []string{"mem-1"}})
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	manager.AfterMemoryDeleteFailure(context.Background(), lease, errString("delete commit failed"))

	if outbox.adjustmentIntent != 1 || outbox.unknown != 1 || outbox.adjustmentDone != 0 {
		t.Fatalf("outbox = %+v, want adjustment intent marked unknown", outbox)
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

	if outbox.reservedActive != 1 || outbox.commitPending != 1 || outbox.retryable != 1 {
		t.Fatalf("outbox = %+v, want reserved, commit pending, retryable", outbox)
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

	if outbox.reservedActive != 1 || outbox.commitPending != 1 || outbox.retryable != 1 {
		t.Fatalf("outbox = %+v, want reserved, commit pending, retryable", outbox)
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

func TestManagerAdjustmentFailureWithOutboxQueuesRetryAndReturnsSuccess(t *testing.T) {
	quota := &fakeQuotaClient{adjustErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	outbox := &fakeOutboxStore{}
	manager := NewManager(Config{Enabled: true, Outbox: outbox}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject, MemoryDeleteTarget{MemoryIDs: []string{"mem-1"}})
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	err = manager.AfterMemoryDeleteSuccess(context.Background(), lease, MemoryDeleteResult{
		MemoryIDs:        []string{"mem-1"},
		MemorySlotsDelta: -1,
		AgentName:        "Codex",
	})
	if err != nil {
		t.Fatalf("AfterMemoryDeleteSuccess: %v", err)
	}

	if outbox.adjustmentIntent != 1 || outbox.adjustmentPending != 1 || outbox.retryable != 1 {
		t.Fatalf("outbox = %+v, want adjustment intent, adjustment pending, retryable", outbox)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before quota adjustment", writer.events)
	}
}

func TestManagerAdjustmentFailureWithoutOutboxReturnsError(t *testing.T) {
	quota := &fakeQuotaClient{adjustErr: &UnavailableError{Err: errString("timeout")}}
	writer := &captureWriter{}
	manager := NewManager(Config{Enabled: true}, quota, writer, nil)
	subject := Subject{TenantID: "tenant-a", ClusterID: "cluster-a", APIKeySubject: "tenant-a", AgentName: "Codex"}

	lease, err := manager.BeforeMemoryDelete(context.Background(), subject, MemoryDeleteTarget{MemoryIDs: []string{"mem-1"}})
	if err != nil {
		t.Fatalf("BeforeMemoryDelete: %v", err)
	}
	err = manager.AfterMemoryDeleteSuccess(context.Background(), lease, MemoryDeleteResult{
		MemoryIDs:        []string{"mem-1"},
		MemorySlotsDelta: -1,
		AgentName:        "Codex",
	})
	if err == nil {
		t.Fatal("AfterMemoryDeleteSuccess error = nil, want adjustment error without outbox")
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none before quota adjustment", writer.events)
	}
}

func TestManagerRecallCommitPendingFailureReleasesReservation(t *testing.T) {
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
	if err == nil {
		t.Fatal("AfterRecallSuccess error = nil, want commit pending error")
	}

	wantFinalize := lease.OperationID + ":" + ReservationStatusReleased + ":recallCommitPendingFailed"
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if outbox.releasePending != 1 || outbox.done != 1 {
		t.Fatalf("outbox release state = %+v, want release pending and done", outbox)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none", writer.events)
	}
}

func TestManagerMemoryCreateCommitPendingFailureReleasesReservation(t *testing.T) {
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
	if err == nil {
		t.Fatal("AfterMemoryCreateSuccess error = nil, want commit pending error")
	}

	wantFinalize := lease.OperationID + ":" + ReservationStatusReleased + ":memoryCreateCommitPendingFailed"
	if len(quota.finalized) != 1 || quota.finalized[0] != wantFinalize {
		t.Fatalf("finalized = %+v, want [%s]", quota.finalized, wantFinalize)
	}
	if outbox.releasePending != 1 || outbox.done != 1 {
		t.Fatalf("outbox release state = %+v, want release pending and done", outbox)
	}
	if len(writer.events) != 0 {
		t.Fatalf("metering events = %+v, want none", writer.events)
	}
}
