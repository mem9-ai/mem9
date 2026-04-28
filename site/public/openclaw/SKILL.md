---
name: mem9
version: 1.0.47
homepage: "https://mem9.ai/openclaw/SKILL.md"
description: "Persistent cloud memory plugin for OpenClaw. This canonical entry routes setup, troubleshooting, and uninstall flows, and hands explicit Hermes installs to the Hermes-specific skill."
keywords: ["mem9", "openclaw memory", "persistent memory", "cloud memory", "memory plugin", "setup mem9", "install mem9", "reconnect mem9", "uninstall mem9"]
user-invocable: true
metadata: {"openclaw":{"emoji":"🧠","homepage":"https://mem9.ai/openclaw-memory","primaryEnv":"MEM9_API_KEY"}}
---

# mem9

mem9 is the persistent cloud memory plugin for OpenClaw. It keeps durable memory across sessions and machines.

This is the canonical OpenClaw install skill URL. The backward-compatible alias `https://mem9.ai/SKILL.md` remains available.

If the user explicitly says `Hermes`, or asks Hermes itself to install, reconnect, verify, or repair mem9, switch to `https://mem9.ai/hermes/SKILL.md` and do not apply OpenClaw config rules to Hermes.

This canonical OpenClaw `SKILL.md` is a routing and safety document. It is the entry point for setup, troubleshooting, and uninstall flows. It is not the canonical reference for runtime request behavior.

## What This Skill Does

- Keep the canonical OpenClaw hosted flow working from `https://mem9.ai/openclaw/SKILL.md`.
- Route first-time install, reconnect, config review, and mainland China / Alibaba Cloud npm install handling to `https://mem9.ai/openclaw/SETUP.md`.
- Route setup failures, recovery work, and broken local state to `https://mem9.ai/openclaw/TROUBLESHOOTING.md`.
- Route local mem9 removal on this machine to `https://mem9.ai/openclaw/UNINSTALL.md`.
- Preserve filtered `utm_*` params from a remote `SKILL.md` URL through the create-new setup flow and first restart.
- Prevent invalid compatibility fallbacks: never write `plugins.entries.mem9.apiKey`; only `plugins.entries.mem9.config.apiKey` is valid.
- Keep restart notices honest: only claim post-restart verification has resumed after that work has actually started.
- Keep history import manual. Do not scan or upload local memory or session files from this skill.
- Route explicit Hermes install or repair requests to `https://mem9.ai/hermes/SKILL.md`.

## Source / Runtime Authority

- Official source: [mem9-ai/mem9](https://github.com/mem9-ai/mem9) and [mem9.ai](https://mem9.ai/).
- Backward-compatible root OpenClaw skill URL: `https://mem9.ai/SKILL.md`.
- Canonical OpenClaw skill URL: `https://mem9.ai/openclaw/SKILL.md`.
- Canonical Hermes skill URL: `https://mem9.ai/hermes/SKILL.md`.
- Default setup network target is `https://api.mem9.ai` unless the user explicitly chooses another `apiUrl`.
- The installed mem9 plugin contains the actual OpenClaw integration, request logic, default base URL handling, and runtime behavior.
- This canonical OpenClaw `SKILL.md` is not the backend API contract and does not define day-to-day memory semantics.
- For OpenClaw-specific runtime details, use the plugin README: [openclaw-plugin/README.md](https://github.com/mem9-ai/mem9/blob/main/openclaw-plugin/README.md).

## Allowed Config Scope

For OpenClaw flows started from this canonical `SKILL.md`, only these `openclaw.json` paths may be changed during setup:

- `plugins.slots.memory`
- `plugins.entries.mem9.enabled`
- `plugins.entries.mem9.config.apiUrl`
- `plugins.entries.mem9.config.apiKey`
- `plugins.entries.mem9.config.provisionToken` for create-new only; generate it once per create-new run before the first restart and keep it stable through the first successful post-restart provision on this machine
- `plugins.entries.mem9.config.provisionQueryParams` for create-new only, and only when the remote `SKILL.md` URL contains filtered `utm_*` parameters; when present, it must be written before the first restart
- `plugins.allow`

Do not change any other OpenClaw config keys unless the user explicitly asks.

The scope above is exhaustive. In particular, do not write `plugins.entries.mem9.apiKey` at the entry top level. OpenClaw rejects that key as invalid config before the mem9 plugin can load.

## Routing

- Canonical OpenClaw URL: `https://mem9.ai/openclaw/SKILL.md`.
- Backward-compatible alias URL: `https://mem9.ai/SKILL.md`.
- Explicit Hermes install, reconnect, verification, or repair requests: use `https://mem9.ai/hermes/SKILL.md` instead of the OpenClaw support documents below.
- OpenClaw install, enable, reconnect, or review mem9 config changes: read `https://mem9.ai/openclaw/SETUP.md`.
- OpenClaw setup failures, broken reconnects, local cleanup issues, or recovery guidance: read `https://mem9.ai/openclaw/TROUBLESHOOTING.md`.
- OpenClaw uninstall, remove, disable, or roll back mem9 on this machine: read `https://mem9.ai/openclaw/UNINSTALL.md`.
- If an OpenClaw uninstall request also mentions `reset session`, `restart gateway`, `重启网关`, clearing local mem9 history, or equivalent, still route to `https://mem9.ai/openclaw/UNINSTALL.md` first and keep those actions as post-verification follow-up only.
- If the target client is unclear, default to the OpenClaw flow.
- If this skill is loaded remotely and the active flow is OpenClaw, use the canonical OpenClaw support-document URLs above exactly.
- If the current remote canonical `SKILL.md` URL contains filtered `utm_*` params, append that same filtered `utm_*` map when opening `https://mem9.ai/openclaw/SETUP.md`, `https://mem9.ai/openclaw/TROUBLESHOOTING.md`, or `https://mem9.ai/openclaw/UNINSTALL.md`.
- If this canonical OpenClaw entry was opened with filtered `utm_*` params and then routes to Hermes, preserve those same filtered `utm_*` params when handing off to `https://mem9.ai/hermes/SKILL.md`.

## Definition of Done

- Canonical OpenClaw flows from `https://mem9.ai/openclaw/SKILL.md` retain the same allowed `openclaw.json` key scope and canonical support-document routing.
- Explicit Hermes requests are routed to `https://mem9.ai/hermes/SKILL.md` without mixing in OpenClaw config rules.
- No OpenClaw config paths outside the allowed scope were changed.
