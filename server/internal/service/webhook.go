package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/repository"
)

type WebhookService struct {
	repo       repository.WebhookRepo
	encryptor  encrypt.Encryptor
	httpClient *http.Client
	logger     *slog.Logger
}

func NewWebhookService(
	repo repository.WebhookRepo,
	encryptor encrypt.Encryptor,
	logger *slog.Logger,
) *WebhookService {
	return &WebhookService{
		repo:       repo,
		encryptor:  encryptor,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     logger,
	}
}

func (s *WebhookService) Create(ctx context.Context, tenantID, rawURL, secret string, eventTypes []domain.EventType) (*domain.Webhook, error) {
	if err := validateWebhookURL(rawURL); err != nil {
		return nil, err
	}
	if len(eventTypes) == 0 {
		eventTypes = domain.AllEventTypes
	}
	if err := validateEventTypes(eventTypes); err != nil {
		return nil, err
	}

	encrypted, err := s.encryptor.Encrypt(ctx, secret)
	if err != nil {
		return nil, fmt.Errorf("webhook create encrypt secret: %w", err)
	}

	w := &domain.Webhook{
		ID:         uuid.New().String(),
		TenantID:   tenantID,
		URL:        rawURL,
		Secret:     encrypted,
		EventTypes: eventTypes,
	}
	if err := s.repo.Create(ctx, w); err != nil {
		return nil, err
	}
	w.Secret = ""
	return w, nil
}

func (s *WebhookService) List(ctx context.Context, tenantID string) ([]*domain.Webhook, error) {
	hooks, err := s.repo.ListByTenant(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for _, h := range hooks {
		h.Secret = ""
	}
	return hooks, nil
}

func (s *WebhookService) Delete(ctx context.Context, id, tenantID string) error {
	return s.repo.Delete(ctx, id, tenantID)
}

func (s *WebhookService) Deliver(tenantID string, event *domain.WebhookEvent) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		hooks, err := s.repo.ListByTenant(ctx, tenantID)
		if err != nil {
			s.logger.Warn("webhook deliver: list failed", "tenant", tenantID, "err", err)
			return
		}
		for _, h := range hooks {
			if !h.Subscribes(event.EventType) {
				continue
			}
			hook := h
			go func() {
				if err := s.deliver(ctx, hook, event); err != nil {
					s.logger.Warn("webhook deliver: send failed", "webhook_id", hook.ID, "err", err)
				}
			}()
		}
	}()
}

func (s *WebhookService) deliver(ctx context.Context, hook *domain.Webhook, event *domain.WebhookEvent) error {
	secret, err := s.encryptor.Decrypt(ctx, hook.Secret)
	if err != nil {
		return fmt.Errorf("decrypt secret: %w", err)
	}

	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	ts := fmt.Sprintf("%d", time.Now().Unix())
	sig := signPayload(secret, ts, body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, hook.URL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Mem9-Timestamp", ts)
	req.Header.Set("X-Mem9-Signature-256", "sha256="+sig)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("non-2xx response: %d", resp.StatusCode)
	}
	return nil
}

func signPayload(secret, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func validateWebhookURL(raw string) error {
	if raw == "" {
		return &domain.ValidationError{Field: "url", Message: "required"}
	}
	u, err := url.ParseRequestURI(raw)
	if err != nil {
		return &domain.ValidationError{Field: "url", Message: "invalid URL"}
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return &domain.ValidationError{Field: "url", Message: "must be http or https"}
	}
	return nil
}

func validateEventTypes(types []domain.EventType) error {
	for _, t := range types {
		found := false
		for _, valid := range domain.AllEventTypes {
			if t == valid {
				found = true
				break
			}
		}
		if !found {
			return &domain.ValidationError{Field: "event_types", Message: fmt.Sprintf("unknown event type %q", t)}
		}
	}
	return nil
}

func BuildIngestEvent(eventID, tenantID, agentID, sessionID string, result *IngestResult) *domain.WebhookEvent {
	ids := result.InsightIDs
	if ids == nil {
		ids = []string{}
	}
	var primaryID *string
	if len(ids) == 1 {
		primaryID = &ids[0]
	}
	return &domain.WebhookEvent{
		SchemaVersion: "v1",
		EventID:       eventID,
		EventType:     domain.EventTypeIngestCompleted,
		OccurredAt:    time.Now().UTC(),
		SpaceID:       tenantID,
		SourceApp:     "mem9",
		AgentID:       agentID,
		SessionID:     sessionID,
		Subject: domain.WebhookSubject{
			Kind:      "memory",
			IDs:       ids,
			PrimaryID: primaryID,
		},
		Data: domain.IngestCompletedData{
			Status:          result.Status,
			MemoriesChanged: result.MemoriesChanged,
			MemoryIDs:       ids,
			Warnings:        result.Warnings,
		},
	}
}

func BuildRecallEvent(eventID, tenantID, agentID, query string, memories []domain.Memory) *domain.WebhookEvent {
	qhash := queryHash(query)
	results := make([]domain.RecallResult, 0, len(memories))
	ids := make([]string, 0, len(memories))
	for i, m := range memories {
		mem := m
		results = append(results, domain.RecallResult{
			MemoryID: mem.ID,
			Rank:     i + 1,
			Score:    mem.Score,
		})
		ids = append(ids, mem.ID)
	}
	var primaryID *string
	if len(ids) == 1 {
		primaryID = &ids[0]
	}
	return &domain.WebhookEvent{
		SchemaVersion: "v1",
		EventID:       eventID,
		EventType:     domain.EventTypeRecallPerformed,
		OccurredAt:    time.Now().UTC(),
		SpaceID:       tenantID,
		SourceApp:     "mem9",
		AgentID:       agentID,
		Subject: domain.WebhookSubject{
			Kind:      "memory",
			IDs:       ids,
			PrimaryID: primaryID,
		},
		Data: domain.RecallPerformedData{
			HitCount:  len(memories),
			QueryHash: qhash,
			Intent:    "recall",
			Results:   results,
		},
	}
}

func BuildLifecycleEvent(eventID, tenantID, agentID, transition, memoryID string, oldMemoryID, supersededBy *string) *domain.WebhookEvent {
	ids := []string{memoryID}
	if oldMemoryID != nil && *oldMemoryID != "" && *oldMemoryID != memoryID {
		ids = append([]string{*oldMemoryID}, ids...)
	}
	primaryID := &memoryID
	return &domain.WebhookEvent{
		SchemaVersion: "v1",
		EventID:       eventID,
		EventType:     domain.EventTypeLifecycleChanged,
		OccurredAt:    time.Now().UTC(),
		SpaceID:       tenantID,
		SourceApp:     "mem9",
		AgentID:       agentID,
		Subject: domain.WebhookSubject{
			Kind:      "memory",
			IDs:       ids,
			PrimaryID: primaryID,
		},
		Data: domain.LifecycleChangedData{
			Transition:   transition,
			MemoryID:     memoryID,
			OldMemoryID:  oldMemoryID,
			SupersededBy: supersededBy,
		},
	}
}

func queryHash(q string) string {
	h := sha256.Sum256([]byte(q))
	return hex.EncodeToString(h[:])
}

