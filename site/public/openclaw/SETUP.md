# mem9 Setup

Use this file only for first-run mem9 onboarding or reconnect.

## First Reply

When this file is read, send only the choice prompt below. Do not include version checks, config paths, config keys, dry-run details, restart counts, or approval phrases in the first reply.

> I can help you set up mem9.
>
> Choose one path:
> 1. Create a new mem9 API key during setup
> 2. Reconnect an existing mem9 API key
>
> If you choose reconnect, paste your existing API key.

## Hard Rules

- Only edit the exact `openclaw.json` keys listed in `SKILL.md`.
- Do not upload local history, memory files, or session files during setup.
- Do not use raw mem9 API calls, direct web-request provisioning, or scripted shell patch commands as a substitute for the plugin flow.
- Do not write the generated or provided API key, even a preview, into local memory files, history notes, `MEMORY.md`, `memory/*.md`, session summaries, or setup logs. Show the key only in the final onboarding handoff.
- Install only with `openclaw plugins install @mem9/mem9`, optionally prefixed by one-shot `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com`. Never substitute `npm install -g @mem9/mem9`, `npm install @mem9/mem9`, `npx`, or a copied npm package.
- Do not point `plugins.slots.memory` at `mem9` until the OpenClaw plugin install succeeds and OpenClaw recognizes plugin id `mem9`.
- Reconnect and create-new are separate branches. After the user chooses one, do not switch unless the user explicitly changes their choice.
- The only valid secret config path is `plugins.entries.mem9.config.apiKey`. Never write `plugins.entries.mem9.apiKey`.
- On OpenClaw `4.23+` / `2026.4.22+`, write `plugins.entries.mem9.hooks.allowConversationAccess = true` as a sibling of `enabled` and `config`. On older versions that reject it, omit it and tell the user full automatic conversation upload requires an OpenClaw upgrade.
- In create-new mode, generate `PROVISION_TOKEN` once after the branch is selected, write it before the first restart, and keep it stable until provisioning succeeds on this machine.
- If the remote `SKILL.md` URL has query params whose keys start with `utm_`, preserve those exact filtered pairs as `REMOTE_SKILL_UTM_PARAMS` and write them only in create-new mode under `plugins.entries.mem9.config.provisionQueryParams`.
- Show one dry-run preview and get one approval for the disclosed install, config, restart, and verification flow. Ask for another approval only if scope materially changes.
- Do not ask the user for repeated `hi` messages while the only missing step is create-new provisioning. Use the one local trigger in this document.
- If install fails, stale local plugin state blocks install, config is already invalid, reconnect auto-provisions a new key, multiple create-new keys appear, or the documented checks cannot be satisfied, stop and use `TROUBLESHOOTING.md`.

## Required Success Handoff

This template is intentionally near the top so remote reads see it even if later sections are truncated.

Once reconnect or create-new success criteria are met, the next user-facing assistant message must be exactly this onboarding handoff with the real key substituted. Do not replace it with a short summary such as `done`, `搞定`, `安装成功`, or diagnostic bullets. Include the full API key exactly once. Do not append log analysis, trigger details, apology text, or extra status notes after it.

```text
✅ Your mem9 API key is connected.
🧭 WHAT YOU CAN DO NEXT

You can also go to https://mem9.ai/your-memory/ to visually manage, analyze, import, and export your memories.
Sign in there with the same mem9 API key from this setup.
If the dashboard still shows "Space ID", enter the same mem9 API key.
Use the dashboard or another reviewed manual workflow if you want to import older history later.
This setup did not upload any local files.
If you later ask me to remember something, I should write it to mem9 and tell you whether the write succeeded.


💾 YOUR MEM9 API KEY

MEM9_API_KEY: <api-key-from-this-setup>

Use this same value as MEM9_API_KEY in recovery or on another trusted machine.
Keep it private and store it somewhere safe.


♻️ RECOVERY

Reinstall mem9 and use the same MEM9_API_KEY in the plugin config.
Your memory will reconnect instantly.


📦 BACKUP PLAN

Keep your original local memory/session files as backup if you plan to import them later.
Also store MEM9_API_KEY in a password manager or secure vault.
```

## Setup Flow

### 1. Choose Branch And Approve

- If the user chooses reconnect, store the pasted key as `USER_PROVIDED_MEM9_API_KEY`.
- If the user chooses create-new, generate and remember `PROVISION_TOKEN`; do not ask the user for an API key.
- If `REMOTE_SKILL_UTM_PARAMS` exists, keep that exact map for create-new.
- Do not probe a key with standalone API calls. Verification happens through OpenClaw loading the plugin.

Before taking action, send one dry-run preview in the user's language. It must include:

- package: `@mem9/mem9`
- install command family: `openclaw plugins install @mem9/mem9`
- selected branch: reconnect or create-new
- exact config keys that may change
- expected restart count: normally 1
- local history will not be uploaded
- restart-and-return instruction: gateway restarts automatically; return to this chat in a few minutes and send `hi`

The config key list must include:

- Always: `plugins.slots.memory`, `plugins.entries.mem9.enabled`, `plugins.entries.mem9.config.apiUrl`, `plugins.allow`
- OpenClaw `4.23+` / `2026.4.22+`: `plugins.entries.mem9.hooks.allowConversationAccess`
- Reconnect only: `plugins.entries.mem9.config.apiKey`
- Create-new only: `plugins.entries.mem9.config.provisionToken`
- Create-new with UTM only: `plugins.entries.mem9.config.provisionQueryParams`

Required approval phrases:

```text
approve reconnect
approve create
```

After approval, send a short notice before running commands:

```text
Approved. I’m starting mem9 setup now.

The gateway will restart automatically; return to this chat in a few minutes and send hi.
```

Use equivalent wording in the user's language. Do not claim post-restart verification has already started.

### 2. Install Plugin

Check registry reachability first. Use the official registry unless it times out or is materially slower than npmmirror; never change global npm config.

```bash
NPMJS_TIME="$(curl -o /dev/null -sS --connect-timeout 2 --max-time 6 -w '%{time_total}' https://registry.npmjs.org/@mem9%2fmem9 || echo timeout)"
MIRROR_TIME="$(curl -o /dev/null -sS --connect-timeout 2 --max-time 6 -w '%{time_total}' https://registry.npmmirror.com/@mem9%2fmem9 || echo timeout)"
```

If npmjs times out, or npmjs is slow while npmmirror is reachable, run:

```bash
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com openclaw plugins install @mem9/mem9
```

Otherwise run:

```bash
openclaw plugins install @mem9/mem9
```

After install, confirm OpenClaw recognizes plugin id `mem9`. If only a global npm install happened, or OpenClaw reports `plugin not found: mem9`, setup has not succeeded; use `TROUBLESHOOTING.md`.

Before any restart, send a short user-facing notice that the plugin is installed and the gateway restart is next. Do not stop and wait for another approval.

### 3. Detect OpenClaw Version

Run:

```bash
openclaw --version
```

Routing:

- `>= 2.2.0`: include `plugins.allow`.
- `< 2.2.0`: omit `plugins.allow`.
- `4.23+` or date-style `2026.4.22+`: include `hooks.allowConversationAccess = true`.
- Older versions: omit `hooks.allowConversationAccess` and tell the user to upgrade OpenClaw for full automatic conversation upload.
- If the version is unavailable or unclear, ask the user before editing config.

### 4. Write Config And Read It Back

Preserve unrelated config. Apply mem9 config in one contiguous update after install succeeds.

Common shape:

```json
{
  "plugins": {
    "slots": { "memory": "mem9" },
    "entries": {
      "mem9": {
        "enabled": true,
        "hooks": {
          "allowConversationAccess": true
        },
        "config": {
          "apiUrl": "https://api.mem9.ai"
        }
      }
    },
    "allow": ["mem9"]
  }
}
```

For reconnect, add:

```json
"apiKey": "<USER_PROVIDED_MEM9_API_KEY>"
```

For create-new, do not write `apiKey` before the first restart. Add:

```json
"provisionToken": "<PROVISION_TOKEN>"
```

If create-new has UTM params, also add:

```json
"provisionQueryParams": {
  "utm_source": "example"
}
```

Before restart, read config back and require:

- `plugins.slots.memory = "mem9"`
- `plugins.entries.mem9.enabled = true`
- `plugins.entries.mem9.config.apiUrl` is present
- OpenClaw `4.23+` / `2026.4.22+`: `plugins.entries.mem9.hooks.allowConversationAccess = true`
- OpenClaw `>= 2.2.0`: `plugins.allow` contains `"mem9"`
- Reconnect: `plugins.entries.mem9.config.apiKey` exactly equals `USER_PROVIDED_MEM9_API_KEY`
- Create-new: `plugins.entries.mem9.config.apiKey` is absent, and `plugins.entries.mem9.config.provisionToken` exactly equals `PROVISION_TOKEN`
- Create-new with UTM: `plugins.entries.mem9.config.provisionQueryParams` exactly equals `REMOTE_SKILL_UTM_PARAMS`

Do not restart until read-back passes. If it cannot pass, use `TROUBLESHOOTING.md`.

### 5. Restart And Resume

Restart the gateway once after read-back passes:

```bash
openclaw gateway restart
```

Tell the user to return to this chat in a few minutes and send `hi`.

When the user returns, resume verification automatically. Send at most one short progress sentence in the user's language after checks have actually started. Do not ask whether to continue.

Reconnect verification:

- Confirm OpenClaw loads mem9 without plugin/config errors.
- Confirm the plugin can reach `https://api.mem9.ai` or shows positive mem9 health logs.
- Confirm reconnect did not auto-provision a different key.
- Empty memory results are acceptable.

Create-new verification:

- Provisioning runs from the mem9 plugin's `before_prompt_build` hook on an OpenClaw agent turn. The user's post-restart `hi` is a resume signal; do not assume that same control chat already ran gateway/plugin hooks.
- Do not check only `plugins.entries.mem9.config.apiKey`; it stays absent by design.
- Check recent mem9 logs and the matching local state under `~/.openclaw/mem9/provision/`.
- Matching state is keyed by `sha256(JSON.stringify({apiUrl, provisionToken, provisionQueryParams: sortedProvisionQueryParams})) + ".json"`, where missing `provisionQueryParams` is `{}`.
- If no generated key is found and there is no mem9 startup/config error, run exactly one local OpenClaw agent turn in the same resumed turn:

```bash
openclaw agent --session-id mem9-setup-provision --message "mem9 setup trigger: reply with OK only" --timeout 180 --json
```

- Re-check logs and provision state after that trigger.
- If a stable generated key exists, use it as `MEM9_API_KEY` in the final handoff.
- Do not schedule a second restart just to persist `apiKey` in `openclaw.json`.
- If no key appears after the one trigger, use `TROUBLESHOOTING.md`; do not ask for another `hi`.

Positive mem9 health signals include:

- `[mem9] Injecting N memories into prompt context`
- `[mem9] Ingest accepted for async processing`
- `[mem9] Ingested session: memories_changed=...`
- `[mem9] *** Auto-provisioned apiKey=...`
- `[mem9] reusing locally persisted create-new API key for this provisionToken`
- `[mem9] Server mode (v1alpha2)` with no later startup error

If recent logs contain a positive health signal, treat mem9 as healthy even if `openclaw status` briefly says `enabled (plugin mem9) · unavailable`.

### 6. Finish

Success requires:

- plugin install completed through OpenClaw
- config read-back passed before restart
- gateway restarted
- plugin loaded without mem9 startup/config errors
- reconnect: active key is still `USER_PROVIDED_MEM9_API_KEY`
- create-new: one stable generated key was verified from logs or local provision state

When success is reached, send the Required Success Handoff template from this file immediately. Do not replace it with a summary and do not append diagnostics.

## Post-Setup Use

- After setup succeeds, do not route `remember this`, `save this for later`, `save this to mem9`, `don't forget this`, `记住`, `记下来`, or `保存一下` back into setup.
- Treat explicit remember/save requests as direct mem9 write requests.
- Preserve the user's original language in saved memory content.
- For explicit writes, attempt the actual mem9 write path before replying, then say only whether the write succeeded or failed in the user's language.
- If the user asks whether something was recorded in mem9, confirm from actual mem9 write state rather than inferring from an earlier reply.
