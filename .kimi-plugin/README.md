# mem9 for Kimi Code

Persistent cloud memory for [Kimi Code](https://github.com/MoonshotAI/kimi-code) sessions: relevant memories are recalled on every prompt, and conversation turns are uploaded to mem9 automatically.

## Install

```
/plugins install https://github.com/mem9-ai/mem9
/reload
```

On the first session the plugin provisions an API key into the shared credentials file `${MEM9_HOME:-~/.mem9}/.credentials.json` (shared with the other mem9 integrations; `MEM9_API_KEY`/`MEM9_API_URL` environment variables override it).

## How it works

| Hook | What it does |
| --- | --- |
| `SessionStart` | Provisions an API key if none exists (silent — Kimi discards this hook's stdout). |
| `UserPromptSubmit` | Recalls relevant memories and prints them as plain text, which Kimi injects into the model context. |
| `Stop` / `PreCompact` / `SessionEnd` | Uploads the recent conversation window, parsed from the session's `wire.jsonl` (located via `session_index.jsonl`). |

All hooks fail open: errors never block the session. Set `MEM9_DEBUG=1` to log hook activity to `${KIMI_CODE_HOME:-~/.kimi-code}/mem9/hooks.log`.

## Skills

- `mem9-setup` — initialize, repair, or diagnose the connection.
- `mem9-recall` — manually search memories for the current question.
- `mem9-store` — explicitly save one fact, preference, or instruction.
- `using-mem9` — loaded automatically at session start; explains the integration.

## API surface

- Provision: `POST <base>/v1alpha1/mem9s` → `{"id": "<api-key>"}`
- Recall: `GET <base>/v1alpha2/mem9s/memories?q=<query>&limit=10`
- Ingest/store: `POST <base>/v1alpha2/mem9s/memories`
- Headers: `X-API-Key`, `X-Mnemo-Agent-Id: kimi-code` (ingest body `agent_id: kimi-code-main`).

## Development

```bash
for f in hooks/*.sh; do bash -n "$f"; done
for f in hooks/lib/*.mjs; do node --check "$f"; done
bash hooks/smoke.test.sh
```
