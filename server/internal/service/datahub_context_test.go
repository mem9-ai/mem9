package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestShouldQueryDataHubContextDetectsDataAssetQuestions(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  bool
	}{
		{
			name:  "dashboard freshness question",
			query: "why is the revenue dashboard wrong today?",
			want:  true,
		},
		{
			name:  "lineage question in Chinese",
			query: "这个订单表的下游血缘有哪些",
			want:  true,
		},
		{
			name:  "ordinary personal memory question",
			query: "what coffee shop did Dylan like last week?",
			want:  false,
		},
		{
			name:  "ordinary stable app question",
			query: "is the mobile app stable now?",
			want:  false,
		},
		{
			name:  "ordinary Chinese performance question",
			query: "他最近表现怎么样",
			want:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ShouldQueryDataHubContext(tt.query); got != tt.want {
				t.Fatalf("ShouldQueryDataHubContext(%q) = %v, want %v", tt.query, got, tt.want)
			}
		})
	}
}

func TestFormatDataHubSearchQueryUsesStructuredKeywordSyntax(t *testing.T) {
	got := FormatDataHubSearchQuery("why is the revenue dashboard wrong today?")
	if got != "/q revenue+dashboard" {
		t.Fatalf("FormatDataHubSearchQuery() = %q, want /q revenue+dashboard", got)
	}

	cased := FormatDataHubSearchQuery("Why is the Executive Revenue dashboard wrong today?")
	if cased != "/q Executive+Revenue+dashboard" {
		t.Fatalf("FormatDataHubSearchQuery() preserved query = %q, want /q Executive+Revenue+dashboard", cased)
	}

	alreadyStructured := FormatDataHubSearchQuery("/q tag:PII")
	if alreadyStructured != "/q tag:PII" {
		t.Fatalf("structured query changed to %q", alreadyStructured)
	}
}

func TestNormalizeDataHubTextContentUsesNestedPropertiesForEntityTitle(t *testing.T) {
	items := normalizeDataHubTextContent(`{
		"urn": "urn:li:dataset:(snowflake,mart.revenue,PROD)",
		"type": "DATASET",
		"properties": {
			"name": "mart.revenue",
			"description": "Nested revenue dataset description.",
			"externalUrl": "https://datahub.example.com/dataset/mart.revenue"
		}
	}`)

	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if items[0].Title != "mart.revenue" {
		t.Fatalf("title = %q, want nested properties.name", items[0].Title)
	}
	if !strings.Contains(items[0].Snippet, "Nested revenue dataset") {
		t.Fatalf("snippet = %q, want nested description", items[0].Snippet)
	}
	if items[0].URL != "https://datahub.example.com/dataset/mart.revenue" {
		t.Fatalf("url = %q, want nested externalUrl", items[0].URL)
	}
}

func TestNormalizeDataHubTextContentHandlesEntitiesMapResponse(t *testing.T) {
	items := normalizeDataHubTextContent(`{
		"entities": {
			"urn:li:dataset:(snowflake,mart.revenue,PROD)": {
				"urn": "urn:li:dataset:(snowflake,mart.revenue,PROD)",
				"type": "DATASET",
				"properties": {
					"name": "mart.revenue",
					"description": "Entity map revenue dataset."
				}
			}
		}
	}`)

	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if items[0].ID != "urn:li:dataset:(snowflake,mart.revenue,PROD)" || items[0].Title != "mart.revenue" {
		t.Fatalf("unexpected entity map item: %+v", items[0])
	}
	if !strings.Contains(items[0].Snippet, "Entity map revenue dataset") {
		t.Fatalf("snippet = %q, want entity map description", items[0].Snippet)
	}
}

func TestNormalizeDataHubTextContentHandlesEntityMapWrappers(t *testing.T) {
	items := normalizeDataHubTextContent(`{
		"entities": {
			"urn:li:dataset:(snowflake,mart.revenue,PROD)": {
				"entity": {
					"type": "DATASET",
					"properties": {
						"name": "mart.revenue"
					}
				}
			}
		}
	}`)

	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if items[0].ID != "urn:li:dataset:(snowflake,mart.revenue,PROD)" || items[0].Title != "mart.revenue" {
		t.Fatalf("unexpected wrapped entity-map item: %+v", items[0])
	}
}

func TestNormalizeDataHubTextContentHandlesResultsAlias(t *testing.T) {
	items := normalizeDataHubTextContent(`{
		"results": [
			{
				"entity": {
					"urn": "urn:li:dashboard:(looker,revenue_exec)",
					"type": "DASHBOARD",
					"name": "Executive Revenue"
				}
			}
		]
	}`)

	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if items[0].ID != "urn:li:dashboard:(looker,revenue_exec)" || items[0].Title != "Executive Revenue" {
		t.Fatalf("unexpected results alias item: %+v", items[0])
	}
}

func TestNormalizeDataHubTextContentHandlesSearchResultEntityURN(t *testing.T) {
	items := normalizeDataHubTextContent(`{
		"searchResults": [
			{
				"entity": "urn:li:dataset:(snowflake,mart.revenue,PROD)",
				"type": "DATASET",
				"name": "mart.revenue",
				"description": "Revenue search hit from URN result.",
				"url": "https://datahub.example.com/dataset/mart.revenue"
			}
		]
	}`)

	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if items[0].ID != "urn:li:dataset:(snowflake,mart.revenue,PROD)" {
		t.Fatalf("id = %q, want entity URN", items[0].ID)
	}
	if items[0].Title != "mart.revenue" {
		t.Fatalf("title = %q, want search result name", items[0].Title)
	}
	if !strings.Contains(items[0].Snippet, "Revenue search hit") {
		t.Fatalf("snippet = %q, want search result description", items[0].Snippet)
	}
	if items[0].URL != "https://datahub.example.com/dataset/mart.revenue" {
		t.Fatalf("url = %q, want search result url", items[0].URL)
	}
}

func TestNormalizeDataHubTextContentHandlesArrayEntityWrappers(t *testing.T) {
	items := normalizeDataHubTextContent(`[
		{
			"entity": {
				"urn": "urn:li:dataset:(snowflake,mart.revenue,PROD)",
				"type": "DATASET",
				"name": "mart.revenue"
			}
		}
	]`)

	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if items[0].ID != "urn:li:dataset:(snowflake,mart.revenue,PROD)" || items[0].Title != "mart.revenue" {
		t.Fatalf("unexpected wrapper item: %+v", items[0])
	}
}

func TestNormalizeDataHubTextContentHandlesEntitiesArrayWrappers(t *testing.T) {
	items := normalizeDataHubTextContent(`{
		"entities": [
			{
				"entity": {
					"urn": "urn:li:dataset:(snowflake,mart.revenue,PROD)",
					"type": "DATASET",
					"name": "mart.revenue"
				}
			}
		]
	}`)

	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if items[0].ID != "urn:li:dataset:(snowflake,mart.revenue,PROD)" || items[0].Title != "mart.revenue" {
		t.Fatalf("unexpected entities-array wrapper item: %+v", items[0])
	}
}

func TestDataHubMCPContextProviderRetrieveCallsSearchAndNormalizesResults(t *testing.T) {
	var sawBearer bool
	var sawSearch bool
	var searchQuery string

	mcpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "Bearer test-token" {
			sawBearer = true
		}

		var req struct {
			ID     any             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		switch req.Method {
		case "initialize":
			w.Header().Set("Mcp-Session-Id", "session-1")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      req.ID,
				"result": map[string]any{
					"protocolVersion": "2025-03-26",
					"capabilities":    map[string]any{},
					"serverInfo":      map[string]string{"name": "fake-datahub"},
				},
			})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/call":
			var params struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			}
			if err := json.Unmarshal(req.Params, &params); err != nil {
				t.Fatalf("decode tool params: %v", err)
			}
			switch params.Name {
			case "search":
				sawSearch = true
				searchQuery, _ = params.Arguments["query"].(string)
				if got := params.Arguments["num_results"]; got != float64(3) {
					t.Fatalf("num_results = %#v, want 3", got)
				}

				payload := map[string]any{
					"count": 1,
					"searchResults": []map[string]any{
						{
							"entity": map[string]any{
								"urn":         "urn:li:dashboard:(looker,revenue_exec)",
								"type":        "DASHBOARD",
								"name":        "Executive Revenue",
								"description": "Executive revenue dashboard with freshness checks.",
								"url":         "https://datahub.example.com/dashboard/revenue",
							},
						},
					},
				}
				writeMCPToolTextResult(t, w, req.ID, payload)
			case "get_entities":
				payload := []map[string]any{
					{
						"urn":         "urn:li:dashboard:(looker,revenue_exec)",
						"type":        "DASHBOARD",
						"name":        "Executive Revenue",
						"description": "Executive revenue dashboard with freshness checks.",
						"url":         "https://datahub.example.com/dashboard/revenue",
					},
				}
				writeMCPToolTextResult(t, w, req.ID, payload)
			case "get_lineage":
				writeMCPToolTextResult(t, w, req.ID, map[string]any{})
			default:
				t.Fatalf("unexpected tool name %q", params.Name)
			}
		default:
			t.Fatalf("unexpected MCP method %q", req.Method)
		}
	}))
	defer mcpServer.Close()

	provider := NewDataHubMCPContextProvider(DataHubMCPConfig{
		Endpoint:   mcpServer.URL,
		Token:      "test-token",
		Timeout:    time.Second,
		MaxResults: 3,
	})
	items, err := provider.Retrieve(context.Background(), "why is the revenue dashboard wrong today?", 3)
	if err != nil {
		t.Fatalf("Retrieve() error: %v", err)
	}
	if !sawBearer {
		t.Fatal("MCP request did not include bearer token")
	}
	if !sawSearch {
		t.Fatal("MCP search tool was not called")
	}
	if searchQuery != "/q revenue+dashboard" {
		t.Fatalf("search query = %q, want /q revenue+dashboard", searchQuery)
	}
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	item := items[0]
	if item.Provider != "datahub" || item.Type != "DASHBOARD" || item.ID != "urn:li:dashboard:(looker,revenue_exec)" {
		t.Fatalf("unexpected item identity: %+v", item)
	}
	if item.Title != "Executive Revenue" {
		t.Fatalf("title = %q", item.Title)
	}
	if !strings.Contains(item.Snippet, "freshness checks") {
		t.Fatalf("snippet = %q, want freshness checks", item.Snippet)
	}
	if item.URL != "https://datahub.example.com/dashboard/revenue" {
		t.Fatalf("url = %q", item.URL)
	}
	if len(item.Metadata) == 0 {
		t.Fatal("metadata should preserve raw entity JSON")
	}
}

func TestDataHubMCPContextProviderRetrieveNormalizesStructuredContent(t *testing.T) {
	mcpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     any             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		switch req.Method {
		case "initialize":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      req.ID,
				"result":  map[string]any{"protocolVersion": "2025-03-26"},
			})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/call":
			var params struct {
				Name string `json:"name"`
			}
			if err := json.Unmarshal(req.Params, &params); err != nil {
				t.Fatalf("decode tool params: %v", err)
			}
			switch params.Name {
			case "search":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"jsonrpc": "2.0",
					"id":      req.ID,
					"result": map[string]any{
						"structuredContent": map[string]any{
							"searchResults": []map[string]any{
								{
									"entity": map[string]any{
										"urn":         "urn:li:dataset:(snowflake,mart.revenue,PROD)",
										"type":        "DATASET",
										"name":        "mart.revenue",
										"description": "Structured content revenue dataset.",
									},
								},
							},
						},
					},
				})
			case "get_entities":
				writeMCPToolTextResult(t, w, req.ID, []map[string]any{})
			default:
				t.Fatalf("unexpected tool %q", params.Name)
			}
		default:
			t.Fatalf("unexpected MCP method %q", req.Method)
		}
	}))
	defer mcpServer.Close()

	provider := NewDataHubMCPContextProvider(DataHubMCPConfig{
		Endpoint:   mcpServer.URL,
		Timeout:    time.Second,
		MaxResults: 3,
	})
	items, err := provider.Retrieve(context.Background(), "revenue dataset", 3)
	if err != nil {
		t.Fatalf("Retrieve() error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if items[0].ID != "urn:li:dataset:(snowflake,mart.revenue,PROD)" || !strings.Contains(items[0].Snippet, "Structured content") {
		t.Fatalf("unexpected structured content item: %+v", items[0])
	}
}

func TestDataHubMCPContextProviderRetrieveEnrichesSearchWithEntitiesAndLineage(t *testing.T) {
	var toolCalls []string
	var getEntitiesURNs []string
	var upstreamFlags []bool

	mcpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     any             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		switch req.Method {
		case "initialize":
			w.Header().Set("Mcp-Session-Id", "session-1")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      req.ID,
				"result": map[string]any{
					"protocolVersion": "2025-03-26",
					"capabilities":    map[string]any{},
				},
			})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/call":
			var params struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			}
			if err := json.Unmarshal(req.Params, &params); err != nil {
				t.Fatalf("decode tool params: %v", err)
			}
			toolCalls = append(toolCalls, params.Name)
			switch params.Name {
			case "search":
				writeMCPToolTextResult(t, w, req.ID, map[string]any{
					"count": 2,
					"searchResults": []map[string]any{
						{
							"entity": map[string]any{
								"urn":         "urn:li:dataset:(snowflake,mart.revenue,PROD)",
								"type":        "DATASET",
								"name":        "mart.revenue",
								"description": "Search result for revenue table.",
							},
						},
						{
							"entity": map[string]any{
								"urn":         "urn:li:dashboard:(looker,revenue_exec)",
								"type":        "DASHBOARD",
								"name":        "Executive Revenue",
								"description": "Revenue dashboard.",
							},
						},
					},
				})
			case "get_entities":
				rawURNs, ok := params.Arguments["urns"].([]any)
				if !ok {
					t.Fatalf("get_entities urns = %#v, want array", params.Arguments["urns"])
				}
				for _, raw := range rawURNs {
					if urn, ok := raw.(string); ok {
						getEntitiesURNs = append(getEntitiesURNs, urn)
					}
				}
				writeMCPToolTextResult(t, w, req.ID, []map[string]any{
					{
						"urn":         "urn:li:dataset:(snowflake,mart.revenue,PROD)",
						"type":        "DATASET",
						"name":        "mart.revenue",
						"description": "Certified revenue dataset owned by Finance Analytics.",
						"url":         "https://datahub.example.com/dataset/mart.revenue",
					},
					{
						"urn":         "urn:li:dashboard:(looker,revenue_exec)",
						"type":        "DASHBOARD",
						"name":        "Executive Revenue",
						"description": "Executive dashboard for revenue.",
					},
				})
			case "get_lineage":
				upstream, _ := params.Arguments["upstream"].(bool)
				upstreamFlags = append(upstreamFlags, upstream)
				if got := params.Arguments["urn"]; got != "urn:li:dataset:(snowflake,mart.revenue,PROD)" {
					t.Fatalf("lineage urn = %#v", got)
				}
				if upstream {
					writeMCPToolTextResult(t, w, req.ID, map[string]any{
						"upstreams": map[string]any{
							"searchResults": []map[string]any{
								{
									"entity": map[string]any{
										"urn":  "urn:li:dataset:(snowflake,raw.orders,PROD)",
										"type": "DATASET",
										"name": "raw.orders",
									},
									"degree": 1,
								},
							},
							"returned": 1,
							"hasMore":  false,
						},
					})
				} else {
					writeMCPToolTextResult(t, w, req.ID, map[string]any{
						"downstreams": map[string]any{
							"searchResults": []map[string]any{
								{
									"entity": map[string]any{
										"urn":  "urn:li:dashboard:(looker,revenue_exec)",
										"type": "DASHBOARD",
										"name": "Executive Revenue",
									},
									"degree": 1,
								},
							},
							"returned": 1,
							"hasMore":  false,
						},
					})
				}
			default:
				t.Fatalf("unexpected tool %q", params.Name)
			}
		default:
			t.Fatalf("unexpected MCP method %q", req.Method)
		}
	}))
	defer mcpServer.Close()

	provider := NewDataHubMCPContextProvider(DataHubMCPConfig{
		Endpoint:   mcpServer.URL,
		Timeout:    time.Second,
		MaxResults: 5,
	})
	items, err := provider.Retrieve(context.Background(), "why is the revenue dashboard wrong today?", 5)
	if err != nil {
		t.Fatalf("Retrieve() error: %v", err)
	}

	wantCalls := []string{"search", "get_entities", "get_lineage", "get_lineage"}
	if !reflect.DeepEqual(toolCalls, wantCalls) {
		t.Fatalf("tool calls = %v, want %v", toolCalls, wantCalls)
	}
	wantURNs := []string{"urn:li:dataset:(snowflake,mart.revenue,PROD)", "urn:li:dashboard:(looker,revenue_exec)"}
	if !reflect.DeepEqual(getEntitiesURNs, wantURNs) {
		t.Fatalf("get_entities urns = %v, want %v", getEntitiesURNs, wantURNs)
	}
	if !reflect.DeepEqual(upstreamFlags, []bool{true, false}) {
		t.Fatalf("lineage upstream flags = %v, want [true false]", upstreamFlags)
	}
	if len(items) < 4 {
		t.Fatalf("items len = %d, want enriched entity plus lineage items", len(items))
	}
	if item := findExternalContextItem(items, "urn:li:dataset:(snowflake,mart.revenue,PROD)", "DATASET"); item == nil || !strings.Contains(item.Snippet, "Certified revenue dataset") {
		t.Fatalf("missing enriched dataset item in %+v", items)
	}
	if item := findExternalContextItem(items, "urn:li:dataset:(snowflake,mart.revenue,PROD)#lineage:upstream", "LINEAGE_UPSTREAM"); item == nil || !strings.Contains(item.Snippet, "raw.orders") {
		t.Fatalf("missing upstream lineage item in %+v", items)
	}
	if item := findExternalContextItem(items, "urn:li:dataset:(snowflake,mart.revenue,PROD)#lineage:downstream", "LINEAGE_DOWNSTREAM"); item == nil || !strings.Contains(item.Snippet, "Executive Revenue") {
		t.Fatalf("missing downstream lineage item in %+v", items)
	}
}

func TestDataHubMCPContextProviderRetrieveNormalizesStructuredLineage(t *testing.T) {
	mcpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     any             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		switch req.Method {
		case "initialize":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      req.ID,
				"result":  map[string]any{"protocolVersion": "2025-03-26"},
			})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/call":
			var params struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			}
			if err := json.Unmarshal(req.Params, &params); err != nil {
				t.Fatalf("decode tool params: %v", err)
			}
			switch params.Name {
			case "search":
				writeMCPToolTextResult(t, w, req.ID, map[string]any{
					"searchResults": []map[string]any{
						{
							"entity": map[string]any{
								"urn":  "urn:li:dataset:(snowflake,mart.revenue,PROD)",
								"type": "DATASET",
								"name": "mart.revenue",
							},
						},
					},
				})
			case "get_entities":
				writeMCPToolTextResult(t, w, req.ID, []map[string]any{
					{
						"urn":  "urn:li:dataset:(snowflake,mart.revenue,PROD)",
						"type": "DATASET",
						"name": "mart.revenue",
					},
				})
			case "get_lineage":
				upstream, _ := params.Arguments["upstream"].(bool)
				if upstream {
					_ = json.NewEncoder(w).Encode(map[string]any{
						"jsonrpc": "2.0",
						"id":      req.ID,
						"result": map[string]any{
							"structuredContent": map[string]any{
								"upstreams": map[string]any{
									"searchResults": []map[string]any{
										{
											"entity": map[string]any{
												"urn":  "urn:li:dataset:(snowflake,raw.orders,PROD)",
												"type": "DATASET",
												"name": "raw.orders",
											},
										},
									},
								},
							},
						},
					})
					return
				}
				writeMCPToolTextResult(t, w, req.ID, map[string]any{
					"downstreams": map[string]any{"searchResults": []map[string]any{}},
				})
			default:
				t.Fatalf("unexpected tool %q", params.Name)
			}
		default:
			t.Fatalf("unexpected MCP method %q", req.Method)
		}
	}))
	defer mcpServer.Close()

	provider := NewDataHubMCPContextProvider(DataHubMCPConfig{
		Endpoint:   mcpServer.URL,
		Timeout:    time.Second,
		MaxResults: 5,
	})
	items, err := provider.Retrieve(context.Background(), "revenue lineage", 5)
	if err != nil {
		t.Fatalf("Retrieve() error: %v", err)
	}
	item := findExternalContextItem(items, "urn:li:dataset:(snowflake,mart.revenue,PROD)#lineage:upstream", "LINEAGE_UPSTREAM")
	if item == nil || !strings.Contains(item.Snippet, "raw.orders") {
		t.Fatalf("missing structured lineage item in %+v", items)
	}
}

func TestDataHubMCPContextProviderRetrievePrefersDatasetForLineageTarget(t *testing.T) {
	var lineageURNs []string
	mcpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     any             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		switch req.Method {
		case "initialize":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      req.ID,
				"result":  map[string]any{"protocolVersion": "2025-03-26"},
			})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/call":
			var params struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			}
			if err := json.Unmarshal(req.Params, &params); err != nil {
				t.Fatalf("decode tool params: %v", err)
			}
			switch params.Name {
			case "search":
				writeMCPToolTextResult(t, w, req.ID, map[string]any{
					"searchResults": []map[string]any{
						{
							"entity": map[string]any{
								"urn":  "urn:li:dashboard:(looker,revenue_exec)",
								"type": "DASHBOARD",
								"name": "Executive Revenue",
							},
						},
						{
							"entity": map[string]any{
								"urn":  "urn:li:dataset:(snowflake,mart.revenue,PROD)",
								"type": "DATASET",
								"name": "mart.revenue",
							},
						},
					},
				})
			case "get_entities":
				// Deliberately return detail rows in a different order than search.
				writeMCPToolTextResult(t, w, req.ID, []map[string]any{
					{
						"urn":  "urn:li:dashboard:(looker,revenue_exec)",
						"type": "DASHBOARD",
						"name": "Executive Revenue",
					},
					{
						"urn":  "urn:li:dataset:(snowflake,mart.revenue,PROD)",
						"type": "DATASET",
						"name": "mart.revenue",
					},
				})
			case "get_lineage":
				urn, _ := params.Arguments["urn"].(string)
				lineageURNs = append(lineageURNs, urn)
				writeMCPToolTextResult(t, w, req.ID, map[string]any{
					"upstreams": map[string]any{"searchResults": []map[string]any{}},
				})
			default:
				t.Fatalf("unexpected tool %q", params.Name)
			}
		default:
			t.Fatalf("unexpected MCP method %q", req.Method)
		}
	}))
	defer mcpServer.Close()

	provider := NewDataHubMCPContextProvider(DataHubMCPConfig{
		Endpoint:   mcpServer.URL,
		Timeout:    time.Second,
		MaxResults: 5,
	})
	if _, err := provider.Retrieve(context.Background(), "revenue lineage", 5); err != nil {
		t.Fatalf("Retrieve() error: %v", err)
	}
	want := []string{
		"urn:li:dataset:(snowflake,mart.revenue,PROD)",
		"urn:li:dataset:(snowflake,mart.revenue,PROD)",
	}
	if !reflect.DeepEqual(lineageURNs, want) {
		t.Fatalf("lineage URNs = %v, want %v", lineageURNs, want)
	}
}

func TestNormalizeDataHubLineageToolResultHandlesDirectEntityResults(t *testing.T) {
	payload := map[string]any{
		"upstreams": map[string]any{
			"searchResults": []map[string]any{
				{
					"urn":  "urn:li:dataset:(snowflake,raw.orders,PROD)",
					"type": "DATASET",
					"properties": map[string]any{
						"name": "raw.orders",
					},
				},
			},
		},
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}

	items := normalizeDataHubLineageToolResult("urn:li:dataset:(snowflake,mart.revenue,PROD)", "upstream", &mcpToolResult{
		Content: []mcpContentItem{{Type: "text", Text: string(payloadBytes)}},
	})
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if !strings.Contains(items[0].Snippet, "raw.orders") {
		t.Fatalf("lineage snippet = %q, want raw.orders", items[0].Snippet)
	}
}

func TestNormalizeDataHubLineageToolResultHandlesResultsAlias(t *testing.T) {
	payload := map[string]any{
		"upstreams": map[string]any{
			"results": []map[string]any{
				{
					"entity": map[string]any{
						"urn":  "urn:li:dataset:(snowflake,raw.orders,PROD)",
						"type": "DATASET",
						"name": "raw.orders",
					},
				},
			},
		},
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}

	items := normalizeDataHubLineageToolResult("urn:li:dataset:(snowflake,mart.revenue,PROD)", "upstream", &mcpToolResult{
		Content: []mcpContentItem{{Type: "text", Text: string(payloadBytes)}},
	})
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if !strings.Contains(items[0].Snippet, "raw.orders") {
		t.Fatalf("lineage snippet = %q, want raw.orders", items[0].Snippet)
	}
}

func TestNormalizeDataHubLineageToolResultHandlesDirectDirectionArray(t *testing.T) {
	payload := map[string]any{
		"upstreams": []map[string]any{
			{
				"entity": map[string]any{
					"urn":  "urn:li:dataset:(snowflake,raw.orders,PROD)",
					"type": "DATASET",
					"name": "raw.orders",
				},
			},
		},
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}

	items := normalizeDataHubLineageToolResult("urn:li:dataset:(snowflake,mart.revenue,PROD)", "upstream", &mcpToolResult{
		Content: []mcpContentItem{{Type: "text", Text: string(payloadBytes)}},
	})
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if !strings.Contains(items[0].Snippet, "raw.orders") {
		t.Fatalf("lineage snippet = %q, want raw.orders", items[0].Snippet)
	}
}

func TestDataHubMCPContextProviderRetrieveKeepsSearchResultsWhenEnrichmentFails(t *testing.T) {
	var toolCalls []string

	mcpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     any             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		switch req.Method {
		case "initialize":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      req.ID,
				"result":  map[string]any{"protocolVersion": "2025-03-26"},
			})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/call":
			var params struct {
				Name string `json:"name"`
			}
			if err := json.Unmarshal(req.Params, &params); err != nil {
				t.Fatalf("decode tool params: %v", err)
			}
			toolCalls = append(toolCalls, params.Name)
			switch params.Name {
			case "search":
				writeMCPToolTextResult(t, w, req.ID, map[string]any{
					"searchResults": []map[string]any{
						{
							"entity": map[string]any{
								"urn":         "urn:li:dataset:(snowflake,mart.revenue,PROD)",
								"type":        "DATASET",
								"name":        "mart.revenue",
								"description": "Search result survives enrichment failure.",
							},
						},
					},
				})
			case "get_entities":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"jsonrpc": "2.0",
					"id":      req.ID,
					"error":   map[string]any{"code": -32000, "message": "DataHub detail failure"},
				})
			default:
				t.Fatalf("unexpected tool %q", params.Name)
			}
		default:
			t.Fatalf("unexpected MCP method %q", req.Method)
		}
	}))
	defer mcpServer.Close()

	provider := NewDataHubMCPContextProvider(DataHubMCPConfig{
		Endpoint:   mcpServer.URL,
		Timeout:    time.Second,
		MaxResults: 5,
	})
	items, err := provider.Retrieve(context.Background(), "why is the revenue dashboard wrong today?", 5)
	if err != nil {
		t.Fatalf("Retrieve() error = %v, want graceful fallback", err)
	}
	if !reflect.DeepEqual(toolCalls, []string{"search", "get_entities"}) {
		t.Fatalf("tool calls = %v, want search then get_entities only", toolCalls)
	}
	if len(items) != 1 || items[0].ID != "urn:li:dataset:(snowflake,mart.revenue,PROD)" {
		t.Fatalf("fallback items = %+v", items)
	}
}

func TestDataHubMCPContextProviderRetrieveSkipsEntityErrorItems(t *testing.T) {
	var toolCalls []string

	mcpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     any             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		switch req.Method {
		case "initialize":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      req.ID,
				"result":  map[string]any{"protocolVersion": "2025-03-26"},
			})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/call":
			var params struct {
				Name string `json:"name"`
			}
			if err := json.Unmarshal(req.Params, &params); err != nil {
				t.Fatalf("decode tool params: %v", err)
			}
			toolCalls = append(toolCalls, params.Name)
			switch params.Name {
			case "search":
				writeMCPToolTextResult(t, w, req.ID, map[string]any{
					"searchResults": []map[string]any{
						{
							"entity": map[string]any{
								"urn":         "urn:li:dataset:(snowflake,mart.revenue,PROD)",
								"type":        "DATASET",
								"name":        "mart.revenue",
								"description": "Search result should not be replaced by entity error.",
							},
						},
					},
				})
			case "get_entities":
				writeMCPToolTextResult(t, w, req.ID, []map[string]any{
					{
						"urn":   "urn:li:dataset:(snowflake,mart.revenue,PROD)",
						"error": "Entity exists but no data could be retrieved.",
					},
				})
			default:
				t.Fatalf("unexpected tool %q", params.Name)
			}
		default:
			t.Fatalf("unexpected MCP method %q", req.Method)
		}
	}))
	defer mcpServer.Close()

	provider := NewDataHubMCPContextProvider(DataHubMCPConfig{
		Endpoint:   mcpServer.URL,
		Timeout:    time.Second,
		MaxResults: 5,
	})
	items, err := provider.Retrieve(context.Background(), "why is the revenue dashboard wrong today?", 5)
	if err != nil {
		t.Fatalf("Retrieve() error = %v", err)
	}
	if !reflect.DeepEqual(toolCalls, []string{"search", "get_entities"}) {
		t.Fatalf("tool calls = %v, want search then get_entities only", toolCalls)
	}
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if !strings.Contains(items[0].Snippet, "Search result should not be replaced") {
		t.Fatalf("item was replaced by error payload: %+v", items[0])
	}
}

func TestDataHubMCPContextProviderInitializesOnceForConcurrentRetrievals(t *testing.T) {
	var initializeCount atomic.Int64
	var toolCount atomic.Int64

	mcpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     any             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		switch req.Method {
		case "initialize":
			initializeCount.Add(1)
			time.Sleep(20 * time.Millisecond)
			w.Header().Set("Mcp-Session-Id", "session-1")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      req.ID,
				"result":  map[string]any{"protocolVersion": "2025-03-26"},
			})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/call":
			toolCount.Add(1)
			writeMCPToolTextResult(t, w, req.ID, map[string]any{"searchResults": []map[string]any{}})
		default:
			t.Fatalf("unexpected MCP method %q", req.Method)
		}
	}))
	defer mcpServer.Close()

	provider := NewDataHubMCPContextProvider(DataHubMCPConfig{
		Endpoint:   mcpServer.URL,
		Timeout:    time.Second,
		MaxResults: 2,
	})
	var wg sync.WaitGroup
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := provider.Retrieve(context.Background(), "revenue dashboard", 2); err != nil {
				t.Errorf("Retrieve() error: %v", err)
			}
		}()
	}
	wg.Wait()

	if got := initializeCount.Load(); got != 1 {
		t.Fatalf("initialize count = %d, want 1", got)
	}
	if got := toolCount.Load(); got != 5 {
		t.Fatalf("tool count = %d, want 5", got)
	}
}

func TestExtractSSEDataHandlesLargeDataLines(t *testing.T) {
	largeText := strings.Repeat("x", 70*1024)
	body := []byte("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"text\":\"" + largeText + "\"}}\n\n")

	got := extractSSEData(body)
	var decoded map[string]any
	if err := json.Unmarshal(got, &decoded); err != nil {
		t.Fatalf("extracted SSE data is not JSON: %v", err)
	}
	if decoded["jsonrpc"] != "2.0" {
		t.Fatalf("jsonrpc = %#v, want 2.0", decoded["jsonrpc"])
	}
}

func TestExtractSSEDataSkipsNonJSONEvents(t *testing.T) {
	body := []byte("event: endpoint\ndata: /messages?session_id=abc\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n\n")

	got := extractSSEData(body)
	var decoded map[string]any
	if err := json.Unmarshal(got, &decoded); err != nil {
		t.Fatalf("extracted SSE data is not JSON: %v; data=%q", err, string(got))
	}
	if decoded["jsonrpc"] != "2.0" {
		t.Fatalf("jsonrpc = %#v, want 2.0", decoded["jsonrpc"])
	}
}

func TestExtractSSEDataPrefersResponseOverJSONNotification(t *testing.T) {
	body := []byte("event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{\"progress\":0.5}}\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n\n")

	got := extractSSEData(body)
	var decoded map[string]any
	if err := json.Unmarshal(got, &decoded); err != nil {
		t.Fatalf("extracted SSE data is not JSON: %v; data=%q", err, string(got))
	}
	if _, ok := decoded["result"]; !ok {
		t.Fatalf("decoded SSE event = %+v, want JSON-RPC response result", decoded)
	}
	if _, ok := decoded["method"]; ok {
		t.Fatalf("decoded notification instead of response: %+v", decoded)
	}
}

func TestCollectDataHubURNsSkipsNonDataHubIDs(t *testing.T) {
	items := []ExternalContextItem{
		{ID: "local-search-result"},
		{ID: "urn:li:dataset:(snowflake,mart.revenue,PROD)"},
	}

	got := collectDataHubURNs(items, 2)
	want := []string{"urn:li:dataset:(snowflake,mart.revenue,PROD)"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("collectDataHubURNs = %v, want %v", got, want)
	}
}

func TestPreferredDataHubLineageURNPrefersDatasetURNWithoutExplicitType(t *testing.T) {
	items := []ExternalContextItem{
		{ID: "urn:li:dashboard:(looker,Executive Revenue)"},
		{ID: "urn:li:dataset:(urn:li:dataPlatform:snowflake,mart.revenue,PROD)"},
	}

	if got := preferredDataHubLineageURN(items); got != "urn:li:dataset:(urn:li:dataPlatform:snowflake,mart.revenue,PROD)" {
		t.Fatalf("preferredDataHubLineageURN() = %q", got)
	}
}

func TestTrimExternalContextItemsPreservesLineageSummaries(t *testing.T) {
	items := []ExternalContextItem{
		{Type: "DATASET", ID: "urn:li:dataset:(snowflake,mart.revenue,PROD)"},
		{Type: "DASHBOARD", ID: "urn:li:dashboard:(looker,revenue_exec)"},
		{Type: "LINEAGE_UPSTREAM", ID: "urn:li:dataset:(snowflake,mart.revenue,PROD)#lineage:upstream"},
		{Type: "LINEAGE_DOWNSTREAM", ID: "urn:li:dataset:(snowflake,mart.revenue,PROD)#lineage:downstream"},
	}

	got := trimExternalContextItems(items, 3)
	if len(got) != 3 {
		t.Fatalf("trimmed len = %d, want 3", len(got))
	}
	if got[0].Type != "DATASET" {
		t.Fatalf("first item type = %q, want DATASET", got[0].Type)
	}
	if findExternalContextItem(got, "urn:li:dataset:(snowflake,mart.revenue,PROD)#lineage:upstream", "LINEAGE_UPSTREAM") == nil {
		t.Fatalf("missing upstream lineage in %+v", got)
	}
	if findExternalContextItem(got, "urn:li:dataset:(snowflake,mart.revenue,PROD)#lineage:downstream", "LINEAGE_DOWNSTREAM") == nil {
		t.Fatalf("missing downstream lineage in %+v", got)
	}
}

func TestCompactSnippetDoesNotSplitUTF8Runes(t *testing.T) {
	got := compactSnippet("字段血缘", 1)
	if !strings.Contains(got, "...") {
		t.Fatalf("compactSnippet = %q, want ellipsis", got)
	}
	if strings.ToValidUTF8(got, "") != got {
		t.Fatalf("compactSnippet produced invalid UTF-8: %q", got)
	}
}

func writeMCPToolTextResult(t *testing.T, w http.ResponseWriter, id any, payload any) {
	t.Helper()
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"result": map[string]any{
			"content": []map[string]string{
				{"type": "text", "text": string(payloadBytes)},
			},
		},
	})
}

func findExternalContextItem(items []ExternalContextItem, id, typ string) *ExternalContextItem {
	for i := range items {
		if items[i].ID == id && items[i].Type == typ {
			return &items[i]
		}
	}
	return nil
}
