package db9

import (
	"database/sql"

	"github.com/qiffang/mnemos/server/internal/repository/postgres"
)

type WebhookRepoImpl struct{ *postgres.WebhookRepoImpl }

func NewWebhookRepo(db *sql.DB) *WebhookRepoImpl {
	return &WebhookRepoImpl{postgres.NewWebhookRepo(db)}
}
