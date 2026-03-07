package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port      string
	DSN       string
	RateLimit float64
	RateBurst int

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

	TiDBZeroEnabled       bool
	TiDBZeroAPIURL        string
	TenantPoolMaxIdle     int
	TenantPoolMaxOpen     int
	TenantPoolIdleTimeout time.Duration
	TenantPoolTotalLimit  int

	// Upload directory for file storage.
	// Files are stored at {UploadDir}/{tenantID}/{agentID}/{filename}.
	UploadDir string
}

func Load() (*Config, error) {
	dsn := os.Getenv("MNEMO_DSN")
	if dsn == "" {
		return nil, fmt.Errorf("MNEMO_DSN is required")
	}

	cfg := &Config{
		Port:                  envOr("MNEMO_PORT", "8080"),
		DSN:                   dsn,
		RateLimit:             envFloat("MNEMO_RATE_LIMIT", 100),
		RateBurst:             envInt("MNEMO_RATE_BURST", 200),
		EmbedAutoModel:        os.Getenv("MNEMO_EMBED_AUTO_MODEL"),
		EmbedAutoDims:         envInt("MNEMO_EMBED_AUTO_DIMS", 1024),
		EmbedAPIKey:           os.Getenv("MNEMO_EMBED_API_KEY"),
		EmbedBaseURL:          os.Getenv("MNEMO_EMBED_BASE_URL"),
		EmbedModel:            os.Getenv("MNEMO_EMBED_MODEL"),
		EmbedDims:             envInt("MNEMO_EMBED_DIMS", 1536),
		LLMAPIKey:             os.Getenv("MNEMO_LLM_API_KEY"),
		LLMBaseURL:            os.Getenv("MNEMO_LLM_BASE_URL"),
		LLMModel:              envOr("MNEMO_LLM_MODEL", "gpt-4o-mini"),
		LLMTemperature:        envFloat("MNEMO_LLM_TEMPERATURE", 0.1),
		IngestMode:            envOr("MNEMO_INGEST_MODE", "smart"),
		TiDBZeroEnabled:       envBool("MNEMO_TIDB_ZERO_ENABLED", true),
		TiDBZeroAPIURL:        envOr("MNEMO_TIDB_ZERO_API_URL", "https://zero.tidbapi.com/v1alpha1"),
		TenantPoolMaxIdle:     envInt("MNEMO_TENANT_POOL_MAX_IDLE", 5),
		TenantPoolMaxOpen:     envInt("MNEMO_TENANT_POOL_MAX_OPEN", 10),
		TenantPoolIdleTimeout: envDuration("MNEMO_TENANT_POOL_IDLE_TIMEOUT", 10*time.Minute),
		TenantPoolTotalLimit:  envInt("MNEMO_TENANT_POOL_TOTAL_LIMIT", 200),
		UploadDir:             envOr("MNEMO_UPLOAD_DIR", "./uploads"),
	}
	// Validate ingest mode.
	switch cfg.IngestMode {
	case "smart", "raw", "":
		// ok
	default:
		return nil, fmt.Errorf("unsupported MNEMO_INGEST_MODE %q; valid values are \"smart\" and \"raw\"", cfg.IngestMode)
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
