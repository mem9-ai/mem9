package encrypt

import "context"

// PlainEncryptor is a no-op encryptor that stores data in plaintext.
// It provides no encryption and is suitable for development or testing environments.
type PlainEncryptor struct{}

// NewPlainEncryptor creates a new PlainEncryptor instance.
func NewPlainEncryptor() *PlainEncryptor {
	return &PlainEncryptor{}
}

// Encrypt returns the plaintext unchanged (no encryption).
func (e *PlainEncryptor) Encrypt(ctx context.Context, plaintext string) (string, error) {
	return plaintext, nil
}

// Decrypt returns the ciphertext unchanged (no decryption needed).
func (e *PlainEncryptor) Decrypt(ctx context.Context, ciphertext string) (string, error) {
	return ciphertext, nil
}
