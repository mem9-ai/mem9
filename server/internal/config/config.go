package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port      string
	DSN       string
	RateLimit float64
	RateBurst int

	// DBBackend selects the database driver: "tidb" (default), "postgres", or "db9".
	DBBackend string

	// Auto-embedding: TiDB Serverless generates embeddings via EMBED_TEXT().
	// When set, takes priority over client-side embedding.
	// Example: "tidbcloud_free/amazon/titan-embed-text-v2"
	EmbedAutoModel string
	EmbedAutoDims  int

	// Client-side embedding provider (optional — omit for keyword-only search).
	EmbedAPIKey  string
	EmbedBaseURL string
	EmbedModel   string
	EmbedDims    int

	LLMAPIKey      string
	LLMBaseURL     string
	LLMModel       string
	LLMTemperature float64
	IngestMode     string

	TiDBZeroEnabled          bool
	TiDBZeroAPIURL           string
	TenantPoolMaxIdle        int
	TenantPoolMaxOpen        int
	TenantPoolConnectTimeout time.Duration
	TenantPoolIdleTimeout    time.Duration
	TenantPoolTotalLimit     int

	// TiDB Cloud Pool configuration
	TiDBCloudAPIURL string
	TiDBCloudPoolID string

	// FTSEnabled controls whether full-text search is attempted.
	// Set MNEMO_FTS_ENABLED=true only when the TiDB cluster supports
	// FULLTEXT INDEX and FTS_MATCH_WORD with constant strings.
	// Defaults to false (safe for all TiDB Serverless / TiDB Zero tiers).
	FTSEnabled bool

	// WorkerConcurrency controls how many upload tasks are processed in parallel.
	// Defaults to 5.
	WorkerConcurrency int

	// DebugLLM enables logging of raw LLM response content, which may contain
	// user data. Disabled by default. Enable only in dev/test environments via
	// MNEMO_DEBUG_LLM=true.
	DebugLLM bool

	// Upload directory for file storage.
	// Files are stored at {UploadDir}/{tenantID}/{agentID}/{filename}.
	UploadDir string

	// Encryption configuration for sensitive data like database passwords.
	//
	// ⚠️ IMPORTANT: This is a one-time deployment decision. Once set and tenants
	// are created, MNEMO_ENCRYPT_TYPE must NOT be changed. Switching from "plain"
	// to "md5"/"kms" (or vice versa) on an existing deployment will cause all
	// tenant requests to fail with HTTP 500, as existing passwords won't decrypt
	// with the new scheme. To change encryption, re-deploy with a fresh database
	// or migrate all tenant passwords manually.
	//
	// Supported types:
	//   - "plain": No encryption (default, backward compatible)
	//   - "md5": AES-GCM encryption with MD5-derived key
	//   - "kms": AWS KMS encryption
	EncryptType string
	// EncryptKey is the encryption key or KMS key ID.
	// For "md5": the key string used to derive the AES key.
	// For "kms": the KMS key ID, ARN, alias name, or alias ARN.
	EncryptKey string `json:"-"` // Never serialize to JSON

	// ClusterBlacklist is the set of TiDB cluster IDs whose spend-limit errors
	// should be returned as 429 instead of 503. Populated from
	// MNEMO_CLUSTER_BLACKLIST (comma-separated). Empty by default.
	ClusterBlacklist map[string]struct{}
}

func Load() (*Config, error) {
	dsn := os.Getenv("MNEMO_DSN")
	if dsn == "" {
		return nil, fmt.Errorf("MNEMO_DSN is required")
	}

	cfg := &Config{
		Port:                     envOr("MNEMO_PORT", "8080"),
		DSN:                      dsn,
		DBBackend:                envOr("MNEMO_DB_BACKEND", "tidb"),
		RateLimit:                envFloat("MNEMO_RATE_LIMIT", 100),
		RateBurst:                envInt("MNEMO_RATE_BURST", 200),
		EmbedAutoModel:           os.Getenv("MNEMO_EMBED_AUTO_MODEL"),
		EmbedAutoDims:            envInt("MNEMO_EMBED_AUTO_DIMS", 1024),
		EmbedAPIKey:              os.Getenv("MNEMO_EMBED_API_KEY"),
		EmbedBaseURL:             os.Getenv("MNEMO_EMBED_BASE_URL"),
		EmbedModel:               os.Getenv("MNEMO_EMBED_MODEL"),
		EmbedDims:                envInt("MNEMO_EMBED_DIMS", 1536),
		LLMAPIKey:                os.Getenv("MNEMO_LLM_API_KEY"),
		LLMBaseURL:               os.Getenv("MNEMO_LLM_BASE_URL"),
		LLMModel:                 envOr("MNEMO_LLM_MODEL", "gpt-4o-mini"),
		LLMTemperature:           envFloat("MNEMO_LLM_TEMPERATURE", 0.1),
		IngestMode:               envOr("MNEMO_INGEST_MODE", "smart"),
		TiDBZeroEnabled:          envBool("MNEMO_TIDB_ZERO_ENABLED", true),
		TiDBZeroAPIURL:           envOr("MNEMO_TIDB_ZERO_API_URL", "https://zero.tidbapi.com/v1alpha1"),
		TiDBCloudAPIURL:          envOr("MNEMO_TIDBCLOUD_API_URL", "https://serverless.tidbapi.com"),
		TiDBCloudPoolID:          envOr("MNEMO_TIDBCLOUD_POOL_ID", "2"),
		TenantPoolMaxIdle:        envInt("MNEMO_TENANT_POOL_MAX_IDLE", 5),
		TenantPoolMaxOpen:        envInt("MNEMO_TENANT_POOL_MAX_OPEN", 10),
		TenantPoolConnectTimeout: envDuration("MNEMO_TENANT_POOL_CONNECT_TIMEOUT", 3*time.Second),
		TenantPoolIdleTimeout:    envDuration("MNEMO_TENANT_POOL_IDLE_TIMEOUT", 10*time.Minute),
		TenantPoolTotalLimit:     envInt("MNEMO_TENANT_POOL_TOTAL_LIMIT", 200),
		UploadDir:                envOr("MNEMO_UPLOAD_DIR", "./uploads"),
		FTSEnabled:               envBool("MNEMO_FTS_ENABLED", false),
		WorkerConcurrency:        envInt("MNEMO_WORKER_CONCURRENCY", 5),
		EncryptType:              envOr("MNEMO_ENCRYPT_TYPE", "plain"),
		EncryptKey:               os.Getenv("MNEMO_ENCRYPT_KEY"),
		DebugLLM:                 envBool("MNEMO_DEBUG_LLM", false),
		ClusterBlacklist:         parseClusterBlacklist(os.Getenv("MNEMO_CLUSTER_BLACKLIST")),
	}
	// Validate ingest mode.
	switch cfg.IngestMode {
	case "smart", "raw", "":
		// ok
	default:
		return nil, fmt.Errorf("unsupported MNEMO_INGEST_MODE %q; valid values are \"smart\" and \"raw\"", cfg.IngestMode)
	}

	// Validate DB backend.
	switch cfg.DBBackend {
	case "tidb", "postgres", "db9":
		// ok
	default:
		return nil, fmt.Errorf("unsupported MNEMO_DB_BACKEND %q; valid values are \"tidb\", \"postgres\", and \"db9\"", cfg.DBBackend)
	}

	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func parseClusterBlacklist(raw string) map[string]struct{} {
	out := make(map[string]struct{})
	for _, id := range strings.Split(raw, ",") {
		if id := strings.TrimSpace(id); id != "" {
			out[id] = struct{}{}
		}
	}
	return out
}

// LogValue returns a slog.Value with sensitive fields masked.
// Use this when logging the config to avoid leaking secrets.
func (c *Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("Port", c.Port),
		slog.String("DBBackend", c.DBBackend),
		slog.String("EncryptType", c.EncryptType),
		slog.Bool("EncryptKeyConfigured", c.EncryptKey != ""),
		// Add other non-sensitive fields as needed
	)
}
