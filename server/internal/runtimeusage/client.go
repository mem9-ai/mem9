package runtimeusage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/qiffang/mnemos/server/internal/reqid"
)

type HTTPClient struct {
	baseURL        string
	internalSecret string
	client         *http.Client
}

const maxResponseBodyBytes = 1 << 20

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
	if requestID := reqid.FromContext(ctx); requestID != "" {
		req.Header.Set(reqid.Header, requestID)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return &UnavailableError{Err: err}
	}
	defer resp.Body.Close()
	success := resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices
	if success && out == nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxResponseBodyBytes+1))
		return nil
	}
	respBody, overflow, err := readBoundedResponseBody(resp.Body)
	if err != nil || overflow {
		if classifyQuotaStatuses && isRuntimeQuotaDenialResponse(resp.StatusCode, respBody) {
			return newQuotaDeniedError(resp, nil)
		}
		if classifyQuotaStatuses {
			if reservationErr := newUnknownReservationResponseError(resp); reservationErr != nil {
				return reservationErr
			}
		}
		if resp.StatusCode == http.StatusConflict {
			return newConflictError(resp, nil)
		}
		if err == nil {
			err = fmt.Errorf("runtime usage response exceeds %d bytes", maxResponseBodyBytes)
		}
		return &UnavailableError{Err: err}
	}

	// Quota detail shape is a fail-closed product denial even when a provider
	// also supplies a code that overlaps the Reservation retry contract.
	if classifyQuotaStatuses && isRuntimeQuotaDenialResponse(resp.StatusCode, respBody) {
		return newQuotaDeniedError(resp, respBody)
	}
	if classifyQuotaStatuses {
		if reservationErr := classifyReservationError(resp.StatusCode, respBody, resp.Header.Get("Retry-After")); reservationErr != nil {
			return reservationErr
		}
		if reservationErr := newUnknownReservationResponseError(resp); reservationErr != nil {
			return reservationErr
		}
	}
	if resp.StatusCode == http.StatusConflict {
		return newConflictError(resp, respBody)
	}
	if !success {
		return &UnavailableError{Err: fmt.Errorf("runtime usage service returned status %d", resp.StatusCode)}
	}
	if out != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("runtime usage decode response: %w", err)
		}
	}
	return nil
}

func newUnknownReservationResponseError(resp *http.Response) error {
	if resp == nil {
		return nil
	}
	switch resp.StatusCode {
	case http.StatusConflict:
		return newReservationStatusError(resp.StatusCode, 0, newConflictError(resp, nil))
	case http.StatusTooManyRequests:
		return newReservationStatusError(
			resp.StatusCode,
			parseRetryAfter(resp.Header.Get("Retry-After")),
			&UnavailableError{Err: fmt.Errorf("runtime usage service returned status %d", resp.StatusCode)},
		)
	default:
		return nil
	}
}

func newQuotaDeniedError(resp *http.Response, body []byte) *QuotaDeniedError {
	return &QuotaDeniedError{
		StatusCode: resp.StatusCode,
		Body:       body,
		RetryAfter: strings.TrimSpace(resp.Header.Get("Retry-After")),
	}
}

func newConflictError(resp *http.Response, body []byte) *ConflictError {
	return &ConflictError{StatusCode: resp.StatusCode, Body: body}
}

func classifyReservationError(status int, body []byte, retryAfterHeader string) *reservationError {
	var envelope struct {
		Code    reservationErrorCode `json:"code"`
		Details struct {
			Retryable bool `json:"retryable"`
		} `json:"details"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil
	}

	policy, known := envelope.Code.policy()
	if !known || policy.statusCode != status {
		return nil
	}
	if envelope.Code == reservationErrorCodeOperationConflict {
		return newReservationError(envelope.Code, false, 0)
	}
	if !policy.retryable || !envelope.Details.Retryable {
		return nil
	}

	retryAfter := parseRetryAfter(retryAfterHeader)
	if policy.statusCode == http.StatusTooManyRequests && retryAfter == 0 {
		return nil
	}
	return newReservationError(envelope.Code, true, retryAfter)
}

func parseRetryAfter(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	for _, digit := range []byte(raw) {
		if digit < '0' || digit > '9' {
			return 0
		}
	}
	seconds, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || seconds == 0 || seconds > uint64((1<<63-1)/time.Second) {
		return 0
	}
	return time.Duration(seconds) * time.Second
}

func readBoundedResponseBody(body io.Reader) ([]byte, bool, error) {
	responseBody, err := io.ReadAll(io.LimitReader(body, maxResponseBodyBytes+1))
	overflow := len(responseBody) > maxResponseBodyBytes
	if overflow {
		responseBody = responseBody[:maxResponseBodyBytes]
	}
	if err != nil {
		return responseBody, overflow, fmt.Errorf("runtime usage read response: %w", err)
	}
	return responseBody, overflow, nil
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
