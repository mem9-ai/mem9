package encrypt

import (
	"context"
	"testing"
)

func TestPlainEncryptor(t *testing.T) {
	enc := NewPlainEncryptor()
	ctx := context.Background()

	t.Run("encrypt returns plaintext", func(t *testing.T) {
		plaintext := "my-secret-password"
		ciphertext, err := enc.Encrypt(ctx, plaintext)
		if err != nil {
			t.Fatalf("encrypt failed: %v", err)
		}
		if ciphertext != plaintext {
			t.Errorf("expected %q, got %q", plaintext, ciphertext)
		}
	})

	t.Run("decrypt returns ciphertext unchanged", func(t *testing.T) {
		ciphertext := "my-secret-password"
		plaintext, err := enc.Decrypt(ctx, ciphertext)
		if err != nil {
			t.Fatalf("decrypt failed: %v", err)
		}
		if plaintext != ciphertext {
			t.Errorf("expected %q, got %q", ciphertext, plaintext)
		}
	})

	t.Run("encrypt decrypt roundtrip", func(t *testing.T) {
		original := "test-password-123"
		encrypted, err := enc.Encrypt(ctx, original)
		if err != nil {
			t.Fatalf("encrypt failed: %v", err)
		}
		decrypted, err := enc.Decrypt(ctx, encrypted)
		if err != nil {
			t.Fatalf("decrypt failed: %v", err)
		}
		if decrypted != original {
			t.Errorf("roundtrip failed: expected %q, got %q", original, decrypted)
		}
	})
}
