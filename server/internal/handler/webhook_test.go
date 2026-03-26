package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/service"
)

type webhookRepoStub struct {
	hooks        []*domain.Webhook
	limitReached bool
}

func (r *webhookRepoStub) ListByTenant(_ context.Context, _ string) ([]*domain.Webhook, error) {
	return r.hooks, nil
}

func (r *webhookRepoStub) CountByTenant(_ context.Context, _ string) (int, error) {
	return len(r.hooks), nil
}

func (r *webhookRepoStub) CreateIfBelowLimit(_ context.Context, w *domain.Webhook, limit int) (bool, error) {
	if r.limitReached || len(r.hooks) >= limit {
		return false, nil
	}
	r.hooks = append(r.hooks, w)
	return true, nil
}

func (r *webhookRepoStub) GetByID(_ context.Context, id string) (*domain.Webhook, error) {
	for _, h := range r.hooks {
		if h.ID == id {
			return h, nil
		}
	}
	return nil, domain.ErrNotFound
}

func (r *webhookRepoStub) Delete(_ context.Context, id, tenantID string) error {
	for i, h := range r.hooks {
		if h.ID == id && h.TenantID == tenantID {
			r.hooks = append(r.hooks[:i], r.hooks[i+1:]...)
			return nil
		}
	}
	return domain.ErrNotFound
}

func newTestServer(repo repository.WebhookRepo) *Server {
	svc := service.NewWebhookService(repo, encrypt.NewPlainEncryptor(), nil)
	return &Server{webhookSvc: svc}
}

func withTestAuth(r *http.Request, tenantID string) *http.Request {
	auth := &domain.AuthInfo{TenantID: tenantID}
	ctx := middleware.StoreAuthInContext(r.Context(), auth)
	return r.WithContext(ctx)
}

func TestCreateWebhook_Created(t *testing.T) {
	t.Parallel()
	srv := newTestServer(&webhookRepoStub{})

	body, _ := json.Marshal(map[string]any{
		"url":    "https://example.com/hook",
		"secret": "whsec_test",
	})
	r := httptest.NewRequest(http.MethodPost, "/webhooks", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r = withTestAuth(r, "tenant-1")

	w := httptest.NewRecorder()
	srv.createWebhook(w, r)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp domain.Webhook
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.ID == "" {
		t.Error("expected non-empty ID")
	}
	if resp.URL != "https://example.com/hook" {
		t.Errorf("expected url, got %q", resp.URL)
	}
	if resp.Secret != "" {
		t.Errorf("secret must not be returned, got %q", resp.Secret)
	}
	if resp.CreatedAt.IsZero() {
		t.Error("expected non-zero created_at")
	}
}

func TestCreateWebhook_MissingSecret(t *testing.T) {
	t.Parallel()
	srv := newTestServer(&webhookRepoStub{})

	body, _ := json.Marshal(map[string]any{"url": "https://example.com/hook"})
	r := httptest.NewRequest(http.MethodPost, "/webhooks", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r = withTestAuth(r, "tenant-1")

	w := httptest.NewRecorder()
	srv.createWebhook(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateWebhook_InvalidURL(t *testing.T) {
	t.Parallel()
	srv := newTestServer(&webhookRepoStub{})

	body, _ := json.Marshal(map[string]any{
		"url":    "not-a-url",
		"secret": "s",
	})
	r := httptest.NewRequest(http.MethodPost, "/webhooks", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r = withTestAuth(r, "tenant-1")

	w := httptest.NewRecorder()
	srv.createWebhook(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateWebhook_SecretNotReturned(t *testing.T) {
	t.Parallel()
	srv := newTestServer(&webhookRepoStub{})

	body, _ := json.Marshal(map[string]any{
		"url":    "https://example.com/hook",
		"secret": "super-secret",
	})
	r := httptest.NewRequest(http.MethodPost, "/webhooks", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r = withTestAuth(r, "tenant-1")

	w := httptest.NewRecorder()
	srv.createWebhook(w, r)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	if bytes.Contains(w.Body.Bytes(), []byte("super-secret")) {
		t.Error("response body must not contain the secret")
	}
}

func TestListWebhooks_Empty(t *testing.T) {
	t.Parallel()
	srv := newTestServer(&webhookRepoStub{})

	r := httptest.NewRequest(http.MethodGet, "/webhooks", nil)
	r = withTestAuth(r, "tenant-1")

	w := httptest.NewRecorder()
	srv.listWebhooks(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var hooks []*domain.Webhook
	if err := json.NewDecoder(w.Body).Decode(&hooks); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(hooks) != 0 {
		t.Errorf("expected empty array, got %d items", len(hooks))
	}
}

func TestListWebhooks_SecretNotReturned(t *testing.T) {
	t.Parallel()
	stub := &webhookRepoStub{
		hooks: []*domain.Webhook{{
			ID:         "wh-1",
			TenantID:   "tenant-1",
			URL:        "https://example.com/hook",
			Secret:     "stored-secret",
			EventTypes: domain.AllEventTypes,
			CreatedAt:  time.Now(),
			UpdatedAt:  time.Now(),
		}},
	}
	srv := newTestServer(stub)

	r := httptest.NewRequest(http.MethodGet, "/webhooks", nil)
	r = withTestAuth(r, "tenant-1")

	w := httptest.NewRecorder()
	srv.listWebhooks(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if bytes.Contains(w.Body.Bytes(), []byte("stored-secret")) {
		t.Error("response must not contain the secret")
	}
}

func TestDeleteWebhook_NoContent(t *testing.T) {
	t.Parallel()
	stub := &webhookRepoStub{
		hooks: []*domain.Webhook{{
			ID:       "wh-del",
			TenantID: "tenant-1",
		}},
	}
	srv := newTestServer(stub)

	r := httptest.NewRequest(http.MethodDelete, "/webhooks/wh-del", nil)
	r = withTestAuth(r, "tenant-1")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("webhookId", "wh-del")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))

	w := httptest.NewRecorder()
	srv.deleteWebhook(w, r)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteWebhook_NotFound(t *testing.T) {
	t.Parallel()
	srv := newTestServer(&webhookRepoStub{})

	r := httptest.NewRequest(http.MethodDelete, "/webhooks/missing", nil)
	r = withTestAuth(r, "tenant-1")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("webhookId", "missing")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))

	w := httptest.NewRecorder()
	srv.deleteWebhook(w, r)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestCreateWebhook_NotConfigured(t *testing.T) {
	t.Parallel()
	srv := &Server{}

	body, _ := json.Marshal(map[string]any{"url": "https://example.com", "secret": "s"})
	r := httptest.NewRequest(http.MethodPost, "/webhooks", bytes.NewReader(body))
	r = withTestAuth(r, "tenant-1")

	w := httptest.NewRecorder()
	srv.createWebhook(w, r)

	if w.Code != http.StatusNotImplemented {
		t.Fatalf("expected 501, got %d", w.Code)
	}
}
