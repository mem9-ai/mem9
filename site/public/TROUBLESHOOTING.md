# mem9 Troubleshooting

Use this file for reconnect, setup failures, uninstall failures, and dashboard/login confusion after the main mem9 flow.

## Quick Checks

Confirm these first:

- `plugins.slots.memory` is set to `mem9`
- `plugins.entries.mem9.enabled` is `true`
- `plugins.entries.mem9.config.apiUrl` points to the intended mem9 API
- `plugins.entries.mem9.config.apiKey` is present for the steady-state reconnect flow
- In reconnect mode, the read-back value of `plugins.entries.mem9.config.apiKey` exactly matches the user's original key before the first restart
- On OpenClaw `>= 2.2.0`, `plugins.allow` includes `mem9`

## Common Issues

### Plugin Does Not Load

- Re-check the memory slot and enabled flag
- Re-check that the mem9 package was installed successfully
- Re-check that the config only edits the exact mem9 keys and does not corrupt unrelated JSON

### Create-New Flow Did Not Auto-Provision

- Make sure the first restart happened with `plugins.entries.mem9.config.apiKey` absent
- Look for the exact log line:

```text
[mem9] *** Auto-provisioned apiKey=<id> *** Save this to your config as apiKey
```

- If no such line appears, stop the first-run flow and ask the user whether to retry the restart or switch to reconnect with an existing API key

### Create-New Flow Did Not Carry Expected UTM Params

- If the setup started from a remote `SKILL.md` URL with `utm_*`, re-check whether `plugins.entries.mem9.config.provisionQueryParams` was disclosed in the dry-run preview
- Re-check the config read-back from before the first restart
- The pre-restart read-back must exactly match the filtered `utm_*` map from the remote `SKILL.md` URL
- If `provisionQueryParams` was absent, partial, renamed, or different before the first restart, do not assume the generated key was attributed correctly
- In that case, stop the happy-path create-new handoff and decide whether to re-run create-new cleanly or switch to reconnect

### Create-New Flow Generated Multiple Auto-Provisioned Keys

- Treat this as abnormal create-new behavior, not as automatic success
- Do not silently keep the latest key without checking the earlier provision attempts
- Re-check whether `plugins.entries.mem9.config.provisionQueryParams` was already present before the first successful auto-provision
- Re-check whether the final persisted `plugins.entries.mem9.config.apiKey` matches the key the plugin is currently using
- If attribution or final-key correctness cannot be confirmed, stop and troubleshoot instead of handing off the newest key

### Existing API Key Fails After Reconnect

- Re-check the value for typos
- Re-check `apiUrl`
- Re-check that the same API key was written to `plugins.entries.mem9.config.apiKey`
- Re-check that config was read back before restart and matched the user-provided key exactly
- Re-check for OpenClaw plugin or config errors after restart

### Existing API Key Was Replaced By A New Auto-Provisioned Key

- Treat this as reconnect failure, not success
- Do not hand off the auto-provisioned key to the user
- Re-check the write order: the user-provided key must be saved before the first restart
- Re-check the exact config path: `plugins.entries.mem9.config.apiKey`
- Re-check the read-back value from `openclaw.json` before the first restart
- Rewrite the original user-provided key to the correct field
- Restart and verify again
- If a new key is still auto-provisioned after that, stop the reconnect flow and keep troubleshooting instead of silently switching mem9 spaces

### Memory Shows Unavailable In Status But Plugin Is Working

- `openclaw status` may briefly show `enabled (plugin mem9) · unavailable` after a restart
- This is a known transient state caused by OpenClaw's status probe timing out before the plugin finishes its first API call
- Check recent gateway logs for positive health signals:
  - `[mem9] Injecting N memories into prompt context`
  - `[mem9] Ingest accepted for async processing`
  - `[mem9] Server mode (v1alpha2)` with no subsequent startup error
- If any positive signal is present, the plugin is healthy — ignore the `unavailable` status
- If no positive signal appears after 2+ minutes and the logs show repeated timeouts, check network connectivity to the configured `apiUrl`
- Do not re-run setup or treat this as a setup failure when logs confirm the plugin is operational

### Removed mem9 But Gateway Will Not Start

- Treat this as uninstall failure, not success
- First re-check the current config read-back
- The most common cause is `plugins.slots.memory` still pointing to `mem9`
- If logs show `config reload skipped (invalid config): plugins.slots.memory: plugin not found: mem9` or `Invalid config ... plugin not found: mem9`, treat that as local rollback failure, not a mem9 cloud problem
- If logs show `Plugin "mem9" is not managed by plugins config/install records and cannot be uninstalled.`, treat that as unmanaged local install residue, not as successful uninstall
- If logs show `plugins.entries.memory-core: plugin disabled (disabled in config) but config is present`, treat that as rollback failure. The default memory plugin was not restored cleanly yet.
- Also re-check whether `plugins.entries.memory-core.enabled = true` after restoring the default memory slot
- Re-check that `plugins.entries.mem9` was removed
- Re-check that `plugins.installs.mem9` was removed if it existed before
- Re-check that `"mem9"` is no longer present in `plugins.allow`
- Re-check whether `~/.openclaw/extensions/mem9` still exists locally and remove it if the uninstall command did not
- After the config read-back, inspect the gateway logs for the exact startup error
- If the config still matches the uninstall failure pattern, re-apply the safe rollback from `UNINSTALL.md` before trying another restart

### Reinstall Fails Because The mem9 Plugin Already Exists Locally

- Treat this as local uninstall residue, not an API-key problem and not a mem9 cloud problem
- The common pattern is:
  - uninstall appeared to finish
  - config rollback succeeded
  - `plugins.installs.mem9` may already be gone
  - later reinstall fails with `plugin already exists`
  - a stale local extension directory still exists at `~/.openclaw/extensions/mem9`
- Re-check whether the local extension directory is still present
- If it is, remove that stale local mem9 extension directory
- Then rerun the mem9 install flow
- Do not continue into config write or restart until the stale local extension directory issue is resolved

### Gateway Became Unhealthy After mem9 Uninstall

- Treat this as uninstall orchestration failure, not a mem9 remote API problem
- The most common cause is that uninstall rollback already triggered one deferred restart, and the flow then added another explicit restart or a current-session reset on top
- Another common cause is that plugin removal happened before the config rollback had finished, leaving `plugins.slots.memory` pointing at a plugin that no longer exists
- Another common cause is that `openclaw plugins uninstall mem9 --force` failed with `Plugin "mem9" is not managed by plugins config/install records and cannot be uninstalled.`, leaving `~/.openclaw/extensions/mem9` behind as unmanaged local residue
- Another common cause is that the rollback switched the slot away from mem9 but left `memory-core` disabled, which shows up as `plugins.entries.memory-core: plugin disabled (disabled in config) but config is present`
- First inspect gateway reload logs for:
  - `config change requires gateway restart`
  - `deferring until ... complete`
  - `config reload skipped (invalid config): plugins.slots.memory: plugin not found: mem9`
- Then check for:
  - `Plugin "mem9" is not managed by plugins config/install records and cannot be uninstalled.`
  - `plugins.entries.memory-core: plugin disabled (disabled in config) but config is present`
  - `Invalid --scope. Expected "config", "config+creds+sessions", or "full".`
- Then check whether a second `SIGTERM` happened after the gateway had already come back once
- Then check whether runtime is `inactive` while the gateway port is still in use
- If that pattern is present, do not keep re-running uninstall steps blindly
- Re-check the current config read-back
- If the uninstall command reported `Plugin "mem9" is not managed by plugins config/install records and cannot be uninstalled.`, stop retrying that uninstall command and remove `~/.openclaw/extensions/mem9` after the rollback config is safe
- If `Invalid --scope. Expected "config", "config+creds+sessions", or "full".` appears right after uninstall actions, treat that as an out-of-band session-reset attempt and stop adding reset or restart actions
- If the config still shows the uninstall-failure shape, re-apply the safe rollback from `UNINSTALL.md` before trying anything else
- Let the gateway return to a healthy steady state with the rollback config in place before suggesting a new session or manual session reset
- Do not attribute this pattern to remote mem9 cloud availability

### User Asked To Remember, Recall, Or Forget After Setup, But mem9 Did Not Handle It Correctly

- First decide whether the user said `remember this`, `save this for later`, `save this to mem9`, `don't forget this`, `what did I say last time?`, `recall my preferences`, `forget that`, `记住`, `记下来`, `保存一下`, `别忘了`, `我上次说过什么`, `回忆一下我的偏好`, `忘掉这件事`, or equivalent
- If yes, do not treat it as a setup-success question and do not re-run onboarding
- Route remember or save requests to the direct mem9 write path
- Route recall requests such as `what did I say last time?` to the mem9 recall or search path
- Route forget requests to mem9 memory-management behavior
- Do not accept background or delayed auto-capture as the success signal for an explicit write request
- If the write or recall still fails, then troubleshoot write-path availability, plugin load state, and mem9 API reachability
- Interpret equivalent remember, recall, and forget intent in any language
- Do not send an unverified conversational acknowledgment unless mem9 actually stored or returned the memory
- Do not tell the user about internal tool names, interface exposure, or background-ingest mechanics

### Assistant Said It Could Not Write Because No Direct mem9 Interface Was Available

- Treat that as a documentation failure, not an acceptable final user-facing reply
- The correct user-facing outcome is still short and operational:
  - a short success confirmation in the user's language
  - or a short failure reason in the user's language
- Keep internal diagnosis internal
- If needed, troubleshoot the write path, plugin load state, and mem9 API reachability without narrating those implementation details back to the user

### User Returned After Restart But Verification Is Still In Progress

- This usually means the gateway restart finished but verification has not completed yet
- Resume verification automatically; do not ask whether the user wants to continue
- First check gateway status, recent mem9-related logs, and the current config read-back
- Tell the user clearly that verification is resuming after the restart and that final success has not been declared yet
- Default to "no action needed right now" unless the verification step truly needs new user input
- Do not send the final success handoff until verification is actually complete
- If there was a real interruption beyond the normal restart, say exactly which step was incomplete and what you are resuming now instead of using vague phrases like `mid-flight` or `system event`

### Dashboard Still Shows "Space ID"

- In the current dashboard, `Space ID` may still refer to the same mem9 credential
- Enter the same `MEM9_API_KEY`

### China Network / npm Registry Problems

- Retry installation with a temporary npm mirror such as `https://registry.npmmirror.com`
- Avoid changing the user's global npm config unless they explicitly ask

## Reconnect On A New Machine

- Install the mem9 plugin
- Write the same `MEM9_API_KEY` into `plugins.entries.mem9.config.apiKey`
- Keep the same `apiUrl` unless the user intentionally changed servers
- Restart OpenClaw

## Legacy Compatibility

- `tenantID` is a legacy alias for the same mem9 credential
- Prefer `apiKey` for new config
- If old config only has `tenantID`, reconnect using the same value and plan a later cleanup to `apiKey`
