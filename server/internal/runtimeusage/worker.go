package runtimeusage

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/qiffang/mnemos/server/internal/metering"
	"github.com/qiffang/mnemos/server/internal/metrics"
)

type Worker struct {
	store        workerStore
	client       QuotaClient
	metering     metering.Writer
	logger       *slog.Logger
	pollInterval time.Duration
	batchSize    int
}

type workerStore interface {
	PendingRows(ctx context.Context, limit int) ([]outboxRow, error)
	MarkOperationDone(ctx context.Context, operationID string, reason string) error
	MarkOperationRetryableFailure(ctx context.Context, operationID string, reason string) error
	MarkUnknownAfterCrash(ctx context.Context, operationID string, reason string) error
	DeferPending(ctx context.Context, operationID string, reason string) error
}

func NewWorker(store *SQLStore, client QuotaClient, writer metering.Writer, logger *slog.Logger) *Worker {
	return newWorker(store, client, writer, logger)
}

func newWorker(store workerStore, client QuotaClient, writer metering.Writer, logger *slog.Logger) *Worker {
	if logger == nil {
		logger = slog.Default()
	}
	return &Worker{
		store:        store,
		client:       client,
		metering:     writer,
		logger:       logger,
		pollInterval: 30 * time.Second,
		batchSize:    100,
	}
}

func (w *Worker) Run(ctx context.Context) error {
	if w == nil || w.store == nil || w.client == nil {
		return nil
	}
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	for {
		if err := w.runOnce(ctx); err != nil && ctx.Err() == nil {
			w.logger.WarnContext(ctx, "runtime usage outbox poll failed", "err", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (w *Worker) runOnce(ctx context.Context) error {
	rows, err := w.store.PendingRows(ctx, w.batchSize)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		w.processRow(ctx, row)
	}
	return nil
}

func (w *Worker) processRow(ctx context.Context, row outboxRow) {
	if row.SubjectVersion != subjectVersionTenantIDV1 {
		w.markUnknown(ctx, row, "unsupported subject version")
		return
	}
	var payload outboxPayload
	if err := json.Unmarshal(row.PayloadJSON, &payload); err != nil {
		w.markUnknown(ctx, row, "invalid outbox payload")
		return
	}

	switch row.Step {
	case outboxStepCommitReservation:
		w.processCommit(ctx, row, payload)
	case outboxStepReleaseReservation:
		w.processRelease(ctx, row, payload)
	case outboxStepApplyAdjustment:
		w.processAdjustment(ctx, row, payload)
	case outboxStepSubmitMetering:
		w.requeueMetering(ctx, row, payload)
	default:
		w.markUnknown(ctx, row, "unsupported outbox step")
	}
}

func (w *Worker) processCommit(ctx context.Context, row outboxRow, payload outboxPayload) {
	if row.Phase == outboxPhaseReservedActive {
		w.markUnknownIfExpired(ctx, row, "reserved operation expired before success/failure was persisted")
		return
	}
	if row.Phase != outboxPhaseCommitPending {
		w.markUnknown(ctx, row, "commit worker saw unsupported phase")
		return
	}
	subject := rowSubject(row)
	if err := w.client.FinalizeReservation(ctx, subject, row.OperationID, ReservationStatusCommitted, payload.Reason); err != nil {
		w.markRetryable(ctx, row, err)
		return
	}
	w.recordPayloadEvent(ctx, row, payload)
}

func (w *Worker) processRelease(ctx context.Context, row outboxRow, payload outboxPayload) {
	if row.Phase != outboxPhaseReleasePending {
		w.markUnknown(ctx, row, "release worker saw unsupported phase")
		return
	}
	subject := rowSubject(row)
	if err := w.client.FinalizeReservation(ctx, subject, row.OperationID, ReservationStatusReleased, payload.Reason); err != nil {
		w.markRetryable(ctx, row, err)
		return
	}
	if err := w.store.MarkOperationDone(ctx, row.OperationID, "reservationReleased"); err != nil {
		w.logger.WarnContext(ctx, "runtime usage outbox mark done failed", "operation_id", row.OperationID, "err", err)
	}
}

func (w *Worker) processAdjustment(ctx context.Context, row outboxRow, payload outboxPayload) {
	if row.Phase == outboxPhaseAdjustmentIntent {
		w.markUnknownIfExpired(ctx, row, "adjustment intent expired before success/failure was persisted")
		return
	}
	if row.Phase != outboxPhaseAdjustmentPending {
		w.markUnknown(ctx, row, "adjustment worker saw unsupported phase")
		return
	}
	subject := rowSubject(row)
	adj := Adjustment{
		OperationID: row.OperationID,
		Meter:       payload.Meter,
		Delta:       payload.Delta,
		Reason:      payload.Reason,
	}
	if err := w.client.ApplyAdjustment(ctx, subject, adj); err != nil {
		w.markRetryable(ctx, row, err)
		return
	}
	w.recordPayloadEvent(ctx, row, payload)
}

func (w *Worker) requeueMetering(ctx context.Context, row outboxRow, payload outboxPayload) {
	if row.Phase != outboxPhaseMeteringPending {
		w.markUnknown(ctx, row, "metering worker saw unsupported phase")
		return
	}
	if w.metering == nil || payload.Event == nil {
		w.markRetryable(ctx, row, errString("metering writer or payload missing"))
		return
	}
	if err := w.store.DeferPending(ctx, row.OperationID, "metering event requeued"); err != nil {
		w.logger.WarnContext(ctx, "runtime usage metering requeue defer failed", "operation_id", row.OperationID, "err", err)
	}
	w.metering.Record(eventFromOutbox(row, *payload.Event))
}

func (w *Worker) recordPayloadEvent(ctx context.Context, row outboxRow, payload outboxPayload) {
	if payload.Event == nil {
		if err := w.store.MarkOperationDone(ctx, row.OperationID, "quotaFinalized"); err != nil {
			w.logger.WarnContext(ctx, "runtime usage outbox mark done failed", "operation_id", row.OperationID, "err", err)
		}
		return
	}
	if w.metering == nil {
		w.markRetryable(ctx, row, errString("metering writer missing"))
		return
	}
	w.metering.Record(eventFromOutbox(row, *payload.Event))
}

func (w *Worker) markUnknownIfExpired(ctx context.Context, row outboxRow, reason string) {
	if row.ExpiresAt.IsZero() || time.Now().UTC().Before(row.ExpiresAt.UTC().Add(2*time.Minute)) {
		if err := w.store.DeferPending(ctx, row.OperationID, reason); err != nil {
			w.logger.WarnContext(ctx, "runtime usage outbox defer failed", "operation_id", row.OperationID, "err", err)
		}
		return
	}
	w.markUnknown(ctx, row, reason)
}

func (w *Worker) markUnknown(ctx context.Context, row outboxRow, reason string) {
	if err := w.store.MarkUnknownAfterCrash(ctx, row.OperationID, reason); err != nil {
		w.logger.WarnContext(ctx, "runtime usage outbox unknown mark failed", "operation_id", row.OperationID, "err", err)
	}
	metrics.RuntimeUsageManualReconciliationTotal.WithLabelValues("unknown_after_crash").Inc()
	metrics.RuntimeUsageReservationUnknownTotal.WithLabelValues(row.Phase).Inc()
	w.logger.ErrorContext(ctx, "manual_reconciliation_required: runtime usage outbox unknown",
		"operation_id", row.OperationID,
		"tenant_id", row.TenantID,
		"cluster_id", row.ClusterID,
		"phase", row.Phase,
		"reason", reason,
	)
}

func (w *Worker) markRetryable(ctx context.Context, row outboxRow, err error) {
	if err := w.store.MarkOperationRetryableFailure(ctx, row.OperationID, err.Error()); err != nil {
		w.logger.WarnContext(ctx, "runtime usage outbox retry update failed", "operation_id", row.OperationID, "err", err)
	}
}

func rowSubject(row outboxRow) Subject {
	return Subject{
		TenantID:      row.TenantID,
		ClusterID:     row.ClusterID,
		APIKeySubject: row.TenantID,
	}
}

func eventFromOutbox(row outboxRow, payload outboxMeteringPayload) metering.Event {
	apiKeySubject := payload.APIKeySubject
	if apiKeySubject == "" {
		apiKeySubject = row.TenantID
	}
	return metering.Event{
		Category:      "runtime-usage",
		TenantID:      row.TenantID,
		ClusterID:     row.ClusterID,
		AgentID:       payload.AgentName,
		OperationID:   row.OperationID,
		APIKeySubject: apiKeySubject,
		EventType:     payload.EventType,
		Meter:         payload.Meter,
		Units:         payload.Units,
		OccurredAt:    payload.OccurredAt.UTC(),
		MemoryIDs:     append([]string(nil), payload.MemoryIDs...),
	}
}

type errString string

func (e errString) Error() string {
	return string(e)
}
