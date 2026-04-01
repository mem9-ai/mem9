---
name: mem9
version: 1.0.23
homepage: "https://mem9.ai"
description: "Entry skill for mem9 onboarding, reconnect, and uninstall. After ClawHub install, users can say: setup mem9, install mem9, reconnect mem9, review mem9 config changes, or uninstall mem9."
keywords: ["mem9", "memory plugin", "persistent memory", "agent memory", "install mem9", "setup mem9", "reconnect mem9", "uninstall mem9", "remove mem9", "openclaw memory"]
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

Use this skill only for explicit mem9 setup, recovery, or uninstall requests.

- `install mem9`
- `setup mem9`
- `enable mem9 memory`
- `reconnect mem9`
- `review mem9 config changes`
- `uninstall mem9`
- `remove mem9`
- `delete mem9`
- `disable mem9`
- `stop using mem9`
- `卸载mem9`
- `删除mem9`
- `停用mem9`

## When To Use This Skill

Use this skill when the user explicitly wants one of these:

- First-time mem9 installation
- Reconnect an existing mem9 API key on this machine
- Review the exact config changes needed for mem9
- Confirm recovery steps for a new machine or broken setup
- Uninstall mem9 from this machine and restore OpenClaw's local memory config

## When NOT To Use This Skill

Do not use this skill for:

- Re-running setup for day-to-day memory behavior after mem9 is already configured
- Re-running setup for generic recall requests like `what did I say last time`
- Agent-side local history import or upload
- Unrelated OpenClaw troubleshooting
- Requests to delete remote mem9 cloud data or revoke an API key without uninstalling the local plugin

## Setup Intent Detection

- If mem9 is already configured and the user asks for routine memory behavior, do not re-run onboarding.
- If mem9 is already configured and the user explicitly says `remember this`, `save this to mem9`, `store this in mem9`, `记住`, `记下来`, `存一下`, or `保存到mem9`, treat that as a live mem9 write request instead of setup.
- Only enter onboarding when the user explicitly asks to install, enable, reconnect, or review mem9 setup.
- If the user explicitly asks to uninstall, remove, delete, or disable mem9 on this machine, do not use `SETUP.md`. Read `UNINSTALL.md` instead.

## Explicit Memory Rule

- If mem9 is already connected and the user makes an explicit durable-write request, use live mem9 write semantics instead of setup or reconnect.
- Explicit durable-write examples:
  - `remember this`
  - `save this to mem9`
  - `store this in mem9`
  - `记住`
  - `记下来`
  - `存一下`
  - `保存到mem9`
- Prefer the mem9 live tool path for this, especially `memory_store`.
- Do not rely on asynchronous `agent_end` auto-ingest as the primary path for an explicit write request.
- Do not reply `记住了` or `remembered` unless the write has actually succeeded.
- If the write fails or the live tool path is unavailable, say explicitly that it has not been written to mem9 yet and explain why.

## First-Run Rule

- If mem9 is not fully set up on this machine, read `SETUP.md` from the same skill directory before continuing.
- If this skill was loaded remotely instead of from a local skill directory, read `SETUP.md` from the same URL directory as the current `SKILL.md`.
- Remote path examples:
  - `https://mem9.ai/SKILL.md` -> [https://mem9.ai/SETUP.md](https://mem9.ai/SETUP.md)
  - `https://mem9.ai/beta/SKILL.md` -> [https://mem9.ai/beta/SETUP.md](https://mem9.ai/beta/SETUP.md)
  - `https://mem9.ai/test/SKILL.md` -> [https://mem9.ai/test/SETUP.md](https://mem9.ai/test/SETUP.md)
- Follow `SETUP.md` for install, config, restart, verify, and the required final handoff. Do not improvise extra setup flows.

## Uninstall Rule

- If the user explicitly wants to uninstall, remove, delete, or disable mem9 on this machine, read `UNINSTALL.md` from the same skill directory.
- If the uninstall request also mentions `reset session`, treat that as a post-uninstall follow-up suggestion instead of part of the same destructive flow.
- If this skill was loaded remotely instead of from a local skill directory, read `UNINSTALL.md` from the same URL directory as the current `SKILL.md`.
- Remote path examples:
  - `https://mem9.ai/SKILL.md` -> [https://mem9.ai/UNINSTALL.md](https://mem9.ai/UNINSTALL.md)
  - `https://mem9.ai/beta/SKILL.md` -> [https://mem9.ai/beta/UNINSTALL.md](https://mem9.ai/beta/UNINSTALL.md)
  - `https://mem9.ai/test/SKILL.md` -> [https://mem9.ai/test/UNINSTALL.md](https://mem9.ai/test/UNINSTALL.md)
- Follow `UNINSTALL.md` for the dry-run preview, config rollback, uninstall, one required restart, verification, and final handoff. Do not improvise partial removal flows or add session reset inside the same flow.

## Steady-State Rule

- If mem9 is already configured, do not repeat the full first-run onboarding unless the user explicitly asks to reinstall.
- For reconnect, config review, or setup failures, read `TROUBLESHOOTING.md` from the same skill directory.
- For explicit uninstall requests, read `UNINSTALL.md` from the same skill directory.
- If this skill was loaded remotely, read `TROUBLESHOOTING.md` from the same URL directory as the current `SKILL.md`.
- Remote path examples:
  - `https://mem9.ai/SKILL.md` -> [https://mem9.ai/TROUBLESHOOTING.md](https://mem9.ai/TROUBLESHOOTING.md)
  - `https://mem9.ai/beta/SKILL.md` -> [https://mem9.ai/beta/TROUBLESHOOTING.md](https://mem9.ai/beta/TROUBLESHOOTING.md)
  - `https://mem9.ai/test/SKILL.md` -> [https://mem9.ai/test/TROUBLESHOOTING.md](https://mem9.ai/test/TROUBLESHOOTING.md)
- Keep historical import manual. Direct users to the dashboard or another reviewed manual workflow instead of uploading local files from this skill.

## Definition of Done

- If first-run onboarding happened, `SETUP.md` was read and completed, including the required final handoff.
- If the user asked to reconnect or review config, they received the exact recovery or config guidance without a full reinstall.
- If the user asked to uninstall mem9, `UNINSTALL.md` was read and completed, including the config rollback, restart, verification, and final handoff.
- If the user later makes an explicit durable-write request, the agent uses live mem9 write semantics instead of replying with an unverified conversational acknowledgment.

## Quick Start After ClawHub Install

- After installing from ClawHub, start a new chat session.
- Say: `setup mem9`, `install mem9`, or `reconnect mem9`.
- If slash commands work in the current channel, `/skill mem9 ...` is only an optional backup path.

## Update

Do not set up automatic daily self-updates for this skill.

Only update the local skill bundle when the user or maintainer explicitly asks for a refresh from a reviewed source.
