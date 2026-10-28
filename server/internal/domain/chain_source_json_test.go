package domain

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"
)

// ChainSource is embedded in memory responses, session message responses,
// create responses and webhook payloads. Its TenantID is the node's Space key,
// so no JSON encoding of it, alone or nested, may carry the key.
func TestChainSourceJSONNeverCarriesSpaceKey(t *testing.T) {
	const spaceKey = "space-key-secret-0123456789"
	source := &ChainSource{ChainID: "chain-a", NodePosition: 1, TenantID: spaceKey, ExternalSpaceID: "space-a"}

	tests := []struct {
		name  string
		value any
		path  func(map[string]any) any
	}{
		{"chain source", source, func(m map[string]any) any { return m }},
		{"memory", Memory{ID: "mem-1", ChainSource: source}, func(m map[string]any) any { return m["chain_source"] }},
		{"memory pointer", &Memory{ID: "mem-1", ChainSource: source}, func(m map[string]any) any { return m["chain_source"] }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := json.Marshal(tt.value)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(raw), spaceKey) || strings.Contains(string(raw), "tenant_id") {
				t.Fatalf("encoded value carries the Space key: %s", raw)
			}
			var decoded map[string]any
			if err := json.Unmarshal(raw, &decoded); err != nil {
				t.Fatal(err)
			}
			chainSource, ok := tt.path(decoded).(map[string]any)
			if !ok {
				t.Fatalf("chain_source missing in %s", raw)
			}
			got := make([]string, 0, len(chainSource))
			for key := range chainSource {
				got = append(got, key)
			}
			sort.Strings(got)
			if want := "chain_id,external_space_id,node_position"; strings.Join(got, ",") != want {
				t.Fatalf("chain_source keys = %v, want %s", got, want)
			}
		})
	}

	if source.TenantID != spaceKey {
		t.Fatalf("encoding changed the Go field: TenantID = %q", source.TenantID)
	}
}
