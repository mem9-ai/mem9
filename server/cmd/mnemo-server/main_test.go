package main

import (
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/config"
)

func TestNewRuntimeUsageConfigMapsReservationRetryDelays(t *testing.T) {
	cfg := &config.Config{
		RuntimeUsageRetryBaseDelay: 450 * time.Millisecond,
		RuntimeUsageRetryMaxDelay:  1250 * time.Millisecond,
	}

	got := newRuntimeUsageConfig(cfg, nil)
	if got.ReservationRetryBaseDelay != cfg.RuntimeUsageRetryBaseDelay {
		t.Fatalf("ReservationRetryBaseDelay = %v, want %v", got.ReservationRetryBaseDelay, cfg.RuntimeUsageRetryBaseDelay)
	}
	if got.ReservationRetryMaxDelay != cfg.RuntimeUsageRetryMaxDelay {
		t.Fatalf("ReservationRetryMaxDelay = %v, want %v", got.ReservationRetryMaxDelay, cfg.RuntimeUsageRetryMaxDelay)
	}
}

func TestRedactMeteringURLForLog(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"s3", "s3://bucket-a/prefix-a/?token=secret", "s3://bucket-a"},
		{"https with query and userinfo", "https://user:pass@example.com/hook?token=secret", "https://example.com"},
		{"http", "http://hooks.example.com/path/to/hook", "http://hooks.example.com"},
		{"invalid", "://bad url", "<invalid>"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := redactMeteringURLForLog(tc.in); got != tc.want {
				t.Fatalf("redactMeteringURLForLog(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
