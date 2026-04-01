# mem9 Beta Troubleshooting

Use this file for reconnect, setup failures, and dashboard/login confusion after the main mem9 beta setup flow.

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
