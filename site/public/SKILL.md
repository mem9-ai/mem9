---
name: mem9
version: 1.0.46
homepage: "https://mem9.ai"
description: "Backward-compatible mem9 install skill. Default to the OpenClaw hosted flow and route explicit Hermes installs to the Hermes-specific skill."
keywords: ["mem9", "openclaw memory", "hermes memory", "persistent memory", "cloud memory", "memory plugin", "setup mem9", "install mem9", "reconnect mem9", "uninstall mem9"]
user-invocable: true
metadata: {"defaultPlatform":"openclaw","platforms":["openclaw","hermes"]}
---

# mem9

mem9 is the persistent cloud memory plugin for OpenClaw, and this root `SKILL.md` remains the backward-compatible entry point for the existing hosted OpenClaw setup flow.

If the user explicitly says `Hermes`, or asks Hermes itself to install, reconnect, verify, or repair mem9, switch to `https://mem9.ai/hermes/SKILL.md` and do not apply OpenClaw config rules to Hermes.

## What This Skill Does

- Keep the historical OpenClaw setup, troubleshooting, and uninstall flow working from `https://mem9.ai/SKILL.md`.
- Route first-time OpenClaw install, reconnect, config review, and mainland China / Alibaba Cloud npm install handling to `https://mem9.ai/SETUP.md`.
- Route OpenClaw setup failures, recovery work, and broken local state to `https://mem9.ai/TROUBLESHOOTING.md`.
- Route local mem9 removal on this machine to `https://mem9.ai/UNINSTALL.md`.
- Preserve filtered `utm_*` params from a remote `SKILL.md` URL through the OpenClaw create-new setup flow and first restart.
- Prevent invalid OpenClaw compatibility fallbacks: never write `plugins.entries.mem9.apiKey`; only `plugins.entries.mem9.config.apiKey` is valid.
- Keep history import manual. Do not scan or upload local memory or session files from this skill.
- Route explicit Hermes install or repair requests to `https://mem9.ai/hermes/SKILL.md`.

## Source / Runtime Authority

- Official source: [mem9-ai/mem9](https://github.com/mem9-ai/mem9) and [mem9.ai](https://mem9.ai/).
- Canonical OpenClaw skill URL: `https://mem9.ai/openclaw/SKILL.md`.
- Canonical Hermes skill URL: `https://mem9.ai/hermes/SKILL.md`.
- Default OpenClaw setup network target is `https://api.mem9.ai` unless the user explicitly chooses another `apiUrl`.
- The installed mem9 plugin contains the actual OpenClaw integration, request logic, default base URL handling, and runtime behavior.
- This root `SKILL.md` is a backward-compatible OpenClaw routing and safety document plus a Hermes router. It is not the backend API contract and does not define day-to-day memory semantics.
- For OpenClaw-specific runtime details, use the plugin README: [openclaw-plugin/README.md](https://github.com/mem9-ai/mem9/blob/main/openclaw-plugin/README.md).

## Allowed Config Scope

For OpenClaw flows started from this root `SKILL.md`, only these `openclaw.json` paths may be changed during setup:

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

- Default and backward-compatible behavior: treat `https://mem9.ai/SKILL.md` as the OpenClaw hosted install entry.
- Canonical OpenClaw URL: `https://mem9.ai/openclaw/SKILL.md`.
- Explicit Hermes install, reconnect, verification, or repair requests: use `https://mem9.ai/hermes/SKILL.md` instead of the OpenClaw support documents below.
- OpenClaw install, enable, reconnect, or review mem9 config changes: read `https://mem9.ai/SETUP.md`.
- OpenClaw setup failures, broken reconnects, local cleanup issues, or recovery guidance: read `https://mem9.ai/TROUBLESHOOTING.md`.
- OpenClaw uninstall, remove, disable, or roll back mem9 on this machine: read `https://mem9.ai/UNINSTALL.md`.
- If an OpenClaw uninstall request also mentions `reset session`, `restart gateway`, `重启网关`, clearing local mem9 history, or equivalent, still route to `https://mem9.ai/UNINSTALL.md` first and keep those actions as post-verification follow-up only.
- If the target client is unclear, default to the OpenClaw flow for backward compatibility.
- If this skill is loaded remotely and the active flow is OpenClaw, use the absolute support-document URLs above exactly.
- If the current remote root `SKILL.md` URL contains filtered `utm_*` params, append that same filtered `utm_*` map when opening `https://mem9.ai/SETUP.md`, `https://mem9.ai/TROUBLESHOOTING.md`, or `https://mem9.ai/UNINSTALL.md`.
- If this root launcher was opened with filtered `utm_*` params and then routes to Hermes, preserve those same filtered `utm_*` params when handing off to `https://mem9.ai/hermes/SKILL.md`.

## Definition of Done

- Backward-compatible OpenClaw flows from `https://mem9.ai/SKILL.md` still retain the same allowed `openclaw.json` key scope and support-document routing.
- Explicit Hermes requests are routed to `https://mem9.ai/hermes/SKILL.md` without mixing in OpenClaw config rules.
- No OpenClaw config paths outside the allowed scope were changed.
