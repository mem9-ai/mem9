package domain

import "errors"

var (
	ErrNotFound      = errors.New("not found")
	ErrConflict      = errors.New("version conflict") // Phase 2: used when LLM merge replaces LWW
	ErrDuplicateKey  = errors.New("duplicate key")
	ErrValidation    = errors.New("validation error")
	ErrWriteConflict = errors.New("write conflict, retry")
)

// ValidationError wraps ErrValidation with a field-level message.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	if e.Field != "" {
		return e.Field + ": " + e.Message
	}
	return e.Message
}

func (e *ValidationError) Unwrap() error {
	return ErrValidation
}
