---
title: server/internal/metering — Agent context
---

## What this area owns

`server/internal/metering` provides mem9's write-only metering writers. The legacy API writer batches `Event` values in memory and flushes them through a transport selected by destination URL scheme. The runtime usage console writer sends per-operation metering events to the runtime usage service and can persist retry state through the runtime usage outbox.

## Public API

- `Config` — legacy API metering writer configuration. The env surface is `MNEMO_METERING_ENABLED`, `MNEMO_METERING_URL`, and `MNEMO_METERING_FLUSH_INTERVAL`
- `ConsoleRuntimeConfig` — runtime usage console metering writer configuration. It is wired from `MNEMO_RUNTIME_USAGE_BASE_URL`, `MNEMO_RUNTIME_USAGE_INTERNAL_SECRET`, `MNEMO_RUNTIME_USAGE_METERING_TIMEOUT`, and the optional runtime usage outbox store
- `Event` — caller-supplied usage record envelope
- `Writer` — asynchronous interface with `Record(evt)` and `Close(ctx)`
- `New(ctx, cfg, logger)` — constructs either the real S3 writer or a no-op writer when disabled
- `NewConsoleRuntime(cfg, logger)` — constructs the runtime usage console metering writer

## Current constraints

- Legacy API metering destination transport is selected by URL scheme: `s3://`, `http://`, or `https://`
- Legacy S3 credentials come from the default AWS SDK chain
- Legacy API metering is lossy-on-error by design: failed uploads are logged and dropped, not retried
- Runtime usage console metering is separate from `MNEMO_METERING_URL`; it sends events to `MNEMO_RUNTIME_USAGE_BASE_URL`
- Runtime usage console events require `OperationID`, `APIKeySubject`, `EventType`, `Meter`, and non-zero `Units`
- Runtime usage console metering sanitizes agent names, memory IDs, and metadata before delivery
- Current call sites exist: `handler/metering.go` records legacy recall/ingest API events, and `runtimeusage.Manager` records console metering after successful quota commits

## How to add a Record call site

Keep metering at service or handler operation boundaries, not in repositories. For legacy API metering, prefer one `Record()` call after a successful high-level operation, with the business payload stored in `Event.Data`. For runtime usage quota/metering, wire through `server/internal/runtimeusage` so reservation, finalization, outbox, and console metering stay consistent.
