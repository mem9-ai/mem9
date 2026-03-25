package db9

import (
	"context"
	"database/sql"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/repository/postgres"
)

type WebhookRepoImpl struct {
	*postgres.WebhookRepoImpl
}

func NewWebhookRepo(db *sql.DB) *WebhookRepoImpl {
	return &WebhookRepoImpl{WebhookRepoImpl: postgres.NewWebhookRepo(db)}
}

func (r *WebhookRepoImpl) Create(ctx context.Context, w *domain.Webhook) error {
	return r.WebhookRepoImpl.Create(ctx, w)
}

func (r *WebhookRepoImpl) ListByTenant(ctx context.Context, tenantID string) ([]*domain.Webhook, error) {
	return r.WebhookRepoImpl.ListByTenant(ctx, tenantID)
}

func (r *WebhookRepoImpl) GetByID(ctx context.Context, id string) (*domain.Webhook, error) {
	return r.WebhookRepoImpl.GetByID(ctx, id)
}

func (r *WebhookRepoImpl) Delete(ctx context.Context, id, tenantID string) error {
	return r.WebhookRepoImpl.Delete(ctx, id, tenantID)
}
