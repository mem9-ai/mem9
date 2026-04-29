// Package metering writes usage events to a destination selected by URL
// scheme.
//
// It is a slimmed-down port of the PingCAP metering_sdk
// (https://github.com/pingcap/metering_sdk), adapted for mem9: no shared-pool
// concept, tenant/cluster as the two-level identity, slog-based logging, S3
// delivery with a 10-second in-memory batch, and webhook delivery with one
// request per recorded event. Supported destinations are S3 object storage
// (`s3://`) and webhook POST endpoints (`http://` / `https://`).
//
// NOTE: the writer is fully implemented, but this round only wires startup
// lifecycle. Caller-side Record() hooks still land in a follow-up change.
package metering

import "time"

// Config carries all metering writer settings.
//
// When Enabled is false OR URL is empty, New() returns a no-op Writer and
// logs at Info level. Credentials come from the default AWS SDK chain (env
// vars, IRSA, pod identity, ~/.aws/credentials) — the same mechanism used by
// server/internal/encrypt/kms.go.
type Config struct {
	Enabled       bool
	URL           string // metering destination: s3://bucket/prefix/ or http(s)://webhook
	Bucket        string
	Prefix        string        // optional, prepended to every object key
	FlushInterval time.Duration // default 10s; used by batched transports such as S3
	ChannelSize   int           // default 1024
}

const (
	defaultFlushInterval = 10 * time.Second
	defaultChannelSize   = 1024
)

// withDefaults returns a copy of c with zero-valued fields filled in.
// Non-zero fields are preserved as-is.
func (c Config) withDefaults() Config {
	if c.FlushInterval <= 0 {
		c.FlushInterval = defaultFlushInterval
	}
	if c.ChannelSize <= 0 {
		c.ChannelSize = defaultChannelSize
	}
	return c
}
