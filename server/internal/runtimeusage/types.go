package runtimeusage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const (
	MeterMemoryRecallRequests = "memory_recall_requests"
	MeterMemoryWriteRequests  = "memory_write_requests"

	EventTypeMemoryRecall = "memoryRecall"

	EventTypeMemoryCreated = "memoryCreated"
	EventTypeMemoryUpdated = "memoryUpdated"
	EventTypeMemoryDeleted = "memoryDeleted"

	ReservationStatusCommitted = "committed"
	ReservationStatusReleased  = "released"

	reservationCommitReason              = "operationSucceeded"
	reservationReleaseOperationFailed    = "operationFailed"
	reservationReleaseOperationAbandoned = "operationAbandoned"
	reservationReleaseClientCancelled    = "clientCancelled"
	reservationReleaseTimeout            = "timeout"
)

const (
	RuntimeAPIKeyStatusActive   = "active"
	RuntimeAPIKeyStatusInactive = "inactive"
	RuntimeAPIKeyStatusUnknown  = "unknown"

	RuntimeBudgetTypeNotMetered      = "notMetered"
	RuntimeBudgetTypeUnknown         = "unknown"
	RuntimeBudgetTypeProviderManaged = "providerManaged"

	RuntimeBudgetStateUnlimited       = "unlimited"
	RuntimeBudgetStateUnknown         = "unknown"
	RuntimeBudgetStateProviderManaged = "providerManaged"

	RuntimeMeasureKindCount   = "count"
	RuntimeMeasureKindUnknown = "unknown"

	RuntimePeriodTypeNone            = "none"
	RuntimePeriodTypeUnknown         = "unknown"
	RuntimePeriodTypeProviderManaged = "providerManaged"

	RuntimeCapacityTypeUnlimited       = "unlimited"
	RuntimeCapacityTypeUnknown         = "unknown"
	RuntimeCapacityTypeProviderManaged = "providerManaged"

	RuntimeGateOutcomeAllowed = "allowed"

	RuntimeGateModeNotMetered = "notMetered"

	RuntimeGateReasonRuntimeUsageDisabled = "runtimeUsageDisabled"
)

type Config struct {
	Enabled         bool
	ProviderID      string
	BaseURL         string
	InternalSecret  string
	Timeout         time.Duration
	MeteringTimeout time.Duration
	ReservationTTL  time.Duration
	OperationTTL    time.Duration
	FailOpen        bool
	OutboxEnabled   bool
	Outbox          OutboxStore
}

type Subject struct {
	TenantID      string
	ClusterID     string
	APIKeySubject string
	APIKeyStatus  string
	AgentName     string
}

type OperationLease struct {
	OperationID string
	Subject     Subject
	Meter       string
	Units       int64
	Reserved    bool
}

type Operation struct {
	Meter string
	Units int64
}

type Reservation struct {
	OperationID            string    `json:"operationId"`
	Meter                  string    `json:"meter"`
	Units                  int64     `json:"units"`
	Status                 string    `json:"status"`
	ExpiresAt              time.Time `json:"expiresAt"`
	RemainingIncludedUnits *int64    `json:"remainingIncludedUnits"`
	ReservedUnits          int64     `json:"reservedUnits"`
	OverageAllowed         bool      `json:"overageAllowed"`
}

type RuntimeState struct {
	Mem9APIKey        RuntimeStateAPIKey        `json:"mem9ApiKey"`
	Meters            []RuntimeStateMeter       `json:"meters"`
	ProviderID        string                    `json:"providerId,omitempty"`
	RecommendedAction *RuntimeRecommendedAction `json:"recommendedAction,omitempty"`
	ProviderData      json.RawMessage           `json:"providerData,omitempty"`
}

type RuntimeStateAPIKey struct {
	Status string `json:"status"`
}

type RuntimeStateMeter struct {
	Meter           string                `json:"meter"`
	QuotaGateResult map[string]any        `json:"quotaGateResult,omitempty"`
	Budgets         []RuntimeStatusBudget `json:"budgets"`
}

type RuntimeStatusBudget struct {
	Type     string                `json:"type"`
	State    string                `json:"state"`
	Measure  RuntimeStatusMeasure  `json:"measure"`
	Period   RuntimeStatusPeriod   `json:"period"`
	Capacity RuntimeStatusCapacity `json:"capacity"`
	Usage    *RuntimeStatusUsage   `json:"usage,omitempty"`
}

type RuntimeStatusMeasure struct {
	Kind     string `json:"kind"`
	Quantity string `json:"quantity"`
	Scale    int64  `json:"scale"`
}

type RuntimeStatusPeriod struct {
	Type    string     `json:"type"`
	StartAt *time.Time `json:"startAt,omitempty"`
	EndAt   *time.Time `json:"endAt,omitempty"`
}

type RuntimeStatusCapacity struct {
	Type  string `json:"type"`
	Value *int64 `json:"value,omitempty"`
}

type RuntimeStatusUsage struct {
	Used      *int64   `json:"used,omitempty"`
	Remaining *int64   `json:"remaining,omitempty"`
	Percent   *float64 `json:"percent,omitempty"`
}

type RuntimeRecommendedAction struct {
	Type               string `json:"type"`
	ProviderActionCode string `json:"providerActionCode,omitempty"`
	Severity           string `json:"severity,omitempty"`
	URL                string `json:"url,omitempty"`
}

func RuntimeUsageDisabledState(statuses ...string) RuntimeState {
	return RuntimeState{
		Mem9APIKey: RuntimeStateAPIKey{Status: runtimeAPIKeyStatus(RuntimeAPIKeyStatusActive, statuses...)},
		Meters: []RuntimeStateMeter{
			notMeteredStateMeter(MeterMemoryRecallRequests),
			notMeteredStateMeter(MeterMemoryWriteRequests),
		},
	}
}

func RuntimeStateProviderUnavailable(statuses ...string) RuntimeState {
	return RuntimeState{
		Mem9APIKey: RuntimeStateAPIKey{Status: runtimeAPIKeyStatus(RuntimeAPIKeyStatusUnknown, statuses...)},
		Meters: []RuntimeStateMeter{
			unknownStateMeter(MeterMemoryRecallRequests),
			unknownStateMeter(MeterMemoryWriteRequests),
		},
	}
}

func runtimeAPIKeyStatus(defaultStatus string, statuses ...string) string {
	for _, status := range statuses {
		switch status {
		case RuntimeAPIKeyStatusActive, RuntimeAPIKeyStatusInactive, RuntimeAPIKeyStatusUnknown:
			return status
		}
	}
	return defaultStatus
}

func (s *RuntimeState) SetProviderDefaults() {
	if s.Mem9APIKey.Status == "" {
		s.Mem9APIKey.Status = RuntimeAPIKeyStatusUnknown
	}
	if len(s.Meters) == 0 {
		s.Meters = []RuntimeStateMeter{
			unknownStateMeter(MeterMemoryRecallRequests),
			unknownStateMeter(MeterMemoryWriteRequests),
		}
		return
	}
	seenMeters := make(map[string]bool, len(s.Meters))
	for i := range s.Meters {
		seenMeters[s.Meters[i].Meter] = true
		if len(s.Meters[i].Budgets) == 0 {
			s.Meters[i].Budgets = []RuntimeStatusBudget{providerManagedBudget()}
		}
	}
	if !seenMeters[MeterMemoryRecallRequests] {
		s.Meters = append(s.Meters, unknownStateMeter(MeterMemoryRecallRequests))
	}
	if !seenMeters[MeterMemoryWriteRequests] {
		s.Meters = append(s.Meters, unknownStateMeter(MeterMemoryWriteRequests))
	}
}

func (s *RuntimeState) NormalizeProviderData() error {
	raw := bytes.TrimSpace(s.ProviderData)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		s.ProviderData = nil
		return nil
	}
	if raw[0] != '{' {
		return fmt.Errorf("runtime state providerData must be a JSON object")
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return fmt.Errorf("runtime state providerData object: %w", err)
	}
	s.ProviderData = append(json.RawMessage(nil), raw...)
	return nil
}

func notMeteredStateMeter(meter string) RuntimeStateMeter {
	return RuntimeStateMeter{
		Meter: meter,
		QuotaGateResult: map[string]any{
			"outcome": RuntimeGateOutcomeAllowed,
			"mode":    RuntimeGateModeNotMetered,
			"reason":  RuntimeGateReasonRuntimeUsageDisabled,
		},
		Budgets: []RuntimeStatusBudget{{
			Type:  RuntimeBudgetTypeNotMetered,
			State: RuntimeBudgetStateUnlimited,
			Measure: RuntimeStatusMeasure{
				Kind:     RuntimeMeasureKindCount,
				Quantity: "request",
				Scale:    1,
			},
			Period: RuntimeStatusPeriod{
				Type: RuntimePeriodTypeNone,
			},
			Capacity: RuntimeStatusCapacity{
				Type: RuntimeCapacityTypeUnlimited,
			},
		}},
	}
}

func unknownStateMeter(meter string) RuntimeStateMeter {
	return RuntimeStateMeter{
		Meter:   meter,
		Budgets: []RuntimeStatusBudget{providerManagedBudget()},
	}
}

func providerManagedBudget() RuntimeStatusBudget {
	return RuntimeStatusBudget{
		Type:  RuntimeBudgetTypeProviderManaged,
		State: RuntimeBudgetStateProviderManaged,
		Measure: RuntimeStatusMeasure{
			Kind:     RuntimeMeasureKindUnknown,
			Quantity: "provider-defined",
			Scale:    1,
		},
		Period: RuntimeStatusPeriod{
			Type: RuntimePeriodTypeProviderManaged,
		},
		Capacity: RuntimeStatusCapacity{
			Type: RuntimeCapacityTypeProviderManaged,
		},
	}
}

type RecallResult struct {
	MemoryIDs []string
	AgentName string
}

type MemoryCreateResult struct {
	MemoryIDs       []string
	AgentName       string
	ObjectsAffected int64
}

type MemoryUpdateResult struct {
	MemoryIDs       []string
	AgentName       string
	ObjectsAffected int64
}

type MemoryDeleteResult struct {
	MemoryIDs       []string
	AgentName       string
	ObjectsAffected int64
}

type MeteringEvent struct {
	EventType  string
	Meter      string
	Units      int64
	OccurredAt time.Time
	AgentName  string
	MemoryIDs  []string
	Metadata   map[string]any
}

type OutboxStore interface {
	StoreCommitPending(ctx context.Context, lease *OperationLease, event MeteringEvent) error
	StoreReleasePending(ctx context.Context, lease *OperationLease, reason string) error
	MarkOperationDone(ctx context.Context, operationID string, reason string) error
	MarkOperationRetryableFailure(ctx context.Context, operationID string, reason string) error
	MarkUnknownAfterCrash(ctx context.Context, operationID string, reason string) error
}

type Manager interface {
	Enabled() bool
	ProviderID() string
	RuntimeState(ctx context.Context, subject Subject) (RuntimeState, error)
	BeforeRecall(ctx context.Context, subject Subject) (*OperationLease, error)
	AfterRecallSuccess(ctx context.Context, lease *OperationLease, result RecallResult) error
	AfterRecallFailure(ctx context.Context, lease *OperationLease, cause error)
	BeforeMemoryCreate(ctx context.Context, subject Subject, units int64) (*OperationLease, error)
	AfterMemoryCreateSuccess(ctx context.Context, lease *OperationLease, result MemoryCreateResult) error
	AfterMemoryCreateFailure(ctx context.Context, lease *OperationLease, cause error)
	BeforeMemoryUpdate(ctx context.Context, subject Subject) (*OperationLease, error)
	AfterMemoryUpdateSuccess(ctx context.Context, lease *OperationLease, result MemoryUpdateResult) error
	AfterMemoryUpdateFailure(ctx context.Context, lease *OperationLease, cause error)
	BeforeMemoryDelete(ctx context.Context, subject Subject) (*OperationLease, error)
	AfterMemoryDeleteSuccess(ctx context.Context, lease *OperationLease, result MemoryDeleteResult) error
	AfterMemoryDeleteFailure(ctx context.Context, lease *OperationLease, cause error)
}

type QuotaClient interface {
	RuntimeState(ctx context.Context, subject Subject) (RuntimeState, error)
	Reserve(ctx context.Context, subject Subject, operationID string, op Operation) (*Reservation, error)
	FinalizeReservation(ctx context.Context, subject Subject, operationID string, status string, reason string) error
}

type QuotaDeniedError struct {
	StatusCode int
	Body       []byte
	RetryAfter string
}

func (e *QuotaDeniedError) Error() string {
	return "runtime usage quota denied"
}

func (e *QuotaDeniedError) ResponseBody() []byte {
	if len(e.Body) == 0 {
		body, _ := json.Marshal(map[string]any{
			"error": defaultQuotaDeniedMessage(e.Status()),
			"details": map[string]any{
				"errorCategory": "runtime_quota_denied",
			},
		})
		return body
	}
	return append([]byte(nil), e.Body...)
}

func (e *QuotaDeniedError) Status() int {
	if e != nil && e.StatusCode == http.StatusTooManyRequests {
		return http.StatusTooManyRequests
	}
	return http.StatusPaymentRequired
}

func defaultQuotaDeniedMessage(status int) string {
	if status == http.StatusTooManyRequests {
		return "Post-quota rate limit exceeded."
	}
	return "Runtime access is blocked."
}

type UnavailableError struct {
	Err error
}

func (e *UnavailableError) Error() string {
	if e.Err == nil {
		return "runtime usage unavailable"
	}
	return fmt.Sprintf("runtime usage unavailable: %v", e.Err)
}

func (e *UnavailableError) Unwrap() error {
	return e.Err
}

type ConflictError struct {
	StatusCode int
	Body       []byte
}

func (e *ConflictError) Error() string {
	return "runtime usage operation conflict"
}

func HTTPStatus(err error) int {
	var denied *QuotaDeniedError
	if errors.As(err, &denied) {
		return denied.Status()
	}
	var conflict *ConflictError
	if errors.As(err, &conflict) {
		return http.StatusBadGateway
	}
	return http.StatusServiceUnavailable
}
