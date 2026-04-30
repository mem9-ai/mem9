<p align="center">
  <img src="site/public/mem9-wordmark-square.svg" alt="mem9" width="180" />
</p>
<p align="center">
  <strong>Persistent Memory for AI Agents.</strong><br/>
  Your agents forget everything between sessions. mem9 fixes that with persistent memory across sessions and machines, shared memory for multi-agent workflows, and hybrid recall with a visual dashboard.
</p>

<p align="center">
  For OpenClaw and ClawHub installs, start here: <a href="https://mem9.ai/openclaw-memory">mem9.ai/openclaw-memory</a>
  <br/>
  Hermes Agent, Claude Code, OpenCode, Codex, and Dify guides are below.
</p>

<p align="center">
  <a href="https://tidbcloud.com"><img src="https://img.shields.io/badge/Powered%20by-TiDB%20Cloud%20Starter-E60C0C?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIj48cGF0aCBkPSJNMTEuOTk4NCAxLjk5OTAyTDMuNzE4NzUgNy40OTkwMkwzLjcxODc1IDE3TDExLjk5NjQgMjIuNUwyMC4yODE0IDE3VjcuNDk5MDJMMTEuOTk4NCAxLjk5OTAyWiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=" alt="Powered by TiDB Cloud Starter"></a>
  <a href="https://goreportcard.com/report/github.com/mem9-ai/mem9/server"><img src="https://goreportcard.com/badge/github.com/mem9-ai/mem9/server" alt="Go Report Card"></a>
  <a href="https://github.com/mem9-ai/mem9/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <a href="https://github.com/mem9-ai/mem9"><img src="https://img.shields.io/github/stars/mem9-ai/mem9?style=social" alt="Stars"></a>
</p>

---

## Quick Start

1. Choose your mem9 endpoint.

   - Hosted API: `https://api.mem9.ai`
   - Self-hosted: apply the matching control-plane schema, then start `mnemo-server`:

     ```bash
     cd server
     MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" go run ./cmd/mnemo-server
     ```

     See [Self-Hosting](#self-hosting) for backend-specific setup details, and [API Reference](#api-reference) for provisioning.

2. Pick your integration guide.

   - [OpenClaw / ClawHub](https://mem9.ai/openclaw-memory)
   - [Hermes Agent](https://github.com/mem9-ai/mem9-hermes-plugin#readme)
   - [Claude Code](claude-plugin/README.md)
   - [OpenCode](opencode-plugin/README.md)
   - [Codex](codex-plugin/README.md)
   - [Dify](https://github.com/mem9-ai/mem9-dify-plugin#readme)
   - [Any HTTP client / custom runtime](#api-reference)

3. Set your credentials.

   ```bash
   # Hosted API
   export MEM9_API_URL="https://api.mem9.ai"
   export MEM9_API_KEY="<mem9-api-key>"

   # Self-hosted
   export MEM9_API_URL="http://localhost:8080"
   export MEM9_API_KEY="<mem9-api-key>"
   ```

   For self-hosted deployments, use your server URL and the mem9 API key returned or configured by your provisioning flow.

## Why mem9

mem9 gives coding agents one shared memory layer instead of separate local notebooks and one-off prompt files.

| What mem9 gives you | Why it matters |
|---|---|
| Persistent memory across sessions and machines | Your context survives restarts, laptop switches, and long-running projects |
| Shared memory across agents and workflow platforms | OpenClaw, Hermes Agent, Claude Code, OpenCode, Codex, Dify apps, and custom clients can recall the same facts |
| Stateless integrations | Runtime plugins stay thin because storage, search, ingest, and policy live in the server |
| Hybrid recall and a visual dashboard | Semantic search, keyword search, and inspection workflows stay in one system |

## Supported Platforms and Agent Runtimes

| Platform | Integration shape | Install / docs |
|---|---|---|
| OpenClaw | `kind: "memory"` plugin for server-backed shared memory | [OpenClaw / ClawHub install guide](https://mem9.ai/openclaw-memory) |
| Hermes Agent | Memory provider plugin with setup and activation flow | [mem9-hermes-plugin README](https://github.com/mem9-ai/mem9-hermes-plugin#readme) |
| Claude Code | Marketplace plugin with hooks and skills | [`claude-plugin/README.md`](claude-plugin/README.md) |
| OpenCode | Plugin SDK integration loaded from `opencode.json` | [`opencode-plugin/README.md`](opencode-plugin/README.md) |
| Codex | Marketplace plugin with managed hooks and project overrides | [`codex-plugin/README.md`](codex-plugin/README.md) |
| Dify | Tool plugin for Dify Agent apps and Workflow apps, with single-space and multi-space authorization | [mem9-dify-plugin README](https://github.com/mem9-ai/mem9-dify-plugin#readme) |
| Any HTTP client / custom runtime | Direct REST API integration | [API Reference](#api-reference) |

All supported runtimes and platform integrations expose the same core memory flow: store, search, get, update, and delete against the mem9 server API.

## Why the Hosted API

The hosted mem9 API is the fastest way to put persistent memory behind an agent fleet while keeping the option to self-host later.

| Hosted API capability | Why teams start here |
|---|---|
| Hosted mem9 API with instant space provisioning | You can install an agent integration first and skip standing up infrastructure on day one |
| Shared memory across runtimes and platforms | One space can serve OpenClaw, Hermes Agent, Claude Code, OpenCode, Codex, Dify apps, and custom clients together |
| Managed search and storage | Hybrid recall works out of the box without a separate vector stack or sync layer |
| TiDB Cloud Starter foundation | The hosted path benefits from instant provisioning, native vector search, full-text search, server-side auto-embedding, hybrid search, and MySQL-compatible operational semantics |
| Same API contract as self-hosted mem9 | Moving to your own deployment is a base-URL and credential change, not a plugin rewrite |
| Visual dashboard and product onboarding | Teams can inspect and manage memory without building internal tooling first |

Under the hood, the hosted mem9 API runs the same mem9 server model surfaced in this repository, with TiDB Cloud Starter providing managed provisioning, native vector search, full-text search, server-side auto-embedding, hybrid search, and MySQL-compatible storage semantics.

## API Reference

Set `X-Mnemo-Agent-Id` on authenticated memory, import, and session-message requests when you want the server to distinguish which runtime or agent instance is writing and recalling memories inside the same mem9 space. This works on both the tenant-path `v1alpha1` routes and the `v1alpha2` API-key routes.

### Provisioning

Use this endpoint when you want mem9 to auto-provision a new TiDB-backed space.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1alpha1/mem9s` | TiDB auto-provision endpoint when a provisioner is configured. TiDB Zero enables this path by default on `tidb`; TiDB Cloud Pool uses `MNEMO_TIDB_ZERO_ENABLED=false` with `MNEMO_TIDBCLOUD_API_KEY` and `MNEMO_TIDBCLOUD_API_SECRET`. Manual-bootstrap deployments use pre-existing tenants instead of this path. Returns `{ "id" }`. Accepts optional `utm_*` query params for attribution logging |

Prefer `v1alpha2` for all new integrations. It uses `X-API-Key` and is the primary API surface for current runtimes.

### Preferred API (`v1alpha2`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1alpha2/mem9s/memories` | Preferred unified write endpoint. Requires `X-API-Key` header |
| `GET` | `/v1alpha2/mem9s/memories` | Preferred search endpoint. Requires `X-API-Key` header |
| `GET` | `/v1alpha2/mem9s/memories/{id}` | Preferred get-by-id endpoint. Requires `X-API-Key` header |
| `PUT` | `/v1alpha2/mem9s/memories/{id}` | Preferred update endpoint. Requires `X-API-Key` header |
| `DELETE` | `/v1alpha2/mem9s/memories/{id}` | Preferred delete endpoint. Requires `X-API-Key` header |

### Legacy Tenant-Path API (`v1alpha1`)

Use these endpoints only when you need compatibility with older tenant-ID-in-path clients.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1alpha1/mem9s/{tenantID}/memories` | Legacy unified write endpoint. Tenant key travels in the URL path |
| `GET` | `/v1alpha1/mem9s/{tenantID}/memories` | Legacy search endpoint for `tenantID`-configured clients |
| `GET` | `/v1alpha1/mem9s/{tenantID}/memories/{id}` | Legacy get-by-id endpoint |
| `PUT` | `/v1alpha1/mem9s/{tenantID}/memories/{id}` | Legacy update endpoint. Optional `If-Match` for version check |
| `DELETE` | `/v1alpha1/mem9s/{tenantID}/memories/{id}` | Legacy delete endpoint |

## Self-Hosting

Before first start, apply the control-plane schema that matches your backend: `server/schema.sql`, `server/schema_pg.sql`, or `server/schema_db9.sql`.

mem9 server supports multiple storage backends. Set `MNEMO_DB_BACKEND` to `tidb`, `postgres`, or `db9`, point `MNEMO_DSN` at that backend, and the rest of the runtime contract stays the same for your agents. TiDB supports three tenant flows: TiDB Zero auto-provisioning is enabled by default on `tidb`; TiDB Cloud Pool auto-provisioning uses `MNEMO_TIDB_ZERO_ENABLED=false` with `MNEMO_TIDBCLOUD_API_KEY` and `MNEMO_TIDBCLOUD_API_SECRET`; manual bootstrap uses pre-existing tenants mode. `postgres` and `db9` use the advanced manual-bootstrap path, which requires an active tenant row in the control-plane DB plus a live tenant database and schema behind it. In `v1alpha2`, `X-API-Key` resolves tenants by ID lookup.

### Build & Run

```bash
make build
cd server
MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" ./bin/mnemo-server
```

For PostgreSQL or db9 deployments, export `MNEMO_DB_BACKEND=postgres` or `MNEMO_DB_BACKEND=db9` before launching the server.

### Docker

`make docker` tags the image as `${REGISTRY}/mnemo-server:${COMMIT}`. This local example builds `local/mnemo-server:dev`:

```bash
make docker REGISTRY=local COMMIT=dev
docker run -e MNEMO_DSN="..." -e MNEMO_DB_BACKEND="tidb" -p 8080:8080 local/mnemo-server:dev
```

### Environment Variables

Minimal runtime config is `MNEMO_DSN`. Everything else is optional or only applies to specific deployment modes.

#### Core Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_DSN` | Yes | — | Database connection string |
| `MNEMO_PORT` | No | `8080` | HTTP listen port |
| `MNEMO_DB_BACKEND` | No | `tidb` | Database backend: `tidb`, `postgres`, or `db9` |
| `MNEMO_RATE_LIMIT` | No | `100` | Requests/sec per IP |
| `MNEMO_RATE_BURST` | No | `200` | Burst size |
| `MNEMO_UPLOAD_DIR` | No | `./uploads` | Directory used for uploaded file storage |
| `MNEMO_WORKER_CONCURRENCY` | No | `5` | Parallelism for async upload ingest workers |
| `MNEMO_UTM_ENABLED` | No | `false` | Enable UTM campaign tracking. When enabled, `utm_*` query params on provisioning requests are stored in the control-plane DB. Requires the `tenant_utm` table to exist |

#### Embedding And Ingest

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_EMBED_AUTO_MODEL` | No | — | TiDB/db9 `EMBED_TEXT()` model name. When set, it takes precedence over client-side embeddings |
| `MNEMO_EMBED_AUTO_DIMS` | No | `1024` | Vector dimensions for `MNEMO_EMBED_AUTO_MODEL` |
| `MNEMO_EMBED_API_KEY` | No | — | Client-side embedding provider API key. Optional for local OpenAI-compatible endpoints when `MNEMO_EMBED_BASE_URL` is set |
| `MNEMO_EMBED_BASE_URL` | No | `https://api.openai.com/v1` when client-side embeddings are enabled | Custom OpenAI-compatible embedding endpoint |
| `MNEMO_EMBED_MODEL` | No | `text-embedding-3-small` | Client-side embedding model name |
| `MNEMO_EMBED_DIMS` | No | `1536` | Client-side embedding vector dimensions |
| `MNEMO_LLM_API_KEY` | No | — | LLM provider API key. If unset, smart ingest falls back to raw ingest behavior |
| `MNEMO_LLM_BASE_URL` | No | `https://api.openai.com/v1` when LLM ingest is enabled | Custom OpenAI-compatible chat endpoint |
| `MNEMO_LLM_MODEL` | No | `gpt-4o-mini` | LLM model for smart ingest |
| `MNEMO_LLM_TEMPERATURE` | No | `0.1` | LLM temperature for smart ingest |
| `MNEMO_INGEST_MODE` | No | `smart` | Ingest mode: `smart` or `raw` |
| `MNEMO_FTS_ENABLED` | No | `false` | Enable TiDB full-text search path. Only set this on clusters that support TiDB FTS |

#### Search Source Turns

The `MEM9_SOURCE_TURN_*` variables control how many source turn conversations are attached to search results as contextual decorations.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEM9_SOURCE_TURN_MIN_SCORE` | No | `2` | Minimum term-frequency relevance score for a source turn to be included in search result decorations |
| `MEM9_SOURCE_TURN_PER_MEMORY_LIMIT` | No | `2` | Maximum source turns attached to a single memory in search results |
| `MEM9_SOURCE_TURN_TOTAL_LIMIT` | No | `12` | Maximum total source turns across all memories in a single search response |

#### Provisioning And Pooling

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_TIDB_ZERO_ENABLED` | No | `true` | Enable TiDB Zero auto-provisioning for `tidb` backend. When enabled, it takes precedence over TiDB Cloud Pool provisioning |
| `MNEMO_TIDB_ZERO_API_URL` | No | `https://zero.tidbapi.com/v1alpha1` | TiDB Zero API base URL |
| `MNEMO_TIDBCLOUD_API_URL` | No | `https://serverless.tidbapi.com` | TiDB Cloud Pool API base URL |
| `MNEMO_TIDBCLOUD_POOL_ID` | No | `2` | TiDB Cloud Pool ID used for cluster takeover |
| `MNEMO_TIDBCLOUD_API_KEY` | No | — | TiDB Cloud Pool API key. Used only when `MNEMO_TIDB_ZERO_ENABLED=false`, `MNEMO_DB_BACKEND=tidb`, and pool takeover is desired |
| `MNEMO_TIDBCLOUD_API_SECRET` | No | — | TiDB Cloud Pool API secret for digest auth. Same conditions as `MNEMO_TIDBCLOUD_API_KEY` |
| `MNEMO_TENANT_POOL_MAX_IDLE` | No | `5` | Max idle tenant database connections kept in the in-process tenant pool |
| `MNEMO_TENANT_POOL_MAX_OPEN` | No | `10` | Max open connections per tenant database handle |
| `MNEMO_TENANT_POOL_CONNECT_TIMEOUT` | No | `3s` | Timeout for tenant pool cold-connect ping/open attempts |
| `MNEMO_TENANT_POOL_IDLE_TIMEOUT` | No | `10m` | Idle timeout for tenant database handles |
| `MNEMO_TENANT_POOL_TOTAL_LIMIT` | No | `200` | Total tenant database handles allowed across the process |
| `MNEMO_CLUSTER_BLACKLIST` | No | — | Comma-separated TiDB cluster IDs whose spend-limit errors should be translated to HTTP 429 instead of 503 |

#### Auto Spend Limit

These variables control automatic spend-limit increases for TiDB Cloud clusters that hit their cap. The feature progressively raises the limit up to `MNEMO_AUTO_SPEND_LIMIT_MAX` with a configurable cooldown between increments.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_AUTO_SPEND_LIMIT_ENABLED` | No | `false` | Enable automatic spend-limit increases for TiDB Cloud clusters. Requires valid `MNEMO_TIDBCLOUD_API_KEY` and `MNEMO_TIDBCLOUD_API_SECRET` |
| `MNEMO_AUTO_SPEND_LIMIT_INCREMENT` | No | `500` | Amount to increase the spend limit by each step (in USD cents: 500 = $5.00) |
| `MNEMO_AUTO_SPEND_LIMIT_MAX` | No | `10000` | Maximum spend limit allowed (in USD cents: 10000 = $100.00). Must be greater than the increment |
| `MNEMO_AUTO_SPEND_LIMIT_COOLDOWN` | No | `1h` | Minimum time between consecutive spend-limit increases for the same cluster |

#### Metering

These are the supported rollout variables for the server-side metering writer. The writer is initialized at server startup, but this round does not wire any `Record()` call sites yet, so no usage events are emitted until caller hooks are added.

The public env surface is intentionally small for now. Metering location is configured as a single destination URL. Supported schemes are:

- `s3://<bucket>/<prefix>/` for compressed JSON batches in S3
- `http://...` or `https://...` for JSON batch webhooks

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_METERING_ENABLED` | No | `false` | Enable the metering writer. When `false`, the writer is a no-op |
| `MNEMO_METERING_URL` | No | — | Metering destination URL. Supported forms: `s3://<bucket>/<prefix>/`, `http://...`, or `https://...`. If empty, the writer stays disabled even when `MNEMO_METERING_ENABLED=true` |
| `MNEMO_METERING_FLUSH_INTERVAL` | No | `10s` | In-memory batch flush interval for the metering writer |

#### Security And Debugging

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_ENCRYPT_TYPE` | No | `plain` | Encryption type for tenant DB passwords: `plain`, `md5`, or `kms`. One-time deployment decision. |
| `MNEMO_ENCRYPT_KEY` | No | — | Encryption key for `md5` or KMS key ID for `kms`. Required when `MNEMO_ENCRYPT_TYPE` is not `plain` |
| `MNEMO_DEBUG_LLM` | No | `false` | Log raw LLM responses for debugging parse errors. Use only in dev/test because responses may contain user data |

#### AWS KMS Environment

These are only relevant when `MNEMO_ENCRYPT_TYPE=kms`. The server uses the AWS SDK default config chain; the common environment-based inputs referenced in code are:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AWS_ACCESS_KEY_ID` | No | — | AWS access key ID for KMS auth when using environment-based AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | No | — | AWS secret access key for KMS auth when using environment-based AWS credentials |
| `AWS_REGION` | No | — | AWS region used to create the KMS client |

#### Test-Only

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_TEST_DSN` | No | Falls back to `MNEMO_DSN` | Integration-test DSN used by server repository tests |

## Repository Map

| Path | Role |
|---|---|
| [`server/`](server/) | Core Go REST API and source of truth for spaces, memories, search, ingest, and tenant provisioning |
| [`cli/`](cli/) | Standalone Go CLI for exercising mem9 API and ingest flows |
| [`openclaw-plugin/`](openclaw-plugin/) | OpenClaw memory plugin |
| [`opencode-plugin/`](opencode-plugin/) | OpenCode plugin |
| [`claude-plugin/`](claude-plugin/) | Claude Code hooks and skills integration |
| [`codex-plugin/`](codex-plugin/) | Codex marketplace plugin and managed hooks |
| [`site/`](site/) | Public mem9.ai site and published onboarding assets |
| [`dashboard/`](dashboard/) | Dashboard product frontend and supporting product docs |
| [`benchmark/`](benchmark/) | Benchmark harnesses and datasets for mem9 evaluation |
| [`e2e/`](e2e/) | Live end-to-end scripts against a running mem9 server |
| [`docs/`](docs/) | Architecture notes, design docs, and feature specs |

## Related Repositories

| Repository | What it owns | When to look there |
|---|---|---|
| [`mem9`](.) | Core Go API server, agent plugins, CLI, site, dashboard frontend, benchmark harnesses, and docs | You are working on the shared memory server, plugin integrations, or the main product docs |
| [`mem9-node`](https://github.com/mem9-ai/mem9-node) | Dashboard analysis backend, async jobs, and worker flows | A dashboard feature depends on backend APIs, background jobs, or analysis pipelines |
| [`mem9-hermes-plugin`](https://github.com/mem9-ai/mem9-hermes-plugin) | Hermes Agent plugin packaging, setup flow, and Hermes-specific docs | You are changing Hermes installation, activation, or runtime-specific behavior |
| [`mem9-dify-plugin`](https://github.com/mem9-ai/mem9-dify-plugin) | Dify tool plugin, memory tools, authorization modes, and Dify-specific docs | You are changing Dify Agent app, Workflow app, or multi-space plugin behavior |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[Apache-2.0](LICENSE)

---

<p align="center">
  <a href="https://tidbcloud.com">
    <img src="assets/tidb-logo.png" alt="TiDB Cloud Starter" height="28" />
  </a>
  <br/>
  <sub>Built on <a href="https://tidbcloud.com">TiDB Cloud Starter</a> for shared memory, vector search, and managed cloud provisioning.</sub>
</p>
