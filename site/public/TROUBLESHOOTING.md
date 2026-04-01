# mem9 Troubleshooting

Use this file for reconnect, setup failures, and dashboard/login confusion after the main mem9 setup flow.

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
