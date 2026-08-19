# @mem9/dsh-plugin

Persistent Mem9 memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). This package is an installable DSH/Cordis bundle. It adds automatic recall, background smart ingest, and five model-facing memory tools without changing the Harness agent loop or session format.

## Install

```bash
export MEM9_API_KEY="<mem9-api-key>"
dsh plugin --profile <profile> add @mem9/dsh-plugin
dsh --profile <profile> --dump-config
```

Before the package is published to npm, install from a local checkout:

```bash
dsh plugin --profile <profile> add ./dsh-plugin
```

The bundle inserts one Cordis row named `mem9`. Override its complete `config` object in the profile's `cordis.patch.yml` when non-default settings are required.

## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `apiUrl` | `https://api.mem9.ai` | Hosted or self-hosted Mem9 origin |
| `apiKeyEnv` | `MEM9_API_KEY` | Credential reference resolved through `ctx.credentials` for every operation |
| `agentId` | `deepseek-harness` | `X-Mnemo-Agent-Id` request header and smart-ingest agent id |
| `defaultTimeoutMs` | `8000` | Store/get/update/delete/ingest timeout |
| `searchTimeoutMs` | `15000` | Search and automatic recall timeout |
| `includeSubagents` | `false` | Give subagents tools, recall, and ingest when enabled |
| `recall.enabled` | `true` | Search before the first model step of each user turn |
| `recall.minQueryChars` | `5` | Skip shorter user text |
| `recall.limit` | `10` | Maximum recalled memories |
| `recall.maxCharsPerMemory` | `500` | Per-memory prompt bound |
| `ingest.enabled` | `true` | Submit completed turns with `mode: smart` |
| `ingest.maxMessages` | `20` | Maximum user/assistant messages per ingest |
| `ingest.maxBytes` | `204800` | UTF-8 content budget per ingest |

Example profile override:

```yaml
- id: mem9
  name: '@mem9/dsh-plugin'
  config:
    apiKeyEnv: MEM9_API_KEY
    apiUrl: https://api.mem9.ai
    includeSubagents: false
    recall:
      enabled: true
      minQueryChars: 5
      limit: 10
      maxCharsPerMemory: 500
    ingest:
      enabled: true
      maxMessages: 20
      maxBytes: 204800
```

## Behavior

Recall runs at `agent/pre-step` for the first real user step. Results enter the ordinary session log as a plugin-sourced `user/message` with `form: recall`, so the model input is replayable without this package installed. Recalled text is explicitly labeled as untrusted historical context.

Smart ingest starts after a completed `turn/end`, selects only real user and assistant text, and never blocks turn completion. Work is serialized per session and drained with the plugin during shutdown. Automatic HTTP failures are fail-soft. A Mem9 runtime-quota denial adds at most one durable notice per session.

The model-facing tools are:

- `memory_store`
- `memory_search`
- `memory_get`
- `memory_update`
- `memory_delete`

Tools return structured JSON values. Expected API failures are returned as `{ "ok": false, ... }`; quota errors preserve their safe action metadata. API keys are resolved per operation and never enter configuration output, session events, or tool errors.

By default, only top-level agents receive Mem9 registrations. Set `includeSubagents: true` to enable the same tools and automatic paths for subagents.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm pack:check
pnpm test:e2e       # skips unless MEM9_API_KEY is set
```

The test suite exercises public Cordis, agent, session, tool, credential, HTTP, and package seams. Live E2E should use a dedicated test Space; it creates uniquely tagged data and deletes it in cleanup.
