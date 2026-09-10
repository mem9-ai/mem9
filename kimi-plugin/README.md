# Mem9 Kimi Code Plugin

Persistent cloud memory for Kimi Code.

## Install

Install from inside Kimi Code, then reload:

```text
/plugins install <path-or-github-url>
/reload
```

After installation, start a new Kimi Code session. Mem9 will initialize automatically on `SessionStart`.

## Prerequisites

- Kimi Code with plugin and hook support
- `Node.js 18+`
- Network access to `https://api.mem9.ai`

## Auth Model

The plugin stores shared mem9 credentials in:

```text
${MEM9_HOME:-~/.mem9}/.credentials.json
```

This file is shared with the Codex integration, so a profile created by either plugin works in both. The plugin upserts its profile and never clobbers other profiles in the file. API keys live only here — never in Kimi-side config files.

The `default` profile is auto-provisioned on `SessionStart` when no usable credentials exist. Provisioning is silent: no stdout, no key printed back.

The stored JSON looks like this:

```json
{
  "schemaVersion": 1,
  "profiles": {
    "default": {
      "label": "Kimi Code",
      "baseUrl": "https://api.mem9.ai",
      "apiKey": "generated-api-key"
    }
  }
}
```

Environment overrides take precedence over the credentials file:

- `MEM9_API_KEY` — API key, bypasses the credentials file
- `MEM9_API_URL` — base URL (default `https://api.mem9.ai`)
- `MEM9_HOME` — credentials directory (default `~/.mem9`)

## Hook Flow

```text
SessionStart
  -> check Node.js 18+
  -> auto-provision ~/.mem9/.credentials.json if missing (silent)

UserPromptSubmit
  -> GET /v1alpha2/mem9s/memories?q=...
  -> inject <relevant-memories>...</relevant-memories>

Stop
  -> locate wire.jsonl via session_index.jsonl
  -> upload last turn as messages[]

PreCompact
  -> upload a larger recent window

SessionEnd
  -> upload a small best-effort final window
```

Only `UserPromptSubmit` injects context into the model — it is the only hook whose stdout reaches Kimi. `SessionStart`, `Stop`, `PreCompact`, and `SessionEnd` keep stdout empty and act by side effects only.

`Stop`, `PreCompact`, and `SessionEnd` find the current session's wire log at `<sessionDir>/agents/main/wire.jsonl` by looking up the session in `${KIMI_CODE_HOME}/session_index.jsonl`.

## Data Directory

Kimi-side runtime state lives in:

```text
${KIMI_CODE_HOME:-~/.kimi-code}/mem9/
```

It holds hook debug logs (`logs/hooks.jsonl`, enabled with `MEM9_DEBUG=1`) and runtime notices (`runtime-notices.json`). Installed plugins are managed copies, so the plugin never writes state into its own install directory.

## API Contract

Base URL defaults to `https://api.mem9.ai`. All requests use explicit timeouts.

| Operation | Method and Path | Headers | Notes |
|---|---|---|---|
| Provision | `POST /v1alpha1/mem9s` | none | Returns `{"id": "<api-key>"}` |
| Recall | `GET /v1alpha2/mem9s/memories?q=<prompt>&limit=10` | `X-API-Key`, `X-Mnemo-Agent-Id: kimi-code`, `User-Agent: mem9-plugin/kimi-code/<version>` | No `agent_id` filter — account-wide recall |
| Ingest | `POST /v1alpha2/mem9s/memories` | `X-API-Key`, `X-Mnemo-Agent-Id: kimi-code`, `User-Agent: mem9-plugin/kimi-code/<version>` | Write scope via `agent_id` in the body |
| Runtime state | `GET /v1alpha2/mem9s/runtime-state` | `X-API-Key`, `X-Mnemo-Agent-Id: kimi-code`, `User-Agent: mem9-plugin/kimi-code/<version>` | One-line notices (quota, migrations) |

Recall intentionally omits `agent_id` so every agent bucket in the account (e.g. other plugins) contributes to the result set. Ingest still scopes writes by `agent_id` (see below).

Automatic transcript ingest uses:

```json
POST /v1alpha2/mem9s/memories
{
  "session_id": "kimi-session-id",
  "agent_id": "kimi-code-main",
  "mode": "smart",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

## Skills

The plugin exposes:

- `/skill:mem9-setup`
- `/skill:mem9-recall`
- `/skill:mem9-store`

`/skill:mem9-setup` is the backup path when auto-provisioning did not complete. It writes the `default` profile in `${MEM9_HOME:-~/.mem9}/.credentials.json` without printing the API key back to the user.

A fourth skill, `using-mem9`, is attached to session start and loaded automatically — you do not invoke it by hand.

## Troubleshooting

If memory is not working:

1. Check that `node --version` is `>= 18`.
2. Check that `${MEM9_HOME:-~/.mem9}/.credentials.json` contains a profile with an `apiKey`.
3. Run `/skill:mem9-setup`.
4. Restart Kimi Code (or run `/reload`).

If recall fails, Kimi continues normally. The plugin treats recall as best effort.

If `Stop` / `PreCompact` / `SessionEnd` fail, Kimi still exits normally. The plugin treats ingest as best effort.

## Debug Logs

For real Kimi Code troubleshooting, enable plugin debug logs with:

```bash
export MEM9_DEBUG=1
```

When enabled, the plugin writes JSONL logs to:

```text
${KIMI_CODE_HOME:-~/.kimi-code}/mem9/logs/hooks.jsonl
```

The logs are designed for debugging hook flow without leaking secrets:

- They record hook name, stage, counts, auth source, and failure reason.
- They do not record API keys.
- They do not record full prompts or full transcript message content.
