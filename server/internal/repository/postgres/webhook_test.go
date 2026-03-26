package postgres

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
