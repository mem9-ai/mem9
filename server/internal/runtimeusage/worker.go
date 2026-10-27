package runtimeusage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/qiffang/mnemos/server/internal/credentials"
	"github.com/qiffang/mnemos/server/internal/metering"
	"github.com/qiffang/mnemos/server/internal/metrics"
)

type Worker struct {
	credentials  *credentials.Store
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
	MarkOperationTerminalFailed(ctx context.Context, operationID string, reason string) error
	MarkUnknownAfterCrash(ctx context.Context, operationID string, reason string) error
	DeferPending(ctx context.Context, operationID string, reason string) error
}

func NewWorker(store *SQLStore, client QuotaClient, writer metering.Writer, logger *slog.Logger) *Worker {
	w := newWorker(store, client, writer, logger)
	if store != nil {
		w.credentials = store.credentials
	}
	return w
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
	if row.SubjectVersion != subjectVersionTenantIDV1 && row.SubjectVersion != subjectVersionCredentialV1 {
		w.markUnknown(ctx, row, "unsupported subject version")
		return
	}
	var payload outboxPayload
	var decodeErr error
	if row.SubjectVersion == subjectVersionCredentialV1 {
		decoder := json.NewDecoder(bytes.NewReader(row.PayloadJSON))
		decoder.UseNumber()
		decodeErr = decoder.Decode(&payload)
	} else {
		decodeErr = json.Unmarshal(row.PayloadJSON, &payload)
	}
	if decodeErr != nil {
		w.markUnknown(ctx, row, "invalid outbox payload")
		return
	}

	if w.credentials != nil {
		if row.TenantID != "" {
			id, release, err := w.credentials.HoldTenant(ctx, row.TenantID)
			if err != nil {
				w.markRetryable(ctx, row, err)
				return
			}
			defer release()
			row.TenantID = id
		} else {
			var rec *credentials.Record
			var err error
			if payload.APIKeyID != "" {
				rec, err = w.credentials.ByID(ctx, payload.APIKeyID)
			} else {
				rec, err = w.credentials.ByKey(ctx, apiKeySubjectFromOutbox(row, payload))
			}
			if err != nil || rec.Kind != "chain" {
				w.markRetryable(ctx, row, errors.New("invalid aggregate Chain subject"))
				return
			}
			_, lease, err := w.credentials.HoldRecord(ctx, rec.ID)
			if err != nil {
				w.markRetryable(ctx, row, err)
				return
			}
			defer lease.Close()
		}
	}
	if row.SubjectVersion == subjectVersionCredentialV1 {
		if w.credentials == nil || payload.APIKeyID == "" {
			w.markRetryable(ctx, row, errors.New("credential resolver unavailable"))
			return
		}
		key, err := w.credentials.Recover(ctx, payload.APIKeyID)
		if err != nil {
			w.logger.ErrorContext(ctx, "outbox credential recovery failed", "operation_id", row.OperationID)
			w.markRetryable(ctx, row, err)
			return
		}
		payload.APIKeySubject = key
		if payload.Event != nil {
			payload.Event.APIKeySubject = key
		}

	} else if w.credentials != nil && !w.credentials.Config.LegacyOutbox {
		w.markRetryable(ctx, row, errors.New("legacy outbox disabled; migrate retained rows"))
		return
	}

	switch row.Step {
	case outboxStepCommitReservation:
		w.processCommit(ctx, row, payload)
	case outboxStepReleaseReservation:
		w.processRelease(ctx, row, payload)
	case outboxStepSubmitMetering:
		w.requeueMetering(ctx, row, payload)
	default:
		w.markUnknown(ctx, row, "unsupported outbox step")
	}
}

func (w *Worker) processCommit(ctx context.Context, row outboxRow, payload outboxPayload) {
	if row.Phase != outboxPhaseCommitPending {
		w.markUnknown(ctx, row, "commit worker saw unsupported phase")
		return
	}
	subject := rowSubject(row, payload)
	if err := w.client.FinalizeReservation(ctx, subject, row.OperationID, ReservationStatusCommitted, payload.Reason); err != nil {
		w.markQuotaFailure(ctx, row, err)
		return
	}
	w.recordPayloadEvent(ctx, row, payload)
}

func (w *Worker) processRelease(ctx context.Context, row outboxRow, payload outboxPayload) {
	if row.Phase != outboxPhaseReleasePending {
		w.markUnknown(ctx, row, "release worker saw unsupported phase")
		return
	}
	subject := rowSubject(row, payload)
	if err := w.client.FinalizeReservation(ctx, subject, row.OperationID, ReservationStatusReleased, payload.Reason); err != nil {
		w.markQuotaFailure(ctx, row, err)
		return
	}
	if err := w.store.MarkOperationDone(ctx, row.OperationID, "reservationReleased"); err != nil {
		w.logger.WarnContext(ctx, "runtime usage outbox mark done failed", "operation_id", row.OperationID, "err", err)
	}
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
	w.metering.Record(eventFromOutbox(row, payload))
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
	w.metering.Record(eventFromOutbox(row, payload))
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

func (w *Worker) markQuotaFailure(ctx context.Context, row outboxRow, err error) {
	var conflict *ConflictError
	if errors.As(err, &conflict) {
		w.markTerminal(ctx, row, err)
		return
	}
	w.markRetryable(ctx, row, err)
}

func (w *Worker) markTerminal(ctx context.Context, row outboxRow, err error) {
	if err := w.store.MarkOperationTerminalFailed(ctx, row.OperationID, err.Error()); err != nil {
		w.logger.WarnContext(ctx, "runtime usage outbox terminal update failed", "operation_id", row.OperationID, "err", err)
	}
	metrics.RuntimeUsageManualReconciliationTotal.WithLabelValues("quota_conflict").Inc()
	w.logger.ErrorContext(ctx, "manual_reconciliation_required: runtime usage outbox terminal failed",
		"operation_id", row.OperationID,
		"tenant_id", row.TenantID,
		"cluster_id", row.ClusterID,
		"step", row.Step,
		"phase", row.Phase,
		"err", err,
	)
}

func rowSubject(row outboxRow, payload outboxPayload) Subject {
	return Subject{
		TenantID:      row.TenantID,
		ClusterID:     row.ClusterID,
		APIKeySubject: apiKeySubjectFromOutbox(row, payload),
	}
}

func apiKeySubjectFromOutbox(row outboxRow, payload outboxPayload) string {
	if payload.Event != nil && payload.Event.APIKeySubject != "" {
		return payload.Event.APIKeySubject
	}
	if payload.APIKeySubject != "" {
		return payload.APIKeySubject
	}
	return row.TenantID
}

func eventFromOutbox(row outboxRow, payload outboxPayload) metering.Event {
	event := payload.Event
	return metering.Event{
		Category:      "runtime-usage",
		TenantID:      row.TenantID,
		ClusterID:     row.ClusterID,
		AgentID:       event.AgentName,
		OperationID:   row.OperationID,
		APIKeySubject: apiKeySubjectFromOutbox(row, payload),
		EventType:     event.EventType,
		Meter:         event.Meter,
		Units:         event.Units,
		OccurredAt:    event.OccurredAt.UTC().Truncate(time.Second),
		MemoryIDs:     append([]string(nil), event.MemoryIDs...),
		Metadata:      cloneAnyMap(event.Metadata),
	}
}

type errString string

func (e errString) Error() string {
	return string(e)
}
