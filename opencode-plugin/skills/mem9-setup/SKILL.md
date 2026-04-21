---
name: mem9-setup
description: "Enable and configure mem9 for OpenCode. Triggers: set up mem9, install mem9, configure memory, enable memory, mem9 onboarding, memory not working."
---

# mem9 Setup for OpenCode

Execute the setup directly. Only ask the user for the choices or secrets you cannot infer safely. The final restart reminder is fine.

## What This Setup Owns

This setup handles three things:

1. register `@mem9/opencode` in the chosen OpenCode scope
2. configure the selected OpenCode scope to use a mem9 profile
3. keep secrets in shared mem9 credentials storage

Use this model:

- shared credentials: `$MEM9_HOME/.credentials.json`
- default `MEM9_HOME`: `$HOME/.mem9`
- user scope config: `<OpenCode config dir>/mem9.json`
- project scope config: `<project>/.opencode/mem9.json`

Runtime compatibility remains:

- preferred override: `MEM9_API_KEY`
- optional override: `MEM9_API_URL`
- legacy compatibility: `MEM9_TENANT_ID`

## Step 0: Choose Plugin Scope

Ask:

> Where should mem9 be enabled?
> 1. Global: available in every OpenCode project on this machine
> 2. Project: only active in the current project

Use these plugin targets:

- global scope: `~/.config/opencode/opencode.json`
- project scope: `./opencode.json`

Choose one plugin target only. Do not register mem9 in both global and project scope at the same time.

Use matching mem9 config targets:

- global scope: `<OpenCode config dir>/mem9.json`
- project scope: `<project>/.opencode/mem9.json`

When a project needs different mem9 behavior, prefer project config overrides over a second plugin entry.

## Step 1: Choose Identity Source

Ask:

> How should mem9 authenticate?
> 1. Shared profile in `$MEM9_HOME/.credentials.json` (recommended)
> 2. Environment variables for this OpenCode launch

### If the user chooses shared profile

Ask for:

- `profileId`
- `apiKey`
- optional `label`
- optional `baseUrl`

Defaults:

- `profileId`: `default`
- `label`: same as `profileId`
- `baseUrl`: `https://api.mem9.ai`

Then:

1. Create `$MEM9_HOME` if needed.
2. Read `$MEM9_HOME/.credentials.json` if it exists.
3. Create or update the selected profile under `profiles[profileId]`.
4. Write the file back with this schema:

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

5. Write the chosen `profileId` into the selected scope config:

```json
{
  "schemaVersion": 1,
  "profileId": "default",
  "debug": false,
  "defaultTimeoutMs": 8000,
  "searchTimeoutMs": 15000
}
```

If the scope config already exists, preserve existing non-sensitive fields and only update the mem9 fields that belong to this setup.

### If the user chooses environment variables

Do not write secrets to disk.

Register the plugin normally, then tell the user the OpenCode process must start with one of these:

```bash
export MEM9_API_KEY="..."
export MEM9_API_URL="https://api.mem9.ai"
```

Legacy compatibility still works:

```bash
export MEM9_TENANT_ID="..."
```

Do not edit shell rc files directly. If the user wants persistence, suggest their normal shell profile flow or a project launcher script.

## Step 2: Register the Plugin

Ensure the selected `opencode.json` contains `@mem9/opencode`.

Desired shape:

```json
{
  "plugin": ["@mem9/opencode"]
}
```

If `plugin` already exists:

- keep existing entries
- add `@mem9/opencode` once
- preserve unrelated config

If mem9 is already registered in another scope, explain that the plugin should stay single-scope and ask the user which scope should remain active. Do not leave both active.

If the user already enabled mem9 by editing `opencode.json`, or already points OpenCode at a local mem9 plugin directory, skip plugin registration work and move straight to mem9 config and credentials.

## Step 3: Explain File Layout

After writing files, tell the user where everything landed:

- plugin registration file
- selected scope `mem9.json`
- shared credentials file if profile mode was used

Also mention:

- debug logs are written under the OpenCode state dir at `plugins/mem9/log/`

## Step 4: Verify

Ask the user to restart OpenCode.

Expected startup behavior:

- profile mode: OpenCode loads mem9 from the selected `profileId`
- env mode: OpenCode uses the environment variables from that launch
- legacy env mode: OpenCode still starts and logs legacy compatibility

Expected healthy log lines include one of these:

```text
[mem9] Server mode (mem9 REST API via profile)
[mem9] Server mode (mem9 REST API via env)
[mem9] Server mode (mem9 REST API via legacy_env)
```

If setup is still incomplete, OpenCode logs:

```text
[mem9] Setup pending.
```

## Step 5: Troubleshooting

Use this guidance:

- `Setup pending`: add `MEM9_API_KEY`, or set `profileId` and create that profile in `$MEM9_HOME/.credentials.json`
- profile exists but still does not work: confirm the selected profile has a non-empty `apiKey`
- project behaves differently from user scope: check for `<project>/.opencode/mem9.json` overriding the user config
- recall, ingest, or debug runs twice: check for duplicate plugin registration across global scope, project scope, npm, or local plugin paths; keep one active plugin entry
- debug logging enabled but no file appears: confirm OpenCode can write to its state directory

## Final Message

After successful setup, send a short confirmation that includes:

- plugin scope
- identity mode
- selected `profileId` if profile mode was used
- the reminder to restart OpenCode
