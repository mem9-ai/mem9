---
title: kimi-plugin — Kimi Code hooks and skills
---

## Overview

Kimi Code integration uses bash hooks plus Node.js `.mjs` helpers and four skills. Hook scripts are small and deterministic; shared HTTP helpers live in `hooks/common.sh`. The plugin auto-provisions credentials on session start, recalls memories on each user prompt, and uploads structured conversation turns parsed from the Kimi wire log.

## Where to look

| Task | File |
|------|------|
| Plugin manifest | `kimi.plugin.json` |
| Shared curl/env helpers | `hooks/common.sh` |
| Session-start bootstrap | `hooks/session-start.sh` |
| Prompt-time recall | `hooks/user-prompt-submit.sh` |
| Session stop capture | `hooks/stop.sh` |
| Pre-compact capture | `hooks/pre-compact.sh` |
| Session-end fallback | `hooks/session-end.sh` |
| Hook JSON helper | `hooks/lib/hook-json.mjs` |
| Memory block formatter | `hooks/lib/memories-formatter.mjs` |
| Runtime-state notice helper | `hooks/lib/runtime-state.mjs` |
| Runtime notice state | `hooks/lib/runtime-notice-state.mjs` |
| Quota-denial notice helper | `hooks/lib/quota-error.mjs` |
| Wire-log parser | `hooks/lib/wire-parser.mjs` |
| On-demand setup | `skills/setup/SKILL.md` |
| On-demand recall | `skills/recall/SKILL.md` |
| On-demand store | `skills/store/SKILL.md` |
| Session-start skill | `skills/using-mem9/SKILL.md` |

## Local conventions

- Every hook sources `hooks/common.sh` and starts with `set -euo pipefail`.
- JSON shaping goes through the `.mjs` helpers under `hooks/lib/` — Node.js 18+ stdlib only, never `jq` or Python.
- Automatic recall and ingest go through `/v1alpha2/mem9s/...` with `X-API-Key` and `X-Mnemo-Agent-Id`.
- Shared credentials live at `${MEM9_HOME:-$HOME/.mem9}/.credentials.json`, shared with the Codex integration; upserts merge and never clobber other profiles.
- Kimi-side state lives under `${KIMI_CODE_HOME:-$HOME/.kimi-code}/mem9/` (logs, `runtime-notices.json`).
- `X-Mnemo-Agent-Id` defaults to `kimi-code` (`MEM9_WRITER_ID`); ingest body `agent_id` defaults to `kimi-code-main` (`MEM9_AGENT_ID`).
- `User-Agent` is `mem9-plugin/kimi-code/<version>` with the version read from `kimi.plugin.json`.
- Keep curl timeouts explicit (`--max-time 8`).

## Validation

- Validate hook scripts with `for f in hooks/*.sh; do bash -n "$f"; done` and JavaScript helpers with `for f in hooks/lib/*.mjs; do node --check "$f"; done` (plain multi-file globs only check the first file).
- Run the network-free integration smoke test with `bash hooks/smoke.test.sh` (stubs curl via `MEM9_CURL_BIN`; exits non-zero on any failure).
- `tsconfig.json` exists for editor type-checking only (requires `@types/node`, not installed in this repo); CI does not run `tsc`.
- Validate the manifest with `node -e 'JSON.parse(require("fs").readFileSync("kimi.plugin.json", "utf8"))'`.

## Anti-patterns

- Hooks run from the managed copy under `plugins/managed/<id>/` — never write state into `$KIMI_PLUGIN_ROOT`; write under `$KIMI_CODE_HOME/mem9/` instead. Read-only access to `$KIMI_PLUGIN_ROOT` is fine.
- Only `UserPromptSubmit` stdout reaches the model — keep `SessionStart` / `Stop` / `PreCompact` / `SessionEnd` stdout empty.
- Do NOT emit Claude's `{"hookSpecificOutput":{"additionalContext":...}}` envelope — Kimi ignores it; print raw text instead.
- Do NOT store API keys in Kimi-side or repo-local config files; they live only in `$MEM9_HOME/.credentials.json`.
- Do NOT add complex state to hooks.
- Do NOT add npm dependencies; Node.js 18+ stdlib only.
- Do NOT use `jq` or Python in hooks.
