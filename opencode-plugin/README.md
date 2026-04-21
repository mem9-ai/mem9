# OpenCode Plugin for mem9

Persistent memory for [OpenCode](https://opencode.ai).

The package ships two plugin entrypoints:

- a server plugin for recall, auto-ingest, and memory tools
- a TUI plugin for interactive setup inside OpenCode

## Quick Start

### 1. Install the server plugin

Install the server plugin in one scope only.

User scope:

File: `~/.config/opencode/opencode.json`

```json
{
  "plugin": ["@mem9/opencode"]
}
```

Project scope:

File: `<project>/.opencode/opencode.json`

```json
{
  "plugin": ["@mem9/opencode"]
}
```

Recommended pattern:

- install the server plugin once at user scope
- keep project-specific behavior in `<project>/.opencode/mem9.json`

Avoid duplicate plugin loading, such as:

- user scope plugin plus project scope plugin
- npm plugin plus local file plugin

### 2. Install the TUI plugin for `/mem9-setup`

File: `~/.config/opencode/tui.json`

```json
{
  "plugin": ["@mem9/opencode"]
}
```

That enables the `/mem9-setup` command inside OpenCode.

### 3. Restart OpenCode and run `/mem9-setup`

`/mem9-setup` is the single entrypoint for both:

- shared mem9 credentials
- OpenCode user/project mem9 settings

When no usable profile exists, it shows two actions:

- `Get a mem9 API key automatically`
- `Add an existing mem9 API key`

When usable profiles already exist, it shows four actions:

- `Get a mem9 API key automatically`
- `Add an existing mem9 API key`
- `Use an existing mem9 profile in a scope`
- `Configure user/project settings`

Profile creation ends after the profile is saved. Scope configuration is a separate action.

## File Layout

OpenCode config directory:

- macOS/Linux: usually `~/.config/opencode`
- Windows: usually `%APPDATA%\\opencode`

OpenCode state directory:

- macOS/Linux: usually `~/.local/share/opencode`
- Windows: usually `%LOCALAPPDATA%\\opencode`

mem9 uses these files:

- server plugin list: `~/.config/opencode/opencode.json` or `<project>/.opencode/opencode.json`
- TUI plugin list: `~/.config/opencode/tui.json`
- shared credentials: `$MEM9_HOME/.credentials.json`
- user mem9 config: `<OpenCode config dir>/mem9.json`
- project mem9 config: `<project>/.opencode/mem9.json`
- debug logs: `<OpenCode state dir>/plugins/mem9/log/YYYY-MM-DD.jsonl`

`MEM9_HOME` defaults to `$HOME/.mem9`.

## Credentials File

Shared credentials live in:

```text
$MEM9_HOME/.credentials.json
```

Example:

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

`profiles` stores credentials only.

## OpenCode mem9 Config

User and project mem9 config use the same schema:

```json
{
  "schemaVersion": 1,
  "profileId": "default",
  "debug": false,
  "defaultTimeoutMs": 8000,
  "searchTimeoutMs": 15000
}
```

Field meanings:

- `profileId`: which shared profile this scope should use
- `debug`: enable redacted JSONL debug logs
- `defaultTimeoutMs`: request timeout for normal mem9 calls
- `searchTimeoutMs`: request timeout for recall search

Project config overrides user config for the current repository.

## Runtime Overrides

These environment variables still override disk config at runtime:

- `MEM9_API_KEY`
- `MEM9_API_URL`
- `MEM9_HOME`

Legacy compatibility remains:

- `MEM9_TENANT_ID`

`MEM9_TENANT_ID` is treated as the API key source for older setups.

## Local Development Install

You can also point OpenCode at a local checkout.

Server plugin example:

```json
{
  "plugin": ["./.opencode/plugins/mem9/src/index.ts"]
}
```

TUI plugin example:

```json
{
  "plugin": ["./.opencode/plugins/mem9/src/tui/index.ts"]
}
```

Keep the same one-scope rule for the server plugin even when using local paths.

## What the Plugin Does

The server plugin does three things:

- recalls relevant mem9 memories before each chat turn
- exposes mem9 memory tools inside OpenCode
- starts best-effort background smart ingest when the session becomes idle and when compaction begins

### Hook Flow

OpenCode integration currently uses four runtime hooks:

| Hook | What mem9 does |
| --- | --- |
| `chat.message` | Captures the latest real user prompt and updates in-memory session state. |
| `experimental.chat.system.transform` | Searches mem9 with the captured prompt and injects a `<relevant-memories>` block. |
| `event` with `session.idle` | Starts a best-effort background smart-ingest pass for the recent transcript window. |
| `experimental.session.compacting` | Pushes a compaction hint and starts another best-effort background smart-ingest pass. |

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

## Troubleshooting

- `Setup pending` means the plugin could not find a usable runtime identity. Run `/mem9-setup`, add `MEM9_API_KEY`, or point the active `mem9.json` scope at a profile with a non-empty `apiKey`.
- If `/mem9-setup` is missing, confirm `@mem9/opencode` is listed in `~/.config/opencode/tui.json`.
- If recall or tools work in one project and not another, check whether the project has its own `.opencode/mem9.json` override.
- If recall, auto-ingest, or debug logs appear to run twice, check for duplicate plugin registration across user scope, project scope, npm, or local file paths.
- If the selected profile exists but has no `apiKey`, update that profile in `$MEM9_HOME/.credentials.json`.
- If debug logging is enabled and no file appears, confirm OpenCode can write to its state directory.

## Local Verification

```bash
pnpm test
pnpm run typecheck
pnpm run pack:check
```

## Publish Surface

The npm package publishes:

- `package.json`
- `README.md`
- runtime source files under `src/`

The package keeps `files: ["src", "README.md"]` in `package.json`. Tests live under `test/`, so the published tarball only carries runtime code.
