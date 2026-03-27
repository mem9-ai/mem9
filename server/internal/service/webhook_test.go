package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
)

type webhookRepoMock struct {
	hooks        []*domain.Webhook
	countErr     error
	createCalled bool
	limitReached bool
}

func (m *webhookRepoMock) ListByTenant(_ context.Context, _ string) ([]*domain.Webhook, error) {
	return m.hooks, nil
}

func (m *webhookRepoMock) CountByTenant(_ context.Context, _ string) (int, error) {
	return len(m.hooks), m.countErr
}

func (m *webhookRepoMock) CreateIfBelowLimit(_ context.Context, w *domain.Webhook, limit int) (bool, error) {
	if m.limitReached || len(m.hooks) >= limit {
		return false, nil
	}
	m.hooks = append(m.hooks, w)
	m.createCalled = true
	return true, nil
}

func (m *webhookRepoMock) GetByID(_ context.Context, id string) (*domain.Webhook, error) {
	for _, h := range m.hooks {
		if h.ID == id {
			return h, nil
		}
	}
	return nil, domain.ErrNotFound
}

func (m *webhookRepoMock) Delete(_ context.Context, id, tenantID string) error {
	for i, h := range m.hooks {
		if h.ID == id && h.TenantID == tenantID {
			m.hooks = append(m.hooks[:i], m.hooks[i+1:]...)
			return nil
		}
	}
	return domain.ErrNotFound
}

func newTestWebhookService(repo *webhookRepoMock) *WebhookService {
	return NewWebhookService(repo, encrypt.NewPlainEncryptor(), nil)
}

func TestBuildIngestEvent_MultiInsight_PrimaryIDNil(t *testing.T) {
	t.Parallel()
	result := &IngestResult{
		Status:          "complete",
		MemoriesChanged: 2,
		InsightIDs:      []string{"id-a", "id-b"},
	}
	event := BuildIngestEvent("evt-1", "tenant-1", "agent-1", "", result)
	if event.Subject.PrimaryID != nil {
		t.Errorf("expected Subject.PrimaryID == nil for multi-insight, got %q", *event.Subject.PrimaryID)
	}
	if len(event.Subject.IDs) != 2 {
		t.Errorf("expected 2 subject IDs, got %d", len(event.Subject.IDs))
	}
}

func TestBuildIngestEvent_SingleInsight_PrimaryIDSet(t *testing.T) {
	t.Parallel()
	result := &IngestResult{
		Status:          "complete",
		MemoriesChanged: 1,
		InsightIDs:      []string{"id-only"},
	}
	event := BuildIngestEvent("evt-2", "tenant-1", "agent-1", "", result)
	if event.Subject.PrimaryID == nil {
		t.Fatal("expected Subject.PrimaryID set for single insight")
	}
	if *event.Subject.PrimaryID != "id-only" {
		t.Errorf("expected primaryID %q, got %q", "id-only", *event.Subject.PrimaryID)
	}
}

func TestValidateWebhookURL_TooLong(t *testing.T) {
	t.Parallel()
	long := "https://example.com/" + strings.Repeat("a", 2048)
	err := validateWebhookURL(long)
	if err == nil {
		t.Fatal("expected ValidationError for URL > 2048 chars, got nil")
	}
	var ve *domain.ValidationError
	if ok := isValidationError(err, &ve); !ok {
		t.Fatalf("expected ValidationError, got %T: %v", err, err)
	}
	if ve.Field != "url" {
		t.Errorf("expected field=url, got %q", ve.Field)
	}
}

func TestValidateWebhookURL_ExactLimit(t *testing.T) {
	t.Parallel()
	exact := "https://x.io/" + strings.Repeat("a", 2048-len("https://x.io/"))
	if len(exact) != 2048 {
		t.Fatalf("test setup: URL length %d != 2048", len(exact))
	}
	if err := validateWebhookURL(exact); err != nil {
		t.Errorf("expected no error for 2048-char URL, got %v", err)
	}
}

func TestWebhookServiceCreate_EmptySecret(t *testing.T) {
	t.Parallel()
	svc := newTestWebhookService(&webhookRepoMock{})
	_, err := svc.Create(context.Background(), "tenant-1", "https://example.com/hook", "", nil)
	if err == nil {
		t.Fatal("expected ValidationError for empty secret, got nil")
	}
	var ve *domain.ValidationError
	if ok := isValidationError(err, &ve); !ok {
		t.Fatalf("expected ValidationError, got %T: %v", err, err)
	}
	if ve.Field != "secret" {
		t.Errorf("expected field=secret, got %q", ve.Field)
	}
}

func TestWebhookServiceCreate_LimitReached(t *testing.T) {
	t.Parallel()
	repo := &webhookRepoMock{limitReached: true}
	svc := newTestWebhookService(repo)
	_, err := svc.Create(context.Background(), "tenant-1", "https://example.com/hook", "secret", nil)
	if err == nil {
		t.Fatal("expected error when limit reached, got nil")
	}
	var ve *domain.ValidationError
	if ok := isValidationError(err, &ve); !ok {
		t.Fatalf("expected ValidationError, got %T: %v", err, err)
	}
	if ve.Field != "webhooks" {
		t.Errorf("expected field=webhooks, got %q", ve.Field)
	}
}

func TestWebhookServiceCreate_AtCap(t *testing.T) {
	t.Parallel()
	hooks := make([]*domain.Webhook, maxWebhooksPerTenant)
	for i := range hooks {
		hooks[i] = &domain.Webhook{ID: "x"}
	}
	repo := &webhookRepoMock{hooks: hooks}
	svc := newTestWebhookService(repo)
	_, err := svc.Create(context.Background(), "tenant-1", "https://example.com/hook", "secret", nil)
	if err == nil {
		t.Fatal("expected error at cap boundary, got nil")
	}
}

func TestDeliver_HMACSignatureCorrect(t *testing.T) {
	t.Parallel()

	const secret = "test-secret-key"
	var receivedSig, receivedTS string
	var receivedBody []byte
	received := make(chan struct{})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedSig = r.Header.Get("X-Mem9-Signature-256")
		receivedTS = r.Header.Get("X-Mem9-Timestamp")
		receivedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
		close(received)
	}))
	defer srv.Close()

	hook := &domain.Webhook{
		ID:         "wh-1",
		TenantID:   "tenant-1",
		URL:        srv.URL,
		Secret:     secret,
		EventTypes: domain.AllEventTypes,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
	repo := &webhookRepoMock{hooks: []*domain.Webhook{hook}}
	svc := newTestWebhookService(repo)

	event := BuildLifecycleEvent("evt-1", "tenant-1", "agent-1", "update", "mem-1", nil, nil)
	svc.Deliver("tenant-1", event)

	select {
	case <-received:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout: no request received by test server")
	}

	expectedSig := "sha256=" + computeHMAC(secret, receivedTS, receivedBody)
	if receivedSig != expectedSig {
		t.Errorf("HMAC mismatch\n  got:  %s\n  want: %s", receivedSig, expectedSig)
	}
}

func TestDeliver_EventPayloadShape(t *testing.T) {
	t.Parallel()

	var body []byte
	received := make(chan struct{})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
		close(received)
	}))
	defer srv.Close()

	hook := &domain.Webhook{
		ID:         "wh-2",
		TenantID:   "tenant-1",
		URL:        srv.URL,
		Secret:     "s",
		EventTypes: []domain.EventType{domain.EventTypeIngestCompleted},
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
	repo := &webhookRepoMock{hooks: []*domain.Webhook{hook}}
	svc := newTestWebhookService(repo)

	result := &IngestResult{Status: "complete", MemoriesChanged: 1, InsightIDs: []string{"m1"}}
	event := BuildIngestEvent("evt-1", "tenant-1", "agent-1", "sess-1", result)
	svc.Deliver("tenant-1", event)

	select {
	case <-received:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout: no request received by test server")
	}

	var payload domain.WebhookEvent
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.SchemaVersion != "v1" {
		t.Errorf("expected schemaVersion=v1, got %q", payload.SchemaVersion)
	}
	if payload.EventType != domain.EventTypeIngestCompleted {
		t.Errorf("expected eventType=%s, got %q", domain.EventTypeIngestCompleted, payload.EventType)
	}
	if payload.Subject.PrimaryID == nil || *payload.Subject.PrimaryID != "m1" {
		t.Errorf("expected primaryId=m1")
	}
}

func computeHMAC(secret, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func isValidationError(err error, ve **domain.ValidationError) bool {
	if e, ok := err.(*domain.ValidationError); ok {
		*ve = e
		return true
	}
	return false
}

func TestDeliver_NonBlocking(t *testing.T) {
	t.Parallel()

	slow := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-slow
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	defer close(slow)

	hook := &domain.Webhook{
		ID:         "wh-slow",
		TenantID:   "tenant-1",
		URL:        srv.URL,
		Secret:     "s",
		EventTypes: domain.AllEventTypes,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
	repo := &webhookRepoMock{hooks: []*domain.Webhook{hook}}
	svc := newTestWebhookService(repo)

	event := BuildLifecycleEvent("evt-1", "tenant-1", "agent-1", "delete", "mem-1", nil, nil)

	start := time.Now()
	svc.Deliver("tenant-1", event)
	elapsed := time.Since(start)

	if elapsed > 100*time.Millisecond {
		t.Errorf("Deliver blocked for %v, expected near-instant return", elapsed)
	}
}

type deliverCapture struct {
	webhookRepoMock
	delivered chan struct{}
}

func (r *deliverCapture) ListByTenant(ctx context.Context, tenantID string) ([]*domain.Webhook, error) {
	hooks, err := r.webhookRepoMock.ListByTenant(ctx, tenantID)
	select {
	case r.delivered <- struct{}{}:
	default:
	}
	return hooks, err
}

func newCaptureSvc(hooks []*domain.Webhook) (*WebhookService, *deliverCapture) {
	cap := &deliverCapture{
		webhookRepoMock: webhookRepoMock{hooks: hooks},
		delivered:       make(chan struct{}, 1),
	}
	svc := NewWebhookService(cap, encrypt.NewPlainEncryptor(), nil)
	return svc, cap
}

func newHookForTenant(tenantID string) *domain.Webhook {
	return &domain.Webhook{
		ID:         "wh-emit",
		TenantID:   tenantID,
		URL:        "https://sink.invalid",
		Secret:     "s",
		EventTypes: domain.AllEventTypes,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
}

func waitDelivered(t *testing.T, cap *deliverCapture) {
	t.Helper()
	select {
	case <-cap.delivered:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout: Deliver never called ListByTenant")
	}
}

func TestMemoryService_Delete_EmitsLifecycleEvent(t *testing.T) {
	t.Parallel()

	const tenantID = "tenant-emit"
	webhookSvc, cap := newCaptureSvc([]*domain.Webhook{newHookForTenant(tenantID)})

	m := &domain.Memory{ID: "mem-del-1", Content: "c", State: domain.StateActive, Version: 1, MemoryType: domain.TypeInsight}
	repo := &memoryRepoMock{
		getByID: map[string]*domain.Memory{m.ID: m},
	}
	svc := NewMemoryService(repo, nil, nil, "", ModeSmart, webhookSvc)

	if err := svc.Delete(context.Background(), tenantID, m.ID, "agent-1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	waitDelivered(t, cap)
}

func TestMemoryService_Update_EmitsLifecycleEvent(t *testing.T) {
	t.Parallel()

	const tenantID = "tenant-emit"
	webhookSvc, cap := newCaptureSvc([]*domain.Webhook{newHookForTenant(tenantID)})

	m := &domain.Memory{ID: "mem-upd-1", Content: "old", State: domain.StateActive, Version: 1, MemoryType: domain.TypeInsight}
	repo := &memoryRepoMock{
		getByID: map[string]*domain.Memory{m.ID: m},
	}
	svc := NewMemoryService(repo, nil, nil, "", ModeSmart, webhookSvc)

	if _, err := svc.Update(context.Background(), tenantID, "agent-1", m.ID, "new content", nil, nil, 0); err != nil {
		t.Fatalf("Update: %v", err)
	}

	waitDelivered(t, cap)
}
