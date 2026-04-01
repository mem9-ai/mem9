---
name: mem9
version: 1.0.13
homepage: "https://github.com/mem9-ai/mem9"
description: "Explicit opt-in setup guide for the mem9 OpenClaw memory plugin. Use when users say: install mem9, setup memory, reconnect mem9, or review mem9 config changes."
keywords: ["mem9", "memory plugin", "persistent memory", "agent memory", "install memory", "setup memory", "openclaw memory", "cloud memory"]
disable-model-invocation: true
user-invocable: true
metadata: {"openclaw":{"emoji":"🧠","homepage":"https://github.com/mem9-ai/mem9","primaryEnv":"MEM9_API_KEY"}}
---

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ███╗   ███╗███████╗███╗   ███╗ █████╗                      │
│   ████╗ ████║██╔════╝████╗ ████║██╔══██╗                     │
│   ██╔████╔██║█████╗  ██╔████╔██║╚██████║                     │
│   ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║ ╚═══██║                     │
│   ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║ █████╔╝                     │
│   ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝ ╚════╝                      │
│                                                              │
│   persistent memory for ai agents                            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

# mem9

mem9 gives OpenClaw persistent memory across resets, restarts, and new machines.

The plugin connects to one cloud memory space, identified by an API key.

## Source / Security / Config Impact

- Official source: [mem9-ai/mem9](https://github.com/mem9-ai/mem9) and [mem9.ai](https://mem9.ai/).
- Default network scope: this onboarding talks to `https://api.mem9.ai` unless the user explicitly chooses a different `apiUrl`.
- Config scope: this onboarding only reads or updates the active `openclaw.json` entries needed for the mem9 plugin. It should not read or modify unrelated files.
- Install impact: setup installs the mem9 plugin, writes plugin config, and restarts OpenClaw so the plugin can load.
- Invocation scope: this is an explicit setup guide only. It should not be auto-used for routine memory store/recall once mem9 is already installed.
- Consent scope: do not install the plugin, edit `openclaw.json`, or restart OpenClaw until the user explicitly confirms each step.
- History import scope: this public onboarding skill does not scan or upload local memory/session files. Use the dashboard or another reviewed manual workflow if the user later wants to import history.

## Exact Config Changes

Only these `openclaw.json` paths may be changed during setup:

- `plugins.slots.memory`
- `plugins.entries.mem9.enabled`
- `plugins.entries.mem9.config.apiUrl`
- `plugins.entries.mem9.config.apiKey`
- `plugins.allow`

Do not change any other config keys unless the user explicitly asks.

When talking to end users:

- Say "API key" or "mem9 API key"
- Prefer `apiKey` when you are editing current OpenClaw plugin config
- Mention `tenantID` only when explaining legacy compatibility or editing old raw config
- Explain that the API key is what reconnects the user to the same mem9 space
- Treat the API key as something the user should save for reconnecting later
- Clearly warn that the API key is effectively a secret and must never be shared

---

## Trigger phrases

Use this skill only when the user explicitly wants to install, reconnect, or review mem9 setup.

Common triggers include:

- "install mem9"
- "setup mem9"
- "enable mem9 memory"
- "reconnect my mem9 API key"
- "review mem9 config changes"
- "configure mem9 in openclaw.json"

---

## When to use this skill

Use this skill when the user explicitly wants help with mem9 onboarding, reconnection, or config review.

Typical situations include:

- The user wants to install the mem9 plugin for the first time
- The user wants to reconnect an existing mem9 API key on this machine
- The user wants to review the exact `openclaw.json` changes before setup
- The user wants to confirm which package, endpoint, and restart step the setup will use
- The user wants to verify recovery steps for reinstalling mem9 on another machine

---

## When NOT to use this skill

Do not use this skill for:

- Temporary conversation context that only matters in the current session
- One-off tasks that do not require long-term memory
- Day-to-day memory store/recall after mem9 is already installed
- Importing or uploading local history directly from the agent; use the dashboard or another reviewed manual workflow instead
- Troubleshooting unrelated to mem9 setup, import, or reconnection

---

## What should be remembered

Good candidates:

- User preferences
- Profile facts about the user
- Project context or ongoing work
- Important decisions made during conversations
- Long-term instructions or habits

Avoid storing:

- Temporary debugging context
- Large data or files
- Secrets, passwords, or API keys

---

## Setup intent detection

If the user asks to remember something and mem9 is already installed, do not use this onboarding skill. Use the installed memory plugin instead.

If mem9 is not installed yet, only use this onboarding skill when the user explicitly asks to install, enable, reconnect, or review persistent memory setup.

---

## Definition of Done

This task is NOT complete until all of the following are true:

1. mem9 API key is provided by the user or auto-provisioned during setup and then saved
2. plugin is installed
3. openclaw.json is configured correctly
4. OpenClaw is restarted
5. setup is verified
6. the user has been sent the full Step 7 handoff message, including:

- next step: dashboard/manual import guidance
- MEM9_API_KEY warning
- dashboard URL + same API key login note
- recovery steps
- backup plan

---

## What You Get

| Tool            | When                                            |
| --------------- | ----------------------------------------------- |
| `memory_store`  | Persist facts, decisions, context               |
| `memory_search` | Find the right memories by keywords and meaning |
| `memory_get`    | Retrieve by ID                                  |
| `memory_update` | Modify existing memory                          |
| `memory_delete` | Remove                                          |

Lifecycle hooks (automatic — no agent action needed):

| Hook                  | Trigger         | What happens                          |
| --------------------- | --------------- | ------------------------------------- |
| `before_prompt_build` | Every LLM call  | Relevant memories injected as context |
| `before_reset`        | Before `/reset` | Session summary saved                 |
| `agent_end`           | Agent finishes  | Last response captured                |

---

## Common failure mode

Agents often finish the technical setup and forget to send the required final handoff.
Prevent this by treating the handoff as part of the setup itself, not as optional follow-up.

---

## Onboarding

### Terminology

Use this distinction consistently:

| Internal term     | User-facing explanation                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `apiKey`          | Preferred OpenClaw config field; sends the same mem9 API key in `X-API-Key` for v1alpha2 |
| `tenantID`        | Legacy OpenClaw config field; only mention for compatibility or old raw configs          |
| `MEM9_API_KEY` env var | A local variable holding the user's mem9 API key                                    |
| `secret`          | Treat as the same value as the mem9 API key unless the user clearly means something else |
| "recovery key"    | Avoid this term; say "API key" instead                                                   |

Short rule: `API key`, `apiKey`, and `secret` may refer to the same mem9 identifier. Prefer saying `API key` to users, use `apiKey` in new config examples, and mention `tenantID` only as the legacy fallback alias.
If a shell example needs an environment variable name, use `MEM9_API_KEY`.
Security note:
Treat the API key like a secret. Anyone who has it can access that mem9 space.

If the user asks "What is this for?" answer plainly:

> This is the API key that reconnects you to your mem9 space. OpenClaw uses it to save and recall your memory in the right place.

If the user asks "What is the relationship between tenantID and key?" answer plainly:

> You only need the API key. In current OpenClaw config, the preferred field is `apiKey`. `tenantID` is the legacy config field for the same value. Important: this API key is effectively your secret, so save it somewhere safe and never share it with anyone.

### Step 0 — Check for existing API key

`[AGENT]` Ask the user before doing anything else:

> Which setup do you want?
>
> 1. Create a new mem9 API key during setup
> 2. Reconnect an existing mem9 API key
>
> If you choose reconnect, paste your existing API key.
>
> Heads-up: OpenClaw will restart later in this setup. When that happens, please wait a few minutes, then send "Hi" here to reconnect and continue.
>
> This setup is explicit opt-in. I will not install the plugin, edit `openclaw.json`, or restart OpenClaw until you confirm each step.

Branching:

- If the user chooses reconnect and provides an API key, use that value for setup.
  - Continue to Step 2.
  - Validate the configured API key during Step 6 after install/config/restart.
- If the user chooses create, continue to Step 1.

```text
MEM9_API_KEY="<paste-from-user>"
```

Do not probe the API key with extra standalone API calls at this stage. Use Step 6 to verify that the plugin loads and the configured API key works end to end.

---

### Step 1 — Create a new mem9 API key during setup

> Skip this step if the user provided an existing API key in Step 0.

`[AGENT]` Do not use `curl` or other direct web-request commands in this public onboarding skill to create the API key.

Instead:

- Continue with install and initial config even if no API key exists yet
- Leave `plugins.entries.mem9.config.apiKey` unset for the first restart
- Let the mem9 plugin auto-provision a new API key on first plugin use
- Watch for the exact OpenClaw log line:

```text
[mem9] *** Auto-provisioned apiKey=<id> *** Save this to your config as apiKey
```

- Save `<id>` as `MEM9_API_KEY`
- After that, write the new `MEM9_API_KEY` back into `openclaw.json` as `plugins.entries.mem9.config.apiKey`
- Restart OpenClaw one more time so future restarts reconnect to the same mem9 space

When explaining it to the user, say:

> Your new mem9 API key will be created during setup. Once the plugin auto-provisions it, save that API key immediately because it is how this machine, and any future machine you trust, reconnects to the same memory.
>
> Important: this API key is also your secret. Never share it with anyone. If someone else gets it, they can access your memory.

### Step 2 — Install plugin

`[AGENT]` Use the standard OpenClaw install command for the official package:

Before running the install command:

- Show the package name: `@mem9/mem9`
- Show that only the paths listed in `Exact Config Changes` may be edited later
- Warn that OpenClaw will need a restart after config is written
- Explain that if the user chose "create a new API key", the first restart may auto-provision the key and a second restart may be needed after saving it into config
- Explain that this public setup skill does not upload local history; use the dashboard or another reviewed manual workflow later if needed
- Do not run the install command until the user confirms

```bash
openclaw plugins install @mem9/mem9
```

Decision rule:

- Use the standard package install path first.
- If the user's network later has registry problems, handle that as troubleshooting rather than embedding registry-switching logic into this public onboarding skill.

**Immediately after install completes**, tell the user (before restarting anything):

> ✅ mem9 plugin installed. Next I need to restart the OpenClaw gateway so the plugin can load and the hooks/tools become active.
>
> The restart will take about 1 minute. After that, send me a message to confirm mem9 is functional.

⚠️ **Important (tool ordering):** If you (the agent) are going to restart the gateway automatically via tools/exec, you must send the notice above as an outbound message _first_ (e.g. via the `message` tool). Do **not** rely on the final assistant reply text, because tool calls happen before the final reply is delivered and a gateway restart can prevent that reply from being sent.

Then proceed to the gateway restart step for the user’s environment/profile.

After the restart completes, ask the user to wait ~1 minute and then send a quick message so you can confirm mem9 is working (for example: "Hello mem9").

### Step 3 — Detect OpenClaw version

`[AGENT]` Check the installed OpenClaw version before editing config:

```bash
openclaw --version
```

Routing rule:

- If the reported version is `>= 2.2.0`, use the config path in **Step 4A**.
- If the reported version is `< 2.2.0`, use the config path in **Step 4B**.
- If the version command is unavailable or unclear, tell the user you could not determine the OpenClaw version and ask them which version they are using before editing `openclaw.json`.

### Step 4 — Configure openclaw.json

Before writing `openclaw.json`:

- Show the exact keys that will change and ask the user to confirm
- Only change the paths listed in `Exact Config Changes`
- Do not write the file until the user explicitly approves
- Apply the change with normal file editing after approval; do not use scripted shell patch commands in this public onboarding skill

#### OpenClaw ≥2.2.0

`[AGENT]` Apply only the following effective changes:

- Set `plugins.slots.memory` to `"mem9"`
- Ensure `plugins.entries.mem9.enabled` is `true`
- Set `plugins.entries.mem9.config.apiUrl` to `https://api.mem9.ai` unless the user explicitly chose another `apiUrl`
- If the user provided an existing API key, set `plugins.entries.mem9.config.apiKey` to the current `MEM9_API_KEY`
- If the user chose "create a new API key during setup", leave `plugins.entries.mem9.config.apiKey` absent for the first restart so the plugin can auto-provision it
- Ensure `plugins.allow` includes `"mem9"` while preserving other existing entries

Preserve unrelated config keys and existing mem9 fields that are not listed above.

Or if no `openclaw.json` exists, create:

```json
{
  "plugins": {
    "slots": { "memory": "mem9" },
    "entries": {
      "mem9": {
        "enabled": true,
        "config": {
          "apiUrl": "https://api.mem9.ai",
          "apiKey": "<your-api-key>"
        }
      }
    },
    "allow": ["mem9"]
  }
}
```

#### OpenClaw <2.2.0

`[AGENT]` Apply only the following effective changes:

- Set `plugins.slots.memory` to `"mem9"`
- Ensure `plugins.entries.mem9.enabled` is `true`
- Set `plugins.entries.mem9.config.apiUrl` to `https://api.mem9.ai` unless the user explicitly chose another `apiUrl`
- If the user provided an existing API key, set `plugins.entries.mem9.config.apiKey` to the current `MEM9_API_KEY`
- If the user chose "create a new API key during setup", leave `plugins.entries.mem9.config.apiKey` absent for the first restart so the plugin can auto-provision it

Preserve unrelated config keys and existing mem9 fields that are not listed above.

Or if no `openclaw.json` exists, create:

```json
{
  "plugins": {
    "slots": { "memory": "mem9" },
    "entries": {
      "mem9": {
        "enabled": true,
        "config": {
          "apiUrl": "https://api.mem9.ai",
          "apiKey": "<your-api-key>"
        }
      }
    }
  }
}
```

Compatibility rule:

- Existing configs that already use `tenantID` continue to work as a legacy alias for `apiKey`
- Do not use `apiToken` or `userToken`

### Step 5 — Restart OpenClaw

Restart OpenClaw so the new mem9 plugin config is loaded.

Before restarting:

- Show the exact restart command or action you plan to use
- Do not restart until the user explicitly approves
- If the user chose "create a new API key during setup", explain that there may be an initial restart for auto-provisioning and a final restart after saving the generated API key into config

### Step 6 — Verify setup

A setup is successful if all of the following are true:

- the plugin can reach the mem9 API
- OpenClaw loads the mem9 plugin without config or plugin errors
- if the user supplied an existing API key, that configured API key works through the plugin after restart
- if the user chose "create a new API key during setup", the plugin auto-provisions a new API key, that key is captured from the log message, written into `openclaw.json`, and then works through the plugin after the final restart
- an empty result is acceptable for a newly created API key
  Notes:
  If the user supplied an existing API key in Step 0, this is where that key is validated end to end.
  A newly created mem9 API key may contain zero memories. Empty is still a valid success state.

### Step 7 — What's Next

`[AGENT]` After successful setup, the agent MUST send the following structured handoff before ending the task.
Do not summarize or remove any parts of it.
Translate the content into the user's language before sending, while keeping the same structure and all warnings.

```
✅ Your mem9 API key is ready.
🧭 WHAT YOU CAN DO NEXT

You can also go to https://mem9.ai/your-memory/ to visually manage, analyze, import, and export your memories.
Sign in there with the same mem9 API key from this setup.
If the dashboard still shows "Space ID", enter the same mem9 API key.
Use the dashboard or another reviewed manual workflow if you want to import older history later.
This setup did not upload any local files.


💾 YOUR MEM9 API KEY

MEM9_API_KEY: <your-api-key>

This API key is your access key to mem9.
Keep it private and store it somewhere safe.


♻️ RECOVERY

Reinstall mem9 and use the same MEM9_API_KEY in Step 4.
Your memory will reconnect instantly.


📦 BACKUP PLAN

Keep your original local memory/session files as backup if you plan to import them later.
Also store the MEM9_API_KEY in a password manager or secure vault.
```

Do not default to offering a synthetic write/read demo as the next step.

Preferred next-step order:

1. Point the user to the dashboard if they want to manage or manually import history later
2. Explain the recovery path for a new machine or accidental local loss
3. Explain local backup plus offsite backup
4. Only offer a live write/read verification if the user explicitly asks for a test or if import/recovery is already clear

---

## Communication Style

When presenting onboarding or recovery instructions:

- Use plain product language, not backend vocabulary
- Prefer "API key" or "mem9 API key"
- Explain concretely that the same API key reconnects the same cloud memory on another trusted machine
- If the user sounds worried about recovery, lead with backup/dashboard/reconnect steps instead of API demos

Suggested English wording:

```text
This MEM9_API_KEY is not a nickname.
It is the key that reconnects you to your mem9 space.
It is also effectively your secret.
Never share it with anyone.
If someone else gets it, they can access your memory.
Save it somewhere safe because you will use the same value later if you want to reconnect on another machine.

If you want to import older history later, use the mem9 dashboard or another reviewed manual workflow.
This setup does not upload local files by default.

Recovery plan:
1. Local backup: keep the original memory/session files if you may want to import them later
2. Offsite recovery: save the MEM9_API_KEY in a password manager, team vault, or another secure offsite location
3. New machine recovery: reinstall the plugin and configure the same MEM9_API_KEY as `apiKey` in openclaw.json to reconnect to the same cloud memory
```

---

## Troubleshooting

| Symptom                                                                 | Fix                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plugin not loading                                                      | Check `slots.memory = "mem9"` and `entries.mem9.enabled = true`                                                                                                    |
| Plugin install hangs or fails on Alibaba Cloud / mainland China network | Retry the install with a temporary npm mirror such as `https://registry.npmmirror.com`, but avoid changing the user's global npm config unless they explicitly ask |
| `404` on API call                                                       | Verify the saved API key was written into the plugin config and confirm network access to `api.mem9.ai`                                                            |
| Existing API key fails after setup                                      | Re-check the value for typos; if the key is lost, provision a new one via Step 1                                                                                   |

---

## Next Steps

After first read, guide the user in this order:

1. **Dashboard/manual import** — Point the user to the dashboard for visual management and any later manual import.
2. **Explain recovery** — Tell the user that reusing the same `MEM9_API_KEY` reconnects the same cloud memory on a new machine.
3. **Explain backup** — Recommend keeping original local files and saving the API key in a secure offsite location.
4. **Verify only if useful** — Offer a live memory test only if the user explicitly asks for validation.

---

## Update

Do not set up automatic daily self-updates for this skill.

Only update the local skill file when the user or maintainer explicitly asks for a refresh from a reviewed source.

---

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░  stateless agents · cloud memory · zero amnesia              ░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```
