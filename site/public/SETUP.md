# mem9 Setup

Use this file only for first-run mem9 onboarding.

## First Reply

When this file is read, send ONLY the choice prompt below. Do not include environment details, OpenClaw version, config file paths, config keys, restart counts, dry-run information, or approval phrases in this first message. The dry-run preview is a separate step that comes after the user selects a path.

> I can help you set up mem9.
>
> Choose one path:
> 1. Create a new mem9 API key during setup
> 2. Reconnect an existing mem9 API key
>
> If you choose reconnect, paste your existing API key.

## Safety Rules

- Only edit the exact `openclaw.json` keys listed in `SKILL.md`.
- Do not upload local history from this setup flow.
- Do not use direct web-request commands, raw memory API calls, or scripted shell patch commands in this public setup flow.
- Do not change the user's global npm registry config during setup unless the user explicitly asks for a permanent mirror change.
- Reconnect and create-new are separate branches. Once one branch is selected, ignore the other branch unless the user explicitly changes their choice.
- The allowed config scope is exhaustive. Never add fallback keys outside it. In particular, never write `plugins.entries.mem9.apiKey`; only `plugins.entries.mem9.config.apiKey` is valid.
- In create-new mode, generate `PROVISION_TOKEN` once immediately after the branch is selected, write it under `plugins.entries.mem9.config.provisionToken` before the first restart, and keep that exact value stable through the first successful post-restart provision on this machine.
- Before taking any action, show one dry-run preview that covers install, config edits, expected restarts, and what the user must do after the restart.
- Use one explicit approval for the entire disclosed flow. Do not ask for a second approval unless the scope materially changes.
- In create-new mode, if the remote `SKILL.md` URL contains filtered `utm_*` params, do not proceed to the first restart until `plugins.entries.mem9.config.provisionQueryParams` has been disclosed and read back exactly.
- If install schedules or hints at a deferred restart, the pre-restart config read-back is still a hard gate. Do not let the first restart happen with only a partial mem9 config update applied.

## Terminology

- User-facing term: `API key`
- Current config field: `apiKey`
- Legacy alias: `tenantID`
- Local variable name when needed: `MEM9_API_KEY`
- Reconnect source of truth: `USER_PROVIDED_MEM9_API_KEY`
- Create-new source of truth: `AUTO_PROVISIONED_MEM9_API_KEY`
- Create-new idempotency source of truth before the first restart: `PROVISION_TOKEN`
- Create-new attribution source of truth when present: `REMOTE_SKILL_UTM_PARAMS`

## Attribution Rule

- If this setup flow was reached from a remotely loaded `SKILL.md` URL that contains query params whose keys start with `utm_`, capture those filtered `utm_*` pairs immediately and store the exact map as `REMOTE_SKILL_UTM_PARAMS`.
- In create-new mode, the dry-run preview, config write, and pre-restart config read-back must all include `plugins.entries.mem9.config.provisionToken = PROVISION_TOKEN`.
- In create-new mode, if `REMOTE_SKILL_UTM_PARAMS` is non-empty, the dry-run preview, config write, and pre-restart config read-back must all include `plugins.entries.mem9.config.provisionQueryParams = REMOTE_SKILL_UTM_PARAMS`.
- Reuse the exact filtered `REMOTE_SKILL_UTM_PARAMS` map through the first restart. Do not rename keys, drop keys, or rebuild the map from memory later in the flow.
- Copy only `utm_*` keys. Do not copy non-UTM query params.
- Do not add or modify `provisionToken` in reconnect mode.
- Do not add or modify `provisionQueryParams` in reconnect mode.
- If no `utm_*` params are present on the current remote `SKILL.md` URL, leave `provisionQueryParams` absent.
- If the setup was started from pasted text rather than a remotely loaded `SKILL.md` URL and the runtime cannot verify the source URL, do not invent UTM params.

## Step 0 — Choose Create Or Reconnect

- If the user chooses reconnect, lock the flow to reconnect, store the pasted value as `USER_PROVIDED_MEM9_API_KEY`, and continue.
- If the user chooses create, lock the flow to create-new and continue without an API key for now.
- Do not switch branches later unless the user explicitly changes their choice.
- Do not probe the API key with standalone API calls. Verification happens later through the plugin.
- After the branch is selected, show one dry-run preview before doing anything else.
- The dry-run preview must include:
  - package name
  - exact config keys that may change
  - selected branch: reconnect or create-new
  - expected restart count
  - local history will not be uploaded by this setup flow
  - a short restart-and-return instruction in the user's language that says the gateway will restart automatically, the user should return to this chat in a few minutes, and the user should say `hi`
- In create-new mode, the exact config keys list must explicitly include `plugins.entries.mem9.config.provisionToken`.
- In create-new mode, if `REMOTE_SKILL_UTM_PARAMS` is non-empty, the exact config keys list must explicitly include `plugins.entries.mem9.config.provisionQueryParams`.
- Approval phrases:
  - reconnect after the key is already captured: `approve reconnect`
  - create-new: `approve create`
- Do not ask the user to repeat the full API key in the approval line after it has already been captured.
- Ask for one approval for the full disclosed flow. After that approval, proceed through install, config, restart, and verification without asking again unless the scope changes.

### Required Pre-Approval Prompt

Before showing `approve reconnect` or `approve create`, the dry-run preview must already make the restart and return path explicit.

Required structure:

```text
If that looks good, reply exactly:

approve reconnect

[Then send one short restart-and-return instruction in the user's language telling the user that the gateway will restart automatically, they should return to this chat in a few minutes, and they should say `hi`.]
```

Create-new uses the same structure but with `approve create`.

Do not rely on the post-approval notice as the only place where restart and return instructions are shown.

## Step 1 — Install Plugin

The dry-run preview must disclose:

- package name: `@mem9/mem9`
- install may use a one-shot `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com` override when the default npm registry is slow or unreachable
- only mem9 plugin config keys will be changed
- plugin install happens before any config write that points `plugins.slots.memory` at `mem9`
- reconnect path expects one restart after config is written and read back
- create-new path expects one restart without `apiKey`; after the restart, the first user message must trigger exactly one create-new provision through the normal plugin hook path
- create-new path will also write one unique `provisionToken` before the first restart so repeated post-restart retries on this machine collapse to the same key
- if create-new has `REMOTE_SKILL_UTM_PARAMS`, the dry-run must explicitly say those filtered `utm_*` values will be written under `plugins.entries.mem9.config.provisionQueryParams` before the first restart
- local history will not be uploaded by this setup flow
- one short restart-and-return instruction in the user's language

Before installing, detect npm registry reachability first. On mainland China / Alibaba Cloud networks, the default npm registry is often slow or unstable. Prefer a one-shot registry override instead of changing the user's global npm config.

Install command sequence:

```bash
NPMJS_TIME="$(curl -o /dev/null -sS --connect-timeout 2 --max-time 6 -w '%{time_total}' https://registry.npmjs.org/@mem9%2fmem9 || echo timeout)"
MIRROR_TIME="$(curl -o /dev/null -sS --connect-timeout 2 --max-time 6 -w '%{time_total}' https://registry.npmmirror.com/@mem9%2fmem9 || echo timeout)"

if [ "$MIRROR_TIME" != "timeout" ] && { [ "$NPMJS_TIME" = "timeout" ] || awk "BEGIN { exit !($NPMJS_TIME > 2 && $MIRROR_TIME < $NPMJS_TIME) }"; }; then
  echo "Using China npm mirror: https://registry.npmmirror.com"
  NPM_CONFIG_REGISTRY=https://registry.npmmirror.com openclaw plugins install @mem9/mem9
else
  openclaw plugins install @mem9/mem9
fi
```

Decision rule:

- If the official npm registry times out, but `npmmirror` is reachable, treat that as a China-optimized network path and use `https://registry.npmmirror.com`.
- If both registries are reachable, but the official registry is materially slower, prefer `npmmirror`.
- Do not run `npm config set registry ...` globally unless the user explicitly asks for a permanent npm mirror change.
- Do not write `plugins.slots.memory = "mem9"`, `plugins.entries.mem9`, or `plugins.allow += "mem9"` before `openclaw plugins install @mem9/mem9` succeeds.
- OpenClaw validates the configured slot plugin during reload. If config points `plugins.slots.memory` at `mem9` before the plugin exists locally, the config becomes invalid and install/reload can fall into an avoidable recovery path.

Preflight failure rule:

- If install fails because the plugin already exists locally, classify that as a stale local mem9 install residue issue.
- Treat a leftover local extension directory such as `~/.openclaw/extensions/mem9` as local uninstall residue, not as a reconnect or API-key problem.
- In that case, stop before config edits or restart and use `TROUBLESHOOTING.md` from the same directory.
- Do not improvise a new install branch after the dry-run.
- A second approval is only acceptable if the original disclosed scope did not already cover local mem9 cleanup.
- If the current `openclaw.json` is already invalid because `plugins.slots.memory = "mem9"` but the plugin is not installed yet, treat that as broken local mem9 wiring from an earlier failed setup attempt.
- In that specific case, the original setup approval already covers a temporary rollback of only the disclosed mem9 wiring to the currently valid memory slot, then plugin install, then restoration of the approved mem9 config.
- Do not ask for an extra `approve recovery install` for that specific missing-plugin recovery. It is part of the same setup scope.

### Required Post-Install Notice

Immediately after install completes, and before any restart action or restart tool call, send a clear user-visible notice.

Recommended notice content:

```text
✅ mem9 plugin installed. Next I need to restart the OpenClaw gateway so the plugin can load and the mem9 hooks become active.

The restart will take about 1 minute. After that, send me a message to confirm mem9 is functional.
```

- If the gateway will be restarted automatically through tools or exec, send this notice before issuing the restart action.
- Do not rely on the final assistant reply as the first place this notice appears.
- Do not stop after install and wait for another user message before Step 2 or Step 3.
- If `openclaw plugins install @mem9/mem9` schedules a deferred gateway restart, finish OpenClaw version detection, mem9 config writes, and config read-back in that same approved turn before the deferred restart is allowed to fire.
- If install succeeds, `plugins.slots.memory = "mem9"` must still not be written until Step 3 starts its single approved config update.
- After the restart finishes, ask the user to wait about 1 minute and send a short message such as `hi`.

### Required Post-Approval Notice

Immediately after the single approval, and before running install, config edits, or restart, send a clear notice.

Reconnect notice:

```text
Approved. I’m starting mem9 reconnect now.

[Then send one short restart-and-return instruction in the user's language.]
```

Create-new notice:

```text
Approved. I’m starting mem9 setup now.

[Then send one short restart-and-return instruction in the user's language.]
```

The restart-and-return instruction must stay short and must tell the user all three points:

- the gateway will restart automatically
- the user should return to this same chat in a few minutes
- the user should say `hi`
- do not claim post-restart verification is already running in this same notice

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
- Do not write any mem9 key before Step 1 install succeeds
- If create-new is selected, include `plugins.entries.mem9.config.provisionToken` in the disclosed key list
- If create-new is selected, read back `plugins.entries.mem9.config.provisionToken` before the first restart and require an exact match to `PROVISION_TOKEN`
- If create-new started from a remote `SKILL.md` URL with `utm_*` params, include `plugins.entries.mem9.config.provisionQueryParams` in the disclosed key list
- If create-new has `REMOTE_SKILL_UTM_PARAMS`, read back `plugins.entries.mem9.config.provisionQueryParams` before the first restart and require an exact key/value match
- Apply the mem9 config in one contiguous update after install succeeds. Do not split it into a pre-install slot switch and a later config write.
- `plugins.entries.mem9.apiKey` at the entry top level is invalid on OpenClaw. Never duplicate or mirror the secret there as a compatibility fallback.

### Reconnect Existing API Key

Effective changes for OpenClaw `>= 2.2.0`:

- `plugins.slots.memory = "mem9"`
- `plugins.entries.mem9.enabled = true`
- `plugins.entries.mem9.config.apiUrl = "https://api.mem9.ai"` unless the user chose another `apiUrl`
- `plugins.entries.mem9.config.apiKey = "<USER_PROVIDED_MEM9_API_KEY>"`
- `plugins.allow` includes `"mem9"`

Reconnect hard rules:

- In reconnect mode, never leave `plugins.entries.mem9.config.apiKey` absent for the first restart.
- The only valid reconnect secret path is `plugins.entries.mem9.config.apiKey`.
- Do not write or test `plugins.entries.mem9.apiKey` at the entry top level. OpenClaw rejects it before the plugin loads.
- Immediately after writing config, read back `plugins.entries.mem9.config.apiKey`.
- The read-back value must exactly match `USER_PROVIDED_MEM9_API_KEY` before the first restart.
- If the read-back value is missing or different, fix config first. Do not restart yet.
- If legacy `tenantID` is also present in old config, `apiKey` still becomes the reconnect source of truth.

Minimal shape if creating a fresh file:

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

For OpenClaw `< 2.2.0`, use the same shape without `plugins.allow`.

### Create New API Key During Setup

Effective changes for OpenClaw `>= 2.2.0`:

- `plugins.slots.memory = "mem9"`
- `plugins.entries.mem9.enabled = true`
- `plugins.entries.mem9.config.apiUrl = "https://api.mem9.ai"` unless the user chose another `apiUrl`
- Leave `plugins.entries.mem9.config.apiKey` absent for the first restart
- Set `plugins.entries.mem9.config.provisionToken = "<PROVISION_TOKEN>"` for the first restart
- If the current remote `SKILL.md` URL has `utm_*`, set `plugins.entries.mem9.config.provisionQueryParams` to the same filtered `utm_*` map for the first restart
- `plugins.allow` includes `"mem9"`

Create-new hard rules:

- Only the create-new branch may leave `apiKey` absent for the first restart.
- Only the create-new branch may accept a generated key as the final mem9 credential.
- Never start the first restart in create-new mode with `plugins.entries.mem9.config.provisionToken` absent, regenerated, or different from `PROVISION_TOKEN`.
- Immediately after writing config in create-new mode, read back `plugins.entries.mem9.config.provisionToken`.
- The read-back value must exactly match `PROVISION_TOKEN` before the first restart.
- If `REMOTE_SKILL_UTM_PARAMS` is non-empty, never start the first restart with `plugins.entries.mem9.config.provisionQueryParams` absent, partial, renamed, or different.
- If `REMOTE_SKILL_UTM_PARAMS` is non-empty, immediately after writing config, read back `plugins.entries.mem9.config.provisionQueryParams`.
- The read-back map must exactly match `REMOTE_SKILL_UTM_PARAMS` before the first restart.
- If the read-back map is missing or different, fix config first. Do not restart yet.

Minimal shape if creating a fresh file:

```json
{
  "plugins": {
    "slots": { "memory": "mem9" },
    "entries": {
      "mem9": {
        "enabled": true,
        "config": {
          "apiUrl": "https://api.mem9.ai",
          "provisionToken": "<generated-provision-token>"
        }
      }
    },
    "allow": ["mem9"]
  }
}
```

If remote-skill `utm_*` params are present, add them under `config.provisionQueryParams` before the first restart, alongside the same `provisionToken`, for example:

```json
{
  "plugins": {
    "entries": {
      "mem9": {
        "config": {
          "apiUrl": "https://api.mem9.ai",
          "provisionToken": "<generated-provision-token>",
          "provisionQueryParams": {
            "utm_source": "bosn",
            "utm_campaign": "spring"
          }
        }
      }
    }
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
[mem9] *** Auto-provisioned apiKey=<id> *** Save this for recovery or reconnect as apiKey
```

- If that happens, follow this recovery sequence:
  1. stop treating the current run as successful
  2. inspect the persisted `plugins.entries.mem9.config.apiKey` value
  3. rewrite `USER_PROVIDED_MEM9_API_KEY` to the correct field
  4. read back config again and confirm exact match
  5. restart and verify again
- If the key still drifts or auto-provisions again, stop and use `TROUBLESHOOTING.md`.
- Do not hand off the new key to the user in reconnect mode.

### Create-New Path

1. Restart once with `apiKey` absent
   That same restart must already have the exact `plugins.entries.mem9.config.provisionToken = PROVISION_TOKEN` in config.
   If `REMOTE_SKILL_UTM_PARAMS` is non-empty, that same restart must already have the exact `plugins.entries.mem9.config.provisionQueryParams` map present in config.
2. After the user returns from that restart, resume verification in the current turn.
3. Let the first resumed user message trigger the plugin's automatic create-new provision through the normal hook path. Do not wait for startup auto-provision logs, and do not rely on any internal plugin tool.
4. Read recent gateway logs and extract the single generated key as `AUTO_PROVISIONED_MEM9_API_KEY`
5. Do not schedule a second mem9-only restart just to persist `apiKey` in `openclaw.json`
6. Proceed directly to verification once the generated key and positive health signals are confirmed

If the first resumed turn does not produce a key in logs, stop and use `TROUBLESHOOTING.md`.

If the gateway logs show a generated key before the first resumed user message after the restart, treat that as abnormal startup behavior and stop the happy path.

If multiple different keys appear during one create-new run, treat that as an abnormal flow, not as success-by-default:

1. stop the happy-path handoff
2. verify whether `REMOTE_SKILL_UTM_PARAMS` was present in config before the first successful provision
3. verify whether `PROVISION_TOKEN` stayed stable for that entire create-new run
4. verify whether only one post-restart provision request was made before success
5. verify whether later logs reused the same locally persisted key for the same `PROVISION_TOKEN`
6. if attribution, token stability, call-count, or final-key correctness cannot be confirmed, stop and use `TROUBLESHOOTING.md` instead of silently keeping the latest key

### Post-Restart Resume Contract

- When the user returns after a restart and sends `hi` or another short message, resume verification automatically.
- Do not ask `Want me to continue?`
- The first resume reply must be short and user-facing, and it may only be sent after the post-restart checks have actually started in the current turn.
- For example: `Resuming mem9 verification after the gateway restart now. You do not need to do anything right now.`
- Keep user-facing restart and resume notices in the user's language instead of replaying fixed English strings verbatim.
- Do not enumerate internal checklists, log lines, temporary status flips, or diagnostic reasoning in the resume reply.
- Do not stream intermediate verification details to the user unless the flow is blocked or has failed.
- After the first post-restart `hi`, either finish verification in that resumed turn or surface a concrete blocking problem.
- Do not ask for another keepalive message while the only missing step is the plugin's first-message create-new provision; that step must be driven by the same resumed turn.
- Do not ask for repeated keepalive messages such as another `hi` unless a real additional restart occurred after the first resumed turn began.
- If the first resumed turn already produced the generated key and no mem9-specific startup error remains, treat that same turn as the happy-path verification turn. Do not ask for another `hi` just to confirm that create-new already ran.
- If the first post-restart host status briefly reports memory as unavailable, do one silent re-check before telling the user anything else.
- That silent re-check must use the current config plus mem9-specific logs or activity to confirm whether the plugin is actually healthy.
- If the silent re-check shows mem9 loaded successfully, reached the API, or resumed injecting memories, continue directly to the final handoff and do not mention the transient unavailable state.
- Only surface a user-facing problem after the re-check still fails or the user must take action.
- Do not use vague wording like `mid-flight` or `system event` by itself.
- If there was a real abnormal interruption beyond the normal restart, say only the minimum needed:
  - setup is still verifying after the restart
  - one issue remains
  - the user does not need to do anything yet unless asked
- If the host cannot durably resume on its own, the pre-restart restart-and-return instruction remains the source of truth; do not improvise stronger promises about automatic continuation.

### Positive Health Signals

Any one of the following in recent gateway logs means the plugin is healthy, regardless of what `openclaw status` reports:

- `[mem9] Injecting N memories into prompt context` (where N is any number including 0)
- `[mem9] Ingest accepted for async processing`
- `[mem9] Ingested session: memories_changed=...`
- `[mem9] Server mode (v1alpha2)` with no subsequent plugin startup error

If any positive health signal is present, treat the plugin as operational and proceed to the final handoff. Do not treat `openclaw status` showing `enabled (plugin mem9) · unavailable` as failure when logs show positive activity. That transient status is a known OpenClaw probe timing issue immediately after restart.

## Step 5 — Verify

### Reconnect Success Criteria

Reconnect is successful only if all of the following are true:

- `plugins.entries.mem9.config.apiKey` was read back before the first restart and exactly matched `USER_PROVIDED_MEM9_API_KEY`
- The plugin can reach the mem9 API
- OpenClaw loads the mem9 plugin without config or plugin errors
- The first valid startup did not auto-provision a new key
- The final active mem9 credential is still `USER_PROVIDED_MEM9_API_KEY`
- A transient immediately-after-restart host status of `enabled (plugin mem9) · unavailable` is not failure by itself if the silent re-check succeeds without user action
- Empty memory results are acceptable
- If install never completed because a stale local mem9 directory blocked `openclaw plugins install @mem9/mem9`, reconnect has not started yet. Treat that as a local cleanup failure and use `TROUBLESHOOTING.md` instead of continuing to config write or restart.

**Verification priority**: Log-based health signals take precedence over `openclaw status`. If `openclaw status` shows `enabled (plugin mem9) · unavailable` but recent logs contain any positive health signal listed in the Positive Health Signals section above, the plugin is healthy and verification passes. This transient unavailable state is a known OpenClaw probe timing issue and must not block the final handoff.

### Create-New Success Criteria

Create-new is successful only if all of the following are true:

- The plugin can reach the mem9 API
- OpenClaw loads the mem9 plugin without config or plugin errors
- The create-new flow produced a key from exactly one post-restart provision request after the first restart
- `PROVISION_TOKEN` was written before the first restart and remained stable for the create-new run
- If `REMOTE_SKILL_UTM_PARAMS` is non-empty, `plugins.entries.mem9.config.provisionQueryParams` was read back before the first restart and exactly matched that map
- No different additional key replaced `AUTO_PROVISIONED_MEM9_API_KEY` later in the same create-new run
- The plugin is running with the generated key on this machine (confirmed by positive health signals or absence of startup errors)
- Empty memory results are acceptable for a new mem9 space

**Verification priority**: Log-based health signals take precedence over `openclaw status`. If `openclaw status` shows `enabled (plugin mem9) · unavailable` but recent logs contain any positive health signal listed in the Positive Health Signals section above, the plugin is healthy and verification passes. This transient unavailable state is a known OpenClaw probe timing issue and must not block the final handoff.

## Step 6 — Required Final Handoff

- Once success criteria are met, send the final handoff directly.
- Do not append extra diagnostic commentary, transient restart notes, log summaries, or internal verification reasoning after the final handoff.

### Reconnect Final Handoff

Use this only when reconnect succeeded. Do not replace it with any auto-provisioned key:

```text
✅ Your mem9 API key is connected.
🧭 WHAT YOU CAN DO NEXT

You can also go to https://mem9.ai/your-memory/ to visually manage, analyze, import, and export your memories.
Sign in there with the same mem9 API key from this setup.
If the dashboard still shows "Space ID", enter the same mem9 API key.
Use the dashboard or another reviewed manual workflow if you want to import older history later.
This setup did not upload any local files.
If you later ask me to remember something, I should write it to mem9 and tell you whether the write succeeded.


💾 YOUR RECONNECTED MEM9 API KEY

USER_PROVIDED_MEM9_API_KEY: <same-key-the-user-pasted-earlier>

This must be the same API key the user provided earlier.
Use this same value as MEM9_API_KEY in recovery or on another trusted machine.
Keep it private and store it somewhere safe.


♻️ RECOVERY

Reinstall mem9 and use the same USER_PROVIDED_MEM9_API_KEY as MEM9_API_KEY in the plugin config.
Your memory will reconnect instantly.


📦 BACKUP PLAN

Keep your original local memory/session files as backup if you plan to import them later.
Also store the USER_PROVIDED_MEM9_API_KEY in a password manager or secure vault.
```

### Create-New Final Handoff

Use this only when create-new succeeded and the single post-restart provision produced a stable key:

```text
✅ Your mem9 API key is ready.
🧭 WHAT YOU CAN DO NEXT

You can also go to https://mem9.ai/your-memory/ to visually manage, analyze, import, and export your memories.
Sign in there with the same mem9 API key from this setup.
If the dashboard still shows "Space ID", enter the same mem9 API key.
Use the dashboard or another reviewed manual workflow if you want to import older history later.
This setup did not upload any local files.
If you later ask me to remember something, I should write it to mem9 and tell you whether the write succeeded.


💾 YOUR NEW MEM9 API KEY

AUTO_PROVISIONED_MEM9_API_KEY: <generated-key>

This machine will keep using the same generated key for this create-new run.
Use this same value as MEM9_API_KEY in recovery or on another trusted machine.
Keep it private and store it somewhere safe.


♻️ RECOVERY

Reinstall mem9 and use the same AUTO_PROVISIONED_MEM9_API_KEY as MEM9_API_KEY in the plugin config.
Your memory will reconnect instantly.


📦 BACKUP PLAN

Keep your original local memory/session files as backup if you plan to import them later.
Also store the AUTO_PROVISIONED_MEM9_API_KEY in a password manager or secure vault.
```

Do not replace these handoffs with a demo or a synthetic write/read test unless the user explicitly asks for a test.

## Post-Setup Continuation Rule

- After setup succeeds, do not route `remember this`, `save this for later`, `save this to mem9`, `don't forget this`, `记住`, `记下来`, `保存一下`, or equivalent requests back into setup, reconnect, or uninstall.
- If the user then asks `what did I say last time?`, `recall my preferences`, `forget that`, `我上次说过什么`, `回忆一下我的偏好`, `忘掉这件事`, or equivalent, treat that as steady-state mem9 recall or memory management rather than onboarding.
- If the user then makes an explicit remember or save request, treat it as a direct mem9 write request.
- When writing to mem9, preserve the user's original language in the stored content. Do not translate. If the user writes in Chinese, the stored memory content must be in Chinese.
- First attempt the actual synchronous mem9 write path before replying.
- Do not treat background or delayed capture as the success path for an explicit remember or save request.
- Interpret equivalent memory-management intent in any language.
- For explicit write requests, send either:
  - a short success confirmation in the user's language
  - or a short failure reason in the user's language
- Do not use an unverified conversational acknowledgment unless the write has actually succeeded.
- Do not mention internal tool names, write-interface availability, background ingest behavior, or routing details in the user-facing reply.
- If the user asks whether something was recorded in mem9, do not infer from an earlier reply. Confirm using actual mem9 write state before answering.
