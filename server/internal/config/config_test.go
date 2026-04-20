package config

import (
	"reflect"
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
