package runtimeusage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type HTTPClient struct {
	baseURL        string
	internalSecret string
	client         *http.Client
}

func NewHTTPClient(baseURL, internalSecret string, timeout time.Duration) *HTTPClient {
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	return &HTTPClient{
		baseURL:        strings.TrimRight(baseURL, "/"),
		internalSecret: internalSecret,
		client:         &http.Client{Timeout: timeout},
	}
}

func (c *HTTPClient) Reserve(ctx context.Context, subject Subject, operationID string, op Operation) (*Reservation, error) {
	body := map[string]any{
		"meter": op.Meter,
		"units": op.Units,
	}
	var reservation Reservation
	if err := c.doJSON(ctx, http.MethodPut, "/api/internal/quota/reservations/"+operationID, subject, body, &reservation); err != nil {
		return nil, err
	}
	return &reservation, nil
}

func (c *HTTPClient) FinalizeReservation(ctx context.Context, subject Subject, operationID string, status string, reason string) error {
	body := map[string]any{
		"status": status,
	}
	if reason != "" {
		body["reason"] = reason
	}
	return c.doJSON(ctx, http.MethodPatch, "/api/internal/quota/reservations/"+operationID, subject, body, nil)
}

func (c *HTTPClient) doJSON(ctx context.Context, method, path string, subject Subject, body any, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("runtime usage marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("runtime usage build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.internalSecret)
	req.Header.Set("X-API-Key", subject.APIKeySubject)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return &UnavailableError{Err: err}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode == http.StatusPaymentRequired {
		return &QuotaDeniedError{StatusCode: resp.StatusCode, Body: respBody}
	}
	if resp.StatusCode == http.StatusConflict {
		return &ConflictError{StatusCode: resp.StatusCode, Body: respBody}
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return &UnavailableError{Err: fmt.Errorf("runtime usage service returned status %d", resp.StatusCode)}
	}
	if out != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("runtime usage decode response: %w", err)
		}
	}
	return nil
}
