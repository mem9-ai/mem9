package metering

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

type batchTransport interface {
	Write(ctx context.Context, payload batchPayload) error
}

type batchKey struct {
	TsMinute  int64
	Category  string
	TenantID  string
	ClusterID string
}

type batchPayload struct {
	Timestamp int64            `json:"timestamp"`
	Category  string           `json:"category"`
	TenantID  string           `json:"tenant_id"`
	ClusterID string           `json:"cluster_id"`
	Part      int              `json:"part"`
	Data      []map[string]any `json:"data"`
}

type queuedEvent struct {
	event      Event
	recordedAt int64
	tsMinute   int64
}

type transportWriter struct {
	cfg       Config
	transport batchTransport
	logger    *slog.Logger

	ch   chan queuedEvent
	done chan struct{}
	wg   sync.WaitGroup

	closeOnce sync.Once

	batches map[batchKey][]map[string]any
	parts   map[batchKey]int

	lastFullWarn int64
	now          func() time.Time

	closeCtxMu sync.Mutex
	closeCtx   context.Context

	runtimeCtx    context.Context
	runtimeCancel context.CancelFunc
}

func newTransportWriter(cfg Config, transport batchTransport, logger *slog.Logger) *transportWriter {
	runtimeCtx, runtimeCancel := context.WithCancel(context.Background())
	w := &transportWriter{
		cfg:           cfg,
		transport:     transport,
		logger:        logger,
		ch:            make(chan queuedEvent, cfg.ChannelSize),
		done:          make(chan struct{}),
		batches:       make(map[batchKey][]map[string]any),
		parts:         make(map[batchKey]int),
		now:           time.Now,
		runtimeCtx:    runtimeCtx,
		runtimeCancel: runtimeCancel,
	}
	w.wg.Add(1)
	go w.run()
	return w
}

func (w *transportWriter) Record(evt Event) {
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

func (w *transportWriter) makeQueuedEvent(evt Event) queuedEvent {
	recordedAt := w.now().Unix()
	return queuedEvent{
		event:      evt,
		recordedAt: recordedAt,
		tsMinute:   minuteAlign(recordedAt),
	}
}

func (w *transportWriter) maybeWarnFull() {
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

func (w *transportWriter) Close(ctx context.Context) error {
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

func (w *transportWriter) run() {
	defer w.wg.Done()

	ticker := time.NewTicker(w.cfg.FlushInterval)
	defer ticker.Stop()

	for {
		select {
		case item := <-w.ch:
			w.enqueueQueued(item)
		case <-ticker.C:
			w.flushAll(w.runtimeCtx)
		case <-w.done:
			w.drainAndFlush(w.shutdownContext())
			return
		}
	}
}

func (w *transportWriter) shutdownContext() context.Context {
	w.closeCtxMu.Lock()
	defer w.closeCtxMu.Unlock()
	if w.closeCtx == nil {
		return context.Background()
	}
	return w.closeCtx
}

func (w *transportWriter) drainAndFlush(ctx context.Context) {
	for {
		select {
		case item := <-w.ch:
			w.enqueueQueued(item)
		default:
			w.flushAll(ctx)
			return
		}
	}
}

func (w *transportWriter) enqueue(evt Event) {
	w.enqueueQueued(w.makeQueuedEvent(evt))
}

func (w *transportWriter) enqueueQueued(item queuedEvent) {
	evt := item.event
	key := batchKey{
		TsMinute:  item.tsMinute,
		Category:  evt.Category,
		TenantID:  evt.TenantID,
		ClusterID: evt.ClusterID,
	}

	record := make(map[string]any, len(evt.Data)+2)
	for k, v := range evt.Data {
		record[k] = v
	}
	if evt.AgentID != "" {
		record["agent_id"] = evt.AgentID
	}
	record["recorded_at"] = item.recordedAt

	w.batches[key] = append(w.batches[key], record)
}

func (w *transportWriter) flushAll(ctx context.Context) {
	for key, records := range w.batches {
		if len(records) == 0 {
			continue
		}
		part := w.parts[key]
		payload := batchPayload{
			Timestamp: key.TsMinute,
			Category:  key.Category,
			TenantID:  key.TenantID,
			ClusterID: key.ClusterID,
			Part:      part,
			Data:      records,
		}
		if err := w.transport.Write(ctx, payload); err != nil {
			w.logger.Warn("metering: flush failed, dropping batch",
				"category", key.Category,
				"tenant_id", key.TenantID,
				"cluster_id", key.ClusterID,
				"ts_minute", key.TsMinute,
				"records", len(records),
				"err", err,
			)
		}
		w.parts[key] = part + 1
	}
	clear(w.batches)
	w.pruneStaleParts(minuteAlign(w.now().Unix()))
}

func (w *transportWriter) pruneStaleParts(currentMinute int64) {
	for key := range w.parts {
		if key.TsMinute < currentMinute {
			delete(w.parts, key)
		}
	}
}
