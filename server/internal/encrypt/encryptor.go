// Package encrypt provides encryption utilities for sensitive data like database passwords.
package encrypt

import "context"

// Encryptor defines the interface for encryption and decryption operations.
type Encryptor interface {
	// Encrypt encrypts the given plaintext and returns the ciphertext.
	// Returns an error if encryption fails.
	Encrypt(ctx context.Context, plaintext string) (string, error)

	// Decrypt decrypts the given ciphertext and returns the plaintext.
	// Returns an error if decryption fails.
	Decrypt(ctx context.Context, ciphertext string) (string, error)
}
