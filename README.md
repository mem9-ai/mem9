<p align="center">
  <img src="site/public/mem9-wordmark-square.svg" alt="mem9" width="180" />
</p>
<p align="center">
  <strong>Persistent Memory for AI Agents.</strong><br/>
  Your agents forget everything between sessions. mem9 fixes that with persistent memory across sessions and machines, shared memory for multi-agent workflows, and hybrid recall with a visual dashboard.
</p>

<p align="center">
  For OpenClaw and ClawHub installs, start here: <a href="https://mem9.ai/openclaw-memory">mem9.ai/openclaw-memory</a>
</p>

<p align="center">
  <a href="https://tidbcloud.com"><img src="https://img.shields.io/badge/Powered%20by-TiDB%20Cloud%20Starter-E60C0C?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIj48cGF0aCBkPSJNMTEuOTk4NCAxLjk5OTAyTDMuNzE4NzUgNy40OTkwMkwzLjcxODc1IDE3TDExLjk5NjQgMjIuNUwyMC4yODE0IDE3VjcuNDk5MDJMMTEuOTk4NCAxLjk5OTAyWiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=" alt="Powered by TiDB Cloud Starter"></a>
  <a href="https://goreportcard.com/report/github.com/mem9-ai/mem9/server"><img src="https://goreportcard.com/badge/github.com/mem9-ai/mem9/server" alt="Go Report Card"></a>
  <a href="https://github.com/mem9-ai/mem9/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <a href="https://github.com/mem9-ai/mem9"><img src="https://img.shields.io/github/stars/mem9-ai/mem9?style=social" alt="Stars"></a>
</p>

---

## 🚀 Quick Start

**Server-based memory via mem9-server.**

1. **Deploy mnemo-server.**

    ```bash
    cd server && MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" go run ./cmd/mnemo-server
    ```

2. **Install the plugin for your agent (pick one).**

    | Platform | Install |
    |----------|---------|
    | **Claude Code** | `/plugin marketplace add mem9-ai/mem9` then `/plugin install mem9@mem9` |
    | **OpenCode** | Add `"plugin": ["@mem9/opencode"]` to `opencode.json` |
    | **OpenClaw** | Add `mnemo` to `openclaw.json` plugins (see [openclaw-plugin/README](openclaw-plugin/README.md)) |

3. **Provision a tenant and set credentials.**

    ```bash
    curl -s -X POST localhost:8080/v1alpha1/mem9s
    # → {"id":"..."}

    export MEM9_API_URL="http://localhost:8080"
    export MEM9_API_KEY="..."
    ```

    All agents pointing at the same tenant ID share one memory pool.

---

## The Problem

AI coding agents — Claude Code, OpenCode, OpenClaw, and others — often maintain separate local memory files. As a result:

- 🧠 **Amnesia** — Agents forget everything when a session ends
- 🏝️ **Silos** — One agent can't access what another learned yesterday
- 📁 **Local files** — Memory is tied to a single machine, lost when you switch devices
- 🚫 **No team sharing** — Your teammate's agent can't benefit from your agent's discoveries

**mnemos** gives every agent a shared, cloud-persistent memory with hybrid vector + keyword search — powered by [TiDB Cloud Starter](https://tidbcloud.com).

## Why TiDB Cloud Starter?

mnemos uses [TiDB Cloud Starter](https://tidbcloud.com) (formerly TiDB Cloud Serverless) as the backing store for mnemo-server:

| Feature | What it means for you |
|---|---|
| **Free tier** | 25 GiB storage, 250M Request Units/month — enough for most individual and small team use |
| **TiDB Cloud Zero** | Instant database provisioning via API — no signup required for first 30 days |
| **Native VECTOR type** | Hybrid search (vector + keyword) without a separate vector database |
| **Auto-embedding (`EMBED_TEXT`)** | TiDB generates embeddings server-side — no OpenAI key needed for semantic search |
| **Zero ops** | No servers to manage, no scaling to worry about, automatic backups |
| **MySQL compatible** | Migrate to self-hosted TiDB or MySQL anytime |

This architecture keeps agent plugins **stateless** — all state lives in mnemo-server, backed by TiDB.

## Supported Agents

mnemos provides native plugins for major AI coding agent platforms:

| Platform | Plugin | How It Works | Install Guide |
|---|---|---|---|
| **Claude Code** | Hooks + Skills | Auto-loads memories on session start, auto-saves on stop | [`claude-plugin/README.md`](claude-plugin/README.md) |
| **OpenCode** | Plugin SDK | `system.transform` injects memories, `session.idle` auto-captures | [`opencode-plugin/README.md`](opencode-plugin/README.md) |
| **OpenClaw** | Memory Plugin | Replaces built-in memory slot (`kind: "memory"`), framework manages lifecycle | [`openclaw-plugin/README.md`](openclaw-plugin/README.md) |
| **Any HTTP client** | REST API | `curl` to mnemo-server | [API Reference](#api-reference) |

All plugins expose the same 5 tools: `memory_store`, `memory_search`, `memory_get`, `memory_update`, `memory_delete`.

> [!NOTE]
>
> **🤖 For AI Agents**: Use the [Quick Start](#-quick-start) above to deploy mnemo-server and provision an API key, then follow the platform-specific README for configuration details.

## Stateless Agents, Cloud Memory

A key design principle: **agent plugins carry zero state.** All memory lives in mnemo-server, backed by TiDB/MySQL. This means:

- **Agent plugins stay stateless** — deploy any number of agent instances freely; they all share the same memory pool via mnemo-server
- **Switch machines freely** — your agent's memory follows you, not your laptop
- **Multi-agent collaboration** — Claude Code, OpenCode, OpenClaw, and any HTTP client share memories when pointed at the same server
- **Centralized control** — rate limits and audit live in one place

## Related Repositories

The broader mem9 product surface is split across a few repositories and workstreams:

| Repo / Name | Where | What it owns |
|---|---|---|
| `mem9` | current repo | Core Go memory API, agent plugins, CLI, website, docs site, dashboard frontend, benchmark harnesses |
| `mem9-node` | sibling repo, commonly `../mem9-node` | Node/Nest backend for dashboard analysis workflows, async jobs, and workers |
| `mem9-benchmark` | benchmark-focused repo / workstream name you may hear internally | Benchmark-heavy evaluation work; the benchmark harnesses that currently ship with `mem9` live under [`benchmark/`](benchmark/) in this repo |
| `mem9-tester` | private repo, often checked out as `../mem9-tester` | Automated OpenClaw install / verification harness for `SKILL.md` flows, smoke tests, and artifact capture |

Notes:

- [`dashboard/app/`](dashboard/app/) in this repo is the frontend half of the dashboard product. The backend half for async analysis lives in `mem9-node`, especially its `apps/api` and `apps/worker`.
- `mem9-tester` is not part of the production runtime. It exists to validate installation / reconnect behavior and reduce fragile manual testing.
- If someone says `mem9-benchmark`, they usually mean the benchmark work around mem9 evaluation. In this repo, that work currently starts in [`benchmark/`](benchmark/).

## API Reference

Agent identity: `X-Mnemo-Agent-Id` header.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1alpha1/mem9s` | Provision tenant (no auth). Returns `{ "id" }`. |
| `POST` | `/v1alpha1/mem9s/{tenantID}/memories` | Legacy unified write endpoint. Tenant key travels in the URL path. |
| `GET` | `/v1alpha1/mem9s/{tenantID}/memories` | Legacy search endpoint for `tenantID`-configured clients. |
| `GET` | `/v1alpha1/mem9s/{tenantID}/memories/:id` | Legacy get-by-id endpoint. |
| `PUT` | `/v1alpha1/mem9s/{tenantID}/memories/:id` | Legacy update endpoint. Optional `If-Match` for version check. |
| `DELETE` | `/v1alpha1/mem9s/{tenantID}/memories/:id` | Legacy delete endpoint. |
| `POST` | `/v1alpha2/mem9s/memories` | Preferred unified write endpoint. Requires `X-API-Key` header. |
| `GET` | `/v1alpha2/mem9s/memories` | Preferred search endpoint. Requires `X-API-Key` header. |
| `GET` | `/v1alpha2/mem9s/memories/:id` | Preferred get-by-id endpoint. Requires `X-API-Key` header. |
| `PUT` | `/v1alpha2/mem9s/memories/:id` | Preferred update endpoint. Requires `X-API-Key` header. |
| `DELETE` | `/v1alpha2/mem9s/memories/:id` | Preferred delete endpoint. Requires `X-API-Key` header. |

## Self-Hosting

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
| `MNEMO_TENANT_POOL_IDLE_TIMEOUT` | No | `10m` | Idle timeout for tenant database handles |
| `MNEMO_TENANT_POOL_TOTAL_LIMIT` | No | `200` | Total tenant database handles allowed across the process |
| `MNEMO_CLUSTER_BLACKLIST` | No | — | Comma-separated TiDB cluster IDs whose spend-limit errors should be translated to HTTP 429 instead of 503 |

#### Security And Debugging

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_ENCRYPT_TYPE` | No | `plain` | Encryption type for tenant DB passwords: `plain`, `md5`, or `kms`. ⚠️ **One-time deployment decision — cannot be changed without re-provisioning all tenants.** |
| `MNEMO_ENCRYPT_KEY` | No | — | Encryption key (for `md5`) or KMS key ID (for `kms`). Required when `MNEMO_ENCRYPT_TYPE` is not `plain`. |
| `MNEMO_DEBUG_LLM` | No | `false` | Log raw LLM responses for debugging parse errors. ⚠️ **Dev/test only — responses may contain user data.** |

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

### Build & Run

```bash
make build
cd server
MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" ./bin/mnemo-server
```

### Docker

```bash
docker build -t mnemo-server ./server
docker run -e MNEMO_DSN="..." -p 8080:8080 mnemo-server
```

## Repository Map

| Path | Role |
|---|---|
| [`server/`](server/) | Core Go REST API and source of truth for spaces, memories, search, ingest, and tenant provisioning |
| [`cli/`](cli/) | Standalone Go CLI for exercising the mem9 API and import / ingest flows |
| [`openclaw-plugin/`](openclaw-plugin/) | OpenClaw memory plugin |
| [`opencode-plugin/`](opencode-plugin/) | OpenCode plugin |
| [`claude-plugin/`](claude-plugin/) | Claude Code hooks + skills integration |
| [`site/`](site/) | Public mem9.ai site. This includes the marketing site, docs page, and published onboarding documents like `site/public/SKILL.md` and `site/public/beta/SKILL.md` |
| [`dashboard/`](dashboard/) | Dedicated home for dashboard work: product docs plus the frontend app |
| [`dashboard/app/`](dashboard/app/) | `Your Memory` frontend SPA served under `/your-memory` |
| [`dashboard/app/src/pages/connect.tsx`](dashboard/app/src/pages/connect.tsx) | Dashboard connect / onboarding page |
| [`dashboard/app/src/pages/space.tsx`](dashboard/app/src/pages/space.tsx) | Main `Your Memory` page for browsing, filtering, importing, exporting, and analyzing memories |
| [`dashboard/app/src/pages/pixel-farm.tsx`](dashboard/app/src/pages/pixel-farm.tsx) | `Memory Farm`, the lab-style interactive memory experience exposed at `/your-memory/labs/memory-farm` |
| [`dashboard/app/src/pages/pixel-farm-editor.tsx`](dashboard/app/src/pages/pixel-farm-editor.tsx) | Dev-only editor for Memory Farm world / mask work |
| [`dashboard/app/src/lib/pixel-farm/`](dashboard/app/src/lib/pixel-farm/) | Memory Farm world generation, memory-to-world transforms, rendering, tiles, and runtime logic |
| [`dashboard/app/src/components/pixel-farm/`](dashboard/app/src/components/pixel-farm/) | Memory Farm UI components |
| [`dashboard/docs/`](dashboard/docs/) | Dashboard product specs, information architecture, data contract, and implementation plans |
| [`benchmark/`](benchmark/) | Benchmark harnesses and datasets for comparing OpenClaw native memory against mem9, including MR-NIAH and LoCoMo adapters |
| [`e2e/`](e2e/) | Live end-to-end scripts against a running mem9 server |
| [`docs/`](docs/) | Architecture notes, design docs, and feature / experiment specs |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | Feature-level specs and experiments, including Pixel / Memory Farm design work |
| [`skills/`](skills/) | Shared setup / onboarding skills |

## Roadmap

| Phase | What | Status |
|-------|------|--------|
| **Phase 1** | Core server + CRUD + auth + hybrid search + upsert + plugins | ✅ Done |
| **Phase 3** | LLM-assisted conflict merge, auto-tagging | 🔜 Planned |
| **Phase 4** | Web dashboard, bulk import/export, CLI wizard | 📋 Planned |

Vector Clock CRDT was deferred and removed from the roadmap.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[Apache-2.0](LICENSE)

---

<p align="center">
  <a href="https://tidbcloud.com"><img src="assets/tidb-logo.png" alt="TiDB Starter" height="36" /></a>
  <br/>
  <sub>Built with <a href="https://tidbcloud.com">TiDB Starter</a> — zero-ops database with native vector search.</sub>
</p>
