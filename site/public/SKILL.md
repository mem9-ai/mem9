---
name: mem9
version: 1.0.16
homepage: "https://mem9.ai"
description: "Entry skill for mem9 onboarding and reconnect. After ClawHub install, users can say: setup mem9, install mem9, reconnect mem9, or review mem9 config changes."
keywords: ["mem9", "memory plugin", "persistent memory", "agent memory", "install mem9", "setup mem9", "reconnect mem9", "openclaw memory"]
user-invocable: true
metadata: {"openclaw":{"emoji":"🧠","homepage":"https://mem9.ai","primaryEnv":"MEM9_API_KEY"}}
---

# mem9

mem9 gives OpenClaw persistent cloud memory across resets, restarts, and new machines.

This file is the entry point only. Keep first-run onboarding in `SETUP.md`, not here.

## Source / Security / Config Impact

- Official source: [mem9-ai/mem9](https://github.com/mem9-ai/mem9) and [mem9.ai](https://mem9.ai/).
- Default network scope: setup uses `https://api.mem9.ai` unless the user explicitly chooses another `apiUrl`.
- Config scope: only the active `openclaw.json` entries needed for the mem9 plugin may be changed.
- Install impact: setup installs the mem9 plugin, writes plugin config, and restarts OpenClaw.
- History import scope: this public skill does not scan or upload local memory/session files. Historical import stays manual through the dashboard or another reviewed workflow.

## Exact Config Changes

Only these `openclaw.json` paths may be changed during setup:

- `plugins.slots.memory`
- `plugins.entries.mem9.enabled`
- `plugins.entries.mem9.config.apiUrl`
- `plugins.entries.mem9.config.apiKey`
- `plugins.allow`

Do not change any other config keys unless the user explicitly asks.

## Trigger Phrases

Use this skill only for explicit mem9 setup or recovery requests.

- `install mem9`
- `setup mem9`
- `enable mem9 memory`
- `reconnect mem9`
- `review mem9 config changes`

## When To Use This Skill

Use this skill when the user explicitly wants one of these:

- First-time mem9 installation
- Reconnect an existing mem9 API key on this machine
- Review the exact config changes needed for mem9
- Confirm recovery steps for a new machine or broken setup

## When NOT To Use This Skill

Do not use this skill for:

- Day-to-day memory store/recall after mem9 is already configured
- Generic requests like `remember this` or `what did I say last time`
- Agent-side local history import or upload
- Unrelated OpenClaw troubleshooting

## Setup Intent Detection

- If mem9 is already configured and the user asks for routine memory behavior, do not re-run onboarding.
- Only enter onboarding when the user explicitly asks to install, enable, reconnect, or review mem9 setup.

## First-Run Rule

- If mem9 is not fully set up on this machine, read `SETUP.md` from the same skill directory before continuing.
- If this skill was loaded remotely instead of from a local skill directory, read [SETUP.md](https://mem9.ai/SETUP.md).
- Follow `SETUP.md` for install, config, restart, verify, and the required final handoff. Do not improvise extra setup flows.

## Steady-State Rule

- If mem9 is already configured, do not repeat the full first-run onboarding unless the user explicitly asks to reinstall.
- For reconnect, config review, or setup failures, read `TROUBLESHOOTING.md` from the same skill directory.
- If this skill was loaded remotely, read [TROUBLESHOOTING.md](https://mem9.ai/TROUBLESHOOTING.md).
- Keep historical import manual. Direct users to the dashboard or another reviewed manual workflow instead of uploading local files from this skill.

## Definition of Done

- If first-run onboarding happened, `SETUP.md` was read and completed, including the required final handoff.
- If the user asked to reconnect or review config, they received the exact recovery or config guidance without a full reinstall.

## Quick Start After ClawHub Install

- After installing from ClawHub, start a new chat session.
- Say: `setup mem9`, `install mem9`, or `reconnect mem9`.
- If slash commands work in the current channel, `/skill mem9 ...` is only an optional backup path.

## Update

Do not set up automatic daily self-updates for this skill.

Only update the local skill bundle when the user or maintainer explicitly asks for a refresh from a reviewed source.
