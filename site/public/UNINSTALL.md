# mem9 Uninstall

Use this file only when the user explicitly wants to remove mem9 from this machine.

## First Reply

When this file is read, start with this structure:

> I can help you uninstall mem9 from this machine and restore OpenClaw's local memory config.
>
> This removes the local mem9 plugin wiring and local mem9 install residue from this machine.
> It does not delete remote mem9 cloud data.
> It does not revoke your mem9 API key.
> It does not reset the current chat session as part of this uninstall flow.
>
> I will show one dry-run preview and ask for a single approval for the full uninstall flow.

## Safety Rules

- Only remove or restore the local OpenClaw keys needed to stop using mem9 on this machine.
- Treat the local mem9 extension directory under `~/.openclaw/extensions/mem9` as part of uninstall scope.
- Do not promise remote mem9 data deletion from this uninstall flow.
- Do not revoke or rotate the user's mem9 API key from this uninstall flow.
- Do not leave OpenClaw in an intermediate state where `plugins.slots.memory` still points to `mem9` after the plugin is gone.
- Do not perform `reset session` or any equivalent current-session reset inside this uninstall flow.
- Do not trigger a second explicit gateway restart after the config rollback has already scheduled or completed the required restart.
- Preserve unrelated config keys.
- Use one explicit approval for the entire disclosed flow. Do not ask for a second approval unless the scope materially changes.

## Step 0 — Dry-Run Preview And Approval

- Before making any changes, show one dry-run preview.
- The preview must include:
  - plugin id: `mem9`
  - package family being removed: `@mem9/mem9`
  - local mem9 install residue may be removed from `~/.openclaw/extensions/mem9`
  - exact config keys that may change
  - expected restart count: `1`
  - that this flow does not delete remote mem9 data
  - that this flow does not reset the current chat session automatically
  - a short restart-and-return instruction in the user's language that says the gateway will restart automatically, the user should return to this chat in a few minutes, and the user should say `hi`
- Approval phrase:
  - `approve uninstall`

Required prompt structure:

```text
Dry-run preview:
Plugin to remove: mem9
Package family: @mem9/mem9
Local install residue that may be removed: ~/.openclaw/extensions/mem9
Exact config keys that may change only:
plugins.slots.memory
plugins.entries.memory-core.enabled
plugins.entries.mem9
plugins.installs.mem9
plugins.allow
Expected restarts: 1
Remote mem9 data deletion: will not happen in this uninstall flow
Current session reset: will not happen automatically in this uninstall flow

If that looks good, reply exactly:

approve uninstall

[Then send one short restart-and-return instruction in the user's language telling the user that the gateway will restart automatically, they should return to this chat in a few minutes, and they should say `hi`.]
```

## Step 1 — Prepare Config Rollback

Before uninstalling the plugin:

- Show the exact keys that will change.
- Prepare the final safe local config state first.
- Apply the rollback in one config edit so the gateway never restarts with `plugins.slots.memory = "mem9"` after mem9 is gone.
- If the user asked to `reset session`, acknowledge that as a follow-up suggestion after uninstall verification completes. Do not include it in the actual uninstall execution steps.

Rollback rules:

- If `plugins.slots.memory = "mem9"`, set `plugins.slots.memory = "memory-core"`.
- If the memory slot is being restored to `memory-core`, set `plugins.entries.memory-core.enabled = true`.
- Delete `plugins.entries.mem9` if it exists.
- Delete `plugins.installs.mem9` if it exists.
- Remove `"mem9"` from `plugins.allow` if it exists there.
- If `plugins.slots.memory` is already some non-mem9 value, do not overwrite that slot.
- Do not change any unrelated keys.

For OpenClaw `< 2.2.0`, use the same rollback shape without `plugins.allow`.

## Step 2 — Uninstall Plugin

Preferred command:

```bash
openclaw plugins uninstall mem9 --force
```

Hard rules:

- Use the approval already obtained in Step 0.
- If the uninstall command leaves any mem9 config residue behind, fix the config before restart.
- The plugin directory or install record may be removed by the uninstall command; do not rely on mem9 still being loadable after this step.
- The uninstall is not complete unless the local mem9 extension directory is absent after cleanup.
- If config rollback succeeds but the local mem9 extension directory under `~/.openclaw/extensions/mem9` still exists, treat that as uninstall failure, not success.
- If the rollback config already caused OpenClaw to schedule a deferred restart, treat that deferred restart as the only restart for this uninstall flow.

## Step 3 — Restart Flow

Before restart, send this notice:

```text
Approved. I’m starting mem9 uninstall now.

[Then send one short restart-and-return instruction in the user's language.]
```

The restart-and-return instruction must stay short and must tell the user all three points:

- the gateway will restart automatically
- the user should return to this same chat in a few minutes
- the user should say `hi`

- Use one restart only.
- If the rollback config or uninstall step already triggered a deferred gateway restart, do not issue another explicit restart command.
- Do not reset the current session before or after the restart.
- When the user returns and sends `hi` or another short message, resume verification automatically.
- Do not ask `Want me to continue?`
- The first resume reply must stay short and user-facing, for example:
- Keep user-facing restart and resume notices in the user's language instead of replaying fixed English strings verbatim.

```text
Resuming mem9 uninstall verification after the gateway restart now. You do not need to do anything right now.
```

## Step 4 — Verify

Success criteria:

- The gateway is running normally.
- The gateway no longer reports `plugins.slots.memory: plugin not found: mem9`.
- The active memory slot is not `mem9`.
- `plugins.entries.mem9` is gone.
- `plugins.installs.mem9` is gone if that install record existed before.
- `"mem9"` is no longer present in `plugins.allow` if that allowlist exists.
- The local mem9 extension directory under `~/.openclaw/extensions/mem9` is absent.
- If the memory slot was restored to `memory-core`, `plugins.entries.memory-core.enabled = true`.
- No extra uninstall-time `reset session` or second explicit restart was attempted after the first required restart was already in flight.

Failure rules:

- If the gateway does not come back up cleanly, do not declare success.
- If `plugins.slots.memory` still points to `mem9`, treat the uninstall as failed and fix config first.
- If the local mem9 extension directory is still present after uninstall, treat the uninstall as failed and keep cleaning local residue before declaring success.
- If verification fails, use `TROUBLESHOOTING.md` from the same directory.

## Step 5 — Required Final Handoff

Use this exact structure after successful verification:

```text
mem9 has been removed from this machine.

What changed locally:
- OpenClaw is no longer using the mem9 plugin for the memory slot
- mem9 config and install references were removed
- local mem9 install residue was removed from this machine
- the gateway restarted successfully

Important:
- This uninstall did not delete any remote mem9 cloud data
- This uninstall did not revoke your mem9 API key
- This uninstall did not reset the current chat session automatically

If you want to reconnect later:
- reinstall mem9
- use the same MEM9_API_KEY in the plugin config

If you want a clean chat after uninstall:
- start a new session after the gateway is healthy again
- or reset the session manually as a separate follow-up step

If you want to delete cloud data or manage memories directly:
- go to https://mem9.ai/your-memory/
```

Do not append extra internal diagnostics after the final handoff.
