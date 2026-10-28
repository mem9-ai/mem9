package runtimeusage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/qiffang/mnemos/server/internal/metering"
)

const (
	subjectVersionTenantIDV1 = "tenant_id_v1"

	outboxStepCommitReservation  = "commit_reservation"
	outboxStepReleaseReservation = "release_reservation"
	outboxStepSubmitMetering     = "submit_metering_event"

	outboxPhaseCommitPending   = "commit_pending"
	outboxPhaseReleasePending  = "release_pending"
	outboxPhaseMeteringPending = "metering_pending"
	outboxPhaseDone            = "done"
	outboxPhaseUnknown         = "unknown_after_crash"
	outboxPhaseTerminalFailed  = "terminal_failed"

	outboxStatusPending        = "pending"
	outboxStatusDone           = "done"
	outboxStatusTerminalFailed = "terminal_failed"
)

type outboxPayload struct {
	APIKeySubject string                 `json:"apiKeySubject,omitempty"`
	Meter         string                 `json:"meter,omitempty"`
	Units         int64                  `json:"units,omitempty"`
	Status        string                 `json:"status,omitempty"`
	Reason        string                 `json:"reason,omitempty"`
	Event         *outboxMeteringPayload `json:"event,omitempty"`
}

type outboxMeteringPayload struct {
	APIKeySubject string         `json:"apiKeySubject,omitempty"`
	EventType     string         `json:"eventType"`
	Meter         string         `json:"meter"`
	Units         int64          `json:"units"`
	OccurredAt    time.Time      `json:"occurredAt"`
	AgentName     string         `json:"agentName,omitempty"`
	MemoryIDs     []string       `json:"memoryIds,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
}

type outboxRow struct {
	OperationID    string
	TenantID       string
	ClusterID      string
	SubjectVersion string
	Step           string
	Phase          string
	PayloadJSON    []byte
	PayloadHash    string
	ExpiresAt      time.Time
	AttemptCount   int
}

type SQLStore struct {
	db      *sql.DB
	backend string
	now     func() time.Time
}

func NewSQLStore(db *sql.DB, backend string) *SQLStore {
	return &SQLStore{
		db:      db,
		backend: backend,
		now:     time.Now,
	}
}

func (s *SQLStore) EnsureSchema(ctx context.Context) error {
	if s == nil || s.db == nil {
		return nil
	}
	query := `CREATE TABLE IF NOT EXISTS runtime_usage_outbox (
  operation_id      VARCHAR(36) PRIMARY KEY,
  tenant_id         VARCHAR(36) NOT NULL,
  cluster_id        VARCHAR(255) NULL,
  subject_version   VARCHAR(32) NOT NULL DEFAULT 'tenant_id_v1',
  step              VARCHAR(32) NOT NULL,
  phase             VARCHAR(32) NOT NULL,
  payload_json      JSON NOT NULL,
  payload_hash      VARCHAR(64) NOT NULL,
  expires_at        TIMESTAMP NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count     INT NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error        TEXT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_runtime_usage_outbox_poll (status, next_attempt_at)
)`
	if s.backend == "postgres" || s.backend == "db9" {
		query = `CREATE TABLE IF NOT EXISTS runtime_usage_outbox (
  operation_id      VARCHAR(36) PRIMARY KEY,
  tenant_id         VARCHAR(36) NOT NULL,
  cluster_id        VARCHAR(255) NULL,
  subject_version   VARCHAR(32) NOT NULL DEFAULT 'tenant_id_v1',
  step              VARCHAR(32) NOT NULL,
  phase             VARCHAR(32) NOT NULL,
  payload_json      JSONB NOT NULL,
  payload_hash      VARCHAR(64) NOT NULL,
  expires_at        TIMESTAMP NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count     INT NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error        TEXT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`
	}
	if _, err := s.db.ExecContext(ctx, query); err != nil {
		return fmt.Errorf("ensure runtime usage outbox schema: %w", err)
	}
	if s.backend == "postgres" || s.backend == "db9" {
		if _, err := s.db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_runtime_usage_outbox_poll ON runtime_usage_outbox (status, next_attempt_at)`); err != nil {
			return fmt.Errorf("ensure runtime usage outbox poll index: %w", err)
		}
	}
	return nil
}

func (s *SQLStore) StoreCommitPending(ctx context.Context, lease *OperationLease, event MeteringEvent) error {
	if lease == nil {
		return nil
	}
	payload := outboxPayload{
		APIKeySubject: lease.Subject.APIKeySubject,
		Meter:         lease.Meter,
		Units:         lease.Units,
		Status:        ReservationStatusCommitted,
		Reason:        reservationCommitReason,
		Event:         outboxEventFromMetering(event, lease.Subject.APIKeySubject),
	}
	return s.storeOperation(ctx, lease, outboxStepCommitReservation, outboxPhaseCommitPending, payload, time.Time{}, s.now())
}

func (s *SQLStore) StoreReleasePending(ctx context.Context, lease *OperationLease, reason string) error {
	if lease == nil {
		return nil
	}
	payload := outboxPayload{
		APIKeySubject: lease.Subject.APIKeySubject,
		Meter:         lease.Meter,
		Units:         lease.Units,
		Status:        ReservationStatusReleased,
		Reason:        reason,
	}
	return s.storeOperation(ctx, lease, outboxStepReleaseReservation, outboxPhaseReleasePending, payload, time.Time{}, s.now())
}

func (s *SQLStore) MarkOperationDone(ctx context.Context, operationID string, reason string) error {
	return s.updateStatus(ctx, operationID, outboxStatusDone, outboxPhaseDone, reason)
}

func (s *SQLStore) MarkOperationRetryableFailure(ctx context.Context, operationID string, reason string) error {
	return s.markRetryableFailure(ctx, operationID, reason)
}

func (s *SQLStore) MarkOperationTerminalFailed(ctx context.Context, operationID string, reason string) error {
	return s.updateStatus(ctx, operationID, outboxStatusTerminalFailed, outboxPhaseTerminalFailed, reason)
}

func (s *SQLStore) PendingRows(ctx context.Context, limit int) ([]outboxRow, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, s.placeholder(`SELECT operation_id, tenant_id, cluster_id, subject_version, step, phase, payload_json, payload_hash, expires_at, attempt_count
FROM runtime_usage_outbox
WHERE status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP
ORDER BY next_attempt_at ASC
LIMIT ?`), limit)
	if err != nil {
		return nil, fmt.Errorf("query runtime usage pending rows: %w", err)
	}
	defer rows.Close()

	var out []outboxRow
	for rows.Next() {
		var row outboxRow
		var clusterID sql.NullString
		var expiresAt sql.NullTime
		if err := rows.Scan(
			&row.OperationID,
			&row.TenantID,
			&clusterID,
			&row.SubjectVersion,
			&row.Step,
			&row.Phase,
			&row.PayloadJSON,
			&row.PayloadHash,
			&expiresAt,
			&row.AttemptCount,
		); err != nil {
			return nil, fmt.Errorf("scan runtime usage pending row: %w", err)
		}
		if clusterID.Valid {
			row.ClusterID = clusterID.String
		}
		if expiresAt.Valid {
			row.ExpiresAt = expiresAt.Time
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate runtime usage pending rows: %w", err)
	}
	return out, nil
}

func (s *SQLStore) MarkUnknownAfterCrash(ctx context.Context, operationID string, reason string) error {
	return s.updateStatus(ctx, operationID, outboxStatusTerminalFailed, outboxPhaseUnknown, reason)
}

func (s *SQLStore) DeferPending(ctx context.Context, operationID string, reason string) error {
	return s.markRetryableFailure(ctx, operationID, reason)
}

func (s *SQLStore) UpsertMeteringPending(ctx context.Context, evt metering.Event, _ []byte, payloadHash string) error {
	if s == nil || s.db == nil {
		return nil
	}
	storedPayload, err := marshalMeteringPendingPayload(evt)
	if err != nil {
		return err
	}
	reason := "different payload hash for existing metering operation"
	_, err = s.db.ExecContext(ctx, s.placeholder(s.meteringPendingUpsertSQL()),
		evt.OperationID,
		evt.TenantID,
		nullableString(evt.ClusterID),
		subjectVersionTenantIDV1,
		outboxStepSubmitMetering,
		outboxPhaseMeteringPending,
		string(storedPayload),
		payloadHash,
		outboxStatusPending,
		reason,
	)
	if err != nil {
		return fmt.Errorf("upsert runtime usage metering outbox: %w", err)
	}
	if err := s.rejectMeteringPayloadConflict(ctx, evt.OperationID, reason); err != nil {
		return err
	}
	return nil
}

func (s *SQLStore) MarkMeteringDone(ctx context.Context, operationID string) error {
	return s.updateStatus(ctx, operationID, outboxStatusDone, outboxPhaseDone, "")
}

func (s *SQLStore) MarkMeteringTerminalFailed(ctx context.Context, operationID, reason string) error {
	return s.updateStatus(ctx, operationID, outboxStatusTerminalFailed, outboxPhaseTerminalFailed, reason)
}

func (s *SQLStore) MarkMeteringRetryableFailure(ctx context.Context, operationID, reason string) error {
	return s.markRetryableFailure(ctx, operationID, reason)
}

func (s *SQLStore) storeOperation(ctx context.Context, lease *OperationLease, step, phase string, payload outboxPayload, expiresAt time.Time, nextAttemptAt time.Time) error {
	if s == nil || s.db == nil {
		return nil
	}
	if nextAttemptAt.IsZero() {
		nextAttemptAt = s.now()
	}
	payloadJSON, payloadHash, err := marshalOutboxPayload(payload)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, s.placeholder(s.operationUpsertSQL()),
		lease.OperationID,
		lease.Subject.TenantID,
		nullableString(lease.Subject.ClusterID),
		subjectVersionTenantIDV1,
		step,
		phase,
		string(payloadJSON),
		payloadHash,
		nullableTime(expiresAt),
		outboxStatusPending,
		nextAttemptAt,
	)
	if err != nil {
		return fmt.Errorf("upsert runtime usage outbox operation: %w", err)
	}
	return nil
}

func (s *SQLStore) operationUpsertSQL() string {
	if s.backend == "postgres" || s.backend == "db9" {
		return `INSERT INTO runtime_usage_outbox
(operation_id, tenant_id, cluster_id, subject_version, step, phase, payload_json, payload_hash, expires_at, status, next_attempt_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (operation_id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  cluster_id = EXCLUDED.cluster_id,
  subject_version = EXCLUDED.subject_version,
  step = EXCLUDED.step,
  phase = EXCLUDED.phase,
  payload_json = EXCLUDED.payload_json,
  payload_hash = EXCLUDED.payload_hash,
  expires_at = EXCLUDED.expires_at,
  status = EXCLUDED.status,
  next_attempt_at = EXCLUDED.next_attempt_at,
  last_error = NULL,
  updated_at = CURRENT_TIMESTAMP`
	}
	return `INSERT INTO runtime_usage_outbox
(operation_id, tenant_id, cluster_id, subject_version, step, phase, payload_json, payload_hash, expires_at, status, next_attempt_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  tenant_id = VALUES(tenant_id),
  cluster_id = VALUES(cluster_id),
  subject_version = VALUES(subject_version),
  step = VALUES(step),
  phase = VALUES(phase),
  payload_json = VALUES(payload_json),
  payload_hash = VALUES(payload_hash),
  expires_at = VALUES(expires_at),
  status = VALUES(status),
  next_attempt_at = VALUES(next_attempt_at),
  last_error = NULL,
  updated_at = CURRENT_TIMESTAMP`
}

func (s *SQLStore) meteringPendingUpsertSQL() string {
	if s.backend == "postgres" || s.backend == "db9" {
		return `INSERT INTO runtime_usage_outbox
(operation_id, tenant_id, cluster_id, subject_version, step, phase, payload_json, payload_hash, status, next_attempt_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (operation_id) DO UPDATE SET
  tenant_id = CASE
    WHEN runtime_usage_outbox.step = 'submit_metering_event' AND runtime_usage_outbox.payload_hash <> EXCLUDED.payload_hash THEN runtime_usage_outbox.tenant_id
    ELSE EXCLUDED.tenant_id
  END,
  cluster_id = CASE
    WHEN runtime_usage_outbox.step = 'submit_metering_event' AND runtime_usage_outbox.payload_hash <> EXCLUDED.payload_hash THEN runtime_usage_outbox.cluster_id
    ELSE EXCLUDED.cluster_id
  END,
  subject_version = CASE
    WHEN runtime_usage_outbox.step = 'submit_metering_event' AND runtime_usage_outbox.payload_hash <> EXCLUDED.payload_hash THEN runtime_usage_outbox.subject_version
    ELSE EXCLUDED.subject_version
  END,
  step = CASE
    WHEN runtime_usage_outbox.step = 'submit_metering_event' AND runtime_usage_outbox.payload_hash <> EXCLUDED.payload_hash THEN runtime_usage_outbox.step
    ELSE EXCLUDED.step
  END,
  phase = CASE
    WHEN runtime_usage_outbox.step = 'submit_metering_event' AND runtime_usage_outbox.payload_hash <> EXCLUDED.payload_hash THEN 'terminal_failed'
    ELSE EXCLUDED.phase
  END,
  payload_json = CASE
    WHEN runtime_usage_outbox.step = 'submit_metering_event' AND runtime_usage_outbox.payload_hash <> EXCLUDED.payload_hash THEN runtime_usage_outbox.payload_json
    ELSE EXCLUDED.payload_json
  END,
  payload_hash = CASE
    WHEN runtime_usage_outbox.step = 'submit_metering_event' AND runtime_usage_outbox.payload_hash <> EXCLUDED.payload_hash THEN runtime_usage_outbox.payload_hash
    ELSE EXCLUDED.payload_hash
  END,
  status = CASE
    WHEN runtime_usage_outbox.step = 'submit_metering_event' AND runtime_usage_outbox.payload_hash <> EXCLUDED.payload_hash THEN 'terminal_failed'
    ELSE EXCLUDED.status
  END,
  next_attempt_at = CASE
    WHEN runtime_usage_outbox.step = 'submit_metering_event' AND runtime_usage_outbox.payload_hash <> EXCLUDED.payload_hash THEN runtime_usage_outbox.next_attempt_at
    ELSE CURRENT_TIMESTAMP
  END,
  last_error = CASE
    WHEN runtime_usage_outbox.step = 'submit_metering_event' AND runtime_usage_outbox.payload_hash <> EXCLUDED.payload_hash THEN ?
    ELSE NULL
  END,
  updated_at = CURRENT_TIMESTAMP`
	}
	return `INSERT INTO runtime_usage_outbox
(operation_id, tenant_id, cluster_id, subject_version, step, phase, payload_json, payload_hash, status, next_attempt_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  phase = IF(step = 'submit_metering_event' AND payload_hash <> VALUES(payload_hash), 'terminal_failed', VALUES(phase)),
  status = IF(step = 'submit_metering_event' AND payload_hash <> VALUES(payload_hash), 'terminal_failed', VALUES(status)),
  next_attempt_at = IF(step = 'submit_metering_event' AND payload_hash <> VALUES(payload_hash), next_attempt_at, CURRENT_TIMESTAMP),
  last_error = IF(step = 'submit_metering_event' AND payload_hash <> VALUES(payload_hash), ?, NULL),
  tenant_id = IF(step = 'submit_metering_event' AND payload_hash <> VALUES(payload_hash), tenant_id, VALUES(tenant_id)),
  cluster_id = IF(step = 'submit_metering_event' AND payload_hash <> VALUES(payload_hash), cluster_id, VALUES(cluster_id)),
  subject_version = IF(step = 'submit_metering_event' AND payload_hash <> VALUES(payload_hash), subject_version, VALUES(subject_version)),
  payload_json = IF(step = 'submit_metering_event' AND payload_hash <> VALUES(payload_hash), payload_json, VALUES(payload_json)),
  step = IF(step = 'submit_metering_event' AND payload_hash <> VALUES(payload_hash), step, VALUES(step)),
  payload_hash = IF(step = 'submit_metering_event' AND payload_hash <> VALUES(payload_hash), payload_hash, VALUES(payload_hash)),
  updated_at = CURRENT_TIMESTAMP`
}

func (s *SQLStore) rejectMeteringPayloadConflict(ctx context.Context, operationID, reason string) error {
	var status, phase string
	var lastError sql.NullString
	err := s.db.QueryRowContext(ctx, s.placeholder("SELECT status, phase, last_error FROM runtime_usage_outbox WHERE operation_id = ?"), operationID).Scan(&status, &phase, &lastError)
	if err != nil {
		return fmt.Errorf("query runtime usage metering upsert result: %w", err)
	}
	if status == outboxStatusTerminalFailed && phase == outboxPhaseTerminalFailed && lastError.Valid && lastError.String == reason {
		return fmt.Errorf("runtime usage outbox payload hash conflict for operation %s", operationID)
	}
	return nil
}

func (s *SQLStore) markRetryableFailure(ctx context.Context, operationID, reason string) error {
	if s == nil || s.db == nil {
		return nil
	}
	nextAttemptAt := s.now().Add(time.Minute)
	var attempts int
	if err := s.db.QueryRowContext(ctx, s.placeholder("SELECT attempt_count FROM runtime_usage_outbox WHERE operation_id = ?"), operationID).Scan(&attempts); err == nil {
		nextAttemptAt = s.now().Add(retryBackoff(attempts, time.Minute, 15*time.Minute))
	}
	_, err := s.db.ExecContext(ctx, s.placeholder(`UPDATE runtime_usage_outbox
SET status = 'pending', attempt_count = attempt_count + 1, next_attempt_at = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
WHERE operation_id = ?`), nextAttemptAt, reason, operationID)
	if err != nil {
		return fmt.Errorf("mark runtime usage retryable failure: %w", err)
	}
	return nil
}

func (s *SQLStore) updateStatus(ctx context.Context, operationID, status, phase, reason string) error {
	if s == nil || s.db == nil {
		return nil
	}
	lastError := nullableString(reason)
	if status == outboxStatusDone {
		lastError = sql.NullString{}
	}
	_, err := s.db.ExecContext(ctx, s.placeholder(`UPDATE runtime_usage_outbox
SET status = ?, phase = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
WHERE operation_id = ?`), status, phase, lastError, operationID)
	if err != nil {
		return fmt.Errorf("update runtime usage outbox status: %w", err)
	}
	return nil
}

func (s *SQLStore) placeholder(query string) string {
	if s.backend != "postgres" && s.backend != "db9" {
		return query
	}
	out := make([]byte, 0, len(query)+8)
	arg := 1
	for i := 0; i < len(query); i++ {
		if query[i] != '?' {
			out = append(out, query[i])
			continue
		}
		out = append(out, '$')
		out = append(out, []byte(fmt.Sprint(arg))...)
		arg++
	}
	return string(out)
}

func nullableString(value string) sql.NullString {
	if value == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: value, Valid: true}
}

func nullableTime(value time.Time) sql.NullTime {
	if value.IsZero() {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: value.UTC(), Valid: true}
}

func marshalOutboxPayload(payload outboxPayload) ([]byte, string, error) {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, "", fmt.Errorf("marshal runtime usage outbox payload: %w", err)
	}
	sum := sha256.Sum256(payloadJSON)
	return payloadJSON, hex.EncodeToString(sum[:]), nil
}

func outboxEventFromMetering(event MeteringEvent, apiKeySubject string) *outboxMeteringPayload {
	return &outboxMeteringPayload{
		APIKeySubject: apiKeySubject,
		EventType:     event.EventType,
		Meter:         event.Meter,
		Units:         event.Units,
		OccurredAt:    event.OccurredAt.UTC().Truncate(time.Second),
		AgentName:     event.AgentName,
		MemoryIDs:     append([]string(nil), event.MemoryIDs...),
		Metadata:      cloneAnyMap(event.Metadata),
	}
}

func marshalMeteringPendingPayload(evt metering.Event) ([]byte, error) {
	payload := outboxPayload{
		Event: &outboxMeteringPayload{
			APIKeySubject: evt.APIKeySubject,
			EventType:     evt.EventType,
			Meter:         evt.Meter,
			Units:         evt.Units,
			OccurredAt:    evt.OccurredAt.UTC().Truncate(time.Second),
			AgentName:     evt.AgentID,
			MemoryIDs:     append([]string(nil), evt.MemoryIDs...),
			Metadata:      cloneAnyMap(evt.Metadata),
		},
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal runtime usage metering outbox payload: %w", err)
	}
	return payloadJSON, nil
}

func cloneAnyMap(in map[string]any) map[string]any {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func retryBackoff(attempts int, minDelay, maxDelay time.Duration) time.Duration {
	if minDelay <= 0 {
		minDelay = time.Minute
	}
	if maxDelay <= 0 || maxDelay < minDelay {
		maxDelay = minDelay
	}
	delay := minDelay
	for i := 0; i < attempts && delay < maxDelay; i++ {
		delay *= 2
		if delay > maxDelay {
			return maxDelay
		}
	}
	return delay
}
