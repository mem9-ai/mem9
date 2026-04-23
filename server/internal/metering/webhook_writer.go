package metering

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

type httpDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

type webhookEvent struct {
	ID        string          `json:"id"`
	EventType string          `json:"event_type"`
	CreatedAt string          `json:"created_at"`
	Payload   map[string]any  `json:"payload"`
	Metadata  webhookMetadata `json:"metadata"`
}

type webhookMetadata struct {
	TenantID  string `json:"tenant_id"`
	ClusterID string `json:"cluster_id,omitempty"`
}

type webhookWriter struct {
	cfg    Config
	url    string
	client httpDoer
	logger *slog.Logger

	ch   chan queuedEvent
	done chan struct{}
	wg   sync.WaitGroup

	closeOnce sync.Once

	lastFullWarn int64
	now          func() time.Time
	idFn         func() string

	closeCtxMu sync.Mutex
	closeCtx   context.Context

	runtimeCtx    context.Context
	runtimeCancel context.CancelFunc
}

func newWebhookWriter(cfg Config, url string, client httpDoer, logger *slog.Logger) *webhookWriter {
	runtimeCtx, runtimeCancel := context.WithCancel(context.Background())
	w := &webhookWriter{
		cfg:           cfg,
		url:           url,
		client:        client,
		logger:        logger,
		ch:            make(chan queuedEvent, cfg.ChannelSize),
		done:          make(chan struct{}),
		now:           time.Now,
		idFn:          newWebhookEventID,
		runtimeCtx:    runtimeCtx,
		runtimeCancel: runtimeCancel,
	}
	w.wg.Add(1)
	go w.run()
	return w
}

func newWebhookEventID() string {
	return "evt_" + strings.ReplaceAll(uuid.NewString(), "-", "")
}

func (w *webhookWriter) Record(evt Event) {
	if evt.Category == "" || evt.TenantID == "" {
		return
	}
	item := w.makeQueuedEvent(evt)
	select {
	case w.ch <- item:
	default:
		w.maybeWarnFull()
	}
}

func (w *webhookWriter) Close(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}

	w.closeOnce.Do(func() {
		w.closeCtxMu.Lock()
		w.closeCtx = ctx
		w.closeCtxMu.Unlock()
		if w.runtimeCancel != nil {
			w.runtimeCancel()
		}
		if w.done != nil {
			close(w.done)
		}
	})

	waitCh := make(chan struct{})
	go func() {
		w.wg.Wait()
		close(waitCh)
	}()

	select {
	case <-waitCh:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (w *webhookWriter) run() {
	defer w.wg.Done()

	for {
		select {
		case item := <-w.ch:
			w.deliver(item)
		case <-w.done:
			w.drainAndDeliver(w.shutdownContext())
			return
		}
	}
}

func (w *webhookWriter) deliver(item queuedEvent) {
	if err := w.postEvent(w.runtimeCtx, item); err != nil {
		if w.runtimeCtx.Err() != nil {
			shutdownCtx := w.shutdownContext()
			if shutdownCtx.Err() == nil {
				if retryErr := w.postEvent(shutdownCtx, item); retryErr == nil {
					return
				} else {
					err = retryErr
				}
			}
		}
		w.logDeliveryError(item, err)
	}
}

func (w *webhookWriter) drainAndDeliver(ctx context.Context) {
	for {
		select {
		case item := <-w.ch:
			if err := w.postEvent(ctx, item); err != nil {
				w.logDeliveryError(item, err)
				if ctx.Err() != nil {
					return
				}
			}
		default:
			return
		}
	}
}

func (w *webhookWriter) shutdownContext() context.Context {
	w.closeCtxMu.Lock()
	defer w.closeCtxMu.Unlock()
	if w.closeCtx == nil {
		return context.Background()
	}
	return w.closeCtx
}

func (w *webhookWriter) makeQueuedEvent(evt Event) queuedEvent {
	if evt.Data != nil {
		copied := make(map[string]any, len(evt.Data))
		for k, v := range evt.Data {
			copied[k] = deepCopyAny(v)
		}
		evt.Data = copied
	}

	recordedAt := w.now().Unix()
	key := batchKey{
		TsMinute:  minuteAlign(recordedAt),
		Category:  evt.Category,
		TenantID:  evt.TenantID,
		ClusterID: evt.ClusterID,
	}
	return queuedEvent{
		event:      evt,
		recordedAt: recordedAt,
		tsMinute:   key.TsMinute,
		key:        key,
	}
}

func (w *webhookWriter) maybeWarnFull() {
	now := w.now().Unix()
	last := atomic.LoadInt64(&w.lastFullWarn)
	if now-last < 10 {
		return
	}
	if !atomic.CompareAndSwapInt64(&w.lastFullWarn, last, now) {
		return
	}
	w.logger.Warn("metering: event channel full, dropping event", "capacity", cap(w.ch))
}

func (w *webhookWriter) postEvent(ctx context.Context, item queuedEvent) error {
	body, err := json.Marshal(w.buildWebhookEvent(item))
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

func (w *webhookWriter) buildWebhookEvent(item queuedEvent) webhookEvent {
	eventType, payload := splitWebhookEventData(item.event.Category, item.event.Data)
	return webhookEvent{
		ID:        w.idFn(),
		EventType: eventType,
		CreatedAt: time.Unix(item.recordedAt, 0).UTC().Format(time.RFC3339),
		Payload:   payload,
		Metadata: webhookMetadata{
			TenantID:  item.event.TenantID,
			ClusterID: item.event.ClusterID,
		},
	}
}

func splitWebhookEventData(fallbackType string, data map[string]any) (string, map[string]any) {
	eventType := fallbackType
	if raw, ok := data["event_type"]; ok {
		if s, ok := raw.(string); ok && s != "" {
			eventType = s
		}
	}

	payload := make(map[string]any, len(data))
	for k, v := range data {
		if k == "event_type" {
			continue
		}
		payload[k] = v
	}
	return eventType, payload
}

func (w *webhookWriter) logDeliveryError(item queuedEvent, err error) {
	eventType, _ := splitWebhookEventData(item.event.Category, item.event.Data)
	w.logger.Warn("metering: webhook delivery failed, dropping event",
		"category", item.event.Category,
		"event_type", eventType,
		"tenant_id", item.event.TenantID,
		"cluster_id", item.event.ClusterID,
		"err", err,
	)
}
