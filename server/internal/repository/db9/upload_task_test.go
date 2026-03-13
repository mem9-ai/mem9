package db9

import (
	"fmt"
	"strings"
	"testing"
)

func TestBuildFetchPendingQueryUsesClampedInlineLimit(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    int
		expected int
	}{
		{name: "non-positive defaults", input: 0, expected: defaultFetchPendingLimit},
		{name: "negative defaults", input: -5, expected: defaultFetchPendingLimit},
		{name: "within range preserved", input: 17, expected: 17},
		{name: "over max clamped", input: 999, expected: maxFetchPendingLimit},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			query := buildFetchPendingQuery(tt.input)
			wantLimit := fmt.Sprintf("LIMIT %d", tt.expected)
			if !strings.Contains(query, wantLimit) {
				t.Fatalf("expected query to contain %q, got %q", wantLimit, query)
			}
			if strings.Contains(query, "LIMIT $1") {
				t.Fatalf("expected inline LIMIT, got parameterized query: %q", query)
			}
			if !strings.Contains(query, "FOR UPDATE SKIP LOCKED") {
				t.Fatalf("expected lock clause in query: %q", query)
			}
		})
	}
}
