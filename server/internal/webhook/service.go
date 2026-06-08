package webhook

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/qiffang/mnemos/server/internal/domain"
)

const APIVersion = "2026-06-08"

type secretProtector interface {
	Encrypt(ctx context.Context, plaintext string) (string, error)
	Decrypt(ctx context.Context, ciphertext string) (string, error)
}

type Store interface {
	EnsureSchema(ctx context.Context) error
	CreateEndpoint(ctx context.Context, endpoint Endpoint) error
	ListEndpoints(ctx context.Context, scopeType, scopeID string) ([]Endpoint, error)
	GetEndpoint(ctx context.Context, scopeType, scopeID, endpointID string) (*Endpoint, error)
	UpdateEndpoint(ctx context.Context, endpoint Endpoint) error
	UpdateEndpointSecret(ctx context.Context, endpoint Endpoint) error
	SoftDeleteEndpoint(ctx context.Context, scopeType, scopeID, endpointID string) error
	EnqueueEvent(ctx context.Context, event EventRecord) error
	EnqueueTestEvent(ctx context.Context, endpoint Endpoint, event EventRecord) (Delivery, error)
	ListDeliveries(ctx context.Context, scopeType, scopeID string, limit int) ([]Delivery, error)
	FetchDueDeliveries(ctx context.Context, limit int) ([]DeliveryJob, error)
	MarkDeliveryDelivered(ctx context.Context, deliveryID string, httpStatus int) error
	MarkDeliveryFailedAttempt(ctx context.Context, deliveryID string, terminal bool, nextAttemptAt time.Time, httpStatus *int, message string) error
}

type Service struct {
	store          Store
	protector      secretProtector
	allowLocalHTTP bool
}

func NewService(store Store, protector secretProtector, allowLocalHTTP bool) *Service {
	return &Service{store: store, protector: protector, allowLocalHTTP: allowLocalHTTP}
}

func (s *Service) CreateEndpoint(ctx context.Context, input CreateEndpointInput) (EndpointSecretResponse, error) {
	if err := validateScope(input.ScopeType, input.ScopeID); err != nil {
		return EndpointSecretResponse{}, err
	}
	name, err := validateName(input.Name)
	if err != nil {
		return EndpointSecretResponse{}, err
	}
	endpointURL, err := validateEndpointURL(input.URL, s.allowLocalHTTP)
	if err != nil {
		return EndpointSecretResponse{}, err
	}
	events, err := normalizeEvents(input.Events)
	if err != nil {
		return EndpointSecretResponse{}, err
	}
	secret, err := generateSigningSecret()
	if err != nil {
		return EndpointSecretResponse{}, err
	}
	encrypted, err := s.protector.Encrypt(ctx, secret)
	if err != nil {
		return EndpointSecretResponse{}, fmt.Errorf("encrypt webhook secret: %w", err)
	}
	now := time.Now().UTC()
	endpoint := Endpoint{
		ID:               uuid.NewString(),
		ScopeType:        input.ScopeType,
		ScopeID:          input.ScopeID,
		Name:             name,
		URL:              endpointURL,
		Enabled:          input.Enabled,
		Events:           events,
		SecretCiphertext: encrypted,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := s.store.CreateEndpoint(ctx, endpoint); err != nil {
		return EndpointSecretResponse{}, err
	}
	return EndpointSecretResponse{
		EndpointResponse: ToEndpointResponse(endpoint),
		SigningSecret:    secret,
	}, nil
}

func (s *Service) ListEndpoints(ctx context.Context, scopeType, scopeID string) ([]EndpointResponse, error) {
	if err := validateScope(scopeType, scopeID); err != nil {
		return nil, err
	}
	endpoints, err := s.store.ListEndpoints(ctx, scopeType, scopeID)
	if err != nil {
		return nil, err
	}
	out := make([]EndpointResponse, 0, len(endpoints))
	for _, endpoint := range endpoints {
		out = append(out, ToEndpointResponse(endpoint))
	}
	return out, nil
}

func (s *Service) GetEndpoint(ctx context.Context, scopeType, scopeID, endpointID string) (EndpointResponse, error) {
	endpoint, err := s.getEndpoint(ctx, scopeType, scopeID, endpointID)
	if err != nil {
		return EndpointResponse{}, err
	}
	return ToEndpointResponse(*endpoint), nil
}

func (s *Service) UpdateEndpoint(ctx context.Context, input UpdateEndpointInput) (EndpointResponse, error) {
	endpoint, err := s.getEndpoint(ctx, input.ScopeType, input.ScopeID, input.EndpointID)
	if err != nil {
		return EndpointResponse{}, err
	}
	if input.Name != nil {
		name, err := validateName(*input.Name)
		if err != nil {
			return EndpointResponse{}, err
		}
		endpoint.Name = name
	}
	if input.URL != nil {
		endpointURL, err := validateEndpointURL(*input.URL, s.allowLocalHTTP)
		if err != nil {
			return EndpointResponse{}, err
		}
		endpoint.URL = endpointURL
	}
	if input.Enabled != nil {
		endpoint.Enabled = *input.Enabled
	}
	if input.Events != nil {
		events, err := normalizeEvents(*input.Events)
		if err != nil {
			return EndpointResponse{}, err
		}
		endpoint.Events = events
	}
	endpoint.UpdatedAt = time.Now().UTC()
	if err := s.store.UpdateEndpoint(ctx, *endpoint); err != nil {
		return EndpointResponse{}, err
	}
	return ToEndpointResponse(*endpoint), nil
}

func (s *Service) DeleteEndpoint(ctx context.Context, scopeType, scopeID, endpointID string) error {
	if err := validateScope(scopeType, scopeID); err != nil {
		return err
	}
	if strings.TrimSpace(endpointID) == "" {
		return &domain.ValidationError{Field: "webhook_id", Message: "required"}
	}
	return s.store.SoftDeleteEndpoint(ctx, scopeType, scopeID, endpointID)
}

func (s *Service) RotateSecret(ctx context.Context, scopeType, scopeID, endpointID string) (EndpointSecretResponse, error) {
	endpoint, err := s.getEndpoint(ctx, scopeType, scopeID, endpointID)
	if err != nil {
		return EndpointSecretResponse{}, err
	}
	secret, err := generateSigningSecret()
	if err != nil {
		return EndpointSecretResponse{}, err
	}
	encrypted, err := s.protector.Encrypt(ctx, secret)
	if err != nil {
		return EndpointSecretResponse{}, fmt.Errorf("encrypt webhook secret: %w", err)
	}
	endpoint.SecretCiphertext = encrypted
	endpoint.UpdatedAt = time.Now().UTC()
	if err := s.store.UpdateEndpointSecret(ctx, *endpoint); err != nil {
		return EndpointSecretResponse{}, err
	}
	return EndpointSecretResponse{
		EndpointResponse: ToEndpointResponse(*endpoint),
		SigningSecret:    secret,
	}, nil
}

func (s *Service) TestEndpoint(ctx context.Context, scopeType, scopeID, endpointID string) (Delivery, error) {
	endpoint, err := s.getEndpoint(ctx, scopeType, scopeID, endpointID)
	if err != nil {
		return Delivery{}, err
	}
	if !endpoint.Enabled {
		return Delivery{}, &domain.ValidationError{Field: "enabled", Message: "webhook endpoint is disabled"}
	}
	id := eventID()
	payload, err := s.buildPayload(id, EventTest, eventScope(scopeType, scopeID, "", ""), map[string]any{
		"message": "mem9 webhook test event",
	})
	if err != nil {
		return Delivery{}, err
	}
	event := EventRecord{
		ID:        id,
		ScopeType: scopeType,
		ScopeID:   scopeID,
		EventType: EventTest,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	}
	return s.store.EnqueueTestEvent(ctx, *endpoint, event)
}

func (s *Service) ListDeliveries(ctx context.Context, scopeType, scopeID string, limit int) ([]Delivery, error) {
	if err := validateScope(scopeType, scopeID); err != nil {
		return nil, err
	}
	return s.store.ListDeliveries(ctx, scopeType, scopeID, limit)
}

func (s *Service) Enqueue(ctx context.Context, scope EventScope, eventType string, data any) error {
	if s == nil || s.store == nil {
		return nil
	}
	scopeType := scope.Type
	scopeID := scope.TenantID
	if scopeType == ScopeChain {
		scopeID = scope.ChainID
	}
	if err := validateScope(scopeType, scopeID); err != nil {
		return err
	}
	if eventType != EventTest && !isSupportedEvent(eventType) {
		return &domain.ValidationError{Field: "type", Message: "unsupported event"}
	}
	id := eventID()
	payload, err := s.buildPayload(id, eventType, scope, data)
	if err != nil {
		return err
	}
	return s.store.EnqueueEvent(ctx, EventRecord{
		ID:        id,
		ScopeType: scopeType,
		ScopeID:   scopeID,
		EventType: eventType,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func (s *Service) DecryptSecret(ctx context.Context, ciphertext string) (string, error) {
	return s.protector.Decrypt(ctx, ciphertext)
}

func (s *Service) getEndpoint(ctx context.Context, scopeType, scopeID, endpointID string) (*Endpoint, error) {
	if err := validateScope(scopeType, scopeID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(endpointID) == "" {
		return nil, &domain.ValidationError{Field: "webhook_id", Message: "required"}
	}
	return s.store.GetEndpoint(ctx, scopeType, scopeID, endpointID)
}

func (s *Service) buildPayload(id, eventType string, scope EventScope, data any) (json.RawMessage, error) {
	dataJSON, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("marshal webhook data: %w", err)
	}
	payload, err := json.Marshal(EventEnvelope{
		ID:         id,
		Type:       eventType,
		APIVersion: APIVersion,
		CreatedAt:  time.Now().UTC(),
		Scope:      scope,
		Data:       dataJSON,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal webhook payload: %w", err)
	}
	return payload, nil
}

func eventScope(scopeType, scopeID, externalSpaceID, chainID string) EventScope {
	switch scopeType {
	case ScopeChain:
		return EventScope{Type: ScopeChain, ChainID: scopeID}
	default:
		return EventScope{Type: ScopeTenant, TenantID: scopeID, ExternalSpaceID: externalSpaceID, ChainID: chainID}
	}
}

func validateScope(scopeType, scopeID string) error {
	scopeType = strings.TrimSpace(scopeType)
	scopeID = strings.TrimSpace(scopeID)
	if scopeType != ScopeTenant && scopeType != ScopeChain {
		return &domain.ValidationError{Field: "scope_type", Message: "unsupported"}
	}
	if scopeID == "" {
		return &domain.ValidationError{Field: "scope_id", Message: "required"}
	}
	return nil
}

func validateName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", &domain.ValidationError{Field: "name", Message: "required"}
	}
	if len(name) > 255 {
		return "", &domain.ValidationError{Field: "name", Message: "too long (max 255)"}
	}
	return name, nil
}

func validateEndpointURL(rawURL string, allowLocalHTTP bool) (string, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", &domain.ValidationError{Field: "url", Message: "required"}
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", &domain.ValidationError{Field: "url", Message: "invalid"}
	}
	if parsed.User != nil {
		return "", &domain.ValidationError{Field: "url", Message: "userinfo is not allowed"}
	}
	host := strings.Trim(parsed.Hostname(), "[]")
	if parsed.Scheme != "https" {
		if !(allowLocalHTTP && parsed.Scheme == "http" && isLocalhost(host)) {
			return "", &domain.ValidationError{Field: "url", Message: "https is required"}
		}
	}
	if ip := net.ParseIP(host); ip != nil && !isAllowedIP(ip, allowLocalHTTP) {
		return "", &domain.ValidationError{Field: "url", Message: "private IP destinations are not allowed"}
	}
	return parsed.String(), nil
}

func validateDeliveryURL(ctx context.Context, rawURL string, allowLocalHTTP bool) error {
	endpointURL, err := validateEndpointURL(rawURL, allowLocalHTTP)
	if err != nil {
		return err
	}
	parsed, err := url.Parse(endpointURL)
	if err != nil {
		return &domain.ValidationError{Field: "url", Message: "invalid"}
	}
	host := strings.Trim(parsed.Hostname(), "[]")
	if _, err := allowedDestinationIPs(ctx, host, allowLocalHTTP); err != nil {
		return err
	}
	return nil
}

func allowedDestinationIPs(ctx context.Context, host string, allowLocalHTTP bool) ([]net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		if !isAllowedIP(ip, allowLocalHTTP) {
			return nil, &domain.ValidationError{Field: "url", Message: "private IP destinations are not allowed"}
		}
		return []net.IP{ip}, nil
	}

	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("resolve webhook destination: %w", err)
	}
	ips := make([]net.IP, 0, len(addrs))
	for _, addr := range addrs {
		if !isAllowedIP(addr.IP, allowLocalHTTP) {
			return nil, &domain.ValidationError{Field: "url", Message: "private IP destinations are not allowed"}
		}
		ips = append(ips, addr.IP)
	}
	if len(ips) == 0 {
		return nil, &domain.ValidationError{Field: "url", Message: "destination has no IP addresses"}
	}
	return ips, nil
}

func normalizeEvents(events []string) ([]string, error) {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(events))
	for _, event := range events {
		event = strings.TrimSpace(event)
		if event == "" {
			continue
		}
		if !isSupportedEvent(event) {
			return nil, &domain.ValidationError{Field: "events", Message: "unsupported event: " + event}
		}
		if _, ok := seen[event]; ok {
			continue
		}
		seen[event] = struct{}{}
		out = append(out, event)
	}
	if len(out) == 0 {
		return nil, &domain.ValidationError{Field: "events", Message: "required"}
	}
	return out, nil
}

func isSupportedEvent(event string) bool {
	for _, supported := range SupportedEvents {
		if event == supported {
			return true
		}
	}
	return false
}

func generateSigningSecret() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return "whsec_" + base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func eventID() string {
	return "evt_" + strings.ReplaceAll(uuid.NewString(), "-", "")
}

func isLocalhost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func isAllowedIP(ip net.IP, allowLocal bool) bool {
	if allowLocal && ip.IsLoopback() {
		return true
	}
	return !(ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified())
}
