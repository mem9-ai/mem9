# OpenCode Plugin for mem9

Persistent memory for [OpenCode](https://opencode.ai).

The package ships two plugin entrypoints:

- a server plugin for recall, auto-ingest, and memory tools
- a TUI plugin for interactive setup inside OpenCode

The server plugin does three things:

- recalls relevant mem9 memories before each chat turn
- exposes mem9 memory tools inside OpenCode
- auto-ingests recent `user` / `assistant` turns when the session becomes idle and before compaction

## Enable

Add `@mem9/opencode` to your OpenCode plugin list, then restart OpenCode.

Register the plugin in one scope only. The recommended pattern is:

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

## Scope Config

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

That override model is how you should vary mem9 behavior per project. Keep plugin registration single-scope.

## Runtime Overrides

These environment variables still override disk config at runtime:

- `MEM9_API_KEY`
- `MEM9_API_URL`
- `MEM9_HOME`

Legacy compatibility remains:

- `MEM9_TENANT_ID`

`MEM9_TENANT_ID` is treated as the API key source for older setups.

## Behavior

### TUI setup

When the TUI plugin is active, OpenCode registers:

- `/mem9-init`

That command collects:

- scope: `user` or `project`
- `profileId`
- profile label
- mem9 API URL
- mem9 API key

It writes:

- `$MEM9_HOME/.credentials.json`
- the selected scope `mem9.json`
- the selected scope `opencode.json` plugin entry

The current OpenCode dialog prompt is plain text. The API key stays visible while you type it.

### Recall

The plugin captures the latest real user prompt from `chat.message`, cleans it, bounds it, and injects a formatted recall block during `experimental.chat.system.transform`.

### Auto-ingest

The plugin keeps recall on chat hooks and uses the session event stream plus the compaction hook for ingest. When OpenCode emits `session.idle`, or when compaction is about to start, the plugin loads the recent session transcript, keeps real text-only `user` and `assistant` turns, and sends a smart ingest request in the background.

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

- `Setup pending` means the plugin could not find a usable runtime identity. Add `MEM9_API_KEY`, or set `profileId` in scope config and create the matching profile in `$MEM9_HOME/.credentials.json`.
- If the selected profile exists but has no `apiKey`, update that profile in `$MEM9_HOME/.credentials.json`.
- If recall or tools work in one project and not another, check whether the project has its own `.opencode/mem9.json` override.
- If recall, auto-ingest, or debug logs appear to run twice, check for duplicate plugin registration across user scope, project scope, npm, or local plugin paths. Keep one active plugin entry.
- If `/mem9-init` is missing, confirm `@mem9/opencode` is also listed in `~/.config/opencode/tui.json`.
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
