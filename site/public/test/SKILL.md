---
name: mem9
version: 1.0.35
homepage: "https://mem9.ai/openclaw-memory"
description: "Persistent cloud memory plugin for OpenClaw. This document routes setup, troubleshooting, and uninstall flows and defines config boundaries."
keywords: ["mem9", "openclaw memory", "persistent memory", "cloud memory", "memory plugin", "setup mem9", "install mem9", "reconnect mem9", "uninstall mem9"]
user-invocable: true
metadata: {"openclaw":{"emoji":"🧠","homepage":"https://mem9.ai/openclaw-memory","primaryEnv":"MEM9_API_KEY"}}
---

# mem9

mem9 is the persistent cloud memory plugin for OpenClaw. It keeps durable memory across sessions and machines.

This top-level `SKILL.md` is a routing and safety document. It is the entry point for setup, troubleshooting, and uninstall flows. It is not the canonical reference for runtime request behavior.

## What This Skill Does

- Route first-time install, reconnect, and config review to `SETUP.md`.
- Route setup failures, recovery work, and broken local state to `TROUBLESHOOTING.md`.
- Route local mem9 removal on this machine to `UNINSTALL.md`.
- Keep history import manual. Do not scan or upload local memory or session files from this skill.

## Source / Runtime Authority

- Official source: [mem9-ai/mem9](https://github.com/mem9-ai/mem9) and [mem9.ai](https://mem9.ai/).
- Default setup network target is `https://api.mem9.ai` unless the user explicitly chooses another `apiUrl`.
- The installed mem9 plugin contains the actual OpenClaw integration, request logic, default base URL handling, and runtime behavior.
- This `SKILL.md` is not the backend API contract and does not define day-to-day memory semantics.
- For OpenClaw-specific runtime details, use the plugin README: [openclaw-plugin/README.md](https://github.com/mem9-ai/mem9/blob/main/openclaw-plugin/README.md).

## Allowed Config Scope

Only these `openclaw.json` paths may be changed during setup:

- `plugins.slots.memory`
- `plugins.entries.mem9.enabled`
- `plugins.entries.mem9.config.apiUrl`
- `plugins.entries.mem9.config.apiKey`
- `plugins.entries.mem9.config.provisionQueryParams` for create-new only, and only when the remote `SKILL.md` URL contains filtered `utm_*` parameters
- `plugins.allow`

Do not change any other config keys unless the user explicitly asks.

## Routing

- Install, enable, reconnect, or review mem9 config changes: read `SETUP.md`.
- Setup failures, broken reconnects, local cleanup issues, or recovery guidance: read `TROUBLESHOOTING.md`.
- Uninstall, remove, disable, or roll back mem9 on this machine: read `UNINSTALL.md`.
- If this skill is loaded remotely, resolve `SETUP.md`, `TROUBLESHOOTING.md`, and `UNINSTALL.md` relative to the directory containing the current `SKILL.md`.

## Definition of Done

- The correct supporting document was used for the user's intent: `SETUP.md`, `TROUBLESHOOTING.md`, or `UNINSTALL.md`.
- No `openclaw.json` paths outside the allowed scope were changed.
- Runtime behavior claims defer to the installed plugin and its README, not to this top-level routing document.
