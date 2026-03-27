package db9

import (
	"database/sql"
	"testing"
)

func TestWebhookRepoImpl_NewReturnsNonNil(t *testing.T) {
	t.Parallel()
	repo := NewWebhookRepo((*sql.DB)(nil))
	if repo == nil {
		t.Fatal("expected non-nil WebhookRepoImpl")
	}
}

func TestWebhookRepoImpl_EmbedsDelegatesCorrectly(t *testing.T) {
	t.Parallel()
	repo := NewWebhookRepo((*sql.DB)(nil))
	if repo.WebhookRepoImpl == nil {
		t.Fatal("embedded postgres.WebhookRepoImpl must not be nil")
	}
}
