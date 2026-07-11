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
	if err := c.doJSON(ctx, http.MethodPut, "/api/internal/quota/reservations/"+operationID, subject, body, &reservation, true); err != nil {
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
	return c.doJSON(ctx, http.MethodPatch, "/api/internal/quota/reservations/"+operationID, subject, body, nil, false)
}

func (c *HTTPClient) RuntimeState(ctx context.Context, subject Subject) (RuntimeState, error) {
	var state RuntimeState
	if err := c.doJSON(ctx, http.MethodGet, "/api/internal/mem9-api-key/state", subject, nil, &state, false); err != nil {
		return RuntimeState{}, err
	}
	if err := state.NormalizeProviderData(); err != nil {
		return RuntimeState{}, &UnavailableError{Err: err}
	}
	state.SetProviderDefaults()
	return state, nil
}

func (c *HTTPClient) doJSON(ctx context.Context, method, path string, subject Subject, body any, out any, classifyQuotaStatuses bool) error {
	var reqBody io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("runtime usage marshal request: %w", err)
		}
		reqBody = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reqBody)
	if err != nil {
		return fmt.Errorf("runtime usage build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.internalSecret)
	req.Header.Set("X-API-Key", subject.APIKeySubject)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return &UnavailableError{Err: err}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if classifyQuotaStatuses && isRuntimeQuotaDenialResponse(resp.StatusCode, respBody) {
		return &QuotaDeniedError{
			StatusCode: resp.StatusCode,
			Body:       respBody,
			RetryAfter: strings.TrimSpace(resp.Header.Get("Retry-After")),
		}
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

func isRuntimeQuotaDenialResponse(status int, body []byte) bool {
	switch status {
	case http.StatusPaymentRequired:
		return true
	case http.StatusTooManyRequests:
	default:
		return false
	}

	// Reservation providers return code/message/details envelopes. Code values
	// are provider-defined, so 429 classification uses the required envelope
	// plus quota detail shape rather than provider-specific code strings.
	var envelope struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Details map[string]any `json:"details"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return false
	}
	if strings.TrimSpace(envelope.Code) == "" || strings.TrimSpace(envelope.Message) == "" {
		return false
	}
	if !hasRuntimeQuotaString(envelope.Details, "meter") {
		return false
	}
	gateResult, ok := envelope.Details["quotaGateResult"].(map[string]any)
	if !ok {
		return false
	}
	if !hasRuntimeQuotaString(gateResult, "outcome") {
		return false
	}
	if !hasRuntimeQuotaString(gateResult, "reason") {
		return false
	}
	return true
}

func hasRuntimeQuotaString(fields map[string]any, name string) bool {
	value, ok := fields[name].(string)
	return ok && strings.TrimSpace(value) != ""
}
