# mem9 Beta Troubleshooting

Use this file for reconnect, setup failures, uninstall failures, and dashboard/login confusion after the main mem9 beta flow.

## Quick Checks

Confirm these first:

- `plugins.slots.memory` is set to `mem9`
- `plugins.slots.contextEngine` is set to `mem9`
- `plugins.entries.mem9.enabled` is `true`
- `plugins.entries.mem9.config.apiUrl` points to the intended mem9 API
- `plugins.entries.mem9.config.tenantID` is present for the steady-state reconnect flow
- In reconnect mode, the read-back value of `plugins.entries.mem9.config.tenantID` exactly matches the user's original space ID before the first restart
- On OpenClaw `>= 2.2.0`, `plugins.allow` includes `mem9`

## Common Issues

### Plugin Does Not Load

- Re-check the memory slot, context engine slot, and enabled flag
- Re-check that the beta package was installed successfully
- Re-check that the config only edits the exact mem9 keys and does not corrupt unrelated JSON

### Create-New Flow Did Not Auto-Provision

- Make sure the first restart happened with `plugins.entries.mem9.config.tenantID` absent
- Look for the exact log line:

```text
[mem9] *** Auto-provisioned apiKey=<id> *** Save this to your config as apiKey
```

- In beta, treat `<id>` as the new `MEM9_SPACE_ID`
- If no such line appears, stop the first-run flow and ask the user whether to retry the restart or switch to reconnect with an existing space ID

### Existing Space ID Fails After Reconnect

- Re-check the value for typos
- Re-check `apiUrl`
- Re-check that the same space ID was written to `plugins.entries.mem9.config.tenantID`
- Re-check that config was read back before restart and matched the user-provided space ID exactly
- Re-check for OpenClaw plugin or config errors after restart

### Existing Space ID Was Replaced By A New Auto-Provisioned Identifier

- Treat this as reconnect failure, not success
- Do not hand off the auto-provisioned identifier to the user
- Re-check the write order: the user-provided space ID must be saved before the first restart
- Re-check the exact config path: `plugins.entries.mem9.config.tenantID`
- Re-check the read-back value from `openclaw.json` before the first restart
- Rewrite the original user-provided space ID to the correct field
- Restart and verify again
- If a new identifier is still auto-provisioned after that, stop the reconnect flow and keep troubleshooting instead of silently switching mem9 spaces

### Removed mem9 But Gateway Will Not Start

- Treat this as uninstall failure, not success
- First re-check the current config read-back
- The most common cause is `plugins.slots.memory` still pointing to `mem9`
- In beta, also re-check whether `plugins.slots.contextEngine` still points to `mem9`
- Also re-check whether `plugins.entries.memory-core.enabled = true` after restoring the default memory slot
- Re-check that `plugins.entries.mem9` was removed
- Re-check that `plugins.installs.mem9` was removed if it existed before
- Re-check that `"mem9"` is no longer present in `plugins.allow`
- After the config read-back, inspect the gateway logs for the exact startup error
- If the config still matches the uninstall failure pattern, re-apply the safe rollback from `UNINSTALL.md` before trying another restart

### User Said Remember After Setup, But Nothing Was Written To mem9

- First decide whether the user made an explicit durable-write request such as `remember this`, `save this to mem9`, `store this in mem9`, `记住`, or `记下来`
- If yes, do not treat it as a setup-success question and do not re-run onboarding
- Route it to the live mem9 write path instead, preferably `memory_store`
- Do not accept `agent_end` asynchronous auto-ingest as the success signal for an explicit write request
- If the write still fails, then troubleshoot tool availability, plugin load state, and mem9 API reachability
- Do not tell the user `记住了` unless mem9 actually stored the memory

### User Returned After Restart But Verification Is Still In Progress

- This usually means the gateway restart finished but verification has not completed yet
- Resume verification automatically; do not ask whether the user wants to continue
- First check gateway status, recent mem9-related logs, and the current config read-back
- Tell the user clearly that verification is resuming after the restart and that final success has not been declared yet
- Default to "no action needed right now" unless the verification step truly needs new user input
- Do not send the final success handoff until verification is actually complete
- If there was a real interruption beyond the normal restart, say exactly which step was incomplete and what you are resuming now instead of using vague phrases like `mid-flight` or `system event`

### Dashboard Still Shows "Space ID"

- In the current dashboard, `Space ID` refers to the same mem9 beta credential
- Enter the same `MEM9_SPACE_ID`

### China Network / npm Registry Problems

- Retry installation with a temporary npm mirror such as `https://registry.npmmirror.com`
- Avoid changing the user's global npm config unless they explicitly ask

## Reconnect On A New Machine

- Install the mem9 beta plugin
- Write the same `MEM9_SPACE_ID` into `plugins.entries.mem9.config.tenantID`
- Keep the same `apiUrl` unless the user intentionally changed servers
- Restart OpenClaw

## Legacy Compatibility

- `tenantID`, `SPACE_ID`, and the beta user-facing `space ID` all refer to the same mem9 beta credential
- Keep saying `space ID` to end users
- Keep using `tenantID` in raw beta plugin config
