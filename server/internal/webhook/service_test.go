package webhook

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestSignPayload(t *testing.T) {
	got := SignPayload("whsec_test", 1710000000, "evt_123", []byte(`{"hello":"world"}`))
	want := "v1=e8b3a71f736fa023d7b77e89bbe33bbd9706c17e91b6d7b1ba539e635cfc6e72"
	if got != want {
		t.Fatalf("SignPayload() = %q, want %q", got, want)
	}
}

func TestCreateEndpointAllowsLocalHTTPOnlyWhenConfigured(t *testing.T) {
	ctx := context.Background()
	input := CreateEndpointInput{
		ScopeType: ScopeTenant,
		ScopeID:   "tenant-1",
		Name:      " Local hook ",
		URL:       " http://localhost:3000/hooks ",
		Enabled:   true,
		Events:    []string{EventMemoryAdded, EventMemoryAdded},
	}

	lockedDown := NewService(newFakeStore(), fakeProtector{}, false)
	if _, err := lockedDown.CreateEndpoint(ctx, input); !isValidationError(err) {
		t.Fatalf("CreateEndpoint() error = %v, want validation error", err)
	}

	store := newFakeStore()
	localDev := NewService(store, fakeProtector{}, true)
	resp, err := localDev.CreateEndpoint(ctx, input)
	if err != nil {
		t.Fatalf("CreateEndpoint() error = %v", err)
	}
	if resp.Name != "Local hook" {
		t.Fatalf("endpoint name = %q, want trimmed name", resp.Name)
	}
	if resp.URL != "http://localhost:3000/hooks" {
		t.Fatalf("endpoint url = %q", resp.URL)
	}
	if got := len(resp.Events); got != 1 || resp.Events[0] != EventMemoryAdded {
		t.Fatalf("endpoint events = %#v, want single memory.added", resp.Events)
	}
	if !strings.HasPrefix(resp.SigningSecret, "whsec_") {
		t.Fatalf("signing secret = %q, want whsec_ prefix", resp.SigningSecret)
	}
	stored := store.endpoints[resp.ID]
	if stored.SecretCiphertext != "enc:"+resp.SigningSecret {
		t.Fatalf("stored ciphertext = %q, want encrypted response secret", stored.SecretCiphertext)
	}
}

func TestValidateDeliveryURLRejectsPrivateDestinations(t *testing.T) {
	ctx := context.Background()
	if err := validateDeliveryURL(ctx, "https://127.0.0.1/hooks", false); !isValidationError(err) {
		t.Fatalf("validateDeliveryURL(loopback, production) error = %v, want validation error", err)
	}
	if err := validateDeliveryURL(ctx, "http://localhost:3000/hooks", true); err != nil {
		t.Fatalf("validateDeliveryURL(localhost, dev) error = %v", err)
	}
	if err := validateDeliveryURL(ctx, "http://127.0.0.1:3000/hooks", false); !isValidationError(err) {
		t.Fatalf("validateDeliveryURL(http loopback, production) error = %v, want validation error", err)
	}
}

func TestRotateSecretUpdatesCiphertextAndReturnsSecretOnce(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	svc := NewService(store, fakeProtector{}, true)

	created, err := svc.CreateEndpoint(ctx, CreateEndpointInput{
		ScopeType: ScopeTenant,
		ScopeID:   "tenant-1",
		Name:      "hook",
		URL:       "https://example.com/hooks",
		Enabled:   true,
		Events:    []string{EventMemoryDeleted},
	})
	if err != nil {
		t.Fatalf("CreateEndpoint() error = %v", err)
	}

	rotated, err := svc.RotateSecret(ctx, ScopeTenant, "tenant-1", created.ID)
	if err != nil {
		t.Fatalf("RotateSecret() error = %v", err)
	}
	if rotated.SigningSecret == "" || rotated.SigningSecret == created.SigningSecret {
		t.Fatalf("rotated signing secret = %q, original = %q", rotated.SigningSecret, created.SigningSecret)
	}
	if store.endpoints[created.ID].SecretCiphertext != "enc:"+rotated.SigningSecret {
		t.Fatalf("stored ciphertext was not updated")
	}
}

func TestTestEndpointRejectsDisabledEndpoint(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	svc := NewService(store, fakeProtector{}, true)

	created, err := svc.CreateEndpoint(ctx, CreateEndpointInput{
		ScopeType: ScopeTenant,
		ScopeID:   "tenant-1",
		Name:      "hook",
		URL:       "https://example.com/hooks",
		Enabled:   false,
		Events:    []string{EventMemoryAdded},
	})
	if err != nil {
		t.Fatalf("CreateEndpoint() error = %v", err)
	}

	if _, err := svc.TestEndpoint(ctx, ScopeTenant, "tenant-1", created.ID); !isValidationError(err) {
		t.Fatalf("TestEndpoint(disabled) error = %v, want validation error", err)
	}
	if store.testDelivery.ID != "" {
		t.Fatalf("test delivery was enqueued for disabled endpoint: %#v", store.testDelivery)
	}
}

func TestTestEndpointReturnsCreatedDelivery(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	svc := NewService(store, fakeProtector{}, true)

	created, err := svc.CreateEndpoint(ctx, CreateEndpointInput{
		ScopeType: ScopeTenant,
		ScopeID:   "tenant-1",
		Name:      "hook",
		URL:       "https://example.com/hooks",
		Enabled:   true,
		Events:    []string{EventMemoryAdded},
	})
	if err != nil {
		t.Fatalf("CreateEndpoint() error = %v", err)
	}

	delivery, err := svc.TestEndpoint(ctx, ScopeTenant, "tenant-1", created.ID)
	if err != nil {
		t.Fatalf("TestEndpoint() error = %v", err)
	}
	if delivery.ID != "test-delivery" {
		t.Fatalf("delivery id = %q, want store-created delivery", delivery.ID)
	}
	if delivery.EndpointID != created.ID || delivery.EventType != EventTest {
		t.Fatalf("delivery = %#v, want created endpoint test delivery", delivery)
	}
}

func isValidationError(err error) bool {
	var validationErr *domain.ValidationError
	return errors.As(err, &validationErr)
}

type fakeProtector struct{}

func (fakeProtector) Encrypt(_ context.Context, plaintext string) (string, error) {
	return "enc:" + plaintext, nil
}

func (fakeProtector) Decrypt(_ context.Context, ciphertext string) (string, error) {
	return strings.TrimPrefix(ciphertext, "enc:"), nil
}

type fakeStore struct {
	endpoints    map[string]Endpoint
	testDelivery Delivery
}

func newFakeStore() *fakeStore {
	return &fakeStore{endpoints: map[string]Endpoint{}}
}

func (s *fakeStore) EnsureSchema(context.Context) error { return nil }

func (s *fakeStore) CreateEndpoint(_ context.Context, endpoint Endpoint) error {
	s.endpoints[endpoint.ID] = endpoint
	return nil
}

func (s *fakeStore) ListEndpoints(_ context.Context, scopeType, scopeID string) ([]Endpoint, error) {
	var endpoints []Endpoint
	for _, endpoint := range s.endpoints {
		if endpoint.ScopeType == scopeType && endpoint.ScopeID == scopeID && endpoint.DeletedAt == nil {
			endpoints = append(endpoints, endpoint)
		}
	}
	return endpoints, nil
}

func (s *fakeStore) GetEndpoint(_ context.Context, scopeType, scopeID, endpointID string) (*Endpoint, error) {
	endpoint, ok := s.endpoints[endpointID]
	if !ok || endpoint.ScopeType != scopeType || endpoint.ScopeID != scopeID || endpoint.DeletedAt != nil {
		return nil, domain.ErrNotFound
	}
	return &endpoint, nil
}

func (s *fakeStore) UpdateEndpoint(_ context.Context, endpoint Endpoint) error {
	if _, ok := s.endpoints[endpoint.ID]; !ok {
		return domain.ErrNotFound
	}
	s.endpoints[endpoint.ID] = endpoint
	return nil
}

func (s *fakeStore) UpdateEndpointSecret(_ context.Context, endpoint Endpoint) error {
	return s.UpdateEndpoint(context.Background(), endpoint)
}

func (s *fakeStore) SoftDeleteEndpoint(_ context.Context, scopeType, scopeID, endpointID string) error {
	endpoint, err := s.GetEndpoint(context.Background(), scopeType, scopeID, endpointID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	endpoint.DeletedAt = &now
	s.endpoints[endpointID] = *endpoint
	return nil
}

func (s *fakeStore) EnqueueEvent(context.Context, EventRecord) error { return nil }

func (s *fakeStore) EnqueueTestEvent(_ context.Context, endpoint Endpoint, event EventRecord) (Delivery, error) {
	delivery := Delivery{
		ID:            "test-delivery",
		EventID:       event.ID,
		EndpointID:    endpoint.ID,
		EventType:     event.EventType,
		ScopeType:     event.ScopeType,
		ScopeID:       event.ScopeID,
		Status:        StatusPending,
		AttemptCount:  0,
		NextAttemptAt: event.CreatedAt,
		CreatedAt:     event.CreatedAt,
		UpdatedAt:     event.CreatedAt,
	}
	s.testDelivery = delivery
	return delivery, nil
}

func (s *fakeStore) ListDeliveries(context.Context, string, string, int) ([]Delivery, error) {
	return nil, nil
}

func (s *fakeStore) FetchDueDeliveries(context.Context, int) ([]DeliveryJob, error) {
	return nil, nil
}

func (s *fakeStore) MarkDeliveryDelivered(context.Context, string, int) error { return nil }

func (s *fakeStore) MarkDeliveryFailedAttempt(context.Context, string, bool, time.Time, *int, string) error {
	return nil
}
