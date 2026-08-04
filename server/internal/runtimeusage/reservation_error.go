package runtimeusage

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

type reservationErrorCode string

const (
	reservationErrorCodeUnknown             reservationErrorCode = "unknown"
	reservationErrorCodeRegistryConflict    reservationErrorCode = "registry_conflict"
	reservationErrorCodeOperationInProgress reservationErrorCode = "operation_in_progress"
	reservationErrorCodeRegistryBusy        reservationErrorCode = "registry_busy"
	reservationErrorCodeConcurrencyLimited  reservationErrorCode = "reservation_concurrency_limited"
	reservationErrorCodeUnavailable         reservationErrorCode = "unavailable"
	reservationErrorCodeOperationConflict   reservationErrorCode = "operation_conflict"
)

type reservationRetryDecision string

const (
	reservationRetryDecisionRetryable reservationRetryDecision = "retryable"
	reservationRetryDecisionTerminal  reservationRetryDecision = "terminal"
	reservationRetryDecisionExhausted reservationRetryDecision = "exhausted"
)

type reservationExhaustionReason string

const (
	reservationExhaustionContractNotRetryable reservationExhaustionReason = "contract_not_retryable"
	reservationExhaustionMaxAttempts          reservationExhaustionReason = "max_attempts"
	reservationExhaustionUnrecognizedContract reservationExhaustionReason = "unrecognized_contract"
)

type reservationErrorPolicy struct {
	statusCode int
	retryable  bool
}

func (c reservationErrorCode) policy() (reservationErrorPolicy, bool) {
	switch c {
	case reservationErrorCodeRegistryConflict:
		return reservationErrorPolicy{statusCode: http.StatusConflict, retryable: true}, true
	case reservationErrorCodeOperationInProgress, reservationErrorCodeRegistryBusy, reservationErrorCodeConcurrencyLimited:
		return reservationErrorPolicy{statusCode: http.StatusTooManyRequests, retryable: true}, true
	case reservationErrorCodeUnavailable:
		return reservationErrorPolicy{statusCode: http.StatusServiceUnavailable, retryable: true}, true
	case reservationErrorCodeOperationConflict:
		return reservationErrorPolicy{statusCode: http.StatusConflict}, true
	default:
		return reservationErrorPolicy{}, false
	}
}

type reservationFailureState struct {
	code           reservationErrorCode
	upstreamStatus int
	retryable      bool
	retryAfter     time.Duration
	terminalReason reservationExhaustionReason
}

func (s reservationFailureState) publicHTTPStatus() int {
	if s.upstreamStatus == http.StatusTooManyRequests {
		return http.StatusTooManyRequests
	}
	return http.StatusServiceUnavailable
}

func (s reservationFailureState) details() ReservationFailure {
	decision := reservationRetryDecisionRetryable
	exhaustion := reservationExhaustionReason("")
	if !s.retryable {
		decision = reservationRetryDecisionTerminal
		exhaustion = s.terminalReason
	}
	return ReservationFailure{
		UpstreamStatus:   s.upstreamStatus,
		Code:             string(s.code),
		Retryable:        s.retryable,
		RetryAfter:       retryAfterSeconds(s.retryAfter),
		AttemptCount:     1,
		RetryDecision:    string(decision),
		ExhaustionReason: string(exhaustion),
	}
}

type reservationError struct {
	reservationFailureState
	cause error
}

func newReservationError(code reservationErrorCode, retryable bool, retryAfter time.Duration) *reservationError {
	policy, known := code.policy()
	var cause error = &UnavailableError{}
	if code == reservationErrorCodeOperationConflict {
		cause = &ConflictError{StatusCode: policy.statusCode}
	}
	return &reservationError{
		reservationFailureState: reservationFailureState{
			code:           code,
			upstreamStatus: policy.statusCode,
			retryable:      retryable && known && policy.retryable,
			retryAfter:     retryAfter,
			terminalReason: reservationExhaustionContractNotRetryable,
		},
		cause: cause,
	}
}

func (e *reservationError) Error() string {
	if e == nil {
		return "runtime usage reservation failed"
	}
	return fmt.Sprintf("runtime usage reservation failed: %s", e.code)
}

func (e *reservationError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func (e *reservationError) ReservationRetryable() bool {
	return e != nil && e.retryable
}

func (e *reservationError) publicHTTPStatus() int {
	if e == nil {
		return http.StatusServiceUnavailable
	}
	return e.reservationFailureState.publicHTTPStatus()
}

func (e *reservationError) reservationFailureDetails() ReservationFailure {
	if e == nil {
		return ReservationFailure{}
	}
	return e.reservationFailureState.details()
}

type reservationStatusError struct {
	reservationFailureState
	cause error
}

func newReservationStatusError(status int, retryAfter time.Duration, cause error) *reservationStatusError {
	return &reservationStatusError{
		reservationFailureState: reservationFailureState{
			code:           reservationErrorCodeUnknown,
			upstreamStatus: status,
			retryAfter:     retryAfter,
			terminalReason: reservationExhaustionUnrecognizedContract,
		},
		cause: cause,
	}
}

func (e *reservationStatusError) Error() string {
	if e == nil {
		return "runtime usage reservation failed"
	}
	return fmt.Sprintf("runtime usage reservation failed: upstream status %d", e.upstreamStatus)
}

func (e *reservationStatusError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func (e *reservationStatusError) publicHTTPStatus() int {
	if e == nil {
		return http.StatusServiceUnavailable
	}
	return e.reservationFailureState.publicHTTPStatus()
}

func (e *reservationStatusError) reservationFailureDetails() ReservationFailure {
	if e == nil {
		return ReservationFailure{}
	}
	return e.reservationFailureState.details()
}

// ReservationFailure describes the bounded provider-contract outcome exposed to handlers and structured logs.
type ReservationFailure struct {
	UpstreamStatus   int
	Code             string
	Retryable        bool
	RetryAfter       string
	AttemptCount     int
	RetryDecision    string
	ExhaustionReason string
}

// ReservationFailureDetails returns bounded Reservation metadata when err came from the Reserve path.
func ReservationFailureDetails(err error) (ReservationFailure, bool) {
	var failure interface {
		reservationFailureDetails() ReservationFailure
	}
	if !errors.As(err, &failure) {
		return ReservationFailure{}, false
	}
	return failure.reservationFailureDetails(), true
}

type finalReservationFailure struct {
	cause   error
	details ReservationFailure
}

func (e *finalReservationFailure) Error() string { return e.cause.Error() }
func (e *finalReservationFailure) Unwrap() error { return e.cause }
func (e *finalReservationFailure) reservationFailureDetails() ReservationFailure {
	return e.details
}

func withFinalReservationDecision(err error, attemptCount int, decision reservationRetryDecision, exhaustion reservationExhaustionReason) error {
	details, ok := ReservationFailureDetails(err)
	if !ok {
		return err
	}
	details.AttemptCount = attemptCount
	details.RetryDecision = string(decision)
	details.ExhaustionReason = string(exhaustion)
	return &finalReservationFailure{cause: err, details: details}
}

func retryAfterSeconds(delay time.Duration) string {
	if delay <= 0 {
		return ""
	}
	seconds := int64(delay / time.Second)
	if seconds <= 0 {
		return ""
	}
	return strconv.FormatInt(seconds, 10)
}
