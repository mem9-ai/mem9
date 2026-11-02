// Package logsafe formats credential-bearing identifiers for diagnostics only.
package logsafe

import (
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"strings"

	"github.com/google/uuid"
)

// TenantID returns a stable, non-replayable fingerprint, never a key prefix.
// Tenant IDs remain valid API keys even when credential mappings are enabled.
func TenantID(id string) string {
	if id == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(id))
	return "sha256:" + hex.EncodeToString(sum[:12])
}

// ClusterID masks UUIDs because TiDB Zero uses the same UUID as its API key.
// Other providers use separate cluster identifiers that remain useful in logs.
func ClusterID(id string) string {
	if uuid.Validate(id) == nil {
		return TenantID(id)
	}
	return id
}

// Error removes known credentials from diagnostic text without changing the
// original error used for classification, wrapping, or responses.
func Error(err error, secrets ...string) any {
	if err == nil {
		return nil
	}
	message := err.Error()
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		for _, value := range []string{url.QueryEscape(secret), url.PathEscape(secret), secret} {
			message = strings.ReplaceAll(message, value, "[REDACTED]")
		}
	}
	if message == err.Error() {
		return err
	}
	return message
}
