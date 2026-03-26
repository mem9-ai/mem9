package encrypt

import (
	"fmt"
	"strings"
)

// Type represents the type of encryptor to use.
type Type string

const (
	// TypePlain stores data in plaintext (no encryption).
	TypePlain Type = "plain"
	// TypeMD5 uses AES-GCM encryption with a key derived from MD5 hash.
	TypeMD5 Type = "md5"
	// TypeKMS uses AWS KMS for encryption.
	TypeKMS Type = "kms"
)

// Config holds configuration for creating an Encryptor.
type Config struct {
	// Type specifies the encryption type: "plain", "md5", or "kms".
	Type Type
	// Key is the encryption key or KMS key ID.
	// For "md5": the key string used to derive the AES key.
	// For "kms": the KMS key ID, ARN, alias name, or alias ARN.
	// For "plain": ignored.
	Key string
}

// New creates an Encryptor based on the provided configuration.
// Supported types:
//   - "plain": No encryption, returns plaintext as-is.
//   - "md5": AES-GCM encryption with MD5-derived key.
//   - "kms": AWS KMS encryption (requires AWS credentials).
func New(cfg Config) (Encryptor, error) {
	switch strings.ToLower(string(cfg.Type)) {
	case string(TypePlain), "", "none":
		return NewPlainEncryptor(), nil
	case string(TypeMD5):
		if cfg.Key == "" {
			return nil, fmt.Errorf("md5 encryptor requires a key")
		}
		return NewMD5Encryptor(cfg.Key), nil
	case string(TypeKMS):
		if cfg.Key == "" {
			return nil, fmt.Errorf("kms encryptor requires a key ID")
		}
		return NewKMSEncryptor(cfg.Key)
	default:
		return nil, fmt.Errorf("unsupported encryptor type: %q", cfg.Type)
	}
}

// mustNew creates an Encryptor and panics if creation fails.
// This is intended for test setup only; production code should use New() with error handling.
func mustNew(cfg Config) Encryptor {
	encryptor, err := New(cfg)
	if err != nil {
		panic(fmt.Sprintf("failed to create encryptor: %v", err))
	}
	return encryptor
}
