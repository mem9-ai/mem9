# mem9 Beta Setup

Use this file only for first-run mem9 beta onboarding.

## First Reply

When this file is read, start with this structure:

> I can help you set up mem9 beta.
>
> Choose one path:
> 1. Create a new mem9 space during setup
> 2. Reconnect an existing mem9 space ID
>
> If you choose reconnect, paste your existing space ID.
>
> After you choose a path, I will show one dry-run preview and ask for a single approval for the full setup flow.

## Safety Rules

- Only edit the exact `openclaw.json` keys listed in `SKILL.md`.
- Do not upload local history from this setup flow.
- Do not use direct web-request commands, raw memory API calls, or scripted shell patch commands in this public setup flow.
- Reconnect and create-new are separate branches. Once one branch is selected, ignore the other branch unless the user explicitly changes their choice.
- Before taking any action, show one dry-run preview that covers install, config edits, expected restarts, and verification.
- Use one explicit approval for the entire disclosed flow. Do not ask for a second approval unless the scope materially changes.

## Terminology

- User-facing term: `space ID`
- Current beta config field: `tenantID`
- Local variable name when needed: `MEM9_SPACE_ID`
- If a beta log mentions `apiKey=<id>`, treat that same value as the new mem9 space ID
- Reconnect source of truth: `USER_PROVIDED_MEM9_SPACE_ID`
- Create-new source of truth: `AUTO_PROVISIONED_MEM9_SPACE_ID`

## Step 0 — Choose Create Or Reconnect

- If the user chooses reconnect, lock the flow to reconnect, store the pasted value as `USER_PROVIDED_MEM9_SPACE_ID`, and continue.
- If the user chooses create, lock the flow to create-new and continue without a space ID for now.
- Do not switch branches later unless the user explicitly changes their choice.
- Do not probe the space ID with standalone API calls. Verification happens later through the plugin.
- After the branch is selected, show one dry-run preview before doing anything else.
- The dry-run preview must include:
  - package name
  - exact config keys that may change
  - selected branch: reconnect or create-new
  - expected restart count
  - reconnect success criteria or create-new success criteria
- Ask for one approval for the full disclosed flow. After that approval, proceed through install, config, restart, and verification without asking again unless the scope changes.

## Step 1 — Install Plugin

The dry-run preview must disclose:

- package name: `@mem9/mem9@0.3.4-beta.1`
- only mem9 beta plugin config keys will be changed
- reconnect path expects one restart after config is written and read back
- create-new path expects one restart without `tenantID`, then a final restart after the generated identifier is written back
- local history will not be uploaded by this setup flow

Install command:

```bash
openclaw plugins install @mem9/mem9@0.3.4-beta.1
```

## Step 2 — Detect OpenClaw Version

Check the installed OpenClaw version before editing config:

```bash
openclaw --version
```

Routing rule:

- If the version is `>= 2.2.0`, use the config shape with `plugins.allow`
- If the version is `< 2.2.0`, use the config shape without `plugins.allow`
- If the version is unavailable or unclear, stop and ask the user which OpenClaw version they are using before editing `openclaw.json`

## Step 3 — Edit openclaw.json

Before writing `openclaw.json`:

- Show the exact keys that will change
- Preserve unrelated config keys
- Use the approval already obtained in Step 0 unless the scope changed

### Reconnect Existing Space ID

Effective changes for OpenClaw `>= 2.2.0`:

- `plugins.slots.memory = "mem9"`
- `plugins.slots.contextEngine = "mem9"`
- `plugins.entries.mem9.enabled = true`
- `plugins.entries.mem9.config.apiUrl = "https://api.mem9.ai"` unless the user chose another `apiUrl`
- `plugins.entries.mem9.config.tenantID = "<USER_PROVIDED_MEM9_SPACE_ID>"`
- `plugins.allow` includes `"mem9"`

Reconnect hard rules:

- In reconnect mode, never leave `plugins.entries.mem9.config.tenantID` absent for the first restart.
- Immediately after writing config, read back `plugins.entries.mem9.config.tenantID`.
- The read-back value must exactly match `USER_PROVIDED_MEM9_SPACE_ID` before the first restart.
- If the read-back value is missing or different, fix config first. Do not restart yet.
- In beta reconnect mode, `tenantID` remains the reconnect source of truth.

Minimal shape if creating a fresh file:

```json
{
  "plugins": {
    "slots": { "memory": "mem9", "contextEngine": "mem9" },
    "entries": {
      "mem9": {
        "enabled": true,
        "config": {
          "apiUrl": "https://api.mem9.ai",
          "tenantID": "<your-space-id>"
        }
      }
    },
    "allow": ["mem9"]
  }
}
```

For OpenClaw `< 2.2.0`, use the same shape without `plugins.allow`.

### Create New Space During Setup

Effective changes for OpenClaw `>= 2.2.0`:

- `plugins.slots.memory = "mem9"`
- `plugins.slots.contextEngine = "mem9"`
- `plugins.entries.mem9.enabled = true`
- `plugins.entries.mem9.config.apiUrl = "https://api.mem9.ai"` unless the user chose another `apiUrl`
- Leave `plugins.entries.mem9.config.tenantID` absent for the first restart
- `plugins.allow` includes `"mem9"`

Create-new hard rules:

- Only the create-new branch may leave `tenantID` absent for the first restart.
- Only the create-new branch may accept an auto-provisioned identifier as the final mem9 credential.

Minimal shape if creating a fresh file:

```json
{
  "plugins": {
    "slots": { "memory": "mem9", "contextEngine": "mem9" },
    "entries": {
      "mem9": {
        "enabled": true,
        "config": {
          "apiUrl": "https://api.mem9.ai"
        }
      }
    },
    "allow": ["mem9"]
  }
}
```

For OpenClaw `< 2.2.0`, use the same shape without `plugins.allow`.

## Step 4 — Restart Flow

Before every restart:

- Show the exact restart action you plan to use
- Use the approval already obtained in Step 0 unless the restart action exceeds the disclosed plan

### Reconnect Path

- Restart OpenClaw once after config read-back succeeds.
- If reconnect mode ever logs this line, treat it as failure, not success:

```text
[mem9] *** Auto-provisioned apiKey=<id> *** Save this to your config as apiKey
```

- If that happens, follow this recovery sequence:
  1. stop treating the current run as successful
  2. inspect the persisted `plugins.entries.mem9.config.tenantID` value
  3. rewrite `USER_PROVIDED_MEM9_SPACE_ID` to the correct field
  4. read back config again and confirm exact match
  5. restart and verify again
- If the key still drifts or auto-provisions again, stop and use `TROUBLESHOOTING.md`.
- Do not hand off the new identifier to the user in reconnect mode.

### Create-New Path

1. Restart once with `tenantID` absent
2. Watch for this exact log line:

```text
[mem9] *** Auto-provisioned apiKey=<id> *** Save this to your config as apiKey
```

3. Treat `<id>` as the new `AUTO_PROVISIONED_MEM9_SPACE_ID`
4. Write that value back into `plugins.entries.mem9.config.tenantID`
5. Restart OpenClaw one more time so future restarts reconnect to the same mem9 space

If the auto-provision log never appears, stop and use `TROUBLESHOOTING.md`.

## Step 5 — Verify

### Reconnect Success Criteria

Reconnect is successful only if all of the following are true:

- `plugins.entries.mem9.config.tenantID` was read back before the first restart and exactly matched `USER_PROVIDED_MEM9_SPACE_ID`
- The plugin can reach the mem9 API
- OpenClaw loads the mem9 beta plugin without config or plugin errors
- The first valid startup did not auto-provision a new identifier
- The final active mem9 credential is still `USER_PROVIDED_MEM9_SPACE_ID`
- Empty memory results are acceptable

### Create-New Success Criteria

Create-new is successful only if all of the following are true:

- The plugin can reach the mem9 API
- OpenClaw loads the mem9 beta plugin without config or plugin errors
- The create-new flow produced an auto-provisioned identifier
- `AUTO_PROVISIONED_MEM9_SPACE_ID` was written back into config
- The final restart works with that persisted identifier
- Empty memory results are acceptable for a new mem9 space

## Step 6 — Required Final Handoff

### Reconnect Final Handoff

Use this only when reconnect succeeded. Do not replace it with any auto-provisioned identifier:

```text
✅ Your mem9 space is connected.
🧭 WHAT YOU CAN DO NEXT

You can also go to https://mem9.ai/your-memory/ to visually manage, analyze, import, and export your memories.
Sign in there with the same mem9 space ID from this setup.
If the dashboard still shows "Space ID", enter the same mem9 space ID.
Use the dashboard or another reviewed manual workflow if you want to import older history later.
This setup did not upload any local files.


💾 YOUR RECONNECTED MEM9 SPACE ID

USER_PROVIDED_MEM9_SPACE_ID: <same-space-id-the-user-pasted-earlier>

This must be the same space ID the user provided earlier.
Use this same value as MEM9_SPACE_ID in recovery or on another trusted machine.
Keep it private and store it somewhere safe.


♻️ RECOVERY

Reinstall mem9 and use the same USER_PROVIDED_MEM9_SPACE_ID as MEM9_SPACE_ID in the plugin config.
Your memory will reconnect instantly.


📦 BACKUP PLAN

Keep your original local memory/session files as backup if you plan to import them later.
Also store the USER_PROVIDED_MEM9_SPACE_ID in a password manager or secure vault.
```

### Create-New Final Handoff

Use this only when create-new succeeded and an auto-provisioned identifier was intentionally adopted:

```text
✅ Your mem9 space is ready.
🧭 WHAT YOU CAN DO NEXT

You can also go to https://mem9.ai/your-memory/ to visually manage, analyze, import, and export your memories.
Sign in there with the same mem9 space ID from this setup.
If the dashboard still shows "Space ID", enter the same mem9 space ID.
Use the dashboard or another reviewed manual workflow if you want to import older history later.
This setup did not upload any local files.


💾 YOUR NEW MEM9 SPACE ID

AUTO_PROVISIONED_MEM9_SPACE_ID: <auto-provisioned-space-id>

Use this same value as MEM9_SPACE_ID in recovery or on another trusted machine.
Keep it private and store it somewhere safe.


♻️ RECOVERY

Reinstall mem9 and use the same AUTO_PROVISIONED_MEM9_SPACE_ID as MEM9_SPACE_ID in the plugin config.
Your memory will reconnect instantly.


📦 BACKUP PLAN

Keep your original local memory/session files as backup if you plan to import them later.
Also store the AUTO_PROVISIONED_MEM9_SPACE_ID in a password manager or secure vault.
```

Do not replace these handoffs with a demo or a synthetic write/read test unless the user explicitly asks for a test.
