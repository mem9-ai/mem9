# mem9 Setup For Hermes

Use this file only for Hermes install, reconnect, or activation work.

## First Reply

When this file is read for install or repair, send only this short approval prompt first:

> I can install mem9 for Hermes.
>
> Plan:
> 1. Check that `hermes` is available.
> 2. Run the official mem9 install script (it handles install, key, `.env`, `mem9.json`, and provider symlink).
> 3. Verify with `hermes memory status`. Only if mem9 is still inactive, run the upstream `link-memory-provider.sh` helper.
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

## Step 3 — Provider Link Repair (Only If Needed)

The official install script already handles plugin install, key provisioning, `.env`, `mem9.json`, and the provider symlink. Only run this step if `hermes memory status` in Step 4 shows mem9 is not active.

If mem9 is installed but Hermes does not yet see it as an active memory provider:

- Run the upstream helper script at `${HERMES_HOME:-$HOME/.hermes}/plugins/mem9/scripts/link-memory-provider.sh`.
- If the helper script cannot locate the Hermes repo automatically, rerun it with `HERMES_PROJECT_ROOT` set for that one command only.
- Re-run `hermes memory status` to confirm.
- Do not run `hermes memory setup` from this skill. The interactive picker only lists providers it can already detect, so triggering it here just selects "built-in only" and overwrites the install script's work.

## Step 3b — Manual Install Fallback

Use this path only when the official install script in Step 2 is unavailable or upstream instructions explicitly require it. Run the steps in order:

```bash
# 1. Install the plugin files
hermes plugins install mem9-ai/mem9-hermes-plugin

# 2. Link into the Hermes memory provider directory
bash "${HERMES_HOME:-$HOME/.hermes}/plugins/mem9/scripts/link-memory-provider.sh"
```

### 3. Ensure `MEM9_API_KEY` is in the Hermes `.env`

The Hermes `.env` lives at `${HERMES_HOME:-$HOME/.hermes}/.env` (the Hermes home root, not under `plugins/mem9/`). Resolve the key as follows before continuing:

**Case A — `.env` already has a non-empty `MEM9_API_KEY`.**
Reuse it as-is. Do not ask the user, do not call the API, do not overwrite it. Skip ahead to step 4.

**Case B — `.env` is missing or has no `MEM9_API_KEY`.**
Ask the user to choose between exactly these two options, and wait for their reply before doing anything:

> No `MEM9_API_KEY` was found in `${HERMES_HOME:-$HOME/.hermes}/.env`. Pick one:
>
> **1) Use an existing `MEM9_API_KEY`** — paste the key you want to reuse (for example, the one from another machine where mem9 is already set up).
>
> **2) Create a new `MEM9_API_KEY`** — I will call the mem9 API to provision a fresh key for this machine.
>
> Reply with `1` (and the key) or `2`.

Then act on their choice:

- **If the user picks 1**, take the key they pasted and write it to `.env` as `MEM9_API_KEY=<key>`.
- **If the user picks 2**, provision a new key by calling the mem9 API:

  ```bash
  curl -fsSL -X POST "${MEM9_API_BASE_URL:-https://api.mem9.ai}/v1alpha1/mem9s"
  ```

  The response is JSON of the form `{"id":"<new-api-key>"}`. Extract the `id` value and write it to `.env` as `MEM9_API_KEY=<key>`. After writing, surface the new key to the user once and remind them to save it for recovery or reuse on another machine.

When writing `.env`, create the file if it does not exist, preserve any other keys that are already there, and use the form:

```
MEM9_API_KEY=<key>
```

Rules:

- Do not present option 2 (create new) as the default. Wait for an explicit user choice — auto-provisioning when the user actually has a key would silently strand them on a new mem9 space.
- Never overwrite an existing non-empty `MEM9_API_KEY` in `.env` without explicit user confirmation.
- Keep the default mem9 API base URL at `https://api.mem9.ai` unless the user explicitly chose another endpoint, in which case set `MEM9_API_BASE_URL` for the `curl` call only.
- If the user already supplied a key earlier in the conversation (Step 1 preflight), treat that as option 1 with the key pre-filled — do not ask the choice question again.

### 4. Set mem9 as the active memory provider

```bash
# Non-interactive equivalent of the picker — avoids `hermes memory setup`,
# which silently falls back to "built-in only" if mem9 isn't yet detectable.
hermes config set memory.provider mem9
```

After this command completes, continue to Step 4 to verify.

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

- First finish the documented upstream repair path: re-run the install script, then if needed run `link-memory-provider.sh`, then `hermes memory status`.
- If mem9 is still inactive after that sequence, report the failure clearly and stop instead of pretending install succeeded.

## Required Final Handoff

Use a short completion message only after verification passes. The final message should make these points clear:

- mem9 is installed for Hermes on this machine
- `hermes memory status` shows mem9 as the active provider
- if the user wants to reuse the same mem9 space elsewhere, they should keep the current `MEM9_API_KEY`

Do not claim success before the verification step passes.
