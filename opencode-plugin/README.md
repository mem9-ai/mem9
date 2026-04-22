# OpenCode Plugin for mem9

Persistent memory for [OpenCode](https://opencode.ai).

The package ships two plugin entrypoints:

- a server plugin for recall, auto-ingest, and memory tools
- a TUI plugin for interactive setup inside OpenCode

## Quick Start

### 1. Install mem9 once at user scope

```bash
opencode plugin --global @mem9/opencode
```

That adds `@mem9/opencode` to both:

- `~/.config/opencode/opencode.json`
- `~/.config/opencode/tui.json`
- `%APPDATA%\\opencode\\opencode.json`
- `%APPDATA%\\opencode\\tui.json`

mem9 works best with one global plugin install plus project-level `mem9.json` overrides.
OpenCode merges plugin lists across scopes, so one install keeps recall, ingest, and tools predictable.

### 2. Restart OpenCode and run `/mem9-setup`

`/mem9-setup` is the main entrypoint for:

- shared mem9 credentials
- OpenCode mem9 settings

When no usable profile exists, it shows two actions:

- `Get a mem9 API key automatically`
- `Add an existing mem9 API key`

When usable profiles already exist, it shows four actions:

- `Get a mem9 API key automatically`
- `Add an existing mem9 API key`
- `Use an existing mem9 profile in a scope`
- `Adjust scope settings`

The last two actions have separate jobs:

- `Use an existing mem9 profile in a scope` changes which profile a user or project scope uses
- `Adjust scope settings` changes `debug`, `defaultTimeoutMs`, and `searchTimeoutMs` for a user or project scope

### 3. Add project overrides only when you need them

Keep the plugin install global.
Use `<project>/.opencode/mem9.json` when one repository needs a different profile, debug flag, or timeout values.

Example:

```json
{
  "schemaVersion": 1,
  "profileId": "default",
  "debug": false,
  "defaultTimeoutMs": 8000,
  "searchTimeoutMs": 15000
}
```

## Where mem9 stores data

- Shared credentials:
  macOS/Linux: `$HOME/.mem9/.credentials.json`
  Windows: `%USERPROFILE%\\.mem9\\.credentials.json`
- Global mem9 config:
  macOS/Linux: `~/.config/opencode/mem9.json`
  Windows: `%APPDATA%\\opencode\\mem9.json`
- Project mem9 override:
  all platforms: `<project>/.opencode/mem9.json`
- Debug logs:
  macOS/Linux: `~/.local/share/opencode/plugins/mem9/log/YYYY-MM-DD.jsonl`
  Windows: `%LOCALAPPDATA%\\opencode\\plugins\\mem9\\log\\YYYY-MM-DD.jsonl`

`MEM9_HOME` defaults to `$HOME/.mem9` on macOS/Linux and `%USERPROFILE%\\.mem9` on Windows.

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
- `MEM9_DEBUG`
- `MEM9_HOME`

Legacy compatibility remains:

- `MEM9_TENANT_ID`

`MEM9_TENANT_ID` is treated as the API key source for older setups.

## Upgrading

OpenCode caches npm plugins by package specifier.
When config points at `@mem9/opencode`, OpenCode resolves it as `@mem9/opencode@latest`.

Reliable upgrade flow:

1. Quit OpenCode.
2. Delete the cached folder that matches the installed specifier.
   Default install on macOS/Linux: `~/.cache/opencode/packages/@mem9/opencode@latest`
   On Windows, open your OpenCode cache directory for the current user and delete the `@mem9/opencode@latest` folder.
   If you pinned an exact version such as `@mem9/opencode@0.1.1`, delete that exact folder name instead.
3. Run:

```bash
opencode plugin --force --global @mem9/opencode
```

4. Restart OpenCode.

For prerelease testing, install an explicit npm specifier such as `@mem9/opencode@rc` or an exact version.

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
