# OpenCode Plugin for mem9

Persistent memory for [OpenCode](https://opencode.ai).

The package ships two plugin entrypoints:

- a server plugin for recall, auto-ingest, and memory tools
- a TUI plugin for interactive setup inside OpenCode

The server plugin does three things:

- recalls relevant mem9 memories before each chat turn
- exposes mem9 memory tools inside OpenCode
- starts best-effort background smart ingest when the session becomes idle and when compaction begins

## Enable

Add `@mem9/opencode` to your OpenCode plugin list, then restart OpenCode.

Register the server plugin in one scope only. The recommended pattern is:

- register the plugin once at user scope
- use project-level `.opencode/mem9.json` only when a project needs a different `profileId`, `debug`, or timeout setting

Avoid loading the same plugin from multiple places at once, such as:

- user scope plugin plus project scope plugin
- npm plugin plus local file plugin

```json
{
  "plugin": ["@mem9/opencode"]
}
```

To enable the interactive setup command, add the same package to your TUI plugin list:

```json
{
  "plugin": ["@mem9/opencode"]
}
```

That entry belongs in `~/.config/opencode/tui.json`.

## Config Model

Shared credentials live here:

```text
$MEM9_HOME/.credentials.json
```

`MEM9_HOME` defaults to `$HOME/.mem9`.

OpenCode config stays scope-local:

```text
user config:    <OpenCode config dir>/mem9.json
project config: <project>/.opencode/mem9.json
```

OpenCode debug logs stay in the OpenCode state directory:

```text
<OpenCode state dir>/plugins/mem9/log/YYYY-MM-DD.jsonl
```

That split keeps secrets shareable across tools while keeping OpenCode-specific config and logs in OpenCode-managed locations.

## Credentials File

`$MEM9_HOME/.credentials.json`

```json
{
  "schemaVersion": 1,
  "profiles": {
    "default": {
      "label": "Personal",
      "baseUrl": "https://api.mem9.ai",
      "apiKey": "..."
    }
  }
}
```

## OpenCode Config

User and project config use the same schema.

```json
{
  "schemaVersion": 1,
  "profileId": "default",
  "debug": false,
  "defaultTimeoutMs": 8000,
  "searchTimeoutMs": 15000
}
```

Project config overrides user config for the current repository.

## Runtime Overrides

These environment variables still override disk config at runtime:

- `MEM9_API_KEY`
- `MEM9_API_URL`
- `MEM9_HOME`

Legacy compatibility remains:

- `MEM9_TENANT_ID`

`MEM9_TENANT_ID` is treated as the API key source for older setups.

## Behavior

### Hook flow

OpenCode integration currently uses four runtime hooks:

| Hook | What mem9 does |
| --- | --- |
| `chat.message` | Captures the latest real user prompt and updates in-memory session state. |
| `experimental.chat.system.transform` | Searches mem9 with the captured prompt and injects a `<relevant-memories>` block. |
| `event` with `session.idle` | Starts a best-effort background smart-ingest pass for the recent transcript window. |
| `experimental.session.compacting` | Pushes a compaction hint and starts another best-effort background smart-ingest pass. |

### TUI setup

When the TUI plugin is active, OpenCode registers:

- `/mem9-setup`

That command is the single setup entrypoint for both shared mem9 identity and OpenCode scope config.

Profile actions use shared credentials in:

- `$MEM9_HOME/.credentials.json`

Scope settings use:

- user config: `<OpenCode config dir>/mem9.json`
- project config: `<project>/.opencode/mem9.json`

When no usable profile exists, the command offers two actions:

- `Get a mem9 API key automatically`
- `Add an existing mem9 API key`

Both actions save a shared profile and set it as the default user profile for OpenCode, then stop there.

When usable profiles already exist, the command offers four actions:

- `Get a mem9 API key automatically`
- `Add an existing mem9 API key`
- `Use an existing mem9 profile in a scope`
- `Configure user/project settings`

The scope actions are separate from API key management:

- `Use an existing mem9 profile in a scope` asks for `user` or `project`, then writes the selected `profileId` into that scope while preserving the current debug and timeout settings.
- `Configure user/project settings` asks for `user` or `project`, then lets you edit `profileId`, `debug`, `defaultTimeoutMs`, and `searchTimeoutMs`.

If you enter a profile ID that already has working credentials, setup asks you to pick a new profile ID or use the existing profile from a scope action.

If automatic API key creation fails, the command stops and asks you to run `/mem9-setup` again later.

The current OpenCode dialog prompt is plain text. The API key stays visible while you type it.

### Recall

The plugin captures the latest real user prompt from `chat.message`, cleans it, bounds it, and injects a formatted recall block during `experimental.chat.system.transform`.

### Auto-ingest

The plugin ingests from two points:

- `session.idle`
- `experimental.session.compacting`

Both paths fetch up to 24 recent session messages, keep real text-only `user` and `assistant` turns, strip injected memory blocks, and upload the last 12 cleaned messages in the background.

Identical transcripts are deduped per in-memory session state, so a matching idle ingest and compaction ingest share one upload while that session state stays warm.

Two timing details matter:

- hook completion happens before the background upload finishes
- the dedupe window is in-memory and TTL-bound to about 15 minutes, so restart or cache expiry can upload the same transcript again

### Tools

The plugin registers these tools:

- `memory_store`
- `memory_search`
- `memory_get`
- `memory_update`
- `memory_delete`

## Debug Logging

Set `debug: true` in the selected scope config when you want JSONL debug logs.

Debug payloads are redacted before they are written. The logger masks obvious secret forms in structured fields and free-form strings, including mem9 keys, bearer tokens, and common provider-style API key prefixes.

## Troubleshooting

- `Setup pending` means the plugin could not find a usable runtime identity. Run `/mem9-setup`, add `MEM9_API_KEY`, or point `profileId` at a profile with a non-empty `apiKey`.
- If the selected profile exists but has no `apiKey`, update that profile in `$MEM9_HOME/.credentials.json`.
- If recall or tools work in one project and not another, check whether the project has its own `.opencode/mem9.json` override.
- If recall, auto-ingest, or debug logs appear to run twice, check for duplicate plugin registration across user scope, project scope, npm, or local plugin paths. Keep one active plugin entry.
- If `/mem9-setup` is missing, confirm `@mem9/opencode` is also listed in `~/.config/opencode/tui.json`.
- If debug logging is enabled and no file appears, confirm OpenCode can write to its state directory.

## Local Verification

```bash
pnpm test
pnpm run typecheck
```

## Publish Surface

The npm package publishes:

- `package.json`
- `README.md`
- runtime source files under `src/`

The package keeps `files: ["src", "README.md"]` in `package.json`. Tests live under `test/`, so the published tarball only carries runtime code.

Check the final tarball contents before release:

```bash
pnpm run pack:check
```
