package llm

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNew(t *testing.T) {
	t.Run("empty api key returns nil", func(t *testing.T) {
		if got := New(Config{}); got != nil {
			t.Fatalf("expected nil client, got %#v", got)
		}
	})

	t.Run("defaults and trims base url", func(t *testing.T) {
		client := New(Config{APIKey: "key", BaseURL: "https://example.com/v1////"})
		if client == nil {
			t.Fatal("expected client, got nil")
		}
		if client.baseURL != "https://example.com/v1" {
			t.Fatalf("baseURL = %q, want %q", client.baseURL, "https://example.com/v1")
		}
		if client.model != "gpt-4o-mini" {
			t.Fatalf("model = %q, want %q", client.model, "gpt-4o-mini")
		}
	})

	t.Run("defaults applied when fields empty", func(t *testing.T) {
		client := New(Config{APIKey: "key"})
		if client == nil {
			t.Fatal("expected client, got nil")
		}
		if client.baseURL != "https://api.openai.com/v1" {
			t.Fatalf("baseURL = %q, want %q", client.baseURL, "https://api.openai.com/v1")
		}
		if client.model != "gpt-4o-mini" {
			t.Fatalf("model = %q, want %q", client.model, "gpt-4o-mini")
		}
	})
}

func TestStripMarkdownFences(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "raw json", in: `{"a":1}`, want: `{"a":1}`},
		{name: "json fence", in: "```json\n{\"a\":1}\n```", want: `{"a":1}`},
		{name: "plain fence", in: "```\n{\"a\":1}\n```", want: `{"a":1}`},
		{name: "nested content", in: "```json\n{\"a\":\"```not fence```\"}\n```", want: "{\"a\":\"```not fence```\"}"},
		{name: "whitespace", in: " \n```json\n  {\"a\":1}\n``` \n", want: `{"a":1}`},
		{name: "empty", in: "", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := StripMarkdownFences(tt.in); got != tt.want {
				t.Fatalf("StripMarkdownFences(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestParseJSON(t *testing.T) {
	type payload struct {
		Name string `json:"name"`
	}

	tests := []struct {
		name    string
		input   string
		want    payload
		wantErr bool
	}{
		{name: "raw json", input: `{"name":"alpha"}`, want: payload{Name: "alpha"}},
		{name: "fenced json", input: "```json\n{\"name\":\"beta\"}\n```", want: payload{Name: "beta"}},
		{name: "invalid json", input: "{", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseJSON[payload](tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("ParseJSON result = %#v, want %#v", got, tt.want)
			}
		})
	}

	t.Run("different type", func(t *testing.T) {
		got, err := ParseJSON[map[string]int]("```\n{\"a\":2}\n```")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got["a"] != 2 {
			t.Fatalf("ParseJSON map value = %d, want %d", got["a"], 2)
		}
	})
}

func TestComplete(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				t.Fatalf("method = %s, want POST", r.Method)
			}
			if r.URL.Path != "/chat/completions" {
				t.Fatalf("path = %s, want /chat/completions", r.URL.Path)
			}
			if got := r.Header.Get("Authorization"); got != "Bearer key" {
				t.Fatalf("Authorization header = %q, want %q", got, "Bearer key")
			}
			if got := r.Header.Get("Content-Type"); got != "application/json" {
				t.Fatalf("Content-Type header = %q, want %q", got, "application/json")
			}

			var req chatRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if req.Model != "test-model" {
				t.Fatalf("model = %q, want %q", req.Model, "test-model")
			}
			if len(req.Messages) != 2 || req.Messages[0].Role != "system" || req.Messages[1].Role != "user" {
				t.Fatalf("unexpected messages: %#v", req.Messages)
			}
			if req.Temperature != 0.1 {
				t.Fatalf("temperature = %v, want %v", req.Temperature, 0.1)
			}
			if req.EnableThinking != nil {
				t.Fatalf("enable_thinking = %v, want nil", *req.EnableThinking)
			}

			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"hello"}}]}`))
		}))
		defer server.Close()

		client := New(Config{APIKey: "key", BaseURL: server.URL, Model: "test-model"})
		if client == nil {
			t.Fatal("expected client, got nil")
		}

		got, err := client.Complete(context.Background(), "sys", "user")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "hello" {
			t.Fatalf("content = %q, want %q", got, "hello")
		}
	})

	t.Run("bedrock converse success", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				t.Fatalf("method = %s, want POST", r.Method)
			}
			if r.URL.Path != "/model/test-model/converse" {
				t.Fatalf("path = %s, want /model/test-model/converse", r.URL.Path)
			}
			if got := r.Header.Get("Authorization"); got != "Bearer key" {
				t.Fatalf("Authorization header = %q, want %q", got, "Bearer key")
			}

			var req bedrockConverseRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if len(req.System) != 1 || req.System[0].Text != "sys" {
				t.Fatalf("unexpected system: %#v", req.System)
			}
			if len(req.Messages) != 1 || req.Messages[0].Role != "user" || req.Messages[0].Content[0].Text != "user" {
				t.Fatalf("unexpected messages: %#v", req.Messages)
			}
			if req.InferenceConfig.MaxTokens != 4096 {
				t.Fatalf("maxTokens = %d, want 4096", req.InferenceConfig.MaxTokens)
			}
			if req.InferenceConfig.Temperature != 0.1 {
				t.Fatalf("temperature = %v, want %v", req.InferenceConfig.Temperature, 0.1)
			}

			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"output":{"message":{"role":"assistant","content":[{"text":"hello from bedrock"}]}},"usage":{"inputTokens":1,"outputTokens":2,"totalTokens":3}}`))
		}))
		defer server.Close()

		client := New(Config{APIKey: "key", BaseURL: server.URL + "/model/test-model/converse", Model: "test-model"})
		if client == nil {
			t.Fatal("expected client, got nil")
		}

		got, err := client.Complete(context.Background(), "sys", "user")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "hello from bedrock" {
			t.Fatalf("content = %q, want %q", got, "hello from bedrock")
		}
	})

	t.Run("api error response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"error":{"message":"bad request"}}`))
		}))
		defer server.Close()

		client := New(Config{APIKey: "key", BaseURL: server.URL, Model: "test-model"})
		_, err := client.Complete(context.Background(), "sys", "user")
		if err == nil || !strings.Contains(err.Error(), "llm error: bad request") {
			t.Fatalf("expected llm error, got %v", err)
		}
	})

	t.Run("empty choices", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[]}`))
		}))
		defer server.Close()

		client := New(Config{APIKey: "key", BaseURL: server.URL, Model: "test-model"})
		_, err := client.Complete(context.Background(), "sys", "user")
		if err == nil || !strings.Contains(err.Error(), "llm returned no choices") {
			t.Fatalf("expected empty choices error, got %v", err)
		}
	})

	t.Run("http error", func(t *testing.T) {
		client := New(Config{APIKey: "key", BaseURL: "http://example.com", Model: "test-model"})
		if client == nil {
			t.Fatal("expected client, got nil")
		}
		client.http = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("boom")
		})}

		_, err := client.Complete(context.Background(), "sys", "user")
		if err == nil || !strings.Contains(err.Error(), "boom") {
			t.Fatalf("expected request error, got %v", err)
		}
	})

	t.Run("qwen model disables thinking with enable_thinking", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var req chatRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if req.EnableThinking == nil || *req.EnableThinking {
				t.Fatalf("enable_thinking = %v, want %v", req.EnableThinking, false)
			}

			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"hello"}}]}`))
		}))
		defer server.Close()

		client := New(Config{APIKey: "key", BaseURL: server.URL, Model: "qwen-plus"})
		if client == nil {
			t.Fatal("expected client, got nil")
		}

		got, err := client.Complete(context.Background(), "sys", "user")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "hello" {
			t.Fatalf("content = %q, want %q", got, "hello")
		}
	})

	t.Run("minimax model enables reasoning_split", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var req chatRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if req.ReasoningSplit == nil || !*req.ReasoningSplit {
				t.Fatalf("reasoning_split = %v, want %v", req.ReasoningSplit, true)
			}

			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"hello"}}]}`))
		}))
		defer server.Close()

		client := New(Config{APIKey: "key", BaseURL: server.URL, Model: "MiniMax-M2.7"})
		if client == nil {
			t.Fatal("expected client, got nil")
		}

		got, err := client.Complete(context.Background(), "sys", "user")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "hello" {
			t.Fatalf("content = %q, want %q", got, "hello")
		}
	})

	t.Run("400 with reasoning params retries without them", func(t *testing.T) {
		var requests []chatRequest
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var req chatRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			requests = append(requests, req)

			if len(requests) == 1 {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":{"message":"unsupported param"}}`))
				return
			}

			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"hello"}}]}`))
		}))
		defer server.Close()

		client := New(Config{APIKey: "key", BaseURL: server.URL, Model: "MiniMax-M2.7"})
		if client == nil {
			t.Fatal("expected client, got nil")
		}

		got, err := client.Complete(context.Background(), "sys", "user")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "hello" {
			t.Fatalf("content = %q, want %q", got, "hello")
		}
		if len(requests) != 2 {
			t.Fatalf("request count = %d, want 2", len(requests))
		}
		if requests[0].ReasoningSplit == nil || !*requests[0].ReasoningSplit {
			t.Fatalf("first request reasoning_split = %v, want %v", requests[0].ReasoningSplit, true)
		}
		if requests[1].ReasoningSplit != nil {
			t.Fatalf("second request reasoning_split = %v, want nil", requests[1].ReasoningSplit)
		}
	})

}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}
