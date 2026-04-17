package metering

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// batchKey identifies a single output object: all events with the same key
// land in the same S3 object. Note TsMinute is the minute-aligned wall clock
// at enqueue time, not the flush time.
type batchKey struct {
	TsMinute  int64
	Category  string
	TenantID  string
	ClusterID string
}

// s3Writer is the production Writer. It owns a goroutine that drains the
// event channel into per-key batches and flushes them every FlushInterval.
type s3Writer struct {
	cfg    Config
	s3     s3PutObjecter
	bucket string
	logger *slog.Logger

	ch   chan Event
	done chan struct{}
	wg   sync.WaitGroup

	closeOnce sync.Once

	// State owned by the flusher goroutine. No locks needed because access
	// is serialized through the select loop.
	batches map[batchKey][]map[string]any
	parts   map[batchKey]int
	gz      *gzipPool

	// Rate-limit guard for "channel full" warnings. Stored as Unix seconds,
	// updated via atomic CAS so Record() stays lock-free.
	lastFullWarn int64

	// now is injected for testing. Defaults to time.Now in production.
	now func() time.Time
}

// newS3Writer returns a started s3Writer. The flusher goroutine is running
// by the time this returns.
func newS3Writer(cfg Config, client s3PutObjecter, logger *slog.Logger) *s3Writer {
	w := &s3Writer{
		cfg:     cfg,
		s3:      client,
		bucket:  cfg.Bucket,
		logger:  logger,
		ch:      make(chan Event, cfg.ChannelSize),
		done:    make(chan struct{}),
		batches: make(map[batchKey][]map[string]any),
		parts:   make(map[batchKey]int),
		gz:      newGzipPool(),
		now:     time.Now,
	}
	w.wg.Add(1)
	go w.run()
	return w
}

// Record enqueues evt. Silently drops malformed events. Non-blocking: drops
// on a full channel with a rate-limited warning.
func (w *s3Writer) Record(evt Event) {
	if evt.Category == "" || evt.TenantID == "" {
		return
	}
	select {
	case w.ch <- evt:
	default:
		w.maybeWarnFull()
	}
}

// maybeWarnFull logs at most once per 10 seconds when the channel is full.
// Uses atomic CAS to stay lock-free on the fast path.
func (w *s3Writer) maybeWarnFull() {
	now := w.now().Unix()
	last := atomic.LoadInt64(&w.lastFullWarn)
	if now-last < 10 {
		return
	}
	if !atomic.CompareAndSwapInt64(&w.lastFullWarn, last, now) {
		return
	}
	w.logger.Warn("metering: event channel full, dropping event",
		"capacity", cap(w.ch))
}

// Close signals the flusher to drain and stop. Waits up to ctx deadline for
// the goroutine to exit. Idempotent.
func (w *s3Writer) Close(ctx context.Context) error {
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

// run is the only goroutine that touches batches and parts. It drains ch,
// accumulates per-key batches, flushes every FlushInterval, and on Close
// does a final flush before returning.
func (w *s3Writer) run() {
	defer w.wg.Done()

	ticker := time.NewTicker(w.cfg.FlushInterval)
	defer ticker.Stop()

	// Use background context for flush operations; individual PutObject calls
	// are not interruptible via Close's ctx because they already handle their
	// own transport-level timeouts via the aws sdk default client.
	ctx := context.Background()

	for {
		select {
		case evt := <-w.ch:
			w.enqueue(evt)
		case <-ticker.C:
			w.flushAll(ctx)
		case <-w.done:
			// Drain any events that are already in the channel. A producer
			// that called Record concurrently with Close could still be
			// mid-send; that event will be lost — Close doesn't block
			// producers. Documented as lossy-on-shutdown.
			w.drainAndFlush(ctx)
			return
		}
	}
}

// drainAndFlush empties the channel non-blockingly, then flushes.
func (w *s3Writer) drainAndFlush(ctx context.Context) {
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

// enqueue appends evt to the correct batch. Called only by the flusher
// goroutine, so no locks are needed.
func (w *s3Writer) enqueue(evt Event) {
	now := w.now().Unix()
	key := batchKey{
		TsMinute:  minuteAlign(now),
		Category:  evt.Category,
		TenantID:  evt.TenantID,
		ClusterID: evt.ClusterID,
	}

	// Build the per-record map. Copy caller's Data (so later caller mutations
	// don't corrupt the batch) and splice in agent_id + recorded_at.
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

// flushAll uploads every non-empty batch and clears the map. Runs inside
// the flusher goroutine.
func (w *s3Writer) flushAll(ctx context.Context) {
	for key, records := range w.batches {
		if len(records) == 0 {
			continue
		}
		part := w.parts[key]
		if err := w.uploadBatch(ctx, key, records, part); err != nil {
			w.logger.Warn("metering: flush failed, dropping batch",
				"category", key.Category,
				"tenant_id", key.TenantID,
				"cluster_id", key.ClusterID,
				"ts_minute", key.TsMinute,
				"records", len(records),
				"err", err,
			)
		}
		// Increment part counter regardless of success. This avoids
		// re-colliding on the same key if a subsequent flush succeeds
		// within the same minute.
		w.parts[key] = part + 1
	}
	// Reset map for next tick. Clearing in place reuses the hash buckets
	// and is allocation-friendly in Go 1.21+.
	clear(w.batches)
}

// uploadBatch serializes one batch as the wire-format JSON and does a
// single S3 PutObject. Returns any error from marshal, gzip, or S3.
func (w *s3Writer) uploadBatch(ctx context.Context, key batchKey, records []map[string]any, part int) error {
	payload := struct {
		Timestamp int64            `json:"timestamp"`
		Category  string           `json:"category"`
		TenantID  string           `json:"tenant_id"`
		ClusterID string           `json:"cluster_id"`
		Part      int              `json:"part"`
		Data      []map[string]any `json:"data"`
	}{
		Timestamp: key.TsMinute,
		Category:  key.Category,
		TenantID:  key.TenantID,
		ClusterID: key.ClusterID,
		Part:      part,
		Data:      records,
	}

	raw, err := json.Marshal(&payload)
	if err != nil {
		return err
	}
	compressed, err := w.gz.compress(raw)
	if err != nil {
		return err
	}

	objectKey := buildKey(w.cfg.Prefix, key.Category, key.TenantID, key.ClusterID, key.TsMinute, part)
	_, err = w.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(w.bucket),
		Key:    aws.String(objectKey),
		Body:   bytes.NewReader(compressed),
	})
	return err
}
