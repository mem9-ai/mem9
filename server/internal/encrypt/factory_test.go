package encrypt

import (
	"testing"
)

func TestNew(t *testing.T) {
	t.Run("plain encryptor", func(t *testing.T) {
		enc, err := New(Config{Type: TypePlain})
		if err != nil {
			t.Fatalf("failed to create plain encryptor: %v", err)
		}
		if _, ok := enc.(*PlainEncryptor); !ok {
			t.Errorf("expected *PlainEncryptor, got %T", enc)
		}
	})

	t.Run("plain encryptor with empty type", func(t *testing.T) {
		enc, err := New(Config{Type: ""})
		if err != nil {
			t.Fatalf("failed to create plain encryptor: %v", err)
		}
		if _, ok := enc.(*PlainEncryptor); !ok {
			t.Errorf("expected *PlainEncryptor, got %T", enc)
		}
	})

	t.Run("plain encryptor with none type", func(t *testing.T) {
		enc, err := New(Config{Type: "none"})
		if err != nil {
			t.Fatalf("failed to create plain encryptor: %v", err)
		}
		if _, ok := enc.(*PlainEncryptor); !ok {
			t.Errorf("expected *PlainEncryptor, got %T", enc)
		}
	})

	t.Run("md5 encryptor", func(t *testing.T) {
		enc, err := New(Config{Type: TypeMD5, Key: "my-key"})
		if err != nil {
			t.Fatalf("failed to create md5 encryptor: %v", err)
		}
		if _, ok := enc.(*MD5Encryptor); !ok {
			t.Errorf("expected *MD5Encryptor, got %T", enc)
		}
	})

	t.Run("md5 encryptor without key", func(t *testing.T) {
		_, err := New(Config{Type: TypeMD5})
		if err == nil {
			t.Error("expected error when creating md5 encryptor without key")
		}
	})

	t.Run("unsupported type", func(t *testing.T) {
		_, err := New(Config{Type: "unsupported"})
		if err == nil {
			t.Error("expected error for unsupported encryptor type")
		}
	})
}

func TestMustNew(t *testing.T) {
	t.Run("successful creation", func(t *testing.T) {
		enc := mustNew(Config{Type: TypePlain})
		if enc == nil {
			t.Error("expected non-nil encryptor")
		}
	})

	t.Run("panics on error", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic for invalid config")
			}
		}()
		mustNew(Config{Type: "invalid"})
	})
}
