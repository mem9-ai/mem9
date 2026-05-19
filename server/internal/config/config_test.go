package config

import (
	"reflect"
	"strings"
	"testing"
	"time"
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
