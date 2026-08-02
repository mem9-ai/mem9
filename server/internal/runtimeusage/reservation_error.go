package runtimeusage

import (
	"fmt"
	"net/http"
	"time"
)

type reservationErrorCode string

const (
	reservationErrorCodeRegistryConflict    reservationErrorCode = "registry_conflict"
	reservationErrorCodeOperationInProgress reservationErrorCode = "operation_in_progress"
	reservationErrorCodeConcurrencyLimited  reservationErrorCode = "reservation_concurrency_limited"
	reservationErrorCodeUnavailable         reservationErrorCode = "unavailable"
	reservationErrorCodeOperationConflict   reservationErrorCode = "operation_conflict"
)

type reservationErrorPolicy struct {
	statusCode int
	retryable  bool
}

func (c reservationErrorCode) policy() (reservationErrorPolicy, bool) {
	switch c {
	case reservationErrorCodeRegistryConflict, reservationErrorCodeOperationInProgress:
		return reservationErrorPolicy{statusCode: http.StatusConflict, retryable: true}, true
	case reservationErrorCodeConcurrencyLimited:
		return reservationErrorPolicy{statusCode: http.StatusTooManyRequests, retryable: true}, true
	case reservationErrorCodeUnavailable:
		return reservationErrorPolicy{statusCode: http.StatusServiceUnavailable, retryable: true}, true
	case reservationErrorCodeOperationConflict:
		return reservationErrorPolicy{statusCode: http.StatusConflict}, true
	default:
		return reservationErrorPolicy{}, false
	}
}

type reservationError struct {
	code       reservationErrorCode
	retryable  bool
	retryAfter time.Duration
	cause      error
}

func newReservationError(code reservationErrorCode, retryable bool, retryAfter time.Duration) *reservationError {
	var cause error = &UnavailableError{}
	if code == reservationErrorCodeOperationConflict {
		policy, _ := code.policy()
		cause = &ConflictError{StatusCode: policy.statusCode}
	}
	return &reservationError{
		code:       code,
		retryable:  retryable,
		retryAfter: retryAfter,
		cause:      cause,
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
	if e == nil || !e.retryable {
		return false
	}
	policy, known := e.code.policy()
	return known && policy.retryable
}
