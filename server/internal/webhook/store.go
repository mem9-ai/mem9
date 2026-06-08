package webhook

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/qiffang/mnemos/server/internal/domain"
)

type SQLStore struct {
	db      *sql.DB
	backend string
}

const deliveryClaimDuration = 5 * time.Minute

func NewSQLStore(db *sql.DB, backend string) *SQLStore {
	return &SQLStore{db: db, backend: strings.TrimSpace(backend)}
}

func (s *SQLStore) EnsureSchema(ctx context.Context) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("webhook store unavailable")
	}
	for _, stmt := range s.schemaStatements() {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("ensure webhook schema: %w", err)
		}
	}
	return nil
}

func (s *SQLStore) CreateEndpoint(ctx context.Context, endpoint Endpoint) error {
	eventsJSON, err := json.Marshal(endpoint.Events)
	if err != nil {
		return fmt.Errorf("marshal webhook events: %w", err)
	}
	_, err = s.db.ExecContext(ctx,
		s.rebind(`INSERT INTO webhook_endpoints
			(id, scope_type, scope_id, name, url, enabled, events_json, secret_ciphertext, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		endpoint.ID,
		endpoint.ScopeType,
		endpoint.ScopeID,
		endpoint.Name,
		endpoint.URL,
		boolValue(endpoint.Enabled),
		string(eventsJSON),
		endpoint.SecretCiphertext,
		endpoint.CreatedAt,
		endpoint.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("create webhook endpoint: %w", err)
	}
	return nil
}

func (s *SQLStore) ListEndpoints(ctx context.Context, scopeType, scopeID string) ([]Endpoint, error) {
	rows, err := s.db.QueryContext(ctx,
		s.rebind(`SELECT id, scope_type, scope_id, name, url, enabled, events_json, secret_ciphertext, created_at, updated_at, deleted_at
			FROM webhook_endpoints
			WHERE scope_type = ? AND scope_id = ? AND deleted_at IS NULL
			ORDER BY created_at DESC, id DESC`),
		scopeType,
		scopeID,
	)
	if err != nil {
		return nil, fmt.Errorf("list webhook endpoints: %w", err)
	}
	defer rows.Close()
	return scanEndpoints(rows)
}

func (s *SQLStore) GetEndpoint(ctx context.Context, scopeType, scopeID, endpointID string) (*Endpoint, error) {
	row := s.db.QueryRowContext(ctx,
		s.rebind(`SELECT id, scope_type, scope_id, name, url, enabled, events_json, secret_ciphertext, created_at, updated_at, deleted_at
			FROM webhook_endpoints
			WHERE id = ? AND scope_type = ? AND scope_id = ? AND deleted_at IS NULL`),
		endpointID,
		scopeType,
		scopeID,
	)
	endpoint, err := scanEndpoint(row)
	if err != nil {
		return nil, err
	}
	return endpoint, nil
}

func (s *SQLStore) UpdateEndpoint(ctx context.Context, endpoint Endpoint) error {
	eventsJSON, err := json.Marshal(endpoint.Events)
	if err != nil {
		return fmt.Errorf("marshal webhook events: %w", err)
	}
	res, err := s.db.ExecContext(ctx,
		s.rebind(`UPDATE webhook_endpoints
			SET name = ?, url = ?, enabled = ?, events_json = ?, updated_at = ?
			WHERE id = ? AND scope_type = ? AND scope_id = ? AND deleted_at IS NULL`),
		endpoint.Name,
		endpoint.URL,
		boolValue(endpoint.Enabled),
		string(eventsJSON),
		endpoint.UpdatedAt,
		endpoint.ID,
		endpoint.ScopeType,
		endpoint.ScopeID,
	)
	if err != nil {
		return fmt.Errorf("update webhook endpoint: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *SQLStore) UpdateEndpointSecret(ctx context.Context, endpoint Endpoint) error {
	res, err := s.db.ExecContext(ctx,
		s.rebind(`UPDATE webhook_endpoints
			SET secret_ciphertext = ?, updated_at = ?
			WHERE id = ? AND scope_type = ? AND scope_id = ? AND deleted_at IS NULL`),
		endpoint.SecretCiphertext,
		endpoint.UpdatedAt,
		endpoint.ID,
		endpoint.ScopeType,
		endpoint.ScopeID,
	)
	if err != nil {
		return fmt.Errorf("rotate webhook endpoint secret: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *SQLStore) SoftDeleteEndpoint(ctx context.Context, scopeType, scopeID, endpointID string) error {
	res, err := s.db.ExecContext(ctx,
		s.rebind(`UPDATE webhook_endpoints
			SET deleted_at = ?, updated_at = ?
			WHERE id = ? AND scope_type = ? AND scope_id = ? AND deleted_at IS NULL`),
		time.Now().UTC(),
		time.Now().UTC(),
		endpointID,
		scopeType,
		scopeID,
	)
	if err != nil {
		return fmt.Errorf("delete webhook endpoint: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *SQLStore) EnqueueEvent(ctx context.Context, event EventRecord) error {
	endpoints, err := s.ListEndpoints(ctx, event.ScopeType, event.ScopeID)
	if err != nil {
		return err
	}
	matching := make([]Endpoint, 0, len(endpoints))
	for _, endpoint := range endpoints {
		if endpoint.Enabled && endpointAcceptsEvent(endpoint, event.EventType) {
			matching = append(matching, endpoint)
		}
	}
	if len(matching) == 0 {
		return nil
	}
	_, err = s.insertEventAndDeliveries(ctx, event, matching)
	return err
}

func (s *SQLStore) EnqueueTestEvent(ctx context.Context, endpoint Endpoint, event EventRecord) (Delivery, error) {
	deliveries, err := s.insertEventAndDeliveries(ctx, event, []Endpoint{endpoint})
	if err != nil {
		return Delivery{}, err
	}
	if len(deliveries) == 0 {
		return Delivery{}, domain.ErrNotFound
	}
	return deliveries[0], nil
}

func (s *SQLStore) ListDeliveries(ctx context.Context, scopeType, scopeID string, limit int) ([]Delivery, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx,
		s.rebind(`SELECT d.id, d.event_id, d.endpoint_id, e.event_type, e.scope_type, e.scope_id,
				d.status, d.attempt_count, d.next_attempt_at, d.last_http_status, d.last_error,
				d.delivered_at, d.created_at, d.updated_at
			FROM webhook_deliveries AS d
			INNER JOIN webhook_events AS e ON e.id = d.event_id
			WHERE e.scope_type = ? AND e.scope_id = ?
			ORDER BY d.created_at DESC, d.id DESC
			LIMIT ?`),
		scopeType,
		scopeID,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list webhook deliveries: %w", err)
	}
	defer rows.Close()
	return scanDeliveries(rows)
}

func (s *SQLStore) FetchDueDeliveries(ctx context.Context, limit int) ([]DeliveryJob, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin webhook delivery claim: %w", err)
	}
	defer tx.Rollback()

	now := time.Now().UTC()
	rows, err := tx.QueryContext(ctx,
		s.rebind(`SELECT d.id
			FROM webhook_deliveries AS d
			INNER JOIN webhook_events AS e ON e.id = d.event_id
			INNER JOIN webhook_endpoints AS ep ON ep.id = d.endpoint_id
			WHERE d.status = ? AND d.next_attempt_at <= ? AND ep.enabled = ? AND ep.deleted_at IS NULL
			ORDER BY d.next_attempt_at ASC, d.created_at ASC, d.id ASC
			LIMIT ?
			FOR UPDATE`),
		StatusPending,
		now,
		boolValue(true),
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("select due webhook deliveries: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan due webhook delivery id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate due webhook deliveries: %w", err)
	}
	rows.Close()

	if len(ids) == 0 {
		if err := tx.Commit(); err != nil {
			return nil, fmt.Errorf("commit empty webhook delivery claim: %w", err)
		}
		return nil, nil
	}

	claimUntil := now.Add(deliveryClaimDuration)
	inClause, idArgs := placeholders(ids)
	updateArgs := append([]any{claimUntil, now}, idArgs...)
	updateArgs = append(updateArgs, StatusPending)
	if _, err := tx.ExecContext(ctx,
		s.rebind(`UPDATE webhook_deliveries
			SET next_attempt_at = ?, updated_at = ?
			WHERE id IN (`+inClause+`) AND status = ?`),
		updateArgs...,
	); err != nil {
		return nil, fmt.Errorf("claim webhook deliveries: %w", err)
	}

	selectArgs := idArgs
	rows, err = tx.QueryContext(ctx,
		s.rebind(`SELECT d.id, d.event_id, d.endpoint_id, e.event_type, e.scope_type, e.scope_id,
				d.status, d.attempt_count, d.next_attempt_at, d.last_http_status, d.last_error,
				d.delivered_at, d.created_at, d.updated_at, ep.url, ep.secret_ciphertext, e.payload_json
			FROM webhook_deliveries AS d
			INNER JOIN webhook_events AS e ON e.id = d.event_id
			INNER JOIN webhook_endpoints AS ep ON ep.id = d.endpoint_id
			WHERE d.id IN (`+inClause+`)
			ORDER BY d.next_attempt_at ASC, d.created_at ASC, d.id ASC`),
		selectArgs...,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch claimed webhook deliveries: %w", err)
	}
	jobs, err := scanDeliveryJobs(rows)
	rows.Close()
	if err != nil {
		return nil, fmt.Errorf("scan claimed webhook deliveries: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit webhook delivery claim: %w", err)
	}
	return jobs, nil
}

func (s *SQLStore) MarkDeliveryDelivered(ctx context.Context, deliveryID string, httpStatus int) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx,
		s.rebind(`UPDATE webhook_deliveries
			SET status = ?, attempt_count = attempt_count + 1, last_http_status = ?, last_error = '',
				delivered_at = ?, updated_at = ?
			WHERE id = ?`),
		StatusDelivered,
		httpStatus,
		now,
		now,
		deliveryID,
	)
	if err != nil {
		return fmt.Errorf("mark webhook delivery delivered: %w", err)
	}
	return nil
}

func (s *SQLStore) MarkDeliveryFailedAttempt(ctx context.Context, deliveryID string, terminal bool, nextAttemptAt time.Time, httpStatus *int, message string) error {
	status := StatusPending
	if terminal {
		status = StatusFailed
	}
	_, err := s.db.ExecContext(ctx,
		s.rebind(`UPDATE webhook_deliveries
			SET status = ?, attempt_count = attempt_count + 1, next_attempt_at = ?, last_http_status = ?,
				last_error = ?, updated_at = ?
			WHERE id = ?`),
		status,
		nextAttemptAt.UTC(),
		nullableInt(httpStatus),
		truncate(message, 2000),
		time.Now().UTC(),
		deliveryID,
	)
	if err != nil {
		return fmt.Errorf("mark webhook delivery failed attempt: %w", err)
	}
	return nil
}

func (s *SQLStore) insertEventAndDeliveries(ctx context.Context, event EventRecord, endpoints []Endpoint) ([]Delivery, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin webhook enqueue: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		s.rebind(`INSERT INTO webhook_events
			(id, scope_type, scope_id, event_type, payload_json, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`),
		event.ID,
		event.ScopeType,
		event.ScopeID,
		event.EventType,
		string(event.Payload),
		event.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("insert webhook event: %w", err)
	}
	deliveries := make([]Delivery, 0, len(endpoints))
	for _, endpoint := range endpoints {
		now := time.Now().UTC()
		delivery := Delivery{
			ID:            uuid.NewString(),
			EventID:       event.ID,
			EndpointID:    endpoint.ID,
			EventType:     event.EventType,
			ScopeType:     event.ScopeType,
			ScopeID:       event.ScopeID,
			Status:        StatusPending,
			AttemptCount:  0,
			NextAttemptAt: now,
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		if _, err := tx.ExecContext(ctx,
			s.rebind(`INSERT INTO webhook_deliveries
				(id, event_id, endpoint_id, status, attempt_count, next_attempt_at, created_at, updated_at)
				VALUES (?, ?, ?, ?, 0, ?, ?, ?)`),
			delivery.ID,
			delivery.EventID,
			delivery.EndpointID,
			delivery.Status,
			delivery.NextAttemptAt,
			delivery.CreatedAt,
			delivery.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("insert webhook delivery: %w", err)
		}
		deliveries = append(deliveries, delivery)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit webhook enqueue: %w", err)
	}
	return deliveries, nil
}

func (s *SQLStore) schemaStatements() []string {
	if s.backend == "postgres" || s.backend == "db9" {
		return []string{
			`CREATE TABLE IF NOT EXISTS webhook_endpoints (
				id VARCHAR(36) PRIMARY KEY,
				scope_type VARCHAR(20) NOT NULL,
				scope_id VARCHAR(255) NOT NULL,
				name VARCHAR(255) NOT NULL,
				url TEXT NOT NULL,
				enabled BOOLEAN NOT NULL DEFAULT TRUE,
				events_json JSONB NOT NULL,
				secret_ciphertext TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				deleted_at TIMESTAMPTZ NULL
			)`,
			`CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_scope ON webhook_endpoints(scope_type, scope_id, deleted_at)`,
			`CREATE TABLE IF NOT EXISTS webhook_events (
				id VARCHAR(36) PRIMARY KEY,
				scope_type VARCHAR(20) NOT NULL,
				scope_id VARCHAR(255) NOT NULL,
				event_type VARCHAR(100) NOT NULL,
				payload_json JSONB NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)`,
			`CREATE INDEX IF NOT EXISTS idx_webhook_events_scope ON webhook_events(scope_type, scope_id, created_at)`,
			`CREATE TABLE IF NOT EXISTS webhook_deliveries (
				id VARCHAR(36) PRIMARY KEY,
				event_id VARCHAR(36) NOT NULL REFERENCES webhook_events(id),
				endpoint_id VARCHAR(36) NOT NULL REFERENCES webhook_endpoints(id),
				status VARCHAR(20) NOT NULL DEFAULT 'pending',
				attempt_count INT NOT NULL DEFAULT 0,
				next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				last_http_status INT NULL,
				last_error TEXT NULL,
				delivered_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)`,
			`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_poll ON webhook_deliveries(status, next_attempt_at)`,
			`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event ON webhook_deliveries(event_id)`,
		}
	}
	return []string{
		`CREATE TABLE IF NOT EXISTS webhook_endpoints (
			id VARCHAR(36) PRIMARY KEY,
			scope_type VARCHAR(20) NOT NULL,
			scope_id VARCHAR(255) NOT NULL,
			name VARCHAR(255) NOT NULL,
			url TEXT NOT NULL,
			enabled TINYINT(1) NOT NULL DEFAULT 1,
			events_json JSON NOT NULL,
			secret_ciphertext TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP NULL,
			INDEX idx_webhook_endpoints_scope (scope_type, scope_id, deleted_at)
		)`,
		`CREATE TABLE IF NOT EXISTS webhook_events (
			id VARCHAR(36) PRIMARY KEY,
			scope_type VARCHAR(20) NOT NULL,
			scope_id VARCHAR(255) NOT NULL,
			event_type VARCHAR(100) NOT NULL,
			payload_json JSON NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_webhook_events_scope (scope_type, scope_id, created_at)
		)`,
		`CREATE TABLE IF NOT EXISTS webhook_deliveries (
			id VARCHAR(36) PRIMARY KEY,
			event_id VARCHAR(36) NOT NULL,
			endpoint_id VARCHAR(36) NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			attempt_count INT NOT NULL DEFAULT 0,
			next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_http_status INT NULL,
			last_error TEXT NULL,
			delivered_at TIMESTAMP NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			INDEX idx_webhook_deliveries_poll (status, next_attempt_at),
			INDEX idx_webhook_deliveries_event (event_id),
			CONSTRAINT fk_webhook_deliveries_event FOREIGN KEY (event_id) REFERENCES webhook_events(id),
			CONSTRAINT fk_webhook_deliveries_endpoint FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(id)
		)`,
	}
}

func (s *SQLStore) rebind(query string) string {
	if s.backend != "postgres" && s.backend != "db9" {
		return query
	}
	var b strings.Builder
	arg := 1
	for _, r := range query {
		if r == '?' {
			b.WriteString(fmt.Sprintf("$%d", arg))
			arg++
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

type scanner interface {
	Scan(dest ...any) error
}

func scanEndpoint(row scanner) (*Endpoint, error) {
	var endpoint Endpoint
	var eventsRaw []byte
	var deletedAt sql.NullTime
	var enabled any
	if err := row.Scan(
		&endpoint.ID,
		&endpoint.ScopeType,
		&endpoint.ScopeID,
		&endpoint.Name,
		&endpoint.URL,
		&enabled,
		&eventsRaw,
		&endpoint.SecretCiphertext,
		&endpoint.CreatedAt,
		&endpoint.UpdatedAt,
		&deletedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	endpoint.Enabled = scanBool(enabled)
	if deletedAt.Valid {
		endpoint.DeletedAt = &deletedAt.Time
	}
	if len(eventsRaw) > 0 {
		_ = json.Unmarshal(eventsRaw, &endpoint.Events)
	}
	if endpoint.Events == nil {
		endpoint.Events = []string{}
	}
	return &endpoint, nil
}

func scanEndpoints(rows *sql.Rows) ([]Endpoint, error) {
	out := []Endpoint{}
	for rows.Next() {
		endpoint, err := scanEndpoint(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *endpoint)
	}
	return out, rows.Err()
}

func scanDeliveries(rows *sql.Rows) ([]Delivery, error) {
	out := []Delivery{}
	for rows.Next() {
		d, err := scanDelivery(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func scanDelivery(row scanner) (Delivery, error) {
	var delivery Delivery
	var lastHTTPStatus sql.NullInt64
	var lastError sql.NullString
	var deliveredAt sql.NullTime
	if err := row.Scan(
		&delivery.ID,
		&delivery.EventID,
		&delivery.EndpointID,
		&delivery.EventType,
		&delivery.ScopeType,
		&delivery.ScopeID,
		&delivery.Status,
		&delivery.AttemptCount,
		&delivery.NextAttemptAt,
		&lastHTTPStatus,
		&lastError,
		&deliveredAt,
		&delivery.CreatedAt,
		&delivery.UpdatedAt,
	); err != nil {
		return Delivery{}, err
	}
	if lastHTTPStatus.Valid {
		value := int(lastHTTPStatus.Int64)
		delivery.LastHTTPStatus = &value
	}
	if lastError.Valid {
		delivery.LastError = lastError.String
	}
	if deliveredAt.Valid {
		delivery.DeliveredAt = &deliveredAt.Time
	}
	return delivery, nil
}

func scanDeliveryJobs(rows *sql.Rows) ([]DeliveryJob, error) {
	out := []DeliveryJob{}
	for rows.Next() {
		job, err := scanDeliveryJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, job)
	}
	return out, rows.Err()
}

func scanDeliveryJob(row scanner) (DeliveryJob, error) {
	var job DeliveryJob
	var lastHTTPStatus sql.NullInt64
	var lastError sql.NullString
	var deliveredAt sql.NullTime
	if err := row.Scan(
		&job.ID,
		&job.EventID,
		&job.EndpointID,
		&job.EventType,
		&job.ScopeType,
		&job.ScopeID,
		&job.Status,
		&job.AttemptCount,
		&job.NextAttemptAt,
		&lastHTTPStatus,
		&lastError,
		&deliveredAt,
		&job.CreatedAt,
		&job.UpdatedAt,
		&job.URL,
		&job.SecretCiphertext,
		&job.Payload,
	); err != nil {
		return DeliveryJob{}, err
	}
	if lastHTTPStatus.Valid {
		value := int(lastHTTPStatus.Int64)
		job.LastHTTPStatus = &value
	}
	if lastError.Valid {
		job.LastError = lastError.String
	}
	if deliveredAt.Valid {
		job.DeliveredAt = &deliveredAt.Time
	}
	return job, nil
}

func endpointAcceptsEvent(endpoint Endpoint, eventType string) bool {
	for _, candidate := range endpoint.Events {
		if candidate == eventType {
			return true
		}
	}
	return false
}

func boolValue(value bool) any {
	return value
}

func scanBool(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case int64:
		return v != 0
	case int:
		return v != 0
	case []byte:
		return string(v) == "1" || strings.EqualFold(string(v), "true")
	case string:
		return v == "1" || strings.EqualFold(v, "true")
	default:
		return false
	}
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func truncate(value string, maxLen int) string {
	if len(value) <= maxLen {
		return value
	}
	return value[:maxLen]
}

func placeholders(values []string) (string, []any) {
	parts := make([]string, len(values))
	args := make([]any, len(values))
	for i, value := range values {
		parts[i] = "?"
		args[i] = value
	}
	return strings.Join(parts, ","), args
}
