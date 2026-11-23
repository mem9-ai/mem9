---
name: mem9-setup
description: >-
  Inspect and configure mem9 profiles, API keys, and user or project scope settings.
  Use when the user wants to set up, inspect, switch, or troubleshoot mem9 credentials.
---

# Mem9 Setup

Manage mem9 credential profiles and Antigravity scope settings using `scripts/setup.mjs` inside this skill directory.

## File Locations

- `MEM9_HOME`: defaults to `~/.mem9` (shared credentials live at `$MEM9_HOME/.credentials.json`).
- User config: `$MEM9_HOME/antigravity/config.json`.
- Project override: `<project-root>/.agents/mem9/config.json`.
- Plugin fallback auth (if present): `${PLUGIN_DATA}/auth.json`.

When mentioning paths to the user, prefer symbolic paths (`~/.mem9/.credentials.json`, `~/.mem9/antigravity/config.json`, `.agents/mem9/config.json`) rather than printing secrets.

## Security Rules

- **Never** ask the user to paste a raw API key into chat.
- **Never** print, echo, or pass raw API keys as CLI flags.
- Always use `profile save-key --api-key-env MEM9_API_KEY` from a trusted shell when attaching an existing key, or `profile create --provision-api-key` to provision a new mem9 space automatically.

## Workflow

Run commands from this skill directory (or resolve `scripts/setup.mjs` relative to this `SKILL.md` file). Run `node scripts/setup.mjs --help` for full CLI usage.

1. **Inspect current state first**:

   ```bash
   node scripts/setup.mjs inspect --cwd <workspace-dir>
   ```

   Review `runtime`, `profiles`, `userConfig`, and `projectConfig` from the JSON output. When listing saved profiles to the user, show `profiles.items[*].displaySummary` verbatim (which preserves the redacted `apiKeyPreview`).

2. **Pause and confirm the user's choice** before mutating credentials or config unless the user already specified what they want:
   - Reuse an existing profile from `profiles.items`
   - Provision a new space and API key (`profile create --provision-api-key`)
   - Save an existing API key via trusted shell (`profile save-key --api-key-env MEM9_API_KEY`)
   - Apply user scope (global default) or project scope (repo override), or clear a project override

3. **Provision a new mem9 API key (when requested)**:

   ```bash
   node scripts/setup.mjs profile create \
     --profile <profile-id> \
     --label <profile-label> \
     --base-url https://api.mem9.ai \
     --provision-api-key
   ```

4. **Attach an existing API key via trusted shell**:
   Provide the user with the exact `manualSaveKeyCommand` from `inspect` (or `profiles.manualSaveKeyTemplate`, or the matching shell variant from `manualSaveKeyShells` / `profiles.manualSaveKeyTemplates`) to run in their own terminal so the secret stays out of chat:

   POSIX (`sh`/`zsh`):

   ```bash
   MEM9_API_KEY='<your-mem9-api-key>' node <skill-dir>/scripts/setup.mjs profile save-key \
     --profile <profile-id> \
     --label <profile-label> \
     --base-url https://api.mem9.ai \
     --api-key-env MEM9_API_KEY
   ```

   Windows PowerShell:

   ```powershell
   $env:MEM9_API_KEY = '<your-mem9-api-key>'; node <skill-dir>/scripts/setup.mjs profile save-key --profile <profile-id> --label <profile-label> --base-url https://api.mem9.ai --api-key-env MEM9_API_KEY; Remove-Item Env:MEM9_API_KEY -ErrorAction SilentlyContinue
   ```

   Only run `profile save-key` from the agent if `MEM9_API_KEY` is already exported in the current process environment.

5. **Apply user or project scope** (after the selected profile has a saved API key):

   ```bash
   # Global user default (~/.mem9/antigravity/config.json)
   node scripts/setup.mjs scope apply \
     --scope user \
     --profile <profile-id> \
     --default-timeout-ms 8000 \
     --search-timeout-ms 15000 \
     --recall-min-prompt-length 5

   # Optional repo-local override (<project-root>/.agents/mem9/config.json)
   node scripts/setup.mjs scope apply \
     --scope project \
     --profile <profile-id> \
     --cwd <workspace-dir>
   ```

   Pass `--agent-id <id>` only when the user wants a specific memory bucket ID (`1-100` characters, no control characters).

6. **Clear a project override (when requested)**:

   ```bash
   node scripts/setup.mjs scope clear --scope project --cwd <workspace-dir>
   ```
