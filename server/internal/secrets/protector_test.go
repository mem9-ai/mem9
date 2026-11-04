package secrets

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"

	"github.com/qiffang/mnemos/server/internal/credentials"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/metrics"
)

func TestProtectorEncV1RoundTripAndFailures(t *testing.T) {
	keyring := loadProtectorKeyring(t, "space-k1", map[string][]byte{
		"space-k1": keyBytes(0x22),
		"db-k1":    keyBytes(0x33),
		"cu-k1":    keyBytes(0x36),
		"wh-k1":    keyBytes(0x34),
		"ob-k1":    keyBytes(0x35),
	}, defaultFieldKIDs("db-k1", "cu-k1", "wh-k1", "ob-k1"))
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
	if !strings.HasPrefix(stored, "enc:v1:db-k1:") {
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
		{name: "unknown version", value: "enc:v2:db-k1:AAAA", field: tenant},
		{name: "unknown kid", value: strings.Replace(stored, ":db-k1:", ":missing:", 1), field: tenant},
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

func TestProtectorUsesDistinctFieldKIDs(t *testing.T) {
	keyring := loadProtectorKeyring(t, "space-k1", map[string][]byte{
		"space-k1": keyBytes(0x22),
		"db-k1":    keyBytes(0x33),
		"cu-k1":    keyBytes(0x36),
		"wh-k1":    keyBytes(0x34),
		"ob-k1":    keyBytes(0x35),
	}, defaultFieldKIDs("db-k1", "cu-k1", "wh-k1", "ob-k1"))
	protector, err := New(keyring, encrypt.NewPlainEncryptor(), WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	for field, wantKID := range map[string]string{
		FieldTenantDBPassword:    "enc:v1:db-k1:",
		FieldTenantClaimURL:      "enc:v1:cu-k1:",
		FieldWebhookSecret:       "enc:v1:wh-k1:",
		FieldOutboxAPIKeySubject: "enc:v1:ob-k1:",
	} {
		stored, err := protector.For(field).Encrypt(context.Background(), field+"-secret")
		if err != nil {
			t.Fatalf("Encrypt %s: %v", field, err)
		}
		if !strings.HasPrefix(stored, wantKID) {
			t.Fatalf("field %s stored = %q prefix, want %q", field, stored, wantKID)
		}
		plaintext, err := protector.For(field).Decrypt(context.Background(), stored)
		if err != nil || plaintext != field+"-secret" {
			t.Fatalf("field %s round trip = %q, %v", field, plaintext, err)
		}
	}
}

func TestNewEncV1RequiresAllProtectedFieldKIDs(t *testing.T) {
	keys := map[string][]byte{
		"space-k1": keyBytes(0x22),
		"db-k1":    keyBytes(0x33),
		"cu-k1":    keyBytes(0x36),
		"wh-k1":    keyBytes(0x34),
		"ob-k1":    keyBytes(0x35),
	}
	for _, missing := range []string{FieldTenantDBPassword, FieldTenantClaimURL, FieldWebhookSecret, FieldOutboxAPIKeySubject} {
		kids := defaultFieldKIDs("db-k1", "cu-k1", "wh-k1", "ob-k1")
		delete(kids, missing)
		keyring := loadProtectorKeyring(t, "space-k1", keys, kids)
		_, err := New(keyring, encrypt.NewPlainEncryptor(), WriteFormatEncV1)
		if err == nil {
			t.Fatalf("New missing %s error = nil", missing)
		}
		if !strings.Contains(err.Error(), missing) {
			t.Fatalf("New error does not name missing field: %v", err)
		}
	}
}

func TestProtectorLegacyDefaultAndMetrics(t *testing.T) {
	keyring := loadProtectorKeyring(t, "space-k1", map[string][]byte{"space-k1": keyBytes(0x33)}, nil)
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

func TestProtectorFieldRotationKeepsOtherFieldsUnchanged(t *testing.T) {
	keys := map[string][]byte{
		"space-k1": keyBytes(0x22),
		"db-k1":    keyBytes(0x33),
		"db-k2":    keyBytes(0x36),
		"cu-k1":    keyBytes(0x37),
		"wh-k1":    keyBytes(0x34),
		"ob-k1":    keyBytes(0x35),
	}
	oldProtector, err := New(loadProtectorKeyring(t, "space-k1", keys, defaultFieldKIDs("db-k1", "cu-k1", "wh-k1", "ob-k1")), encrypt.NewPlainEncryptor(), WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New old protector: %v", err)
	}
	oldDB, err := oldProtector.For(FieldTenantDBPassword).Encrypt(context.Background(), "old-db-secret")
	if err != nil {
		t.Fatalf("Encrypt old DB: %v", err)
	}

	newProtector, err := New(loadProtectorKeyring(t, "space-k1", keys, defaultFieldKIDs("db-k2", "cu-k1", "wh-k1", "ob-k1")), encrypt.NewPlainEncryptor(), WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New new protector: %v", err)
	}
	plaintext, err := newProtector.For(FieldTenantDBPassword).Decrypt(context.Background(), oldDB)
	if err != nil {
		t.Fatalf("Decrypt old DB kid: %v", err)
	}
	if plaintext != "old-db-secret" {
		t.Fatalf("old DB plaintext mismatch")
	}
	newDB, err := newProtector.For(FieldTenantDBPassword).Encrypt(context.Background(), "new-db-secret")
	if err != nil {
		t.Fatalf("Encrypt new DB: %v", err)
	}
	if !strings.HasPrefix(newDB, "enc:v1:db-k2:") {
		t.Fatalf("new DB stored = %q, want db-k2", newDB)
	}
	if _, err := newProtector.For(FieldTenantDBPassword).Decrypt(context.Background(), newDB); err != nil {
		t.Fatalf("Decrypt new DB: %v", err)
	}

	webhookStored, err := newProtector.For(FieldWebhookSecret).Encrypt(context.Background(), "webhook-secret")
	if err != nil || !strings.HasPrefix(webhookStored, "enc:v1:wh-k1:") {
		t.Fatalf("webhook stored = %q, %v; want wh-k1", webhookStored, err)
	}
	outboxStored, err := newProtector.For(FieldOutboxAPIKeySubject).Encrypt(context.Background(), "outbox-secret")
	if err != nil || !strings.HasPrefix(outboxStored, "enc:v1:ob-k1:") {
		t.Fatalf("outbox stored = %q, %v; want ob-k1", outboxStored, err)
	}
}

func TestProtectorRejectsSpaceCredentialKID(t *testing.T) {
	keyring := loadProtectorKeyring(t, "space-k1", map[string][]byte{
		"space-k1": keyBytes(0x22),
		"wh-k1":    keyBytes(0x34),
		"ob-k1":    keyBytes(0x35),
		"db-k1":    keyBytes(0x33),
		"cu-k1":    keyBytes(0x36),
	}, defaultFieldKIDs("db-k1", "cu-k1", "wh-k1", "ob-k1"))
	sealed, err := keyring.SealWithKID("space-k1", []byte(secretAADPrefix+FieldTenantDBPassword), []byte("space-secret"))
	if err != nil {
		t.Fatalf("SealWithKID: %v", err)
	}
	stored := encV1Prefix + "space-k1:" + base64.RawURLEncoding.EncodeToString(sealed)

	protector, err := New(keyring, encrypt.NewPlainEncryptor(), WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	_, err = protector.For(FieldTenantDBPassword).Decrypt(context.Background(), stored)
	if err == nil {
		t.Fatal("Decrypt Space kid error = nil")
	}
	if strings.Contains(err.Error(), "space-secret") {
		t.Fatal("error leaked plaintext")
	}
}

func TestProtectorEmptyValuesAndDBPasswordLimit(t *testing.T) {
	keyring := loadProtectorKeyring(t, "space-k1", map[string][]byte{
		"space-k1": keyBytes(0x22),
		"db-k1":    keyBytes(0x33),
		"cu-k1":    keyBytes(0x36),
		"wh-k1":    keyBytes(0x34),
		"ob-k1":    keyBytes(0x35),
	}, defaultFieldKIDs("db-k1", "cu-k1", "wh-k1", "ob-k1"))
	protector, err := New(keyring, encrypt.NewPlainEncryptor(), WriteFormatEncV1)
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

	var withinLimit string
	for plaintextLength := 130; plaintextLength <= 145; plaintextLength++ {
		stored, err := fieldEncryptor.Encrypt(context.Background(), strings.Repeat("x", plaintextLength))
		if err != nil {
			continue
		}
		if limit := storedValueLimits[FieldTenantDBPassword]; utf8.RuneCountInString(stored) <= limit {
			withinLimit = stored
			break
		}
	}
	if limit := storedValueLimits[FieldTenantDBPassword]; utf8.RuneCountInString(withinLimit) > limit {
		t.Fatalf("stored length = %d, want at most %d", utf8.RuneCountInString(withinLimit), limit)
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
	keyring := loadProtectorKeyring(t, "space-k1", map[string][]byte{"space-k1": keyBytes(0x33)}, nil)
	_, err := New(keyring, encrypt.NewPlainEncryptor(), "future")
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

func loadProtectorKeyring(t *testing.T, activeKID string, keys map[string][]byte, fieldKIDs map[string]string) *credentials.Keyring {
	t.Helper()
	encodedKeys := make([]string, 0, len(keys))
	for kid, key := range keys {
		encodedKeys = append(encodedKeys, fmt.Sprintf("%q:%q", kid, base64.StdEncoding.EncodeToString(key)))
	}
	contents := fmt.Sprintf(`{
  "hash_version":"h1",
  "hmac_keys":{"h1":%q},
  "encryption_kid":%q,
  "encryption_keys":{%s},
  "secret_field_kids":%s
}`, base64.StdEncoding.EncodeToString(keyBytes(0x11)), activeKID, strings.Join(encodedKeys, ","), mustJSONMap(fieldKIDs))
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

func defaultFieldKIDs(dbKID, cuKID, whKID, obKID string) map[string]string {
	return map[string]string{
		FieldTenantDBPassword:    dbKID,
		FieldTenantClaimURL:      cuKID,
		FieldWebhookSecret:       whKID,
		FieldOutboxAPIKeySubject: obKID,
	}
}

func mustJSONMap(values map[string]string) string {
	parts := make([]string, 0, len(values))
	for field, kid := range values {
		parts = append(parts, fmt.Sprintf("%q:%q", field, kid))
	}
	return "{" + strings.Join(parts, ",") + "}"
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

func TestProtectorRejectsNonCanonicalEncoding(t *testing.T) {
	keyring := loadProtectorKeyring(t, "space-k1", map[string][]byte{
		"space-k1": keyBytes(0x22),
		"db-k1":    keyBytes(0x33),
		"cu-k1":    keyBytes(0x36),
		"wh-k1":    keyBytes(0x34),
		"ob-k1":    keyBytes(0x35),
	}, defaultFieldKIDs("db-k1", "cu-k1", "wh-k1", "ob-k1"))
	protector, err := New(keyring, encrypt.NewPlainEncryptor(), WriteFormatEncV1)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	tenant := protector.For(FieldTenantDBPassword)

	// 12-byte nonce + 16-byte tag + 18-byte plaintext = 46 bytes, so the last
	// base64url character carries unused low bits that a lenient decoder ignores.
	stored, err := tenant.Encrypt(context.Background(), "sensitive-password")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	last := strings.IndexByte(alphabet, stored[len(stored)-1])
	if last < 0 || last&0x0f != 0 {
		t.Fatalf("unexpected canonical trailing character %q", stored[len(stored)-1])
	}
	nonCanonical := stored[:len(stored)-1] + string(alphabet[last|0x01])

	if _, err := tenant.Decrypt(context.Background(), nonCanonical); err == nil {
		t.Fatal("Decrypt accepted a non-canonical base64url payload")
	}
	if got, err := tenant.Decrypt(context.Background(), stored); err != nil || got != "sensitive-password" {
		t.Fatalf("Decrypt canonical = %q, %v", got, err)
	}
}
