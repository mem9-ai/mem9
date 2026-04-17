package metering

import (
	"context"
	"log/slog"
)

// Event is the unit passed to Writer.Record. It is non-blocking — the writer
// enqueues it for later batching and flushing.
//
// Category and TenantID MUST be non-empty; events with either missing are
// silently dropped (no log, no error, no panic).
//
// ClusterID may be empty (rendered as "_" in the S3 key).
// AgentID may be empty; when present it is merged into Data as "agent_id".
// Data may be nil or empty; it is the caller-defined per-event payload.
type Event struct {
	Category  string
	TenantID  string
	ClusterID string
	AgentID   string
	Data      map[string]any
}

// Writer records metering events asynchronously and flushes them to S3 in
// batches. Record is non-blocking and safe for concurrent use. Close flushes
// any pending batch and stops the background goroutine.
type Writer interface {
	// Record enqueues evt for later flush. Must not block. Must be safe for
	// concurrent callers. Malformed events (empty Category or TenantID) are
	// silently dropped.
	Record(evt Event)

	// Close flushes pending events and stops the background goroutine. Safe
	// to call multiple times. Returns ctx.Err() if ctx expires before the
	// flush completes.
	Close(ctx context.Context) error
}

// New constructs a Writer. When cfg.Enabled is false or cfg.Bucket is empty,
// returns a no-op Writer and logs at Info level. Otherwise builds an S3
// client, starts the background flusher goroutine, and returns the
// configured Writer.
//
// The ctx argument is used only for initial AWS SDK config loading. The
// writer's internal goroutine uses its own derived context for the
// lifetime of Close.
func New(ctx context.Context, cfg Config, logger *slog.Logger) (Writer, error) {
	if logger == nil {
		logger = slog.Default()
	}
	cfg = cfg.withDefaults()

	if !cfg.Enabled || cfg.Bucket == "" {
		logger.Info("metering disabled", "enabled", cfg.Enabled, "bucket_set", cfg.Bucket != "")
		return noopWriter{}, nil
	}

	client, err := newS3Client(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return newS3Writer(cfg, client, logger), nil
}

// noopWriter drops all events. Used when metering is disabled.
type noopWriter struct{}

func (noopWriter) Record(Event)                {}
func (noopWriter) Close(context.Context) error { return nil }
