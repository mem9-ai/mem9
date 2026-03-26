package encrypt

import (
	"context"
	"testing"
)

func TestMD5Encryptor(t *testing.T) {
	enc := NewMD5Encryptor("my-secret-key")
	ctx := context.Background()

	t.Run("encrypt produces different output", func(t *testing.T) {
		plaintext := "my-secret-password"
		ciphertext, err := enc.Encrypt(ctx, plaintext)
		if err != nil {
			t.Fatalf("encrypt failed: %v", err)
		}
		if ciphertext == plaintext {
			t.Error("ciphertext should be different from plaintext")
		}
	})

	t.Run("decrypt returns original plaintext", func(t *testing.T) {
		plaintext := "my-secret-password"
		ciphertext, err := enc.Encrypt(ctx, plaintext)
		if err != nil {
			t.Fatalf("encrypt failed: %v", err)
		}

		decrypted, err := enc.Decrypt(ctx, ciphertext)
		if err != nil {
			t.Fatalf("decrypt failed: %v", err)
		}
		if decrypted != plaintext {
			t.Errorf("expected %q, got %q", plaintext, decrypted)
		}
	})

	t.Run("different keys produce different ciphertexts", func(t *testing.T) {
		plaintext := "my-secret-password"

		enc1 := NewMD5Encryptor("key1")
		enc2 := NewMD5Encryptor("key2")

		ciphertext1, err := enc1.Encrypt(ctx, plaintext)
		if err != nil {
			t.Fatalf("encrypt with key1 failed: %v", err)
		}

		ciphertext2, err := enc2.Encrypt(ctx, plaintext)
		if err != nil {
			t.Fatalf("encrypt with key2 failed: %v", err)
		}

		if ciphertext1 == ciphertext2 {
			t.Error("different keys should produce different ciphertexts")
		}
	})

	t.Run("wrong key cannot decrypt", func(t *testing.T) {
		plaintext := "my-secret-password"

		enc1 := NewMD5Encryptor("correct-key")
		enc2 := NewMD5Encryptor("wrong-key")

		ciphertext, err := enc1.Encrypt(ctx, plaintext)
		if err != nil {
			t.Fatalf("encrypt failed: %v", err)
		}

		_, err = enc2.Decrypt(ctx, ciphertext)
		if err == nil {
			t.Error("decrypt with wrong key should fail")
		}
	})

	t.Run("same key produces different ciphertexts (random nonce)", func(t *testing.T) {
		plaintext := "my-secret-password"

		enc1 := NewMD5Encryptor("same-key")
		enc2 := NewMD5Encryptor("same-key")

		ciphertext1, err := enc1.Encrypt(ctx, plaintext)
		if err != nil {
			t.Fatalf("encrypt with enc1 failed: %v", err)
		}

		ciphertext2, err := enc2.Encrypt(ctx, plaintext)
		if err != nil {
			t.Fatalf("encrypt with enc2 failed: %v", err)
		}

		// Random nonce means same plaintext should produce different ciphertexts
		if ciphertext1 == ciphertext2 {
			t.Error("same plaintext with random nonce should produce different ciphertexts")
		}

		// But both should decrypt to the same plaintext
		decrypted1, err := enc1.Decrypt(ctx, ciphertext1)
		if err != nil {
			t.Fatalf("decrypt ciphertext1 failed: %v", err)
		}
		decrypted2, err := enc2.Decrypt(ctx, ciphertext2)
		if err != nil {
			t.Fatalf("decrypt ciphertext2 failed: %v", err)
		}
		if decrypted1 != plaintext || decrypted2 != plaintext {
			t.Error("decrypted plaintext should match original")
		}
	})

	t.Run("handles empty string", func(t *testing.T) {
		plaintext := ""
		ciphertext, err := enc.Encrypt(ctx, plaintext)
		if err != nil {
			t.Fatalf("encrypt failed: %v", err)
		}

		decrypted, err := enc.Decrypt(ctx, ciphertext)
		if err != nil {
			t.Fatalf("decrypt failed: %v", err)
		}
		if decrypted != plaintext {
			t.Errorf("expected empty string, got %q", decrypted)
		}
	})

	t.Run("handles unicode characters", func(t *testing.T) {
		plaintext := "密码-🔐-パスワード"
		ciphertext, err := enc.Encrypt(ctx, plaintext)
		if err != nil {
			t.Fatalf("encrypt failed: %v", err)
		}

		decrypted, err := enc.Decrypt(ctx, ciphertext)
		if err != nil {
			t.Fatalf("decrypt failed: %v", err)
		}
		if decrypted != plaintext {
			t.Errorf("expected %q, got %q", plaintext, decrypted)
		}
	})
}
