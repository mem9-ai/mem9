package secrets

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"

	"github.com/qiffang/mnemos/server/internal/credentials"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/metrics"
)

func TestProtectorEncV1RoundTripAndFailures(t *testing.T) {
	keyring := loadProtectorKeyring(t, "new", map[string][]byte{
		"old": keyBytes(0x22),
		"new": keyBytes(0x33),
	})
	protector, err := New(keyring, encrypt.NewPlainEncryptor(), WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	tenant := protector.For(FieldTenantDBPassword)
	webhook := protector.For(FieldWebhookSecret)

	stored, err := tenant.Encrypt(context.Background(), "sensitive-password")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if !strings.HasPrefix(stored, "enc:v1:new:") {
		t.Fatalf("stored value has unexpected format")
	}
	plaintext, err := tenant.Decrypt(context.Background(), stored)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if plaintext != "sensitive-password" {
		t.Fatalf("plaintext mismatch")
	}

	tests := []struct {
		name  string
		value string
		field encrypt.Encryptor
	}{
		{name: "wrong field aad", value: stored, field: webhook},
		{name: "tampered payload", value: tamperStoredValue(t, stored), field: tenant},
		{name: "unknown version", value: "enc:v2:new:AAAA", field: tenant},
		{name: "unknown kid", value: strings.Replace(stored, ":new:", ":missing:", 1), field: tenant},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := tt.field.Decrypt(context.Background(), tt.value)
			if err == nil {
				t.Fatal("Decrypt error = nil")
			}
			for _, secret := range []string{"sensitive-password", tt.value} {
				if strings.Contains(err.Error(), secret) {
					t.Fatalf("error leaked secret data")
				}
			}
		})
	}
}

func TestProtectorLegacyDefaultAndMetrics(t *testing.T) {
	keyring := loadProtectorKeyring(t, "new", map[string][]byte{"new": keyBytes(0x33)})
	protector, err := New(keyring, encrypt.NewPlainEncryptor(), "")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	fieldEncryptor := protector.For(FieldWebhookSecret)

	stored, err := fieldEncryptor.Encrypt(context.Background(), "legacy-secret")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if stored != "legacy-secret" {
		t.Fatalf("stored = %q, want legacy plaintext", stored)
	}
	before := counterValue(t, metrics.SecretLegacyReadsTotal.WithLabelValues(FieldWebhookSecret))
	plaintext, err := fieldEncryptor.Decrypt(context.Background(), stored)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if plaintext != stored {
		t.Fatalf("plaintext = %q", plaintext)
	}
	after := counterValue(t, metrics.SecretLegacyReadsTotal.WithLabelValues(FieldWebhookSecret))
	if after != before+1 {
		t.Fatalf("legacy reads counter delta = %v, want 1", after-before)
	}
}

func TestProtectorOldKIDRemainsReadableAfterRotation(t *testing.T) {
	keys := map[string][]byte{"old": keyBytes(0x22), "new": keyBytes(0x33)}
	oldProtector, err := New(loadProtectorKeyring(t, "old", keys), encrypt.NewPlainEncryptor(), WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New old protector: %v", err)
	}
	stored, err := oldProtector.For(FieldWebhookSecret).Encrypt(context.Background(), "rotated-secret")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	newProtector, err := New(loadProtectorKeyring(t, "new", keys), encrypt.NewPlainEncryptor(), WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New new protector: %v", err)
	}
	plaintext, err := newProtector.For(FieldWebhookSecret).Decrypt(context.Background(), stored)
	if err != nil {
		t.Fatalf("Decrypt old kid: %v", err)
	}
	if plaintext != "rotated-secret" {
		t.Fatalf("plaintext mismatch")
	}
}

func TestProtectorEmptyValuesAndDBPasswordLimit(t *testing.T) {
	protector, err := New(loadProtectorKeyring(t, "new", map[string][]byte{"new": keyBytes(0x33)}), encrypt.NewPlainEncryptor(), WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	fieldEncryptor := protector.For(FieldTenantDBPassword)

	stored, err := fieldEncryptor.Encrypt(context.Background(), "")
	if err != nil || stored != "" {
		t.Fatalf("Encrypt empty = %q, %v", stored, err)
	}
	plaintext, err := fieldEncryptor.Decrypt(context.Background(), "")
	if err != nil || plaintext != "" {
		t.Fatalf("Decrypt empty = %q, %v", plaintext, err)
	}

	withinLimit, err := fieldEncryptor.Encrypt(context.Background(), strings.Repeat("x", 155))
	if err != nil {
		t.Fatalf("Encrypt 255-character stored value: %v", err)
	}
	if len(withinLimit) != 255 {
		t.Fatalf("stored length = %d, want 255", len(withinLimit))
	}

	_, err = fieldEncryptor.Encrypt(context.Background(), strings.Repeat("x", 156))
	if err == nil {
		t.Fatal("Encrypt oversized db password error = nil")
	}
	if strings.Contains(err.Error(), strings.Repeat("x", 20)) {
		t.Fatalf("error leaked plaintext")
	}
}

func TestNewRejectsInvalidWriteFormat(t *testing.T) {
	_, err := New(loadProtectorKeyring(t, "new", map[string][]byte{"new": keyBytes(0x33)}), encrypt.NewPlainEncryptor(), "future")
	if err == nil {
		t.Fatal("New error = nil")
	}
}

func tamperStoredValue(t *testing.T, stored string) string {
	t.Helper()
	parts := strings.Split(stored, ":")
	if len(parts) != 4 {
		t.Fatalf("stored parts = %d", len(parts))
	}
	sealed, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		t.Fatalf("decode stored: %v", err)
	}
	sealed[len(sealed)-1] ^= 0xff
	parts[3] = base64.RawURLEncoding.EncodeToString(sealed)
	return strings.Join(parts, ":")
}

func loadProtectorKeyring(t *testing.T, activeKID string, keys map[string][]byte) *credentials.Keyring {
	t.Helper()
	encodedKeys := make([]string, 0, len(keys))
	for kid, key := range keys {
		encodedKeys = append(encodedKeys, fmt.Sprintf("%q:%q", kid, base64.StdEncoding.EncodeToString(key)))
	}
	contents := fmt.Sprintf(`{
  "hash_version":"h1",
  "hmac_keys":{"h1":%q},
  "encryption_kid":%q,
  "encryption_keys":{%s}
}`, base64.StdEncoding.EncodeToString(keyBytes(0x11)), activeKID, strings.Join(encodedKeys, ","))
	path := filepath.Join(t.TempDir(), "keyring.json")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	keyring, err := credentials.LoadKeyring(path)
	if err != nil {
		t.Fatalf("LoadKeyring: %v", err)
	}
	return keyring
}

func keyBytes(value byte) []byte {
	result := make([]byte, 32)
	for i := range result {
		result[i] = value
	}
	return result
}

func counterValue(t *testing.T, counter prometheus.Counter) float64 {
	t.Helper()
	metric := &dto.Metric{}
	if err := counter.Write(metric); err != nil {
		t.Fatalf("counter.Write: %v", err)
	}
	return metric.GetCounter().GetValue()
}
