package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestMiniMaxSerializedRequests(t *testing.T) {
	models := []struct {
		model    string
		thinking string
		split    bool
	}{
		{"MiniMax-M3.1-Flash", "adaptive", false},
		{"minimax-m3.1-flash", "adaptive", false},
		{"MiniMax-M3", "disabled", false},
		{"MiniMax-M2.7", "", true},
		{"MiniMax-M3-custom", "", false},
		{"MiniMax-M3.1-Flash-custom", "", false},
		{"custom-model", "", false},
		{"", "", false},
	}
	for _, baseURL := range []string{"https://api.minimax.io/v1", "https://api.minimaxi.com/v1"} {
		for _, tt := range models {
			t.Run(baseURL+"/"+tt.model, func(t *testing.T) {
				client := New(Config{APIKey: "test-key", BaseURL: baseURL, Model: tt.model})
				calls := 0
				client.http = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
					calls++
					if r.Method != http.MethodPost || r.URL.String() != baseURL+"/chat/completions" {
						t.Fatalf("unexpected request: %s %s", r.Method, r.URL)
					}
					var body map[string]json.RawMessage
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Fatal(err)
					}
					wantModel := tt.model
					if wantModel == "" {
						wantModel = "gpt-4o-mini"
					}
					var model string
					if err := json.Unmarshal(body["model"], &model); err != nil || model != wantModel {
						t.Fatalf("model = %s, want %q", body["model"], wantModel)
					}
					if tt.thinking == "" {
						if _, exists := body["thinking"]; exists {
							t.Fatalf("unexpected thinking: %s", body["thinking"])
						}
					} else if string(body["thinking"]) != `{"type":"`+tt.thinking+`"}` {
						t.Fatalf("thinking = %s, want %s", body["thinking"], tt.thinking)
					}
					for _, key := range []string{"enable_thinking", "reasoning_effort", "service_tier"} {
						if _, exists := body[key]; exists {
							t.Fatalf("unexpected %s: %s", key, body[key])
						}
					}
					if tt.split {
						if string(body["reasoning_split"]) != "true" {
							t.Fatalf("legacy reasoning_split = %s, want true", body["reasoning_split"])
						}
					} else if _, exists := body["reasoning_split"]; exists {
						t.Fatalf("unexpected reasoning_split: %s", body["reasoning_split"])
					}
					if string(body["messages"]) != `[{"role":"system","content":"sys"},{"role":"user","content":"user"}]` {
						t.Fatalf("messages changed: %s", body["messages"])
					}
					if string(body["response_format"]) != `{"type":"json_object"}` {
						t.Fatalf("response_format = %s", body["response_format"])
					}
					return &http.Response{
						StatusCode: http.StatusOK,
						Body:       io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"{}"}}]}`)),
						Header:     make(http.Header),
					}, nil
				})}
				got, err := client.CompleteJSONWithScope(context.Background(), "sys", "user", CallScope{Step: "extract"})
				if err != nil || got != "{}" || calls != 1 {
					t.Fatalf("completion = %q, %v; calls = %d", got, err, calls)
				}
			})
		}
	}
}
