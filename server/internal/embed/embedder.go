package embed

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Embedder generates vector embeddings from text.
type Embedder struct {
	apiKey  string
	baseURL string
	model   string
	dims    int
	client  *http.Client
}

// Config holds embedding provider configuration.
type Config struct {
	APIKey  string // OpenAI key; "local" or empty for Ollama
	BaseURL string // Override for Ollama/LM Studio (e.g., http://localhost:11434/v1)
	Model   string // Model name (default: text-embedding-3-small)
	Dims    int    // Vector dimensions (default: 1536)
}

const (
	defaultModel   = "text-embedding-3-small"
	defaultDims    = 1536
	defaultBaseURL = "https://api.openai.com/v1"
)

// New creates an Embedder from config. Returns nil if not configured
// (no API key and no base URL).
func New(cfg Config) *Embedder {
	if cfg.APIKey == "" && cfg.BaseURL == "" {
		return nil
	}
	model := cfg.Model
	if model == "" {
		model = defaultModel
	}
	dims := cfg.Dims
	if dims <= 0 {
		dims = defaultDims
	}
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	apiKey := cfg.APIKey
	if apiKey == "" {
		apiKey = "local"
	}
	return &Embedder{
		apiKey:  apiKey,
		baseURL: baseURL,
		model:   model,
		dims:    dims,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

// Dims returns the configured vector dimensions.
func (e *Embedder) Dims() int {
	return e.dims
}

func (e *Embedder) Model() string {
	return e.model
}

// embeddingRequest is the OpenAI-compatible request body.
type embeddingRequest struct {
	Model          string `json:"model"`
	Input          string `json:"input"`
	EncodingFormat string `json:"encoding_format"`
}

type embeddingResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
	} `json:"data"`
}

// Embed generates a vector embedding for the given text.
func (e *Embedder) Embed(ctx context.Context, text string) ([]float32, error) {
	reqBody := embeddingRequest{
		Model:          e.model,
		Input:          text,
		EncodingFormat: "float", // Required for Ollama/LM Studio; safe for OpenAI too.
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal embedding request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", e.baseURL+"/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create embedding request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+e.apiKey)

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embedding API call: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embedding API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result embeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode embedding response: %w", err)
	}
	if len(result.Data) == 0 || len(result.Data[0].Embedding) == 0 {
		return nil, fmt.Errorf("empty embedding response")
	}
	return result.Data[0].Embedding, nil
}
