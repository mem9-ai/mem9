package domain

import "errors"

var (
	ErrNotFound                = errors.New("not found")
	ErrConflict                = errors.New("version conflict") // Phase 2: used when LLM merge replaces LWW
	ErrDuplicateKey            = errors.New("duplicate key")
	ErrValidation              = errors.New("validation error")
	ErrWriteConflict           = errors.New("write conflict, retry")
	ErrNotSupported            = errors.New("not supported")
	ErrAutoVectorSearchSkipped = errors.New("auto vector search skipped")
	ErrSchemaIncompatible      = errors.New("schema incompatible")
	ErrFTSSearchTruncated      = errors.New("fts search truncated")
	// ErrManagementKeyRequired reports a valid Space Chain key that is not a
	// management key used where one is needed. The text is shown to callers, so
	// it never carries the key.
	ErrManagementKeyRequired = errors.New("a Space Chain management key is required")
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

// SchemaCompatibilityError reports a tenant schema/runtime configuration mismatch.
type SchemaCompatibilityError struct {
	Message string
}

func (e *SchemaCompatibilityError) Error() string {
	return e.Message
}

func (e *SchemaCompatibilityError) Unwrap() error {
	return ErrSchemaIncompatible
}
