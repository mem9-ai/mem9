package metering

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/qiffang/mnemos/server/internal/metrics"
)

type ConsoleRuntimeConfig struct {
	BaseURL        string
	InternalSecret string
	Timeout        time.Duration
	ChannelSize    int
	Store          ConsoleEventStore
}

type ConsoleEventStore interface {
	UpsertMeteringPending(ctx context.Context, evt Event, payloadJSON []byte, payloadHash string) error
	MarkMeteringDone(ctx context.Context, operationID string) error
	MarkMeteringTerminalFailed(ctx context.Context, operationID, reason string) error
	MarkMeteringRetryableFailure(ctx context.Context, operationID, reason string) error
}

const consoleOutboxTimeout = 2 * time.Second

type consoleMeteringPayload struct {
	EventType  string         `json:"eventType"`
	Meter      string         `json:"meter"`
	Units      int64          `json:"units"`
	OccurredAt string         `json:"occurredAt"`
	AgentName  string         `json:"agentName,omitempty"`
	MemoryIDs  []string       `json:"memoryIds,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

type consoleMeteringHashPayload struct {
	APIKeySubject string `json:"apiKeySubject"`
	consoleMeteringPayload
}

type consoleQueuedEvent struct {
	evt         Event
	payloadJSON []byte
	payloadHash string
}

type consoleRuntimeWriter struct {
	cfg    ConsoleRuntimeConfig
	client httpDoer
	logger *slog.Logger

	ch   chan consoleQueuedEvent
	done chan struct{}
	wg   sync.WaitGroup

	closeOnce sync.Once

	lastFullWarn int64
	now          func() time.Time

	closeCtxMu sync.Mutex
	closeCtx   context.Context

	runtimeCtx    context.Context
	runtimeCancel context.CancelFunc
}

func NewConsoleRuntime(cfg ConsoleRuntimeConfig, logger *slog.Logger) (Writer, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return nil, fmt.Errorf("metering: runtime usage service base URL is required")
	}
	if strings.TrimSpace(cfg.InternalSecret) == "" {
		return nil, fmt.Errorf("metering: runtime usage service internal secret is required")
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 5 * time.Second
	}
	if cfg.ChannelSize <= 0 {
		cfg.ChannelSize = defaultChannelSize
	}
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	cfg.BaseURL = baseURL
	return newConsoleRuntimeWriter(cfg, &http.Client{Timeout: cfg.Timeout}, logger), nil
}

func newConsoleRuntimeWriter(cfg ConsoleRuntimeConfig, client httpDoer, logger *slog.Logger) *consoleRuntimeWriter {
	runtimeCtx, runtimeCancel := context.WithCancel(context.Background())
	w := &consoleRuntimeWriter{
		cfg:           cfg,
		client:        client,
		logger:        logger,
		ch:            make(chan consoleQueuedEvent, cfg.ChannelSize),
		done:          make(chan struct{}),
		now:           time.Now,
		runtimeCtx:    runtimeCtx,
		runtimeCancel: runtimeCancel,
	}
	w.wg.Add(1)
	go w.run()
	return w
}

func (w *consoleRuntimeWriter) Record(evt Event) {
	if evt.OccurredAt.IsZero() {
		evt.OccurredAt = w.now().UTC().Truncate(time.Second)
	} else {
		evt.OccurredAt = evt.OccurredAt.UTC().Truncate(time.Second)
	}
	item, err := w.makeQueuedEvent(evt)
	if err != nil {
		w.logInvalidEvent(evt, err)
		return
	}
	if w.cfg.Store != nil {
		ctx, cancel := consoleOutboxContext()
		defer cancel()
		if err := w.cfg.Store.UpsertMeteringPending(ctx, item.evt, item.payloadJSON, item.payloadHash); err != nil {
			w.logger.Error("metering: runtime usage service event outbox upsert failed",
				"operation_id", evt.OperationID,
				"tenant_id", evt.TenantID,
				"cluster_id", evt.ClusterID,
				"payload_hash", item.payloadHash,
				"err", err,
			)
			return
		}
	}
	select {
	case w.ch <- item:
	default:
		w.maybeWarnFull()
	}
}

func (w *consoleRuntimeWriter) Close(ctx context.Context) error {
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

func (w *consoleRuntimeWriter) makeQueuedEvent(evt Event) (consoleQueuedEvent, error) {
	if evt.OperationID == "" {
		return consoleQueuedEvent{}, fmt.Errorf("operation ID is required")
	}
	if evt.APIKeySubject == "" {
		return consoleQueuedEvent{}, fmt.Errorf("API key subject is required")
	}
	if evt.EventType == "" {
		return consoleQueuedEvent{}, fmt.Errorf("event type is required")
	}
	if evt.Meter == "" {
		return consoleQueuedEvent{}, fmt.Errorf("meter is required")
	}
	if evt.Units == 0 {
		return consoleQueuedEvent{}, fmt.Errorf("units must be non-zero")
	}
	occurredAt := evt.OccurredAt.UTC().Truncate(time.Second)
	payload := consoleMeteringPayload{
		EventType:  evt.EventType,
		Meter:      evt.Meter,
		Units:      evt.Units,
		OccurredAt: occurredAt.Format(time.RFC3339),
		AgentName:  consoleAgentName(evt.AgentID),
		MemoryIDs:  consoleMemoryIDs(evt.MemoryIDs),
		Metadata:   consoleMetadata(evt.Metadata),
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return consoleQueuedEvent{}, err
	}
	hashJSON, err := json.Marshal(consoleMeteringHashPayload{
		APIKeySubject:          evt.APIKeySubject,
		consoleMeteringPayload: payload,
	})
	if err != nil {
		return consoleQueuedEvent{}, err
	}
	sum := sha256.Sum256(hashJSON)
	evt.OccurredAt = occurredAt
	evt.AgentID = payload.AgentName
	evt.MemoryIDs = append([]string(nil), payload.MemoryIDs...)
	evt.Metadata = consoleMetadata(payload.Metadata)
	return consoleQueuedEvent{
		evt:         evt,
		payloadJSON: payloadJSON,
		payloadHash: hex.EncodeToString(sum[:]),
	}, nil
}

var (
	consoleAgentNamePattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$`)
	consoleMemoryIDPattern    = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)
	consoleMetadataKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)
)

func consoleAgentName(agentName string) string {
	if consoleAgentNamePattern.MatchString(agentName) && !looksSensitive(agentName) {
		return agentName
	}
	return ""
}

func consoleMemoryIDs(ids []string) []string {
	if len(ids) == 0 {
		return nil
	}
	out := make([]string, 0, min(len(ids), 200))
	seen := make(map[string]struct{}, min(len(ids), 200))
	for _, id := range ids {
		if len(out) >= 200 {
			break
		}
		if !consoleMemoryIDPattern.MatchString(id) || looksSensitive(id) {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func consoleMetadata(metadata map[string]any) map[string]any {
	if len(metadata) == 0 {
		return nil
	}
	out := make(map[string]any, min(len(metadata), 20))
	for key, value := range metadata {
		if len(out) >= 20 {
			break
		}
		if !consoleMetadataKeyPattern.MatchString(key) || sensitiveMetadataKey(key) {
			continue
		}
		switch v := value.(type) {
		case string:
			if len(v) > 512 || looksSensitive(v) {
				continue
			}
			out[key] = v
		case int:
			out[key] = v
		case int8:
			out[key] = int64(v)
		case int16:
			out[key] = int64(v)
		case int32:
			out[key] = int64(v)
		case int64:
			out[key] = v
		case uint:
			out[key] = uint64(v)
		case uint8:
			out[key] = uint64(v)
		case uint16:
			out[key] = uint64(v)
		case uint32:
			out[key] = uint64(v)
		case uint64:
			out[key] = v
		case float32:
			out[key] = float64(v)
		case float64:
			out[key] = v
		case bool:
			out[key] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func sensitiveMetadataKey(key string) bool {
	key = strings.ToLower(key)
	sensitive := []string{"authorization", "cookie", "token", "secret", "password", "api_key", "apikey", "dsn", "prompt", "content"}
	for _, marker := range sensitive {
		if strings.Contains(key, marker) {
			return true
		}
	}
	return false
}

func looksSensitive(value string) bool {
	value = strings.TrimSpace(value)
	lower := strings.ToLower(value)
	return strings.HasPrefix(lower, "bearer ") ||
		strings.Contains(lower, "authorization:") ||
		strings.Contains(lower, "password=") ||
		strings.Contains(lower, "x-api-key") ||
		strings.Contains(lower, "mnemo_") ||
		strings.Contains(lower, "mem9_")
}

func (w *consoleRuntimeWriter) run() {
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

func (w *consoleRuntimeWriter) deliver(item consoleQueuedEvent) {
	if err := w.putEvent(w.runtimeCtx, item); err != nil {
		if w.runtimeCtx.Err() != nil {
			shutdownCtx := w.shutdownContext()
			if shutdownCtx.Err() == nil {
				if retryErr := w.putEvent(shutdownCtx, item); retryErr == nil {
					return
				} else {
					err = retryErr
				}
			}
		}
		w.markRetryableFailure(item, err)
	}
}

func (w *consoleRuntimeWriter) drainAndDeliver(ctx context.Context) {
	for {
		select {
		case item := <-w.ch:
			if err := w.putEvent(ctx, item); err != nil {
				w.markRetryableFailure(item, err)
				if ctx.Err() != nil {
					return
				}
			}
		default:
			return
		}
	}
}

func (w *consoleRuntimeWriter) shutdownContext() context.Context {
	w.closeCtxMu.Lock()
	defer w.closeCtxMu.Unlock()
	if w.closeCtx == nil {
		return context.Background()
	}
	return w.closeCtx
}

func (w *consoleRuntimeWriter) putEvent(ctx context.Context, item consoleQueuedEvent) error {
	endpoint := w.cfg.BaseURL + "/api/internal/metering/events/" + item.evt.OperationID
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, bytes.NewReader(item.payloadJSON))
	if err != nil {
		return fmt.Errorf("metering: build runtime usage service request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+w.cfg.InternalSecret)
	req.Header.Set("X-API-Key", item.evt.APIKeySubject)
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.client.Do(req)
	if err != nil {
		return fmt.Errorf("metering: put runtime usage service event: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
		w.markDone(item)
		return nil
	}
	if resp.StatusCode == http.StatusConflict || resp.StatusCode == http.StatusBadRequest {
		w.markTerminalFailed(item, fmt.Sprintf("runtime usage service metering returned status %d", resp.StatusCode))
		return nil
	}
	return fmt.Errorf("metering: runtime usage service returned status %d", resp.StatusCode)
}

func (w *consoleRuntimeWriter) markDone(item consoleQueuedEvent) {
	if w.cfg.Store != nil {
		ctx, cancel := consoleOutboxContext()
		defer cancel()
		if err := w.cfg.Store.MarkMeteringDone(ctx, item.evt.OperationID); err != nil {
			w.logger.Error("metering: mark runtime usage service event done failed",
				"operation_id", item.evt.OperationID,
				"payload_hash", item.payloadHash,
				"err", err,
			)
		}
	}
}

func (w *consoleRuntimeWriter) markTerminalFailed(item consoleQueuedEvent, reason string) {
	metrics.RuntimeUsageMeteringDeliveryFailedTotal.WithLabelValues("terminal_response").Inc()
	if w.cfg.Store != nil {
		ctx, cancel := consoleOutboxContext()
		defer cancel()
		if err := w.cfg.Store.MarkMeteringTerminalFailed(ctx, item.evt.OperationID, reason); err != nil {
			w.logger.Error("metering: mark runtime usage service event terminal failed failed",
				"operation_id", item.evt.OperationID,
				"payload_hash", item.payloadHash,
				"err", err,
			)
		}
	}
	w.logger.Error("metering: runtime usage service event terminal failed",
		"operation_id", item.evt.OperationID,
		"tenant_id", item.evt.TenantID,
		"cluster_id", item.evt.ClusterID,
		"payload_hash", item.payloadHash,
		"reason", reason,
	)
}

func (w *consoleRuntimeWriter) markRetryableFailure(item consoleQueuedEvent, err error) {
	if w.cfg.Store != nil {
		ctx, cancel := consoleOutboxContext()
		defer cancel()
		_ = w.cfg.Store.MarkMeteringRetryableFailure(ctx, item.evt.OperationID, err.Error())
	}
	w.logger.Warn("metering: runtime usage service delivery failed, will retry from outbox",
		"operation_id", item.evt.OperationID,
		"tenant_id", item.evt.TenantID,
		"cluster_id", item.evt.ClusterID,
		"payload_hash", item.payloadHash,
		"err", err,
	)
}

func (w *consoleRuntimeWriter) logInvalidEvent(evt Event, err error) {
	metrics.RuntimeUsageMeteringDeliveryFailedTotal.WithLabelValues("invalid_event").Inc()
	if evt.OperationID != "" && w.cfg.Store != nil {
		ctx, cancel := consoleOutboxContext()
		defer cancel()
		_ = w.cfg.Store.MarkMeteringTerminalFailed(ctx, evt.OperationID, err.Error())
	}
	w.logger.Error("metering: invalid runtime usage service event",
		"operation_id", evt.OperationID,
		"tenant_id", evt.TenantID,
		"cluster_id", evt.ClusterID,
		"err", err,
	)
}

func consoleOutboxContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), consoleOutboxTimeout)
}

func (w *consoleRuntimeWriter) maybeWarnFull() {
	now := w.now().Unix()
	last := atomic.LoadInt64(&w.lastFullWarn)
	if now-last < 10 {
		return
	}
	if !atomic.CompareAndSwapInt64(&w.lastFullWarn, last, now) {
		return
	}
	w.logger.Warn("metering: runtime usage service event channel full, keeping outbox row for retry", "capacity", cap(w.ch))
}
