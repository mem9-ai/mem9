# mem9 Setup For Hermes

Use this file only for Hermes install, reconnect, or activation work.

## First Reply

When this file is read for install or repair, send only this short approval prompt first:

> I can install mem9 for Hermes.
>
> Plan:
> 1. Check that `hermes` is available.
> 2. Run the official mem9 install script.
> 3. If Hermes still needs the provider link step, finish it with the upstream helper script.
> 4. Verify with `hermes memory status`.
>
> If that looks good, reply exactly: `approve install`

Do not claim the plugin is already installed, linked, or working in this first reply.

## Safety Rules

- Confirm `hermes` is available before changing anything.
- Prefer the official install script from `mem9-ai/mem9-hermes-plugin`.
- If the user explicitly supplied an existing `MEM9_API_KEY`, reuse that key instead of forcing a new provision.
- Keep the default mem9 API base URL at `https://api.mem9.ai` unless the user explicitly asks for another endpoint.
- Only change mem9-related files under `${HERMES_HOME:-$HOME/.hermes}` and the active Hermes memory-provider selection.
- Do not rewrite unrelated Hermes config or uninstall other Hermes plugins from this setup flow.
- Use the upstream helper script only when the provider link is missing or Hermes cannot see mem9 after install.
- Verify with `hermes memory status` before claiming success.

## Step 1 — Preflight

- Confirm `hermes` is available with `hermes version`.
- If Hermes is not installed or the command is unavailable, stop and tell the user Hermes must be installed first.
- If the user explicitly supplied an existing mem9 key, make that key available to the official install flow as `MEM9_API_KEY`.

## Step 2 — Official Install Script

Run the upstream install command first:

```bash
curl -fsSL https://raw.githubusercontent.com/mem9-ai/mem9-hermes-plugin/main/install.sh | bash
```

Rules:

- Prefer this script over manual plugin installation.
- Do not replace it with ad hoc shell logic when the upstream script is available.
- If the install script already completes install, setup, and verification, do not repeat those steps unnecessarily.
- The upstream README says this script installs the plugin, obtains or reuses an API key, writes `.env`, writes `mem9.json`, and creates the provider symlink.
- If the script installs the plugin but reports a connectivity failure or leaves mem9 inactive, continue to Step 3.

## Step 3 — Provider Link And Setup Finish

If mem9 is installed but Hermes does not yet see it as an active memory provider:

- Run the upstream helper script `link-memory-provider.sh` from the installed mem9 Hermes plugin.
- If the helper script cannot locate the Hermes repo automatically, rerun it with `HERMES_PROJECT_ROOT` set for that one command only.
- After the link step, run `hermes memory setup`.
- In `hermes memory setup`, choose `mem9` as the provider.
- Prefer the upstream auto-provision flow when the user did not provide an existing key.
- If the user explicitly provided an existing key, reconnect with that key instead of creating a new one.

Manual fallback is only for cases where the official install script is unavailable or the upstream instructions explicitly require it:

```bash
hermes plugins install mem9-ai/mem9-hermes-plugin
```

If the manual install path is used, still finish the provider-link step and `hermes memory setup` before verification.

## Step 4 — Verification

Before claiming success, run:

```bash
hermes memory status
```

Success criteria:

- Hermes reports `mem9` as the active memory provider.
- The install flow did not leave Hermes in an unconfigured state.
- If mem9 required setup or reconnect, that work completed before the final handoff.

If verification fails:

- First finish the documented upstream repair path: provider link step, then `hermes memory setup`, then `hermes memory status`.
- If mem9 is still inactive after that sequence, report the failure clearly and stop instead of pretending install succeeded.

## Required Final Handoff

Use a short completion message only after verification passes. The final message should make these points clear:

- mem9 is installed for Hermes on this machine
- `hermes memory status` shows mem9 as the active provider
- if the user wants to reuse the same mem9 space elsewhere, they should keep the current `MEM9_API_KEY`

Do not claim success before the verification step passes.
