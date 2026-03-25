package tidb

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

type WebhookRepoImpl struct {
	db *sql.DB
}

func NewWebhookRepo(db *sql.DB) *WebhookRepoImpl {
	return &WebhookRepoImpl{db: db}
}

func (r *WebhookRepoImpl) Create(ctx context.Context, w *domain.Webhook) error {
	typesJSON, err := json.Marshal(w.EventTypes)
	if err != nil {
		return fmt.Errorf("webhook create marshal event_types: %w", err)
	}
	_, err = r.db.ExecContext(ctx,
		`INSERT INTO webhooks (id, tenant_id, url, secret, event_types, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
		w.ID, w.TenantID, w.URL, w.Secret, typesJSON,
	)
	if err != nil {
		return fmt.Errorf("webhook create: %w", err)
	}
	return nil
}

func (r *WebhookRepoImpl) ListByTenant(ctx context.Context, tenantID string) ([]*domain.Webhook, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, tenant_id, url, secret, event_types, created_at, updated_at
		 FROM webhooks WHERE tenant_id = ? ORDER BY created_at ASC`,
		tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("webhook list: %w", err)
	}
	defer rows.Close()

	var out []*domain.Webhook
	for rows.Next() {
		w, err := scanWebhook(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (r *WebhookRepoImpl) GetByID(ctx context.Context, id string) (*domain.Webhook, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, tenant_id, url, secret, event_types, created_at, updated_at
		 FROM webhooks WHERE id = ?`,
		id,
	)
	w, err := scanWebhook(row)
	if err == sql.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	return w, err
}

func (r *WebhookRepoImpl) Delete(ctx context.Context, id, tenantID string) error {
	result, err := r.db.ExecContext(ctx,
		`DELETE FROM webhooks WHERE id = ? AND tenant_id = ?`,
		id, tenantID,
	)
	if err != nil {
		return fmt.Errorf("webhook delete: %w", err)
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

type webhookScanner interface {
	Scan(dest ...any) error
}

func scanWebhook(s webhookScanner) (*domain.Webhook, error) {
	var w domain.Webhook
	var typesJSON []byte
	var createdAt, updatedAt time.Time
	if err := s.Scan(&w.ID, &w.TenantID, &w.URL, &w.Secret, &typesJSON, &createdAt, &updatedAt); err != nil {
		return nil, fmt.Errorf("webhook scan: %w", err)
	}
	if err := json.Unmarshal(typesJSON, &w.EventTypes); err != nil {
		return nil, fmt.Errorf("webhook unmarshal event_types: %w", err)
	}
	w.CreatedAt = createdAt
	w.UpdatedAt = updatedAt
	return &w, nil
}
