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

type transportWriter struct {
	cfg       Config
	transport batchTransport
	logger    *slog.Logger

	ch   chan Event
	done chan struct{}
	wg   sync.WaitGroup

	closeOnce sync.Once

	batches map[batchKey][]map[string]any
	parts   map[batchKey]int

	lastFullWarn int64
	now          func() time.Time
}

func newTransportWriter(cfg Config, transport batchTransport, logger *slog.Logger) *transportWriter {
	w := &transportWriter{
		cfg:       cfg,
		transport: transport,
		logger:    logger,
		ch:        make(chan Event, cfg.ChannelSize),
		done:      make(chan struct{}),
		batches:   make(map[batchKey][]map[string]any),
		parts:     make(map[batchKey]int),
		now:       time.Now,
	}
	w.wg.Add(1)
	go w.run()
	return w
}

func (w *transportWriter) Record(evt Event) {
	if evt.Category == "" || evt.TenantID == "" {
		return
	}
	select {
	case w.ch <- evt:
	default:
		w.maybeWarnFull()
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
	w.closeOnce.Do(func() {
		close(w.done)
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

	ctx := context.Background()

	for {
		select {
		case evt := <-w.ch:
			w.enqueue(evt)
		case <-ticker.C:
			w.flushAll(ctx)
		case <-w.done:
			w.drainAndFlush(ctx)
			return
		}
	}
}

func (w *transportWriter) drainAndFlush(ctx context.Context) {
	for {
		select {
		case evt := <-w.ch:
			w.enqueue(evt)
		default:
			w.flushAll(ctx)
			return
		}
	}
}

func (w *transportWriter) enqueue(evt Event) {
	now := w.now().Unix()
	key := batchKey{
		TsMinute:  minuteAlign(now),
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
	record["recorded_at"] = now

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
}
