package credentials

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestKeyringSealWithKIDOpenWithAAD(t *testing.T) {
	keyring := loadTestKeyring(t, "space-k1", map[string][]byte{
		"space-k1": bytesOf(0x22),
		"field-k1": bytesOf(0x33),
	}, nil)

	sealed, err := keyring.SealWithKID("field-k1", []byte("field-a"), []byte("secret-value"))
	if err != nil {
		t.Fatalf("SealWithKID: %v", err)
	}
	if len(sealed) <= 12 {
		t.Fatalf("sealed length = %d, want nonce and ciphertext", len(sealed))
	}
	plaintext, err := keyring.OpenWithAAD("field-k1", []byte("field-a"), sealed)
	if err != nil {
		t.Fatalf("OpenWithAAD: %v", err)
	}
	if string(plaintext) != "secret-value" {
		t.Fatalf("plaintext = %q", plaintext)
	}

	if _, err := keyring.SealWithKID("missing", []byte("field-a"), []byte("secret-value")); err == nil {
		t.Fatal("SealWithKID unknown kid error = nil")
	}
	if _, err := keyring.OpenWithAAD("missing", []byte("field-a"), sealed); err == nil {
		t.Fatal("OpenWithAAD unknown kid error = nil")
	}
	if _, err := keyring.OpenWithAAD("field-k1", []byte("field-b"), sealed); err == nil {
		t.Fatal("OpenWithAAD wrong AAD error = nil")
	}
}

func TestLoadKeyringValidSecretFieldKIDs(t *testing.T) {
	keyring := loadTestKeyring(t, "space-k1", map[string][]byte{
		"space-k1": bytesOf(0x22),
		"db-k1":    bytesOf(0x33),
		"wh-k1":    bytesOf(0x34),
		"ob-k1":    bytesOf(0x35),
	}, nil)
	if _, ok := keyring.SecretFieldKID("tenants.db_password"); ok {
		t.Fatal("SecretFieldKID missing field = true")
	}
}

func TestLoadKeyringWithSecretFieldKIDs(t *testing.T) {
	keyring := loadTestKeyring(t, "space-k1", map[string][]byte{
		"space-k1": bytesOf(0x22),
		"db-k1":    bytesOf(0x33),
		"wh-k1":    bytesOf(0x34),
		"ob-k1":    bytesOf(0x35),
	}, map[string]string{
		"tenants.db_password":                  "db-k1",
		"webhook_endpoints.secret_ciphertext":  "wh-k1",
		"runtime_usage_outbox.api_key_subject": "ob-k1",
	})

	kid, ok := keyring.SecretFieldKID("tenants.db_password")
	if !ok || kid != "db-k1" {
		t.Fatalf("SecretFieldKID = %q, %v; want db-k1, true", kid, ok)
	}
	if _, ok := keyring.SecretFieldKID("unknown.field"); ok {
		t.Fatal("SecretFieldKID unknown field = true")
	}
}

func TestLoadKeyringWithoutSecretFieldKIDs(t *testing.T) {
	keyring := loadTestKeyring(t, "space-k1", map[string][]byte{
		"space-k1": bytesOf(0x22),
	}, nil)
	if _, ok := keyring.SecretFieldKID("tenants.db_password"); ok {
		t.Fatal("SecretFieldKID missing field = true")
	}
}

func TestLoadKeyringRejectsInvalidSecretFieldKIDs(t *testing.T) {
	tests := []struct {
		name string
		kids map[string]string
	}{
		{
			name: "unknown kid",
			kids: map[string]string{"tenants.db_password": "missing"},
		},
		{
			name: "space credential kid",
			kids: map[string]string{"tenants.db_password": "space-k1"},
		},
		{
			name: "shared kid",
			kids: map[string]string{
				"tenants.db_password":                 "field-k1",
				"webhook_endpoints.secret_ciphertext": "field-k1",
			},
		},
		{
			name: "empty field",
			kids: map[string]string{"": "field-k1"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := writeTestKeyring(t, "space-k1", map[string][]byte{
				"space-k1": bytesOf(0x22),
				"field-k1": bytesOf(0x33),
			}, tt.kids)
			if _, err := LoadKeyring(path); err == nil {
				t.Fatal("LoadKeyring error = nil")
			}
		})
	}
}

func TestLoadKeyringRejectsDuplicateEncryptionKeyMaterial(t *testing.T) {
	path := writeTestKeyring(t, "space-k1", map[string][]byte{
		"space-k1": bytesOf(0x22),
		"field-k1": bytesOf(0x33),
		"field-k2": bytesOf(0x33),
	}, nil)
	if _, err := LoadKeyring(path); err == nil {
		t.Fatal("LoadKeyring error = nil")
	}
}

func loadTestKeyring(t *testing.T, activeKID string, encryptionKeys map[string][]byte, fieldKIDs map[string]string) *Keyring {
	t.Helper()
	keyring, err := LoadKeyring(writeTestKeyring(t, activeKID, encryptionKeys, fieldKIDs))
	if err != nil {
		t.Fatalf("LoadKeyring: %v", err)
	}
	return keyring
}

func writeTestKeyring(t *testing.T, activeKID string, encryptionKeys map[string][]byte, fieldKIDs map[string]string) string {
	t.Helper()
	encodedKeys := make(map[string]string, len(encryptionKeys))
	for kid, key := range encryptionKeys {
		encodedKeys[kid] = base64.StdEncoding.EncodeToString(key)
	}
	contents := fmt.Sprintf(`{
  "hash_version": "h1",
  "hmac_keys": {"h1": %q},
  "encryption_kid": %q,
  "encryption_keys": %s,
  "secret_field_kids": %s
}`, base64.StdEncoding.EncodeToString(bytesOf(0x11)), activeKID, mustJSONMap(t, encodedKeys), mustJSONMap(t, fieldKIDs))
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
