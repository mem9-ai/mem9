---
title: server/internal/metering — Agent context
---

## What this area owns

`server/internal/metering` provides mem9's write-only S3 metering writer. It batches `Event` values in memory, flushes compressed JSON objects on a timer, and intentionally drops batches on upload error after logging a warning. This package is a stripped-down port of PingCAP's `metering_sdk`: no shared-pool concept, identity is `{tenant_id}/{cluster_id}`, and the public logger is `log/slog`.

## Public API

- `Config` — internal writer configuration. The supported rollout env surface is intentionally smaller: `MNEMO_METERING_ENABLED`, `MNEMO_METERING_S3_BUCKET`, `MNEMO_METERING_S3_PREFIX`, and `MNEMO_METERING_FLUSH_INTERVAL`
- `Event` — caller-supplied usage record envelope
- `Writer` — asynchronous interface with `Record(evt)` and `Close(ctx)`
- `New(ctx, cfg, logger)` — constructs either the real S3 writer or a no-op writer when disabled

## Current constraints

- S3-compatible object storage only
- AWS credentials come from the default AWS SDK chain
- Lossy-on-error by design: failed uploads are logged and dropped, not retried
- Keep the documented env list small for now: enabled flag, bucket, prefix, and flush interval are the intended public knobs
- No caller hooks yet in this round: startup wiring exists, but handlers/services/LLM code do not call `Record()` yet

## How to add a Record call site

Keep metering at service or client boundaries, not in repositories. Prefer one `Record()` call after a successful high-level operation (for example memory create, update, delete, or LLM completion), with the business payload stored in `Event.Data`.

TODO: next round, wire `Record()` from the selected service and LLM boundaries once the event taxonomy is finalized.
