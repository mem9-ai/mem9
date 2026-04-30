---
name: mem9-hermes
version: 1.0.45
homepage: "https://mem9.ai/hermes/SKILL.md"
description: "Persistent cloud memory plugin for Hermes. This document routes setup, troubleshooting, and uninstall flows for the Hermes Agent integration."
keywords: ["mem9", "hermes", "hermes memory", "install mem9", "MEM9_API_KEY", "persistent memory", "cloud memory"]
user-invocable: true
metadata: {"hermes":{"emoji":"🧠","homepage":"https://mem9.ai/hermes/SKILL.md","primaryEnv":"MEM9_API_KEY"}}
---

# mem9 For Hermes

mem9 is the persistent cloud memory plugin for Hermes. It keeps durable memory across sessions and machines.

This top-level `SKILL.md` is a routing and safety document for the Hermes integration. It is the entry point for setup, troubleshooting, and uninstall flows. It is not the canonical reference for runtime request behavior.

## Recommended IM Prompt

The user can send Hermes a single message like this:

> Read `https://mem9.ai/hermes/SKILL.md` and install mem9 for Hermes on this machine. Use the official install flow, finish any required link/setup steps, and stop only after `hermes memory status` shows mem9 is active.

## What This Skill Does

- Route first-time install, reconnect, config review, provider-link completion, and post-install activation to `SETUP.md`.
- Route install failures, provider-link issues, connectivity problems, and verification failures to `TROUBLESHOOTING.md`.
- Route local mem9 removal for Hermes on this machine to `UNINSTALL.md`.
- Reuse an existing `MEM9_API_KEY` when one is already available to the install flow; otherwise allow the official setup flow to auto-provision a new key.
- Keep the default mem9 API base URL at `https://api.mem9.ai` unless the user explicitly asks for another endpoint.
- Keep history import manual. Do not scan or upload local history or session files from this skill.

## Source / Runtime Authority

- Official source: [mem9-ai/mem9-hermes-plugin](https://github.com/mem9-ai/mem9-hermes-plugin) and [mem9.ai](https://mem9.ai/).
- The official install path is the upstream `install.sh` script from that repository.
- The upstream README documents install, uninstall, `.env` persistence, and `hermes memory status` verification behavior.
- The upstream `after-install.md` documents the manual provider-link step inside the Hermes repo's `plugins/memory/` directory when the automatic link is missing.
- The plugin runtime behavior, credential persistence, and Hermes integration semantics are defined by the installed plugin and the upstream repo, not by this document.

## Allowed Action Scope

Only these actions are in scope unless the user explicitly asks for more:

- Read `hermes version`
- Run the official install script from `mem9-ai/mem9-hermes-plugin`
- Run `hermes plugins install mem9-ai/mem9-hermes-plugin` only as a fallback when the official install script is unavailable or when the upstream instructions explicitly require the manual path
- Run the upstream helper script `link-memory-provider.sh` from the installed mem9 Hermes plugin when the Hermes provider link is missing
- Set `HERMES_PROJECT_ROOT` only for the current install/link command when Hermes cannot auto-detect the project root
- Run `hermes config set memory.provider mem9` only on the manual fallback path, to set mem9 as the active provider non-interactively
- Read and write `MEM9_API_KEY` in the Hermes `.env` at `${HERMES_HOME:-$HOME/.hermes}/.env` only when needed for the manual fallback path
- Call `POST ${MEM9_API_BASE_URL:-https://api.mem9.ai}/v1alpha1/mem9s` to provision a new mem9 API key only when the manual fallback path has no existing key in `.env` and the user confirms they do not have one to reuse
- Run `hermes memory status`
- Run the documented uninstall commands from `UNINSTALL.md` when the user explicitly asks to remove mem9 from Hermes
- Read and update mem9-related files under `${HERMES_HOME:-$HOME/.hermes}` only when needed for the official setup or uninstall flow

Do not uninstall other Hermes plugins, rewrite unrelated Hermes config, or switch the user to another memory provider unless the user explicitly asks.

## Routing

- Install, reconnect, activate, verify, or repair mem9 for Hermes: read `SETUP.md`.
- Troubleshoot install failures, provider-link problems, or inactive mem9 status: read `TROUBLESHOOTING.md`.
- Uninstall, remove, or disable mem9 for Hermes on this machine: read `UNINSTALL.md`.
- If this skill is loaded remotely, resolve `SETUP.md`, `TROUBLESHOOTING.md`, and `UNINSTALL.md` relative to the directory containing the current `SKILL.md`.

## Definition of Done

- The correct supporting document was used for the user's intent: `SETUP.md`, `TROUBLESHOOTING.md`, or `UNINSTALL.md`.
- Hermes install or repair claims are only made after `hermes memory status` confirms mem9 is active.
- Uninstall claims are only made after the documented Hermes uninstall steps complete and mem9 is no longer the active provider.
