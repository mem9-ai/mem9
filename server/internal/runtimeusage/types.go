package runtimeusage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const (
	MeterRecalls     = "recalls"
	MeterMemorySlots = "memory_slots"

	EventTypeRecall        = "recall"
	EventTypeMemoryCreated = "memoryCreated"
	EventTypeMemoryDeleted = "memoryDeleted"

	ReservationStatusCommitted = "committed"
	ReservationStatusReleased  = "released"

	reservationCommitReason              = "operationSucceeded"
	reservationReleaseOperationFailed    = "operationFailed"
	reservationReleaseOperationAbandoned = "operationAbandoned"
	reservationReleaseClientCancelled    = "clientCancelled"
	reservationReleaseTimeout            = "timeout"
)

type Config struct {
	Enabled         bool
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
	RemainingIncludedUnits int64     `json:"remainingIncludedUnits"`
	ReservedUnits          int64     `json:"reservedUnits"`
	OverageAllowed         bool      `json:"overageAllowed"`
}

type Adjustment struct {
	OperationID string
	Meter       string
	Delta       int64
	Reason      string
}

type RecallResult struct {
	MemoryIDs []string
	AgentName string
}

type MemoryCreateResult struct {
	MemoryIDs []string
	AgentName string
}

type MemoryDeleteTarget struct {
	MemoryIDs []string
}

type MemoryDeleteResult struct {
	MemoryIDs        []string
	MemorySlotsDelta int64
	AgentName        string
}

type MeteringEvent struct {
	EventType  string
	Meter      string
	Units      int64
	OccurredAt time.Time
	AgentName  string
	MemoryIDs  []string
}

type OutboxStore interface {
	StoreCommitPending(ctx context.Context, lease *OperationLease, event MeteringEvent) error
	StoreReleasePending(ctx context.Context, lease *OperationLease, reason string) error
	StoreAdjustmentIntent(ctx context.Context, lease *OperationLease, target MemoryDeleteTarget, expiresAt time.Time) error
	StoreAdjustmentDone(ctx context.Context, operationID string, reason string) error
	StoreAdjustmentPending(ctx context.Context, lease *OperationLease, adj Adjustment, event MeteringEvent) error
	MarkOperationDone(ctx context.Context, operationID string, reason string) error
	MarkOperationRetryableFailure(ctx context.Context, operationID string, reason string) error
	MarkUnknownAfterCrash(ctx context.Context, operationID string, reason string) error
}

type Manager interface {
	Enabled() bool
	BeforeRecall(ctx context.Context, subject Subject) (*OperationLease, error)
	AfterRecallSuccess(ctx context.Context, lease *OperationLease, result RecallResult) error
	AfterRecallFailure(ctx context.Context, lease *OperationLease, cause error)
	BeforeMemoryCreate(ctx context.Context, subject Subject, units int64) (*OperationLease, error)
	AfterMemoryCreateSuccess(ctx context.Context, lease *OperationLease, result MemoryCreateResult) error
	AfterMemoryCreateFailure(ctx context.Context, lease *OperationLease, cause error)
	BeforeMemoryDelete(ctx context.Context, subject Subject, target MemoryDeleteTarget) (*OperationLease, error)
	AfterMemoryDeleteSuccess(ctx context.Context, lease *OperationLease, result MemoryDeleteResult) error
	AfterMemoryDeleteFailure(ctx context.Context, lease *OperationLease, cause error)
}

type QuotaClient interface {
	Reserve(ctx context.Context, subject Subject, operationID string, op Operation) (*Reservation, error)
	FinalizeReservation(ctx context.Context, subject Subject, operationID string, status string, reason string) error
	ApplyAdjustment(ctx context.Context, subject Subject, adj Adjustment) error
}

type QuotaDeniedError struct {
	StatusCode int
	Body       []byte
}

func (e *QuotaDeniedError) Error() string {
	return "runtime usage quota denied"
}

func (e *QuotaDeniedError) ResponseBody() []byte {
	if len(e.Body) == 0 {
		body, _ := json.Marshal(map[string]any{
			"code":      "runtime_quota_denied",
			"message":   "runtime usage quota denied",
			"retryable": false,
		})
		return body
	}
	return append([]byte(nil), e.Body...)
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
		return http.StatusPaymentRequired
	}
	var conflict *ConflictError
	if errors.As(err, &conflict) {
		return http.StatusBadGateway
	}
	return http.StatusServiceUnavailable
}
