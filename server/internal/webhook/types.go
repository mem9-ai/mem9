package webhook

import (
	"encoding/json"
	"time"
)

const (
	EventMemoryAdded          = "memory.added"
	EventMemoryDeleted        = "memory.deleted"
	EventSpaceChainFactRouted = "space_chain.fact_routed"
	EventTest                 = "webhook.test"

	ScopeTenant = "tenant"
	ScopeChain  = "chain"

	StatusPending   = "pending"
	StatusDelivered = "delivered"
	StatusFailed    = "failed"
)

var SupportedEvents = []string{
	EventMemoryAdded,
	EventMemoryDeleted,
	EventSpaceChainFactRouted,
}

type Endpoint struct {
	ID               string     `json:"id"`
	ScopeType        string     `json:"scope_type"`
	ScopeID          string     `json:"scope_id"`
	Name             string     `json:"name"`
	URL              string     `json:"url"`
	Enabled          bool       `json:"enabled"`
	Events           []string   `json:"events"`
	SecretCiphertext string     `json:"-"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	DeletedAt        *time.Time `json:"deleted_at,omitempty"`
}

type EndpointResponse struct {
	ID        string    `json:"id"`
	ScopeType string    `json:"scope_type"`
	ScopeID   string    `json:"scope_id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	Enabled   bool      `json:"enabled"`
	Events    []string  `json:"events"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type EndpointSecretResponse struct {
	EndpointResponse
	SigningSecret string `json:"signing_secret,omitempty"`
}

type EventEnvelope struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	APIVersion string          `json:"api_version"`
	CreatedAt  time.Time       `json:"created_at"`
	Scope      EventScope      `json:"scope"`
	Data       json.RawMessage `json:"data"`
}

type EventScope struct {
	Type            string `json:"type"`
	TenantID        string `json:"tenant_id,omitempty"`
	ChainID         string `json:"chain_id,omitempty"`
	ExternalSpaceID string `json:"external_space_id,omitempty"`
}

type EventRecord struct {
	ID        string
	ScopeType string
	ScopeID   string
	EventType string
	Payload   json.RawMessage
	CreatedAt time.Time
}

type Delivery struct {
	ID             string     `json:"id"`
	EventID        string     `json:"event_id"`
	EndpointID     string     `json:"endpoint_id"`
	EventType      string     `json:"event_type"`
	ScopeType      string     `json:"scope_type"`
	ScopeID        string     `json:"scope_id"`
	Status         string     `json:"status"`
	AttemptCount   int        `json:"attempt_count"`
	NextAttemptAt  time.Time  `json:"next_attempt_at"`
	LastHTTPStatus *int       `json:"last_http_status,omitempty"`
	LastError      string     `json:"last_error,omitempty"`
	DeliveredAt    *time.Time `json:"delivered_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type DeliveryJob struct {
	Delivery
	URL              string
	SecretCiphertext string
	Payload          json.RawMessage
}

type CreateEndpointInput struct {
	ScopeType string
	ScopeID   string
	Name      string
	URL       string
	Enabled   bool
	Events    []string
}

type UpdateEndpointInput struct {
	ScopeType  string
	ScopeID    string
	EndpointID string
	Name       *string
	URL        *string
	Enabled    *bool
	Events     *[]string
}

func ToEndpointResponse(endpoint Endpoint) EndpointResponse {
	return EndpointResponse{
		ID:        endpoint.ID,
		ScopeType: endpoint.ScopeType,
		ScopeID:   endpoint.ScopeID,
		Name:      endpoint.Name,
		URL:       endpoint.URL,
		Enabled:   endpoint.Enabled,
		Events:    append([]string(nil), endpoint.Events...),
		CreatedAt: endpoint.CreatedAt,
		UpdatedAt: endpoint.UpdatedAt,
	}
}
