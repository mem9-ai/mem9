package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/qiffang/mnemos/server/internal/metrics"
)

type Client struct {
	apiKey      string
	baseURL     string
	model       string
	temperature float64
	debugLLM    bool
	http        *http.Client
}

type Config struct {
	APIKey      string
	BaseURL     string
	Model       string
	Temperature float64
	DebugLLM    bool
}

func New(cfg Config) *Client {
	if cfg.APIKey == "" {
		return nil
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.openai.com/v1"
	}
	if cfg.Model == "" {
		cfg.Model = "gpt-4o-mini"
	}
	if cfg.Temperature <= 0 {
		cfg.Temperature = 0.1
	}
	return &Client{
		apiKey:      cfg.APIKey,
		baseURL:     strings.TrimRight(cfg.BaseURL, "/"),
		model:       cfg.Model,
		temperature: cfg.Temperature,
		debugLLM:    cfg.DebugLLM,
		http: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type responseFormat struct {
	Type string `json:"type"`
}

type chatRequest struct {
	Model          string          `json:"model"`
	Messages       []Message       `json:"messages"`
	Temperature    float64         `json:"temperature"`
	ResponseFormat *responseFormat `json:"response_format,omitempty"`
	EnableThinking *bool           `json:"enable_thinking,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// HTTPStatusError is returned when the LLM API responds with an HTTP error status code.
// This enables callers (e.g., CompleteJSON) to detect specific HTTP codes.
type HTTPStatusError struct {
	Code int
	Body string
}

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("llm http %d: %s", e.Code, e.Body)
}

// Complete sends a chat completion request to the LLM.
func (c *Client) Complete(ctx context.Context, system, user string) (string, error) {
	return c.complete(ctx, system, user, nil)
}

// CompleteJSON sends a chat completion request with response_format: json_object.
// This instructs the model to return valid JSON, improving reliability.
// If the provider returns HTTP 400 (e.g., Ollama, some vLLM builds that don't support
// response_format), it automatically retries without the parameter.
func (c *Client) CompleteJSON(ctx context.Context, system, user string) (string, error) {
	result, err := c.complete(ctx, system, user, &responseFormat{Type: "json_object"})
	if err != nil {
		var httpErr *HTTPStatusError
		if errors.As(err, &httpErr) && httpErr.Code == http.StatusBadRequest {
			slog.Warn("LLM rejected response_format:json_object (HTTP 400), retrying without it")
			return c.complete(ctx, system, user, nil)
		}
	}
	return result, err
}

func (c *Client) complete(ctx context.Context, system, user string, respFmt *responseFormat) (string, error) {
	messages := []Message{
		{Role: "system", Content: system},
		{Role: "user", Content: user},
	}

	enableThinking := disableThinkingOptions(c.model)

	result, err := c.doRequest(ctx, chatRequest{
		Model:          c.model,
		Messages:       messages,
		Temperature:    c.temperature,
		ResponseFormat: respFmt,
		EnableThinking: enableThinking,
	})
	if err != nil {
		// If 400 and thinking parameters were sent, retry without them (provider may not support them).
		var httpErr *HTTPStatusError
		if errors.As(err, &httpErr) && httpErr.Code == http.StatusBadRequest && enableThinking != nil {
			slog.Warn("LLM rejected thinking parameters (HTTP 400), retrying without them", "model", c.model)
			return c.doRequest(ctx, chatRequest{
				Model:          c.model,
				Messages:       messages,
				Temperature:    c.temperature,
				ResponseFormat: respFmt,
			})
		}
	}
	return result, err
}

// doRequest sends a single chat completion request and handles metrics/response parsing.
func (c *Client) doRequest(ctx context.Context, cr chatRequest) (string, error) {
	start := time.Now()

	body, err := json.Marshal(cr)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		metrics.LLMRequestDuration.WithLabelValues(c.model, "error").Observe(time.Since(start).Seconds())
		return "", fmt.Errorf("llm request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	duration := time.Since(start).Seconds()

	// Surface HTTP errors as typed errors so callers can detect specific status codes.
	if resp.StatusCode >= 400 {
		metrics.LLMRequestDuration.WithLabelValues(c.model, "error").Observe(duration)
		return "", &HTTPStatusError{Code: resp.StatusCode, Body: string(respBody)}
	}

	var chatResp chatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		metrics.LLMRequestDuration.WithLabelValues(c.model, "error").Observe(duration)
		return "", fmt.Errorf("decode response: %w", err)
	}

	if chatResp.Error != nil {
		metrics.LLMRequestDuration.WithLabelValues(c.model, "error").Observe(duration)
		return "", fmt.Errorf("llm error: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		metrics.LLMRequestDuration.WithLabelValues(c.model, "error").Observe(duration)
		return "", fmt.Errorf("llm returned no choices")
	}

	content := chatResp.Choices[0].Message.Content
	if c.debugLLM {
		slog.Debug("llm raw response", "model", c.model, "len", len(content), "raw", content)
	}

	metrics.LLMRequestDuration.WithLabelValues(c.model, "success").Observe(duration)
	return content, nil
}

func (c *Client) DebugLLM() bool {
	return c.debugLLM
}

func disableThinkingOptions(model string) *bool {
	if strings.Contains(strings.ToLower(model), "qwen") {
		enableThinking := false
		return &enableThinking
	}
	return nil
}

func StripMarkdownFences(s string) string {
	re := regexp.MustCompile("(?s)^\\s*```(?:json)?\\s*\n?(.*?)\\s*```\\s*$")
	if match := re.FindStringSubmatch(s); len(match) > 1 {
		return strings.TrimSpace(match[1])
	}
	return strings.TrimSpace(s)
}

func ParseJSON[T any](raw string) (T, error) {
	var result T
	cleaned := StripMarkdownFences(raw)
	if err := json.Unmarshal([]byte(cleaned), &result); err != nil {
		return result, fmt.Errorf("invalid JSON: %w", err)
	}
	return result, nil
}
