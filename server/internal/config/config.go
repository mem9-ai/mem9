package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port      string
	DSN       string
	RateLimit float64
	RateBurst int
}

func Load() (*Config, error) {
	dsn := os.Getenv("MNEMO_DSN")
	if dsn == "" {
		return nil, fmt.Errorf("MNEMO_DSN is required")
	}

	cfg := &Config{
		Port:      envOr("MNEMO_PORT", "8080"),
		DSN:       dsn,
		RateLimit: envFloat("MNEMO_RATE_LIMIT", 100),
		RateBurst: envInt("MNEMO_RATE_BURST", 200),
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
