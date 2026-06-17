package handler

import (
	"errors"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

// parseTimeParam is the wire-side half of the raw-session created_at
// window filter: optional RFC3339 timestamps, absent → no bound, a
// malformed value is a client error rather than a silently-ignored
// param.

func TestParseTimeParam_EmptyIsUnbounded(t *testing.T) {
	for _, raw := range []string{"", "   "} {
		got, err := parseTimeParam(raw, "created_after")
		if err != nil {
			t.Fatalf("parseTimeParam(%q) err = %v, want nil", raw, err)
		}
		if got != nil {
			t.Fatalf("parseTimeParam(%q) = %v, want nil (unbounded)", raw, got)
		}
	}
}

func TestParseTimeParam_ValidRFC3339(t *testing.T) {
	got, err := parseTimeParam("2026-06-17T14:00:00Z", "created_after")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	want := time.Date(2026, 6, 17, 14, 0, 0, 0, time.UTC)
	if got == nil || !got.Equal(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestParseTimeParam_InvalidIsValidationError(t *testing.T) {
	// Non-RFC3339 forms must be rejected, not silently dropped.
	for _, raw := range []string{"2026-06-17", "yesterday", "1718632800"} {
		got, err := parseTimeParam(raw, "created_before")
		if got != nil {
			t.Fatalf("parseTimeParam(%q) = %v, want nil on error", raw, got)
		}
		var ve *domain.ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("parseTimeParam(%q) err = %v, want *domain.ValidationError", raw, err)
		}
		if ve.Field != "created_before" {
			t.Fatalf("error field = %q, want created_before", ve.Field)
		}
	}
}
