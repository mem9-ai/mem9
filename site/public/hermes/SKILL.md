---
name: mem9-hermes
version: 1.0.45
homepage: "https://mem9.ai/hermes/SKILL.md"
description: "Install mem9 for Hermes with the official install script, finish the provider link/setup flow, and verify Hermes memory is active."
keywords: ["mem9", "hermes", "hermes memory", "install mem9", "MEM9_API_KEY", "persistent memory", "cloud memory"]
user-invocable: true
metadata: {"hermes":{"emoji":"🧠","homepage":"https://mem9.ai/hermes/SKILL.md","primaryEnv":"MEM9_API_KEY"}}
---

# mem9 For Hermes

mem9 is the persistent cloud memory plugin for Hermes. Use this skill when the user wants Hermes itself to install, reconnect, verify, or repair mem9 on the current machine.

## Recommended IM Prompt

The user can send Hermes a single message like this:

> Read `https://mem9.ai/hermes/SKILL.md` and install mem9 for Hermes on this machine. Use the official install script, finish any required link/setup steps, and stop only after `hermes memory status` shows mem9 is active.

## What This Skill Does

- Install the official Hermes plugin with the upstream one-shot install script:
  `curl -fsSL https://raw.githubusercontent.com/mem9-ai/mem9-hermes-plugin/main/install.sh | bash`
- Reuse an existing `MEM9_API_KEY` when one is already available to the install flow; otherwise allow the official setup flow to auto-provision a new key.
- Keep the default mem9 API base URL at `https://api.mem9.ai` unless the user explicitly asks for another endpoint.
- Ensure the Hermes third-party memory provider link step is complete. The upstream repo documents that third-party memory providers must be linked into the Hermes repo's `plugins/memory/` directory.
- Use the helper script `link-memory-provider.sh` when the provider link is missing or when the install script asks for the Hermes project root.
- Finish configuration with `hermes memory setup` if the install script leaves mem9 installed but not yet activated.
- Verify success with `hermes memory status` before claiming the plugin is working.

## Source / Runtime Authority

- Official source: [mem9-ai/mem9-hermes-plugin](https://github.com/mem9-ai/mem9-hermes-plugin) and [mem9.ai](https://mem9.ai/).
- The official install path is the upstream `install.sh` script from that repository.
- The plugin runtime behavior, credential persistence, and Hermes integration semantics are defined by the installed plugin and the upstream repo, not by this document.
- The upstream README states that install saves configuration under `HERMES_HOME`, supports auto-provision or reuse of an existing `MEM9_API_KEY`, and uses `hermes memory status` as the final verification step.
- The upstream `after-install.md` states that third-party memory providers need the provider symlink/link step inside the Hermes repo's `plugins/memory/` directory.

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

## Allowed Action Scope

Only these actions are in scope unless the user explicitly asks for more:

- Read `hermes version`
- Run the official install script from `mem9-ai/mem9-hermes-plugin`
- Run `hermes plugins install mem9-ai/mem9-hermes-plugin` only as a fallback when the official install script is unavailable or when the upstream instructions explicitly require the manual path
- Run the upstream helper script `link-memory-provider.sh` from the installed plugin when the Hermes provider link is missing
- Set `HERMES_PROJECT_ROOT` only for the current install/link command when Hermes cannot auto-detect the project root
- Run `hermes memory setup`
- Run `hermes memory status`
- Read and update mem9-related files under `${HERMES_HOME:-$HOME/.hermes}` only when needed for the official setup flow

Do not uninstall other Hermes plugins, rewrite unrelated Hermes config, or switch the user to another memory provider unless the user explicitly asks.

## Install Flow

### Step 1 — Preflight

- Confirm `hermes` is available with `hermes version`.
- If Hermes is not installed or the command is unavailable, stop and tell the user Hermes must be installed first.
- If the user explicitly supplied an existing mem9 key, make that key available to the official install flow as `MEM9_API_KEY` instead of forcing a new provision.

### Step 2 — Official Install Script

Run the upstream install command first:

```bash
curl -fsSL https://raw.githubusercontent.com/mem9-ai/mem9-hermes-plugin/main/install.sh | bash
```

Rules:

- Prefer this script over manual plugin installation.
- Do not replace it with ad hoc shell logic when the upstream script is available.
- If the install script already completes install, setup, and verification, do not repeat those steps unnecessarily.
- If the script installs the plugin but reports that the Hermes third-party memory provider still needs to be linked, continue to Step 3.

### Step 3 — Provider Link / Setup Finish

If mem9 is installed but Hermes does not yet see it as an active memory provider:

- Run the upstream helper script `link-memory-provider.sh` from the installed mem9 Hermes plugin.
- If the helper script cannot locate the Hermes repo automatically, rerun it with `HERMES_PROJECT_ROOT` set for that one command only.
- After the link step, run `hermes memory setup`.
- In `hermes memory setup`, choose `mem9` as the provider.
- Prefer the upstream auto-provision flow when the user did not provide an existing key.
- If the user explicitly provided an existing key, reconnect with that key instead of creating a new one.

### Step 4 — Verification

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

## Definition of Done

- The official mem9 Hermes install flow ran successfully.
- The Hermes provider link requirement was satisfied when needed.
- `hermes memory status` shows mem9 as the active memory provider.
- The user is told mem9 is ready only after the verification step passes.
