package tidb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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

func (r *WebhookRepoImpl) CreateIfBelowLimit(ctx context.Context, w *domain.Webhook, limit int) (bool, error) {
	typesJSON, err := json.Marshal(w.EventTypes)
	if err != nil {
		return false, fmt.Errorf("webhook create marshal event_types: %w", err)
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("webhook create begin tx: %w", err)
	}
	defer tx.Rollback()

	var count int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM webhooks WHERE tenant_id = ? FOR UPDATE`,
		w.TenantID,
	).Scan(&count); err != nil {
		return false, fmt.Errorf("webhook create count: %w", err)
	}
	if count >= limit {
		return false, nil
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO webhooks (id, tenant_id, url, secret, event_types, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		w.ID, w.TenantID, w.URL, w.Secret, typesJSON, w.CreatedAt, w.UpdatedAt,
	)
	if err != nil {
		return false, fmt.Errorf("webhook create: %w", err)
	}
	return true, tx.Commit()
}

func (r *WebhookRepoImpl) CountByTenant(ctx context.Context, tenantID string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM webhooks WHERE tenant_id = ?`, tenantID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("webhook count: %w", err)
	}
	return count, nil
}

func (r *WebhookRepoImpl) GetByID(ctx context.Context, id string) (*domain.Webhook, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, tenant_id, url, secret, event_types, created_at, updated_at
		 FROM webhooks WHERE id = ?`,
		id,
	)
	w, err := scanWebhook(row)
	if errors.Is(err, sql.ErrNoRows) {
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
