package metering

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Event is the unit passed to Writer.Record. It is non-blocking — the writer
// enqueues it for later asynchronous delivery.
//
// Category and TenantID MUST be non-empty; events with either missing are
// silently dropped (no log, no error, no panic).
//
// ClusterID may be empty (rendered as "_" in the S3 key).
// AgentID may be empty. S3 batches currently merge it into Data as "agent_id";
// webhook delivery currently ignores it.
// Data may be nil or empty; it is the caller-defined per-event payload.
type Event struct {
	Category  string
	TenantID  string
	ClusterID string
	AgentID   string
	Data      map[string]any
}

// Writer records metering events asynchronously and delivers them through the
// configured destination transport. Record is non-blocking and safe for
// concurrent use. Close flushes any pending work and stops the background
// goroutine.
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

// New constructs a Writer. When cfg.Enabled is false or cfg.URL is empty,
// returns a no-op Writer and logs at Info level. Otherwise it selects the
// destination transport from the URL scheme, starts the background delivery
// goroutine, and returns the configured Writer.
//
// The ctx argument is used only for initial AWS SDK config loading. The
// writer's internal goroutine uses its own derived context for the
// lifetime of Close.
func New(ctx context.Context, cfg Config, logger *slog.Logger) (Writer, error) {
	if logger == nil {
		logger = slog.Default()
	}
	cfg = cfg.withDefaults()

	if !cfg.Enabled || cfg.URL == "" {
		logger.Info("metering disabled", "enabled", cfg.Enabled, "url_set", cfg.URL != "")
		return noopWriter{}, nil
	}

	u, err := url.Parse(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("metering: parse destination URL: %w", err)
	}

	switch u.Scheme {
	case "s3":
		if u.Host == "" {
			return nil, fmt.Errorf("metering: s3 destination bucket is required")
		}
		cfg.Bucket = u.Host
		cfg.Prefix = strings.Trim(u.Path, "/")
		client, err := newS3Client(ctx)
		if err != nil {
			return nil, err
		}
		return newS3Writer(cfg, client, logger), nil
	case "http", "https":
		return newWebhookWriter(cfg, cfg.URL, &http.Client{Timeout: 10 * time.Second}, logger), nil
	default:
		return nil, fmt.Errorf("metering: unsupported destination scheme %q", u.Scheme)
	}
}

// noopWriter drops all events. Used when metering is disabled.
type noopWriter struct{}

func (noopWriter) Record(Event)                {}
func (noopWriter) Close(context.Context) error { return nil }
