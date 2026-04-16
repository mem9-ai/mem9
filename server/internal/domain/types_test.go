package domain

import "testing"

func TestMemoryFilterRerankerQuery(t *testing.T) {
	filter := MemoryFilter{Query: "augmented query", RawQuery: "raw user query"}
	if got := filter.RerankerQuery(); got != "raw user query" {
		t.Fatalf("expected raw query, got %q", got)
	}

	filter = MemoryFilter{Query: "plain query"}
	if got := filter.RerankerQuery(); got != "plain query" {
		t.Fatalf("expected fallback to Query, got %q", got)
	}
}
