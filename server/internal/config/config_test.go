package config

import (
	"reflect"
	"testing"
	"time"
)

func TestConfig_MeteringSurfaceReduced(t *testing.T) {
	typeName := reflect.TypeOf(Config{})
	for _, field := range []string{
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
	t.Setenv("MNEMO_METERING_S3_BUCKET", "bucket-a")
	t.Setenv("MNEMO_METERING_S3_PREFIX", "prefix-a")
	t.Setenv("MNEMO_METERING_FLUSH_INTERVAL", "15s")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.MeteringEnabled {
		t.Fatal("MeteringEnabled = false, want true")
	}
	if cfg.MeteringBucket != "bucket-a" {
		t.Fatalf("MeteringBucket = %q, want bucket-a", cfg.MeteringBucket)
	}
	if cfg.MeteringPrefix != "prefix-a" {
		t.Fatalf("MeteringPrefix = %q, want prefix-a", cfg.MeteringPrefix)
	}
	if cfg.MeteringFlushInterval != 15*time.Second {
		t.Fatalf("MeteringFlushInterval = %v, want 15s", cfg.MeteringFlushInterval)
	}
}
