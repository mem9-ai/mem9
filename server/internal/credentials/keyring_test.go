package credentials

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestKeyringSealOpenWithAAD(t *testing.T) {
	keyring := loadTestKeyring(t, "enc-current", map[string][]byte{
		"enc-current": bytesOf(0x22),
	})

	kid, sealed, err := keyring.SealWithAAD([]byte("field-a"), []byte("secret-value"))
	if err != nil {
		t.Fatalf("SealWithAAD: %v", err)
	}
	if kid != "enc-current" {
		t.Fatalf("kid = %q, want enc-current", kid)
	}
	if len(sealed) <= 12 {
		t.Fatalf("sealed length = %d, want nonce and ciphertext", len(sealed))
	}

	plaintext, err := keyring.OpenWithAAD(kid, []byte("field-a"), sealed)
	if err != nil {
		t.Fatalf("OpenWithAAD: %v", err)
	}
	if string(plaintext) != "secret-value" {
		t.Fatalf("plaintext = %q", plaintext)
	}

	for _, tt := range []struct {
		name   string
		kid    string
		aad    []byte
		sealed []byte
	}{
		{name: "unknown kid", kid: "missing", aad: []byte("field-a"), sealed: sealed},
		{name: "short input", kid: kid, aad: []byte("field-a"), sealed: sealed[:11]},
		{name: "wrong aad", kid: kid, aad: []byte("field-b"), sealed: sealed},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := keyring.OpenWithAAD(tt.kid, tt.aad, tt.sealed)
			if err == nil {
				t.Fatal("OpenWithAAD error = nil")
			}
			if strings.Contains(err.Error(), "secret-value") {
				t.Fatalf("error leaked plaintext: %v", err)
			}
		})
	}
}

func TestLoadKeyringRejectsEncryptionKIDContainingColon(t *testing.T) {
	path := writeTestKeyring(t, "enc:current", map[string][]byte{
		"enc:current": bytesOf(0x22),
	})
	_, err := LoadKeyring(path)
	if err == nil {
		t.Fatal("LoadKeyring error = nil")
	}
}

func loadTestKeyring(t *testing.T, activeKID string, encryptionKeys map[string][]byte) *Keyring {
	t.Helper()
	keyring, err := LoadKeyring(writeTestKeyring(t, activeKID, encryptionKeys))
	if err != nil {
		t.Fatalf("LoadKeyring: %v", err)
	}
	return keyring
}

func writeTestKeyring(t *testing.T, activeKID string, encryptionKeys map[string][]byte) string {
	t.Helper()
	encodedKeys := make(map[string]string, len(encryptionKeys))
	for kid, key := range encryptionKeys {
		encodedKeys[kid] = base64.StdEncoding.EncodeToString(key)
	}
	contents := fmt.Sprintf(`{
  "hash_version": "h1",
  "hmac_keys": {"h1": %q},
  "encryption_kid": %q,
  "encryption_keys": %s
}`, base64.StdEncoding.EncodeToString(bytesOf(0x11)), activeKID, mustJSONMap(t, encodedKeys))
	path := filepath.Join(t.TempDir(), "keyring.json")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return path
}

func mustJSONMap(t *testing.T, values map[string]string) string {
	t.Helper()
	parts := make([]string, 0, len(values))
	for key, value := range values {
		parts = append(parts, fmt.Sprintf("%q:%q", key, value))
	}
	return "{" + strings.Join(parts, ",") + "}"
}

func bytesOf(value byte) []byte {
	result := make([]byte, 32)
	for i := range result {
		result[i] = value
	}
	return result
}
