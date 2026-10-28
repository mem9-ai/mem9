package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/runtimeusage"
)

func TestConfig_MeteringSurfaceReduced(t *testing.T) {
	typeName := reflect.TypeOf(Config{})
	for _, field := range []string{
		"MeteringBucket",
		"MeteringPrefix",
		"MeteringRegion",
		"MeteringEndpoint",
		"MeteringForcePathStyle",
		"MeteringChannelSize",
	} {
		if _, ok := typeName.FieldByName(field); ok {
			t.Fatalf("Config still exposes unsupported metering field %q", field)
		}
	}
}

func TestLoad_ChainRecallStopScoreDefaultsToHighConfidence(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.ChainRecallStopScore != 0.8 {
		t.Fatalf("ChainRecallStopScore = %v, want 0.8", cfg.ChainRecallStopScore)
	}
}

func TestLoad_RecallRequestBudgetDefaults(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.RecallRequestTimeout != time.Minute {
		t.Fatalf("RecallRequestTimeout = %v, want 1m", cfg.RecallRequestTimeout)
	}
	if cfg.RecallResponseReserve != 5*time.Second {
		t.Fatalf("RecallResponseReserve = %v, want 5s", cfg.RecallResponseReserve)
	}
}

func TestLoad_RecallRequestBudgetOverrides(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_RECALL_REQUEST_TIMEOUT", "90s")
	t.Setenv("MNEMO_RECALL_RESPONSE_RESERVE", "8s")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.RecallRequestTimeout != 90*time.Second {
		t.Fatalf("RecallRequestTimeout = %v, want 90s", cfg.RecallRequestTimeout)
	}
	if cfg.RecallResponseReserve != 8*time.Second {
		t.Fatalf("RecallResponseReserve = %v, want 8s", cfg.RecallResponseReserve)
	}
}

func TestLoad_RecallRequestBudgetValidation(t *testing.T) {
	tests := []struct {
		name       string
		timeout    string
		reserve    string
		wantSubstr string
	}{
		{name: "timeout must be positive", timeout: "0", wantSubstr: "MNEMO_RECALL_REQUEST_TIMEOUT must be positive"},
		{name: "reserve must not be negative", reserve: "-1s", wantSubstr: "MNEMO_RECALL_RESPONSE_RESERVE must not be negative"},
		{name: "reserve must be less than timeout", timeout: "5s", reserve: "5s", wantSubstr: "MNEMO_RECALL_RESPONSE_RESERVE must be less than MNEMO_RECALL_REQUEST_TIMEOUT"},
		{name: "timeout must be a duration", timeout: "5seconds", wantSubstr: "MNEMO_RECALL_REQUEST_TIMEOUT must be a valid duration"},
		{name: "reserve must be a duration", reserve: "soon", wantSubstr: "MNEMO_RECALL_RESPONSE_RESERVE must be a valid duration"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("MNEMO_DSN", "test-dsn")
			if tt.timeout != "" {
				t.Setenv("MNEMO_RECALL_REQUEST_TIMEOUT", tt.timeout)
			}
			if tt.reserve != "" {
				t.Setenv("MNEMO_RECALL_RESPONSE_RESERVE", tt.reserve)
			}

			_, err := Load()
			if err == nil {
				t.Fatal("Load error = nil, want validation error")
			}
			if !strings.Contains(err.Error(), tt.wantSubstr) {
				t.Fatalf("Load error = %v, want %q", err, tt.wantSubstr)
			}
		})
	}
}

func TestLoad_DisableSessionSave(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_DISABLE_SESSION_SAVE", "true")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.DisableSessionSave {
		t.Fatal("DisableSessionSave = false, want true")
	}
}

func TestLoad_FactExtractionIncludesAssistant(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_FACT_EXTRACTION_INCLUDE_ASSISTANT", "true")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.FactExtractionIncludeAssistant {
		t.Fatal("FactExtractionIncludeAssistant = false, want true")
	}
}

func TestLoad_TiDBCloudPrivateLinkConfig(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_TIDBCLOUD_PREFER_PRIVATELINK", "true")
	t.Setenv("MNEMO_TIDBCLOUD_PRIVATELINK_SERVICE_NAMES", "vpce-svc-a, vpce-svc-b,,vpce-svc-a")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.TiDBCloudPreferPrivateLink {
		t.Fatal("TiDBCloudPreferPrivateLink = false, want true")
	}
	if len(cfg.TiDBCloudPrivateLinkServiceNames) != 2 {
		t.Fatalf("service names len = %d, want 2", len(cfg.TiDBCloudPrivateLinkServiceNames))
	}
	for _, name := range []string{"vpce-svc-a", "vpce-svc-b"} {
		if _, ok := cfg.TiDBCloudPrivateLinkServiceNames[name]; !ok {
			t.Fatalf("service names missing %q", name)
		}
	}
}

func TestLoad_MeteringSupportedFields(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_METERING_ENABLED", "true")
	t.Setenv("MNEMO_METERING_URL", "s3://bucket-a/prefix-a/")
	t.Setenv("MNEMO_METERING_FLUSH_INTERVAL", "15s")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.MeteringEnabled {
		t.Fatal("MeteringEnabled = false, want true")
	}
	v := reflect.ValueOf(*cfg)
	field := v.FieldByName("MeteringURL")
	if !field.IsValid() {
		t.Fatal("Config missing MeteringURL field")
	}
	if got := field.String(); got != "s3://bucket-a/prefix-a/" {
		t.Fatalf("MeteringURL = %q, want s3://bucket-a/prefix-a/", got)
	}
	if cfg.MeteringFlushInterval != 15*time.Second {
		t.Fatalf("MeteringFlushInterval = %v, want 15s", cfg.MeteringFlushInterval)
	}
}

func TestLoad_MeteringURLHTTPSAccepted(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_METERING_ENABLED", "true")
	t.Setenv("MNEMO_METERING_URL", "https://hooks.example.com/metering")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	v := reflect.ValueOf(*cfg)
	field := v.FieldByName("MeteringURL")
	if !field.IsValid() {
		t.Fatal("Config missing MeteringURL field")
	}
	if got := field.String(); got != "https://hooks.example.com/metering" {
		t.Fatalf("MeteringURL = %q, want https://hooks.example.com/metering", got)
	}
}

func TestLoad_MeteringURLInvalidScheme(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_METERING_ENABLED", "true")
	t.Setenv("MNEMO_METERING_URL", "ftp://bucket-a/prefix-a/")

	_, err := Load()
	if err == nil {
		t.Fatal("Load error = nil, want invalid MNEMO_METERING_URL error")
	}
}

func TestLoad_MeteringURLSkippedWhenDisabled(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_METERING_ENABLED", "false")
	t.Setenv("MNEMO_METERING_URL", "ftp://token:secret@bucket-a/prefix-a/")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.MeteringEnabled {
		t.Fatal("MeteringEnabled = true, want false")
	}
	if cfg.MeteringURL != "" {
		t.Fatalf("MeteringURL = %q, want empty string when metering is disabled", cfg.MeteringURL)
	}
}

func TestLoad_MeteringURLValidationErrorRedactsRawURL(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_METERING_ENABLED", "true")
	t.Setenv("MNEMO_METERING_URL", "ftp://token:secret@example.com/prefix?api_key=top-secret")

	_, err := Load()
	if err == nil {
		t.Fatal("Load error = nil, want invalid MNEMO_METERING_URL error")
	}
	msg := err.Error()
	for _, secret := range []string{"token:secret", "api_key=top-secret", "ftp://token:secret@example.com/prefix?api_key=top-secret"} {
		if strings.Contains(msg, secret) {
			t.Fatalf("validation error leaked raw metering URL content: %q", msg)
		}
	}
}

func TestLoad_RuntimeUsageConfig(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_RUNTIME_USAGE_ENABLED", "true")
	t.Setenv("MNEMO_RUNTIME_USAGE_BASE_URL", "https://runtime-usage.example.com/internal/")
	t.Setenv("MNEMO_RUNTIME_USAGE_INTERNAL_SECRET", "secret-value")
	t.Setenv("MNEMO_RUNTIME_USAGE_TIMEOUT", "4s")
	t.Setenv("MNEMO_RUNTIME_USAGE_METERING_TIMEOUT", "6s")
	t.Setenv("MNEMO_RUNTIME_USAGE_RESERVATION_TTL", "20m")
	t.Setenv("MNEMO_RUNTIME_USAGE_OPERATION_TTL", "25m")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.RuntimeUsageEnabled {
		t.Fatal("RuntimeUsageEnabled = false, want true")
	}
	if cfg.RuntimeUsageProviderID != "" {
		t.Fatalf("RuntimeUsageProviderID = %q, want empty default", cfg.RuntimeUsageProviderID)
	}
	if cfg.RuntimeUsageBaseURL != "https://runtime-usage.example.com/internal" {
		t.Fatalf("RuntimeUsageBaseURL = %q", cfg.RuntimeUsageBaseURL)
	}
	if cfg.RuntimeUsageInternalSecret != "secret-value" {
		t.Fatal("RuntimeUsageInternalSecret not loaded")
	}
	if cfg.RuntimeUsageTimeout != 4*time.Second {
		t.Fatalf("RuntimeUsageTimeout = %v, want 4s", cfg.RuntimeUsageTimeout)
	}
	if cfg.RuntimeUsageMeteringTimeout != 6*time.Second {
		t.Fatalf("RuntimeUsageMeteringTimeout = %v, want 6s", cfg.RuntimeUsageMeteringTimeout)
	}
	if cfg.RuntimeUsageReservationTTL != 20*time.Minute {
		t.Fatalf("RuntimeUsageReservationTTL = %v, want 20m", cfg.RuntimeUsageReservationTTL)
	}
	if cfg.RuntimeUsageOperationTTL != 25*time.Minute {
		t.Fatalf("RuntimeUsageOperationTTL = %v, want 25m", cfg.RuntimeUsageOperationTTL)
	}
	if !cfg.RuntimeUsageOutboxEnabled {
		t.Fatal("RuntimeUsageOutboxEnabled = false, want default true when runtime usage is enabled")
	}
	if cfg.MeteringEnabled {
		t.Fatal("MeteringEnabled = true, want false; runtime usage metering must not require MNEMO_METERING_ENABLED")
	}
}

func TestLoad_RuntimeUsageProviderID(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_RUNTIME_USAGE_ENABLED", "true")
	t.Setenv("MNEMO_RUNTIME_USAGE_PROVIDER_ID", "provider-x")
	t.Setenv("MNEMO_RUNTIME_USAGE_BASE_URL", "https://runtime-usage.example.com")
	t.Setenv("MNEMO_RUNTIME_USAGE_INTERNAL_SECRET", "secret-value")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.RuntimeUsageProviderID != "provider-x" {
		t.Fatalf("RuntimeUsageProviderID = %q, want provider-x", cfg.RuntimeUsageProviderID)
	}
}

func TestLoad_RuntimeUsageReservationRetryConfig(t *testing.T) {
	tests := []struct {
		name        string
		baseDelay   string
		maxDelay    string
		wantBase    time.Duration
		wantMaximum time.Duration
	}{
		{
			name:        "defaults",
			wantBase:    500 * time.Millisecond,
			wantMaximum: time.Second,
		},
		{
			name:        "lower bounds",
			baseDelay:   "300ms",
			maxDelay:    "600ms",
			wantBase:    300 * time.Millisecond,
			wantMaximum: 600 * time.Millisecond,
		},
		{
			name:        "upper bounds",
			baseDelay:   "1s",
			maxDelay:    "2s",
			wantBase:    time.Second,
			wantMaximum: 2 * time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("MNEMO_DSN", "test-dsn")
			t.Setenv("MNEMO_RUNTIME_USAGE_ENABLED", "true")
			t.Setenv("MNEMO_RUNTIME_USAGE_BASE_URL", "https://runtime-usage.example.com")
			t.Setenv("MNEMO_RUNTIME_USAGE_INTERNAL_SECRET", "secret-value")
			if tt.baseDelay != "" {
				t.Setenv("MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_BASE_DELAY", tt.baseDelay)
			}
			if tt.maxDelay != "" {
				t.Setenv("MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_MAX_DELAY", tt.maxDelay)
			}

			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if cfg.RuntimeUsageRetryBaseDelay != tt.wantBase {
				t.Fatalf("RuntimeUsageRetryBaseDelay = %v, want %v", cfg.RuntimeUsageRetryBaseDelay, tt.wantBase)
			}
			if cfg.RuntimeUsageRetryMaxDelay != tt.wantMaximum {
				t.Fatalf("RuntimeUsageRetryMaxDelay = %v, want %v", cfg.RuntimeUsageRetryMaxDelay, tt.wantMaximum)
			}
		})
	}
}

func TestLoad_RuntimeUsageReservationRetryConfigValidation(t *testing.T) {
	tests := []struct {
		name       string
		baseDelay  string
		maxDelay   string
		wantSubstr string
	}{
		{
			name:       "base below minimum",
			baseDelay:  "299ms",
			wantSubstr: "MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_BASE_DELAY must be between 300ms and 1s",
		},
		{
			name:       "base above maximum",
			baseDelay:  "1001ms",
			wantSubstr: "MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_BASE_DELAY must be between 300ms and 1s",
		},
		{
			name:       "maximum below minimum",
			maxDelay:   "599ms",
			wantSubstr: "MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_MAX_DELAY must be between 600ms and 2s",
		},
		{
			name:       "maximum above maximum",
			maxDelay:   "2001ms",
			wantSubstr: "MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_MAX_DELAY must be between 600ms and 2s",
		},
		{
			name:       "maximum equals base",
			baseDelay:  "600ms",
			maxDelay:   "600ms",
			wantSubstr: "MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_MAX_DELAY must be greater than MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_BASE_DELAY",
		},
		{
			name:       "maximum below base",
			baseDelay:  "700ms",
			maxDelay:   "600ms",
			wantSubstr: "MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_MAX_DELAY must be greater than MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_BASE_DELAY",
		},
		{
			name:       "malformed base",
			baseDelay:  "soon",
			wantSubstr: "MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_BASE_DELAY must be a valid duration",
		},
		{
			name:       "malformed maximum",
			maxDelay:   "later",
			wantSubstr: "MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_MAX_DELAY must be a valid duration",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("MNEMO_DSN", "test-dsn")
			t.Setenv("MNEMO_RUNTIME_USAGE_ENABLED", "true")
			t.Setenv("MNEMO_RUNTIME_USAGE_BASE_URL", "https://runtime-usage.example.com")
			t.Setenv("MNEMO_RUNTIME_USAGE_INTERNAL_SECRET", "secret-value")
			if tt.baseDelay != "" {
				t.Setenv("MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_BASE_DELAY", tt.baseDelay)
			}
			if tt.maxDelay != "" {
				t.Setenv("MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_MAX_DELAY", tt.maxDelay)
			}

			_, err := Load()
			if err == nil {
				t.Fatal("Load error = nil, want validation error")
			}
			if !strings.Contains(err.Error(), tt.wantSubstr) {
				t.Fatalf("Load error = %v, want %q", err, tt.wantSubstr)
			}
		})
	}
}

func TestLoad_RuntimeUsageReservationRetryConfigRedactsParseInputAndWrapsCause(t *testing.T) {
	const rawValue = "private-duration-value"
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_RUNTIME_USAGE_ENABLED", "true")
	t.Setenv("MNEMO_RUNTIME_USAGE_BASE_URL", "https://runtime-usage.example.com")
	t.Setenv("MNEMO_RUNTIME_USAGE_INTERNAL_SECRET", "secret-value")
	t.Setenv("MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_BASE_DELAY", rawValue)

	_, err := Load()
	if err == nil {
		t.Fatal("Load error = nil, want duration parse error")
	}
	if strings.Contains(err.Error(), rawValue) {
		t.Fatal("duration parse error exposed the raw environment value")
	}
	if errors.Unwrap(err) == nil {
		t.Fatal("duration parse error did not wrap its cause")
	}
}

func TestLoad_RuntimeUsageReservationRetryConfigIgnoresValuesWhenDisabled(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_RUNTIME_USAGE_ENABLED", "false")
	t.Setenv("MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_BASE_DELAY", "placeholder-base")
	t.Setenv("MNEMO_RUNTIME_USAGE_RESERVATION_RETRY_MAX_DELAY", "placeholder-maximum")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.RuntimeUsageRetryBaseDelay != runtimeusage.DefaultReservationRetryBaseDelay {
		t.Fatalf("RuntimeUsageRetryBaseDelay = %v, want %v", cfg.RuntimeUsageRetryBaseDelay, runtimeusage.DefaultReservationRetryBaseDelay)
	}
	if cfg.RuntimeUsageRetryMaxDelay != runtimeusage.DefaultReservationRetryMaxDelay {
		t.Fatalf("RuntimeUsageRetryMaxDelay = %v, want %v", cfg.RuntimeUsageRetryMaxDelay, runtimeusage.DefaultReservationRetryMaxDelay)
	}
}

func TestLoad_RuntimeUsageNoticeConfigDefaults(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_RUNTIME_USAGE_ENABLED", "true")
	t.Setenv("MNEMO_RUNTIME_USAGE_BASE_URL", "https://runtime-usage.example.com")
	t.Setenv("MNEMO_RUNTIME_USAGE_INTERNAL_SECRET", "secret-value")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.RuntimeUsageNoticeTimeout != time.Second {
		t.Fatalf("RuntimeUsageNoticeTimeout = %v, want 1s", cfg.RuntimeUsageNoticeTimeout)
	}
	if !cfg.RuntimeUsageNoticeCacheEnabled {
		t.Fatal("RuntimeUsageNoticeCacheEnabled = false, want true")
	}
	if cfg.RuntimeUsageNoticeCacheTTL != 30*time.Second {
		t.Fatalf("RuntimeUsageNoticeCacheTTL = %v, want 30s", cfg.RuntimeUsageNoticeCacheTTL)
	}
	if cfg.RuntimeUsageNoticeStaleTTL != 2*time.Minute {
		t.Fatalf("RuntimeUsageNoticeStaleTTL = %v, want 2m", cfg.RuntimeUsageNoticeStaleTTL)
	}
}

func TestLoad_RuntimeUsageNoticeConfigOverrides(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_RUNTIME_USAGE_ENABLED", "true")
	t.Setenv("MNEMO_RUNTIME_USAGE_BASE_URL", "https://runtime-usage.example.com")
	t.Setenv("MNEMO_RUNTIME_USAGE_INTERNAL_SECRET", "secret-value")
	t.Setenv("MNEMO_RUNTIME_USAGE_NOTICE_TIMEOUT", "1500ms")
	t.Setenv("MNEMO_RUNTIME_USAGE_NOTICE_CACHE_ENABLED", "false")
	t.Setenv("MNEMO_RUNTIME_USAGE_NOTICE_CACHE_TTL", "45s")
	t.Setenv("MNEMO_RUNTIME_USAGE_NOTICE_STALE_TTL", "3m")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.RuntimeUsageNoticeTimeout != 1500*time.Millisecond {
		t.Fatalf("RuntimeUsageNoticeTimeout = %v, want 1500ms", cfg.RuntimeUsageNoticeTimeout)
	}
	if cfg.RuntimeUsageNoticeCacheEnabled {
		t.Fatal("RuntimeUsageNoticeCacheEnabled = true, want false")
	}
	if cfg.RuntimeUsageNoticeCacheTTL != 45*time.Second {
		t.Fatalf("RuntimeUsageNoticeCacheTTL = %v, want 45s", cfg.RuntimeUsageNoticeCacheTTL)
	}
	if cfg.RuntimeUsageNoticeStaleTTL != 3*time.Minute {
		t.Fatalf("RuntimeUsageNoticeStaleTTL = %v, want 3m", cfg.RuntimeUsageNoticeStaleTTL)
	}
}

func TestLoad_RuntimeUsageNoticeConfigValidation(t *testing.T) {
	tests := []struct {
		name       string
		envKey     string
		envValue   string
		wantSubstr string
	}{
		{
			name:       "timeout must be positive",
			envKey:     "MNEMO_RUNTIME_USAGE_NOTICE_TIMEOUT",
			envValue:   "0",
			wantSubstr: "MNEMO_RUNTIME_USAGE_NOTICE_TIMEOUT must be positive",
		},
		{
			name:       "cache ttl must be positive",
			envKey:     "MNEMO_RUNTIME_USAGE_NOTICE_CACHE_TTL",
			envValue:   "0",
			wantSubstr: "MNEMO_RUNTIME_USAGE_NOTICE_CACHE_TTL must be positive",
		},
		{
			name:       "stale ttl must not be negative",
			envKey:     "MNEMO_RUNTIME_USAGE_NOTICE_STALE_TTL",
			envValue:   "-1s",
			wantSubstr: "MNEMO_RUNTIME_USAGE_NOTICE_STALE_TTL must not be negative",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("MNEMO_DSN", "test-dsn")
			t.Setenv("MNEMO_RUNTIME_USAGE_ENABLED", "true")
			t.Setenv("MNEMO_RUNTIME_USAGE_BASE_URL", "https://runtime-usage.example.com")
			t.Setenv("MNEMO_RUNTIME_USAGE_INTERNAL_SECRET", "secret-value")
			t.Setenv(tt.envKey, tt.envValue)

			_, err := Load()
			if err == nil {
				t.Fatal("Load error = nil, want validation error")
			}
			if !strings.Contains(err.Error(), tt.wantSubstr) {
				t.Fatalf("Load error = %v, want %q", err, tt.wantSubstr)
			}
		})
	}
}

func TestLoad_RuntimeUsageRequiresBaseURLAndSecret(t *testing.T) {
	tests := []struct {
		name       string
		baseURL    string
		secret     string
		wantSubstr string
	}{
		{name: "missing base URL", secret: "secret", wantSubstr: "MNEMO_RUNTIME_USAGE_BASE_URL is required"},
		{name: "invalid base URL", baseURL: "ftp://token:secret@example.com/path?api_key=secret", secret: "secret", wantSubstr: "invalid MNEMO_RUNTIME_USAGE_BASE_URL"},
		{name: "missing secret", baseURL: "https://runtime-usage.example.com", wantSubstr: "MNEMO_RUNTIME_USAGE_INTERNAL_SECRET is required"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("MNEMO_DSN", "test-dsn")
			t.Setenv("MNEMO_RUNTIME_USAGE_ENABLED", "true")
			if tt.baseURL != "" {
				t.Setenv("MNEMO_RUNTIME_USAGE_BASE_URL", tt.baseURL)
			}
			if tt.secret != "" {
				t.Setenv("MNEMO_RUNTIME_USAGE_INTERNAL_SECRET", tt.secret)
			}

			_, err := Load()
			if err == nil {
				t.Fatal("Load error = nil, want error")
			}
			if !strings.Contains(err.Error(), tt.wantSubstr) {
				t.Fatalf("Load error = %q, want substring %q", err.Error(), tt.wantSubstr)
			}
			if strings.Contains(err.Error(), "token:secret") || strings.Contains(err.Error(), "api_key=secret") {
				t.Fatalf("runtime usage validation error leaked secret content: %q", err.Error())
			}
		})
	}
}

func TestLoad_RuntimeUsageOutboxCannotBeDisabledWithoutFailOpen(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_RUNTIME_USAGE_ENABLED", "true")
	t.Setenv("MNEMO_RUNTIME_USAGE_BASE_URL", "https://runtime-usage.example.com")
	t.Setenv("MNEMO_RUNTIME_USAGE_INTERNAL_SECRET", "secret-value")
	t.Setenv("MNEMO_RUNTIME_USAGE_OUTBOX_ENABLED", "false")

	_, err := Load()
	if err == nil {
		t.Fatal("Load error = nil, want outbox disabled error")
	}
}

func TestLoad_RuntimeUsageBaseURLDrivesRuntimeUsageMeteringWhenLegacyMeteringEnabled(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_RUNTIME_USAGE_ENABLED", "true")
	t.Setenv("MNEMO_RUNTIME_USAGE_BASE_URL", "https://runtime-usage.example.com")
	t.Setenv("MNEMO_RUNTIME_USAGE_INTERNAL_SECRET", "secret-value")
	t.Setenv("MNEMO_METERING_ENABLED", "true")
	t.Setenv("MNEMO_METERING_URL", "s3://legacy-export/mem9/")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.RuntimeUsageBaseURL != "https://runtime-usage.example.com" {
		t.Fatalf("RuntimeUsageBaseURL = %q", cfg.RuntimeUsageBaseURL)
	}
	if cfg.MeteringURL != "s3://legacy-export/mem9/" {
		t.Fatalf("MeteringURL = %q", cfg.MeteringURL)
	}
}

func TestLoad_AutoSpendLimitDefaultsAndCustom(t *testing.T) {
	tests := []struct {
		name          string
		envs          map[string]string
		wantEnabled   bool
		wantIncrement int
		wantMax       int
		wantCooldown  time.Duration
	}{
		{
			name:          "defaults",
			envs:          map[string]string{},
			wantEnabled:   false,
			wantIncrement: 500,
			wantMax:       10000,
			wantCooldown:  time.Hour,
		},
		{
			name: "custom",
			envs: map[string]string{
				"MNEMO_AUTO_SPEND_LIMIT_ENABLED":   "true",
				"MNEMO_AUTO_SPEND_LIMIT_INCREMENT": "750",
				"MNEMO_AUTO_SPEND_LIMIT_MAX":       "20000",
				"MNEMO_AUTO_SPEND_LIMIT_COOLDOWN":  "2h",
			},
			wantEnabled:   true,
			wantIncrement: 750,
			wantMax:       20000,
			wantCooldown:  2 * time.Hour,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("MNEMO_DSN", "test-dsn")
			for k, v := range tt.envs {
				t.Setenv(k, v)
			}

			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if cfg.AutoSpendLimitEnabled != tt.wantEnabled {
				t.Fatalf("AutoSpendLimitEnabled = %v, want %v", cfg.AutoSpendLimitEnabled, tt.wantEnabled)
			}
			if cfg.AutoSpendLimitIncrement != tt.wantIncrement {
				t.Fatalf("AutoSpendLimitIncrement = %d, want %d", cfg.AutoSpendLimitIncrement, tt.wantIncrement)
			}
			if cfg.AutoSpendLimitMax != tt.wantMax {
				t.Fatalf("AutoSpendLimitMax = %d, want %d", cfg.AutoSpendLimitMax, tt.wantMax)
			}
			if cfg.AutoSpendLimitCooldown != tt.wantCooldown {
				t.Fatalf("AutoSpendLimitCooldown = %v, want %v", cfg.AutoSpendLimitCooldown, tt.wantCooldown)
			}
		})
	}
}

func TestLoad_AutoSpendLimitValidation(t *testing.T) {
	tests := []struct {
		name       string
		envs       map[string]string
		wantSubstr string
	}{
		{
			name: "increment zero",
			envs: map[string]string{
				"MNEMO_AUTO_SPEND_LIMIT_INCREMENT": "0",
			},
			wantSubstr: "must be positive",
		},
		{
			name: "increment negative",
			envs: map[string]string{
				"MNEMO_AUTO_SPEND_LIMIT_INCREMENT": "-1",
			},
			wantSubstr: "must be positive",
		},
		{
			name: "max less than increment",
			envs: map[string]string{
				"MNEMO_AUTO_SPEND_LIMIT_INCREMENT": "500",
				"MNEMO_AUTO_SPEND_LIMIT_MAX":       "100",
			},
			wantSubstr: "must be greater than increment",
		},
		{
			name: "max equal increment",
			envs: map[string]string{
				"MNEMO_AUTO_SPEND_LIMIT_INCREMENT": "500",
				"MNEMO_AUTO_SPEND_LIMIT_MAX":       "500",
			},
			wantSubstr: "must be greater than increment",
		},
		{
			name: "cooldown zero",
			envs: map[string]string{
				"MNEMO_AUTO_SPEND_LIMIT_COOLDOWN": "0",
			},
			wantSubstr: "must be positive",
		},
		{
			name: "enabled does not bypass validation",
			envs: map[string]string{
				"MNEMO_AUTO_SPEND_LIMIT_ENABLED":   "true",
				"MNEMO_AUTO_SPEND_LIMIT_INCREMENT": "0",
			},
			wantSubstr: "must be positive",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("MNEMO_DSN", "test-dsn")
			for k, v := range tt.envs {
				t.Setenv(k, v)
			}

			_, err := Load()
			if err == nil {
				t.Fatal("Load error = nil, want validation error")
			}
			if !strings.Contains(err.Error(), tt.wantSubstr) {
				t.Fatalf("Load error = %q, want substring %q", err.Error(), tt.wantSubstr)
			}
		})
	}
}

func TestCohereV3RequiresFixedEmbeddingDimensions(t *testing.T) {
	t.Setenv("MNEMO_DSN", "test-dsn")
	t.Setenv("MNEMO_EMBED_AUTO_MODEL", "tidbcloud_free/cohere/embed-multilingual-v3")
	t.Setenv("MNEMO_EMBED_AUTO_DIMS", "1024")
	cfg, err := Load()
	if err != nil || cfg.EmbedAutoDims != 1024 {
		t.Fatalf("valid Cohere config: %v", err)
	}
	t.Setenv("MNEMO_EMBED_AUTO_DIMS", "512")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "requires MNEMO_EMBED_AUTO_DIMS=1024") {
		t.Fatalf("wrong dimensions accepted: %v", err)
	}
}

const (
	createGateSwitchEnv = "MNEMO_SPACE_CHAIN_CREATE_SECRET_REQUIRED"
	createGateSecretEnv = "MNEMO_SPACE_CHAIN_CREATE_SECRET"
)

// clearCreateGateEnv leaves both create gate variables unset, so a case does
// not depend on the environment it runs in.
func clearCreateGateEnv(t *testing.T) {
	t.Helper()
	t.Setenv("MNEMO_DSN", "test-dsn")
	for _, key := range []string{createGateSwitchEnv, createGateSecretEnv} {
		t.Setenv(key, "") // registers restoring the original value after the case
		if err := os.Unsetenv(key); err != nil {
			t.Fatalf("unset %s: %v", key, err)
		}
	}
}

func TestLoad_SpaceChainCreateGateDefaultsOff(t *testing.T) {
	clearCreateGateEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.SpaceChainCreateSecretRequired {
		t.Fatal("SpaceChainCreateSecretRequired = true, want false by default")
	}
	if cfg.SpaceChainCreateSecret != "" {
		t.Fatal("SpaceChainCreateSecret is not empty by default")
	}
}

func TestLoad_SpaceChainCreateGateLoadsSwitchAndTrimmedSecret(t *testing.T) {
	clearCreateGateEnv(t)
	t.Setenv(createGateSwitchEnv, "true")
	t.Setenv(createGateSecretEnv, " \n\tgate-secret-value\r\n ")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.SpaceChainCreateSecretRequired {
		t.Fatal("SpaceChainCreateSecretRequired = false, want true")
	}
	if cfg.SpaceChainCreateSecret != "gate-secret-value" {
		t.Fatal("SpaceChainCreateSecret was not loaded with surrounding whitespace trimmed")
	}
}

func TestLoad_SpaceChainCreateGateSwitchedOnNeedsSecret(t *testing.T) {
	tests := []struct {
		name   string
		secret *string // nil leaves the secret variable unset
	}{
		{name: "secret unset"},
		{name: "secret empty", secret: ptr("")},
		{name: "secret only whitespace", secret: ptr(" \t\r\n ")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clearCreateGateEnv(t)
			t.Setenv(createGateSwitchEnv, "true")
			if tt.secret != nil {
				t.Setenv(createGateSecretEnv, *tt.secret)
			}

			cfg, err := Load()
			if err == nil {
				t.Fatal("Load succeeded with the create gate switched on and no secret")
			}
			if cfg != nil {
				t.Fatal("Load returned a config together with an error")
			}
			for _, name := range []string{createGateSwitchEnv, createGateSecretEnv} {
				if !strings.Contains(err.Error(), name) {
					t.Fatalf("error %q does not name %s", err.Error(), name)
				}
			}
		})
	}
}

func ptr[T any](v T) *T { return &v }

func TestLoad_SpaceChainCreateGateSwitchSpellings(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "true", value: "true", want: true},
		{name: "upper case TRUE", value: "TRUE", want: true},
		{name: "digit one", value: "1", want: true},
		{name: "letter t", value: "t", want: true},
		{name: "true with surrounding whitespace", value: " true \n", want: true},
		{name: "false", value: "false", want: false},
		{name: "mixed case False", value: "False", want: false},
		{name: "digit zero", value: "0", want: false},
		{name: "letter f", value: "f", want: false},
		{name: "false with surrounding whitespace", value: "\tfalse ", want: false},
		{name: "empty means off", value: "", want: false},
		{name: "only whitespace means off", value: " \t\n", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clearCreateGateEnv(t)
			t.Setenv(createGateSwitchEnv, tt.value)
			t.Setenv(createGateSecretEnv, "gate-secret-value")

			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if cfg.SpaceChainCreateSecretRequired != tt.want {
				t.Fatalf("SpaceChainCreateSecretRequired = %v, want %v", cfg.SpaceChainCreateSecretRequired, tt.want)
			}
		})
	}
}

func TestLoad_SpaceChainCreateGateSwitchRefusesUnreadableValue(t *testing.T) {
	// A mistyped switch must stop the server. Falling back to "off" would let
	// an operator believe the gate is on while it is not.
	for _, value := range []string{"yes", "on", "ture", "enabled", "2", "sentinel-not-a-bool"} {
		t.Run(value, func(t *testing.T) {
			clearCreateGateEnv(t)
			t.Setenv(createGateSwitchEnv, value)
			t.Setenv(createGateSecretEnv, "gate-secret-value")

			cfg, err := Load()
			if err == nil {
				t.Fatal("Load accepted a switch value that is not a boolean")
			}
			if cfg != nil {
				t.Fatal("Load returned a config together with an error")
			}
			if !strings.Contains(err.Error(), createGateSwitchEnv) {
				t.Fatalf("error %q does not name %s", err.Error(), createGateSwitchEnv)
			}
			if strings.Contains(err.Error(), "gate-secret-value") {
				t.Fatal("error contains the create secret")
			}
			// Only the long sentinel is checked for being repeated: short values
			// such as "on" could appear in the message by chance, and any code
			// that repeats the value would repeat the sentinel as well.
			if strings.Contains(err.Error(), "sentinel-not-a-bool") {
				t.Fatal("error repeats the rejected switch value")
			}
		})
	}
}

func TestLoad_SpaceChainCreateGateSecretWithoutSwitchIsAccepted(t *testing.T) {
	// The secret can be put in place before the switch is turned on.
	clearCreateGateEnv(t)
	t.Setenv(createGateSecretEnv, "gate-secret-value")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.SpaceChainCreateSecretRequired {
		t.Fatal("SpaceChainCreateSecretRequired = true without the switch")
	}
}

func TestLoad_OtherSwitchesKeepFallingBackOnUnreadableValue(t *testing.T) {
	// Only the create gate switch is strict. Making the shared helper strict
	// would stop servers that already run with a typo in some other switch.
	clearCreateGateEnv(t)
	t.Setenv("MNEMO_FTS_ENABLED", "ture")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.FTSEnabled {
		t.Fatal("FTSEnabled = true for an unreadable value, want the default false")
	}
}

func TestConfig_SpaceChainCreateGateShowsStateButNeverTheSecret(t *testing.T) {
	clearCreateGateEnv(t)
	t.Setenv(createGateSwitchEnv, "true")
	t.Setenv(createGateSecretEnv, "gate-secret-value")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	encoded, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if strings.Contains(string(encoded), "gate-secret-value") {
		t.Fatal("JSON encoding of the config contains the create secret")
	}

	var logged bytes.Buffer
	slog.New(slog.NewJSONHandler(&logged, nil)).Info("config loaded", "config", cfg)
	if strings.Contains(logged.String(), "gate-secret-value") {
		t.Fatal("logged config contains the create secret")
	}
	var line struct {
		Config map[string]any `json:"config"`
	}
	if err := json.Unmarshal(logged.Bytes(), &line); err != nil {
		t.Fatalf("decode logged config: %v", err)
	}
	if got := line.Config["SpaceChainCreateSecretRequired"]; got != true {
		t.Fatalf("logged SpaceChainCreateSecretRequired = %v, want true", got)
	}
	if got := line.Config["SpaceChainCreateSecretConfigured"]; got != true {
		t.Fatalf("logged SpaceChainCreateSecretConfigured = %v, want true", got)
	}
}
