package runtimeusage

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/metering"
	"github.com/qiffang/mnemos/server/internal/metrics"
)

type manager struct {
	cfg      Config
	client   QuotaClient
	metering metering.Writer
	outbox   OutboxStore
	logger   *slog.Logger
	now      func() time.Time
}

func NewManager(cfg Config, client QuotaClient, writer metering.Writer, logger *slog.Logger) Manager {
	if logger == nil {
		logger = slog.Default()
	}
	if !cfg.Enabled {
		return noopManager{}
	}
	return &manager{
		cfg:      cfg,
		client:   client,
		metering: writer,
		outbox:   cfg.Outbox,
		logger:   logger,
		now:      time.Now,
	}
}

type noopManager struct{}

func (noopManager) Enabled() bool { return false }
func (noopManager) BeforeRecall(context.Context, Subject) (*OperationLease, error) {
	return nil, nil
}
func (noopManager) AfterRecallSuccess(context.Context, *OperationLease, RecallResult) error {
	return nil
}
func (noopManager) AfterRecallFailure(context.Context, *OperationLease, error) {}
func (noopManager) BeforeMemoryCreate(context.Context, Subject, int64) (*OperationLease, error) {
	return nil, nil
}
func (noopManager) AfterMemoryCreateSuccess(context.Context, *OperationLease, MemoryCreateResult) error {
	return nil
}
func (noopManager) AfterMemoryCreateFailure(context.Context, *OperationLease, error) {}
func (noopManager) BeforeMemoryUpdate(context.Context, Subject) (*OperationLease, error) {
	return nil, nil
}
func (noopManager) AfterMemoryUpdateSuccess(context.Context, *OperationLease, MemoryUpdateResult) error {
	return nil
}
func (noopManager) AfterMemoryUpdateFailure(context.Context, *OperationLease, error) {}
func (noopManager) BeforeMemoryDelete(context.Context, Subject) (*OperationLease, error) {
	return nil, nil
}
func (noopManager) AfterMemoryDeleteSuccess(context.Context, *OperationLease, MemoryDeleteResult) error {
	return nil
}
func (noopManager) AfterMemoryDeleteFailure(context.Context, *OperationLease, error) {}

func (m *manager) Enabled() bool { return true }

func (m *manager) BeforeRecall(ctx context.Context, subject Subject) (*OperationLease, error) {
	return m.reserve(ctx, subject, MeterMemoryRecallRequests, 1)
}

func (m *manager) AfterRecallSuccess(ctx context.Context, lease *OperationLease, result RecallResult) error {
	if lease == nil || !lease.Reserved {
		return nil
	}
	event := m.consoleMeteringEvent(lease, EventTypeMemoryRecall, result.AgentName, result.MemoryIDs, lease.Units, nil)
	if err := m.storeCommitPending(ctx, lease, event); err != nil {
		return m.commitReservationWithoutOutbox(ctx, lease, event, err)
	}
	if err := m.client.FinalizeReservation(ctx, lease.Subject, lease.OperationID, ReservationStatusCommitted, reservationCommitReason); err != nil {
		m.markRetryable(ctx, lease.OperationID, err)
		if m.outbox != nil {
			return nil
		}
		return err
	}
	m.recordConsoleMetering(lease, event)
	return nil
}

func (m *manager) AfterRecallFailure(ctx context.Context, lease *OperationLease, cause error) {
	m.release(ctx, lease, reservationReleaseReason(cause), releaseDetail("recallFailed", cause))
}

func (m *manager) BeforeMemoryCreate(ctx context.Context, subject Subject, _ int64) (*OperationLease, error) {
	return m.reserve(ctx, subject, MeterMemoryWriteRequests, 1)
}

func (m *manager) AfterMemoryCreateSuccess(ctx context.Context, lease *OperationLease, result MemoryCreateResult) error {
	if lease == nil || !lease.Reserved {
		return nil
	}
	event := m.consoleMeteringEvent(lease, EventTypeMemoryCreated, result.AgentName, result.MemoryIDs, lease.Units, objectsAffectedMetadata(result.ObjectsAffected))
	if err := m.storeCommitPending(ctx, lease, event); err != nil {
		return m.commitReservationWithoutOutbox(ctx, lease, event, err)
	}
	if err := m.client.FinalizeReservation(ctx, lease.Subject, lease.OperationID, ReservationStatusCommitted, reservationCommitReason); err != nil {
		m.markRetryable(ctx, lease.OperationID, err)
		if m.outbox != nil {
			return nil
		}
		return err
	}
	m.recordConsoleMetering(lease, event)
	return nil
}

func (m *manager) AfterMemoryCreateFailure(ctx context.Context, lease *OperationLease, cause error) {
	m.release(ctx, lease, reservationReleaseReason(cause), releaseDetail("memoryCreateFailed", cause))
}

func (m *manager) BeforeMemoryUpdate(ctx context.Context, subject Subject) (*OperationLease, error) {
	return m.reserve(ctx, subject, MeterMemoryWriteRequests, 1)
}

func (m *manager) AfterMemoryUpdateSuccess(ctx context.Context, lease *OperationLease, result MemoryUpdateResult) error {
	if lease == nil || !lease.Reserved {
		return nil
	}
	event := m.consoleMeteringEvent(lease, EventTypeMemoryUpdated, result.AgentName, result.MemoryIDs, lease.Units, objectsAffectedMetadata(result.ObjectsAffected))
	if err := m.storeCommitPending(ctx, lease, event); err != nil {
		return m.commitReservationWithoutOutbox(ctx, lease, event, err)
	}
	if err := m.client.FinalizeReservation(ctx, lease.Subject, lease.OperationID, ReservationStatusCommitted, reservationCommitReason); err != nil {
		m.markRetryable(ctx, lease.OperationID, err)
		if m.outbox != nil {
			return nil
		}
		return err
	}
	m.recordConsoleMetering(lease, event)
	return nil
}

func (m *manager) AfterMemoryUpdateFailure(ctx context.Context, lease *OperationLease, cause error) {
	m.release(ctx, lease, reservationReleaseReason(cause), releaseDetail("memoryUpdateFailed", cause))
}

func (m *manager) BeforeMemoryDelete(ctx context.Context, subject Subject) (*OperationLease, error) {
	return m.reserve(ctx, subject, MeterMemoryWriteRequests, 1)
}

func (m *manager) AfterMemoryDeleteSuccess(ctx context.Context, lease *OperationLease, result MemoryDeleteResult) error {
	if lease == nil || !lease.Reserved {
		return nil
	}
	event := m.consoleMeteringEvent(lease, EventTypeMemoryDeleted, result.AgentName, result.MemoryIDs, lease.Units, objectsAffectedMetadata(result.ObjectsAffected))
	if err := m.storeCommitPending(ctx, lease, event); err != nil {
		return m.commitReservationWithoutOutbox(ctx, lease, event, err)
	}
	if err := m.client.FinalizeReservation(ctx, lease.Subject, lease.OperationID, ReservationStatusCommitted, reservationCommitReason); err != nil {
		m.markRetryable(ctx, lease.OperationID, err)
		if m.outbox != nil {
			return nil
		}
		return err
	}
	m.recordConsoleMetering(lease, event)
	return nil
}

func (m *manager) AfterMemoryDeleteFailure(ctx context.Context, lease *OperationLease, cause error) {
	m.release(ctx, lease, reservationReleaseReason(cause), releaseDetail("memoryDeleteFailed", cause))
}

func (m *manager) reserve(ctx context.Context, subject Subject, meter string, units int64) (*OperationLease, error) {
	units = 1
	operationID, err := newOperationID()
	if err != nil {
		return nil, err
	}
	lease := &OperationLease{
		OperationID: operationID,
		Subject:     subject,
		Meter:       meter,
		Units:       units,
		Reserved:    true,
	}
	_, err = m.client.Reserve(ctx, subject, operationID, Operation{Meter: meter, Units: units})
	if err != nil {
		var denied *QuotaDeniedError
		if errors.As(err, &denied) {
			return nil, err
		}
		var conflict *ConflictError
		if errors.As(err, &conflict) {
			return nil, err
		}
		if m.cfg.FailOpen {
			m.logger.WarnContext(ctx, "runtime usage reserve failed open",
				"operation_id", operationID,
				"tenant_id", subject.TenantID,
				"cluster_id", subject.ClusterID,
				"meter", meter,
				"err", err,
			)
			lease.Reserved = false
			return lease, nil
		}
		return nil, err
	}
	return lease, nil
}

func (m *manager) release(ctx context.Context, lease *OperationLease, reason string, detail string) {
	if lease == nil || !lease.Reserved {
		return
	}
	if m.outbox != nil {
		if err := m.outbox.StoreReleasePending(ctx, lease, reason); err != nil {
			m.logger.WarnContext(ctx, "runtime usage release pending outbox failed",
				"operation_id", lease.OperationID,
				"tenant_id", lease.Subject.TenantID,
				"cluster_id", lease.Subject.ClusterID,
				"err", err,
			)
		}
		if detail != "" && detail != reason {
			m.markRetryable(ctx, lease.OperationID, errors.New(detail))
		}
	}
	if err := m.client.FinalizeReservation(ctx, lease.Subject, lease.OperationID, ReservationStatusReleased, reason); err != nil {
		m.markRetryable(ctx, lease.OperationID, err)
		m.logger.WarnContext(ctx, "runtime usage release failed",
			"operation_id", lease.OperationID,
			"tenant_id", lease.Subject.TenantID,
			"cluster_id", lease.Subject.ClusterID,
			"err", err,
		)
		return
	}
	if m.outbox != nil {
		if err := m.outbox.MarkOperationDone(ctx, lease.OperationID, "reservationReleased"); err != nil {
			m.logger.WarnContext(ctx, "runtime usage release done outbox failed",
				"operation_id", lease.OperationID,
				"tenant_id", lease.Subject.TenantID,
				"cluster_id", lease.Subject.ClusterID,
				"err", err,
			)
		}
	}
}

func (m *manager) consoleMeteringEvent(lease *OperationLease, eventType, agentName string, memoryIDs []string, units int64, metadata map[string]any) MeteringEvent {
	occurredAt := m.now().UTC().Truncate(time.Second)
	return MeteringEvent{
		EventType:  eventType,
		Meter:      lease.Meter,
		Units:      units,
		OccurredAt: occurredAt,
		AgentName:  agentName,
		MemoryIDs:  append([]string(nil), memoryIDs...),
		Metadata:   cloneMetadata(metadata),
	}
}

func (m *manager) recordConsoleMetering(lease *OperationLease, event MeteringEvent) {
	if m.metering == nil || lease == nil || event.Units == 0 {
		return
	}
	m.metering.Record(metering.Event{
		Category:      "runtime-usage",
		TenantID:      lease.Subject.TenantID,
		ClusterID:     lease.Subject.ClusterID,
		AgentID:       event.AgentName,
		OperationID:   lease.OperationID,
		APIKeySubject: lease.Subject.APIKeySubject,
		EventType:     event.EventType,
		Meter:         event.Meter,
		Units:         event.Units,
		OccurredAt:    event.OccurredAt,
		MemoryIDs:     append([]string(nil), event.MemoryIDs...),
		Metadata:      cloneMetadata(event.Metadata),
	})
}

func (m *manager) commitReservationWithoutOutbox(ctx context.Context, lease *OperationLease, event MeteringEvent, outboxErr error) error {
	if err := m.client.FinalizeReservation(ctx, lease.Subject, lease.OperationID, ReservationStatusCommitted, reservationCommitReason); err != nil {
		metrics.RuntimeUsageManualReconciliationTotal.WithLabelValues("commit_after_outbox_failed").Inc()
		m.logger.ErrorContext(ctx, "manual_reconciliation_required: runtime usage commit failed after outbox failure",
			"operation_id", lease.OperationID,
			"tenant_id", lease.Subject.TenantID,
			"cluster_id", lease.Subject.ClusterID,
			"outbox_err", outboxErr,
			"err", err,
		)
		return fmt.Errorf("runtime usage commit not durable: outbox: %v; finalize: %w", outboxErr, err)
	}
	m.markDoneBestEffort(ctx, lease, "quotaFinalizedWithoutOutbox")
	m.recordConsoleMetering(lease, event)
	return nil
}

func (m *manager) markDoneBestEffort(ctx context.Context, lease *OperationLease, reason string) {
	if m.outbox == nil || lease == nil {
		return
	}
	if err := m.outbox.MarkOperationDone(ctx, lease.OperationID, reason); err != nil {
		m.logger.WarnContext(ctx, "runtime usage outbox done update failed after direct finalization",
			"operation_id", lease.OperationID,
			"tenant_id", lease.Subject.TenantID,
			"cluster_id", lease.Subject.ClusterID,
			"err", err,
		)
	}
}

func (m *manager) storeCommitPending(ctx context.Context, lease *OperationLease, event MeteringEvent) error {
	if m.outbox == nil {
		return nil
	}
	if err := m.outbox.StoreCommitPending(ctx, lease, event); err != nil {
		metrics.RuntimeUsageManualReconciliationTotal.WithLabelValues("commit_pending_outbox_failed").Inc()
		m.logger.ErrorContext(ctx, "manual_reconciliation_required: runtime usage commit pending outbox failed",
			"operation_id", lease.OperationID,
			"tenant_id", lease.Subject.TenantID,
			"cluster_id", lease.Subject.ClusterID,
			"err", err,
		)
		return err
	}
	return nil
}

func (m *manager) markRetryable(ctx context.Context, operationID string, err error) {
	if m.outbox == nil || operationID == "" || err == nil {
		return
	}
	if markErr := m.outbox.MarkOperationRetryableFailure(ctx, operationID, err.Error()); markErr != nil {
		m.logger.WarnContext(ctx, "runtime usage retryable outbox update failed",
			"operation_id", operationID,
			"err", markErr,
		)
	}
}

func reservationReleaseReason(cause error) string {
	switch {
	case errors.Is(cause, context.Canceled):
		return reservationReleaseClientCancelled
	case errors.Is(cause, context.DeadlineExceeded):
		return reservationReleaseTimeout
	case cause == nil:
		return reservationReleaseOperationAbandoned
	default:
		return reservationReleaseOperationFailed
	}
}

func releaseDetail(prefix string, cause error) string {
	if cause == nil {
		return prefix
	}
	return fmt.Sprintf("%s: %v", prefix, cause)
}

func objectsAffectedMetadata(objectsAffected int64) map[string]any {
	if objectsAffected <= 0 {
		return nil
	}
	return map[string]any{"objectsAffected": objectsAffected}
}

func cloneMetadata(metadata map[string]any) map[string]any {
	if len(metadata) == 0 {
		return nil
	}
	out := make(map[string]any, len(metadata))
	for k, v := range metadata {
		out[k] = v
	}
	return out
}

func newOperationID() (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	return id.String(), nil
}
