package metering

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type httpDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

type webhookTransport struct {
	url    string
	client httpDoer
}

func newWebhookTransport(url string, client httpDoer) *webhookTransport {
	return &webhookTransport{
		url:    url,
		client: client,
	}
}

func (w *webhookTransport) Write(ctx context.Context, payload batchPayload) error {
	body, err := json.Marshal(&payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("metering: build webhook request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.client.Do(req)
	if err != nil {
		return fmt.Errorf("metering: post webhook: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("metering: webhook returned status %d", resp.StatusCode)
	}
	return nil
}
