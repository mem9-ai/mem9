package encrypt

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
)

// MD5Encryptor uses AES-GCM encryption with a key derived from an MD5 hash.
// The key is MD5 hashed to produce a 16-byte key suitable for AES-128.
type MD5Encryptor struct {
	key []byte
}

// NewMD5Encryptor creates a new MD5Encryptor with the given key.
// The key is MD5 hashed to produce a 16-byte encryption key.
func NewMD5Encryptor(key string) *MD5Encryptor {
	hash := md5.Sum([]byte(key))
	return &MD5Encryptor{key: hash[:]}
}

// Encrypt encrypts the plaintext using AES-GCM and returns base64-encoded ciphertext.
func (e *MD5Encryptor) Encrypt(ctx context.Context, plaintext string) (string, error) {
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", fmt.Errorf("md5 encrypt: create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("md5 encrypt: create gcm: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("md5 encrypt: generate nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt decrypts the base64-encoded ciphertext using AES-GCM.
func (e *MD5Encryptor) Decrypt(ctx context.Context, ciphertext string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", fmt.Errorf("md5 decrypt: decode base64: %w", err)
	}

	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", fmt.Errorf("md5 decrypt: create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("md5 decrypt: create gcm: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("md5 decrypt: ciphertext too short")
	}

	nonce, ciphertextBytes := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertextBytes, nil)
	if err != nil {
		return "", fmt.Errorf("md5 decrypt: decrypt failed: %w", err)
	}

	return string(plaintext), nil
}
