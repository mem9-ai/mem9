---
name: mem9-setup
description: "Set up mem9 for OpenCode. Triggers: set up mem9, configure mem9, enable mem9 memory, mem9 onboarding, setup pending."
---

# mem9 Setup for OpenCode

Execute the setup directly. Keep it simple and keep installation separate from identity setup.

## What This Setup Owns

This setup owns both mem9 identity and OpenCode scope config. It does two things:

1. maintain shared credentials in `$MEM9_HOME/.credentials.json`
2. update OpenCode user or project `mem9.json`

Use this model:

- shared credentials: `$MEM9_HOME/.credentials.json`
- default `MEM9_HOME`: `$HOME/.mem9`
- OpenCode user config: `<OpenCode config dir>/mem9.json`
- optional project override: `<project>/.opencode/mem9.json`

This setup does not choose plugin install scope and does not edit `opencode.json` plugin lists.

## Preferred Flow

If the TUI plugin is active, tell the user to run:

```text
/mem9-setup
```

That command supports two actions when no usable profile exists:

- get a mem9 API key automatically
- add an existing mem9 API key

That command supports four actions when usable profiles already exist:

- get a mem9 API key automatically
- add an existing mem9 API key
- use an existing mem9 profile in a scope
- configure user/project settings

The profile actions write:

- `$MEM9_HOME/.credentials.json`

Profile creation also updates the user-level OpenCode config so first-time setup is usable immediately.

The scope actions write one of these:

- `<OpenCode config dir>/mem9.json`
- `<project>/.opencode/mem9.json`

Scope config fields are:

- `profileId`
- `debug`
- `defaultTimeoutMs`
- `searchTimeoutMs`

The current OpenCode prompt is plain text, so API keys stay visible while the user types them.

## Manual Fallback

Use manual setup when `/mem9-setup` is unavailable or when the user wants a file-based setup.

### Shared profile mode

1. Choose a `profileId`. Use `default` when the user does not care.
2. Create or update `$MEM9_HOME/.credentials.json`:

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

3. Write `<OpenCode config dir>/mem9.json`:

```json
{
  "schemaVersion": 1,
  "profileId": "default",
  "debug": false,
  "defaultTimeoutMs": 8000,
  "searchTimeoutMs": 15000
}
```

4. Preserve existing non-sensitive config fields when updating the file.

### Environment variable mode

If the user prefers env vars, do not write secrets to disk. Tell them to launch OpenCode with:

```bash
export MEM9_API_KEY="..."
export MEM9_API_URL="https://api.mem9.ai"
```

Optional shared-home override:

```bash
export MEM9_HOME="$HOME/.mem9"
```

Legacy compatibility still works:

```bash
export MEM9_TENANT_ID="..."
```

## Troubleshooting

Use this guidance:

- `Setup pending`: run `/mem9-setup`, add `MEM9_API_KEY`, or point the active scope config at a profile with a non-empty `apiKey`
- selected profile still does not work: confirm the profile exists in `$MEM9_HOME/.credentials.json` and has a non-empty `apiKey`
- project behaves differently: check for `<project>/.opencode/mem9.json`
- recall, ingest, or logs appear twice: keep one active server plugin registration
- `/mem9-setup` is missing: ensure `@mem9/opencode` is in `~/.config/opencode/tui.json`

## Final Message

After successful setup, send a short confirmation that includes:

- which `profileId` OpenCode will use
- where credentials were stored if file mode was used
- which scope config file changed when settings mode was used
- the reminder to restart OpenCode
