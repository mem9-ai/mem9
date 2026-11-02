// Package secrets protects control-plane secret values with field-bound
// authenticated encryption while retaining legacy read compatibility.
package secrets

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/qiffang/mnemos/server/internal/credentials"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/metrics"
)

const (
	FieldTenantDBPassword    = "tenants.db_password"
	FieldWebhookSecret       = "webhook_endpoints.secret_ciphertext"
	FieldOutboxAPIKeySubject = "runtime_usage_outbox.api_key_subject"
	WriteFormatLegacy        = "legacy"
	WriteFormatEncV1         = "enc_v1"
	encV1Prefix              = "enc:v1:"
	secretAADPrefix          = "mem9-secret:v1:"
)

var storedValueLimits = map[string]int{
	FieldTenantDBPassword: 255,
}

// Protector creates field-bound encryptors for control-plane secrets.
type Protector struct {
	keyring     *credentials.Keyring
	legacy      encrypt.Encryptor
	writeFormat string
}

// New creates a Protector. An empty write format selects legacy writes.
func New(keyring *credentials.Keyring, legacy encrypt.Encryptor, writeFormat string) (*Protector, error) {
	if writeFormat == "" {
		writeFormat = WriteFormatLegacy
	}
	switch writeFormat {
	case WriteFormatLegacy, WriteFormatEncV1:
		// valid
	default:
		return nil, fmt.Errorf("unsupported secret write format %q", writeFormat)
	}
	if keyring == nil {
		return nil, errors.New("secret keyring is required")
	}
	if legacy == nil {
		return nil, errors.New("legacy secret encryptor is required")
	}
	return &Protector{keyring: keyring, legacy: legacy, writeFormat: writeFormat}, nil
}

// For returns an encryptor whose ciphertext is bound to field.
func (p *Protector) For(field string) encrypt.Encryptor {
	return &fieldEncryptor{protector: p, field: field}
}

type fieldEncryptor struct {
	protector *Protector
	field     string
}

func (e *fieldEncryptor) Encrypt(ctx context.Context, plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	if e.protector.writeFormat == WriteFormatLegacy {
		stored, err := e.protector.legacy.Encrypt(ctx, plaintext)
		if err != nil {
			return "", errors.New("encrypt legacy secret failed")
		}
		if err := e.validateStoredLength(stored); err != nil {
			return "", err
		}
		return stored, nil
	}
	kid, sealed, err := e.protector.keyring.SealWithAAD(e.aad(), []byte(plaintext))
	if err != nil {
		return "", errors.New("encrypt secret failed")
	}
	stored := encV1Prefix + kid + ":" + base64.RawURLEncoding.EncodeToString(sealed)
	if err := e.validateStoredLength(stored); err != nil {
		return "", err
	}
	return stored, nil
}

func (e *fieldEncryptor) Decrypt(ctx context.Context, stored string) (string, error) {
	if stored == "" {
		return "", nil
	}
	if strings.HasPrefix(stored, encV1Prefix) {
		plaintext, err := e.decryptV1(stored)
		if err != nil {
			e.incrementDecryptError()
			return "", err
		}
		return plaintext, nil
	}
	if strings.HasPrefix(stored, "enc:") {
		e.incrementDecryptError()
		return "", errors.New("unsupported encrypted secret version")
	}
	e.incrementLegacyRead()
	plaintext, err := e.protector.legacy.Decrypt(ctx, stored)
	if err != nil {
		e.incrementDecryptError()
		return "", errors.New("decrypt legacy secret failed")
	}
	return plaintext, nil
}

func (e *fieldEncryptor) decryptV1(stored string) (string, error) {
	parts := strings.Split(stored, ":")
	if len(parts) != 4 || parts[0] != "enc" || parts[1] != "v1" || parts[2] == "" || parts[3] == "" {
		return "", errors.New("invalid encrypted secret format")
	}
	sealed, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return "", errors.New("invalid encrypted secret payload")
	}
	plaintext, err := e.protector.keyring.OpenWithAAD(parts[2], e.aad(), sealed)
	if err != nil {
		return "", errors.New("decrypt encrypted secret failed")
	}
	return string(plaintext), nil
}

func (e *fieldEncryptor) aad() []byte {
	return []byte(secretAADPrefix + e.field)
}

func (e *fieldEncryptor) validateStoredLength(stored string) error {
	if limit := storedValueLimits[e.field]; limit > 0 && utf8.RuneCountInString(stored) > limit {
		return fmt.Errorf("encrypted secret exceeds %d-character storage limit", limit)
	}
	return nil
}

func (e *fieldEncryptor) incrementLegacyRead() {
	if isKnownField(e.field) {
		metrics.SecretLegacyReadsTotal.WithLabelValues(e.field).Inc()
	}
}

func (e *fieldEncryptor) incrementDecryptError() {
	if isKnownField(e.field) {
		metrics.SecretDecryptErrorsTotal.WithLabelValues(e.field).Inc()
	}
}

func isKnownField(field string) bool {
	switch field {
	case FieldTenantDBPassword, FieldWebhookSecret, FieldOutboxAPIKeySubject:
		return true
	default:
		return false
	}
}
