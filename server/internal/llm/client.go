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

type CallScope struct {
	Step string
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
	ReasoningSplit *bool           `json:"reasoning_split,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens        int `json:"prompt_tokens"`
		CompletionTokens    int `json:"completion_tokens"`
		TotalTokens         int `json:"total_tokens"`
		PromptTokensDetails *struct {
			CachedTokens int `json:"cached_tokens"`
		} `json:"prompt_tokens_details,omitempty"`
		// Anthropic-style cache fields (used by some OpenAI-compatible proxies).
		CacheCreationInputTokens int `json:"cache_creation_input_tokens,omitempty"`
		CacheReadInputTokens     int `json:"cache_read_input_tokens,omitempty"`
	} `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type bedrockContentBlock struct {
	Text string `json:"text,omitempty"`
}

type bedrockSystemBlock struct {
	Text string `json:"text"`
}

type bedrockMessage struct {
	Role    string                `json:"role"`
	Content []bedrockContentBlock `json:"content"`
}

type bedrockInferenceConfig struct {
	MaxTokens   int     `json:"maxTokens,omitempty"`
	Temperature float64 `json:"temperature,omitempty"`
}

type bedrockConverseRequest struct {
	System          []bedrockSystemBlock   `json:"system,omitempty"`
	Messages        []bedrockMessage       `json:"messages"`
	InferenceConfig bedrockInferenceConfig `json:"inferenceConfig,omitempty"`
}

type bedrockConverseResponse struct {
	Output *struct {
		Message struct {
			Content []bedrockContentBlock `json:"content"`
		} `json:"message"`
	} `json:"output,omitempty"`
	Usage *struct {
		InputTokens  int `json:"inputTokens"`
		OutputTokens int `json:"outputTokens"`
		TotalTokens  int `json:"totalTokens"`
	} `json:"usage,omitempty"`
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
	return c.complete(ctx, system, user, nil, CallScope{})
}

func (c *Client) CompleteWithScope(ctx context.Context, system, user string, scope CallScope) (string, error) {
	return c.complete(ctx, system, user, nil, scope)
}

// CompleteJSON sends a chat completion request with response_format: json_object.
// This instructs the model to return valid JSON, improving reliability.
// If the provider returns HTTP 400 (e.g., Ollama, some vLLM builds that don't support
// response_format), it automatically retries without the parameter.
func (c *Client) CompleteJSON(ctx context.Context, system, user string) (string, error) {
	result, err := c.complete(ctx, system, user, &responseFormat{Type: "json_object"}, CallScope{})
	if err != nil {
		var httpErr *HTTPStatusError
		if errors.As(err, &httpErr) && httpErr.Code == http.StatusBadRequest {
			slog.Warn("LLM rejected response_format:json_object (HTTP 400), retrying without it")
			return c.complete(ctx, system, user, nil, CallScope{})
		}
	}
	return result, err
}

func (c *Client) CompleteJSONWithScope(ctx context.Context, system, user string, scope CallScope) (string, error) {
	result, err := c.complete(ctx, system, user, &responseFormat{Type: "json_object"}, scope)
	if err != nil {
		var httpErr *HTTPStatusError
		if errors.As(err, &httpErr) && httpErr.Code == http.StatusBadRequest {
			recordRetryMetric(scope, "response_format_400_fallback")
			slog.Warn("LLM rejected response_format:json_object (HTTP 400), retrying without it")
			return c.complete(ctx, system, user, nil, scope)
		}
	}
	return result, err
}

func (c *Client) complete(ctx context.Context, system, user string, respFmt *responseFormat, scope CallScope) (string, error) {
	messages := []Message{
		{Role: "system", Content: system},
		{Role: "user", Content: user},
	}

	enableThinking := disableThinkingOptions(c.model)
	reasoningSplit := supportsReasoningSplit(c.model)

	result, err := c.doRequest(ctx, chatRequest{
		Model:          c.model,
		Messages:       messages,
		Temperature:    c.temperature,
		ResponseFormat: respFmt,
		EnableThinking: enableThinking,
		ReasoningSplit: reasoningSplit,
	}, scope)
	if err != nil {
		// If 400 and thinking parameters were sent, retry without them (provider may not support them).
		var httpErr *HTTPStatusError
		if errors.As(err, &httpErr) && httpErr.Code == http.StatusBadRequest && (enableThinking != nil || reasoningSplit != nil) {
			recordRetryMetric(scope, "thinking_param_400_fallback")
			slog.Warn("LLM rejected thinking parameters (HTTP 400), retrying without them", "model", c.model)
			return c.doRequest(ctx, chatRequest{
				Model:          c.model,
				Messages:       messages,
				Temperature:    c.temperature,
				ResponseFormat: respFmt,
			}, scope)
		}
	}
	return result, err
}

func recordRetryMetric(scope CallScope, reason string) {
	if scope.enabled() {
		metrics.LLMRetryTotal.WithLabelValues(scope.Step, reason).Inc()
	}
}

// doRequest sends a single chat completion request and handles metrics/response parsing.
func (c *Client) doRequest(ctx context.Context, cr chatRequest, scope CallScope) (string, error) {
	start := time.Now()

	isBedrock := isBedrockConverseURL(c.baseURL)
	var body []byte
	var err error
	if isBedrock {
		body, err = json.Marshal(buildBedrockConverseRequest(cr))
	} else {
		body, err = json.Marshal(cr)
	}
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	requestURL := c.baseURL + "/chat/completions"
	if isBedrock {
		requestURL = c.baseURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		metrics.LLMRequestDuration.WithLabelValues(c.model, "error").Observe(time.Since(start).Seconds())
		if scope.enabled() {
			metrics.LLMRequestsByStepTotal.WithLabelValues(scope.Step, c.model, "error").Inc()
		}
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
		if scope.enabled() {
			metrics.LLMRequestsByStepTotal.WithLabelValues(scope.Step, c.model, "error").Inc()
		}
		return "", &HTTPStatusError{Code: resp.StatusCode, Body: string(respBody)}
	}

	if isBedrock {
		return c.parseBedrockConverseResponse(respBody, duration, scope)
	}

	var chatResp chatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		metrics.LLMRequestDuration.WithLabelValues(c.model, "error").Observe(duration)
		if scope.enabled() {
			metrics.LLMRequestsByStepTotal.WithLabelValues(scope.Step, c.model, "error").Inc()
		}
		return "", fmt.Errorf("decode response: %w", err)
	}

	if chatResp.Error != nil {
		metrics.LLMRequestDuration.WithLabelValues(c.model, "error").Observe(duration)
		if scope.enabled() {
			metrics.LLMRequestsByStepTotal.WithLabelValues(scope.Step, c.model, "error").Inc()
		}
		return "", fmt.Errorf("llm error: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		metrics.LLMRequestDuration.WithLabelValues(c.model, "error").Observe(duration)
		if scope.enabled() {
			metrics.LLMRequestsByStepTotal.WithLabelValues(scope.Step, c.model, "error").Inc()
		}
		return "", fmt.Errorf("llm returned no choices")
	}

	content := chatResp.Choices[0].Message.Content
	if c.debugLLM {
		slog.Debug("llm raw response", "model", c.model, "len", len(content), "raw", content)
	}

	metrics.LLMRequestDuration.WithLabelValues(c.model, "success").Observe(duration)
	if scope.enabled() {
		metrics.LLMRequestsByStepTotal.WithLabelValues(scope.Step, c.model, "success").Inc()
	}
	if chatResp.Usage != nil {
		u := chatResp.Usage
		metrics.LLMTokensTotal.WithLabelValues(c.model, "input").Add(float64(u.PromptTokens))
		metrics.LLMTokensTotal.WithLabelValues(c.model, "output").Add(float64(u.CompletionTokens))
		metrics.LLMTokensTotal.WithLabelValues(c.model, "total").Add(float64(u.TotalTokens))
		if scope.enabled() {
			metrics.LLMTokensByStepTotal.WithLabelValues(scope.Step, c.model, "input").Add(float64(u.PromptTokens))
			metrics.LLMTokensByStepTotal.WithLabelValues(scope.Step, c.model, "output").Add(float64(u.CompletionTokens))
		}

		// Cache tokens: try OpenAI-style (prompt_tokens_details.cached_tokens), then Anthropic-style.
		cacheRead := u.CacheReadInputTokens
		if cacheRead == 0 && u.PromptTokensDetails != nil {
			cacheRead = u.PromptTokensDetails.CachedTokens
		}
		if cacheRead > 0 {
			metrics.LLMTokensTotal.WithLabelValues(c.model, "cache_read").Add(float64(cacheRead))
		}
		if u.CacheCreationInputTokens > 0 {
			metrics.LLMTokensTotal.WithLabelValues(c.model, "cache_creation").Add(float64(u.CacheCreationInputTokens))
		}
	}
	return content, nil
}

func isBedrockConverseURL(baseURL string) bool {
	return strings.HasSuffix(strings.TrimRight(baseURL, "/"), "/converse")
}

func buildBedrockConverseRequest(cr chatRequest) bedrockConverseRequest {
	req := bedrockConverseRequest{
		InferenceConfig: bedrockInferenceConfig{
			MaxTokens:   4096,
			Temperature: cr.Temperature,
		},
	}
	for _, msg := range cr.Messages {
		if strings.TrimSpace(msg.Content) == "" {
			continue
		}
		if msg.Role == "system" {
			req.System = append(req.System, bedrockSystemBlock{Text: msg.Content})
			continue
		}
		role := msg.Role
		if role != "assistant" {
			role = "user"
		}
		req.Messages = append(req.Messages, bedrockMessage{
			Role:    role,
			Content: []bedrockContentBlock{{Text: msg.Content}},
		})
	}
	if len(req.Messages) == 0 {
		req.Messages = append(req.Messages, bedrockMessage{
			Role:    "user",
			Content: []bedrockContentBlock{{Text: ""}},
		})
	}
	return req
}

func (c *Client) parseBedrockConverseResponse(respBody []byte, duration float64, scope CallScope) (string, error) {
	var converseResp bedrockConverseResponse
	if err := json.Unmarshal(respBody, &converseResp); err != nil {
		metrics.LLMRequestDuration.WithLabelValues(c.model, "error").Observe(duration)
		if scope.enabled() {
			metrics.LLMRequestsByStepTotal.WithLabelValues(scope.Step, c.model, "error").Inc()
		}
		return "", fmt.Errorf("decode bedrock response: %w", err)
	}

	if converseResp.Output == nil {
		metrics.LLMRequestDuration.WithLabelValues(c.model, "error").Observe(duration)
		if scope.enabled() {
			metrics.LLMRequestsByStepTotal.WithLabelValues(scope.Step, c.model, "error").Inc()
		}
		return "", fmt.Errorf("bedrock returned no output")
	}

	var content strings.Builder
	for _, block := range converseResp.Output.Message.Content {
		content.WriteString(block.Text)
	}
	text := content.String()
	if c.debugLLM {
		slog.Debug("llm raw response", "model", c.model, "len", len(text), "raw", text)
	}

	metrics.LLMRequestDuration.WithLabelValues(c.model, "success").Observe(duration)
	if scope.enabled() {
		metrics.LLMRequestsByStepTotal.WithLabelValues(scope.Step, c.model, "success").Inc()
	}
	if converseResp.Usage != nil {
		metrics.LLMTokensTotal.WithLabelValues(c.model, "input").Add(float64(converseResp.Usage.InputTokens))
		metrics.LLMTokensTotal.WithLabelValues(c.model, "output").Add(float64(converseResp.Usage.OutputTokens))
		metrics.LLMTokensTotal.WithLabelValues(c.model, "total").Add(float64(converseResp.Usage.TotalTokens))
		if scope.enabled() {
			metrics.LLMTokensByStepTotal.WithLabelValues(scope.Step, c.model, "input").Add(float64(converseResp.Usage.InputTokens))
			metrics.LLMTokensByStepTotal.WithLabelValues(scope.Step, c.model, "output").Add(float64(converseResp.Usage.OutputTokens))
		}
	}
	return text, nil
}

func (s CallScope) enabled() bool {
	return s.Step != ""
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

func supportsReasoningSplit(model string) *bool {
	if strings.HasPrefix(strings.ToLower(model), "minimax-m2") {
		reasoningSplit := true
		return &reasoningSplit
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
