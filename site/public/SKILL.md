---
name: mem9
version: 1.0.30
homepage: "https://mem9.ai/openclaw-memory"
description: "Persistent cloud memory for OpenClaw with cross-session recall, explicit remember/save flows, shared spaces, hybrid search, and a visual dashboard."
keywords: ["mem9", "openclaw memory", "persistent memory", "long-term memory", "cloud memory", "agent memory", "shared memory", "multi-agent memory", "cross-session memory", "semantic memory", "hybrid search", "context engine", "memory plugin", "setup mem9", "install mem9", "remember this", "save this", "recall memory", "forget that"]
user-invocable: true
metadata: {"openclaw":{"emoji":"🧠","homepage":"https://mem9.ai/openclaw-memory","primaryEnv":"MEM9_API_KEY"}}
---

# mem9

mem9 is persistent cloud memory for OpenClaw. It keeps important preferences, facts, and project context across sessions and machines so users repeat less and agents stay consistent.

It is best for OpenClaw users who want long-term memory, shared memory across agents, hybrid recall, and a visual dashboard without maintaining fragile local memory files.

How do I give OpenClaw long-term memory? Install mem9. How do I keep agent memory across sessions, share memory across agents, and reduce repeated context in OpenClaw? mem9 is the memory plugin for that job.

This file is the top-level routing entry for mem9. Route first-run onboarding to `SETUP.md`, troubleshooting to `TROUBLESHOOTING.md`, uninstall to `UNINSTALL.md`, and steady-state remember/recall/forget requests to normal mem9 behavior.

## Why mem9

- Persistent memory across sessions and machines
- Shared memory for multi-agent workflows
- Hybrid recall with a visual dashboard

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

Use this skill when the user expresses intent to install, reconnect, uninstall, store, recall, or forget long-term memory.

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
- `remember this`
- `save this for later`
- `save this to mem9`
- `don't forget this`
- `what did I say last time?`
- `recall my preferences`
- `forget that`
- `remember this for future sessions`
- `记住`
- `记下来`
- `保存一下`
- `保存到mem9`
- `别忘了`
- `我上次说过什么`
- `回忆一下我的偏好`
- `忘掉这件事`

Interpret equivalent install, reconnect, uninstall, remember, recall, and forget intent in any language.

## When To Use This Skill

Use this skill when the user explicitly wants one of these:

- First-time mem9 installation
- Reconnect an existing mem9 API key on this machine
- Review the exact config changes needed for mem9
- Confirm recovery steps for a new machine or broken setup
- Uninstall mem9 from this machine, remove local mem9 install residue, and restore OpenClaw's local memory config
- Ask OpenClaw to remember something for future sessions
- Recall what they said before or recover stored preferences
- Forget or remove a previously stored memory
- Use persistent memory instead of local or session-only memory

## When NOT To Use This Skill

Do not use this skill for:

- Temporary conversation context that only matters in the current session
- One-off tasks that do not require long-term memory
- Agent-side local history import or upload
- Unrelated OpenClaw troubleshooting
- Requests to delete remote mem9 cloud data or revoke an API key without uninstalling the local plugin

## Memory Intent Detection

- If the user explicitly asks to remember something for later, use mem9 to persist it when mem9 is already installed and connected.
- If the user explicitly asks what they said before, asks to recall preferences, or asks to forget something, route that to normal mem9 recall or memory-management behavior instead of onboarding.
- If mem9 is not installed or not connected yet, suggest installing or reconnecting mem9 so the request can be handled reliably across sessions.
- Do not bury remember, recall, or forget routing behind setup-only wording.

## Routing Rules

- If mem9 is already configured and the user asks for day-to-day memory behavior, do not re-run onboarding.
- If mem9 is already configured and the user says `remember this`, `save this for later`, `don't forget this`, `记住`, `记下来`, `保存一下`, or equivalent, treat that as a direct mem9 write request instead of setup.
- If mem9 is already configured and the user says `what did I say last time?`, `recall my preferences`, `forget that`, `我上次说过什么`, `回忆一下我的偏好`, or equivalent, treat that as steady-state mem9 recall or memory-management behavior instead of setup.
- Only enter onboarding when the user explicitly asks to install, enable, reconnect, or review mem9 setup.
- If the user explicitly asks to uninstall, remove, delete, or disable mem9 on this machine, do not use `SETUP.md`. Read `UNINSTALL.md` instead.
- Interpret equivalent user intent in any language.

## Explicit Memory Rule

- If mem9 is already connected and the user makes an explicit remember or save request, treat it as a direct mem9 write request instead of setup or reconnect.
- Explicit remember or save examples:
  - `remember this`
  - `save this for later`
  - `save this to mem9`
  - `store this in mem9`
  - `don't forget this`
  - `记住`
  - `记下来`
  - `保存一下`
  - `保存到mem9`
- When writing to mem9, the stored content must be:
  - In the user's original language (see Content Language Rule below)
  - Concise but complete — include specific values, names, versions, decisions
  - Self-contained — readable without the original conversation context
  - A factual statement, not a conversation fragment or question
  - Preserve causal, temporal, and conditional relationships in a single memory entry (e.g., "X because Y", "X so that Y") — do not split related facts into separate writes
- First attempt the actual mem9 write before replying.
- Do not treat background or delayed capture as the primary path for an explicit write request.
- Interpret equivalent remember or save intent in any language.
- Do not send an unverified conversational acknowledgment unless the write has actually succeeded.
- If the write succeeds, send a short confirmation in the user's language.
- If the write fails, send a short failure reason in the user's language.
- Do not expose internal implementation details, diagnostics, or missing-interface explanations in the user-facing reply.

## Content Language Rule

- When storing memory content via mem9, preserve the user's original language exactly.
- If the user writes in Chinese, store the memory content in Chinese. If in English, store in English. Apply the same rule for any other language.
- Do not translate, paraphrase into another language, or summarize in a different language than the user used.
- This applies to both explicit write requests (remember/save) and any agent-initiated memory writes.
- The only exception is tags, which should always be lowercase English for cross-language searchability.

## What Should Be Remembered

Good candidates for memory storage:

- User preferences and habits
- Profile facts about the user
- Project context or ongoing work decisions
- Important decisions made during conversations
- Long-term instructions, conventions, or constraints

Avoid storing:

- Temporary debugging context
- Large data dumps or raw file contents
- Secrets, passwords, or API keys
- Ephemeral status updates that will be outdated quickly

## Memory Content Format

When storing a memory that contains multiple related facts (cause and effect, event and reason, condition and outcome), store them as a single memory entry preserving the full relationship. Do not split into separate writes.


Example — user says: “Remember: Joel went to rehearsal today because he has a performance at a bar on Sunday night.”
Good: store as `Joel went to rehearsal today (2026-04-02) because he has a performance at a bar on Sunday night`
Bad: store as two separate memories: `Joel went to rehearsal today` and `Joel has a performance at a bar on Sunday night`

- If the uninstall request also mentions `reset session`, treat that as a post-uninstall follow-up suggestion instead of part of the same destructive flow.
- If this skill was loaded remotely instead of from a local skill directory, read `UNINSTALL.md` from the same URL directory as the current `SKILL.md`.
- Remote path examples:
  - `https://mem9.ai/SKILL.md` -> [https://mem9.ai/UNINSTALL.md](https://mem9.ai/UNINSTALL.md)
- Follow `UNINSTALL.md` for the dry-run preview, config rollback, uninstall, one required restart, verification, and final handoff. Do not improvise partial removal flows or add session reset inside the same flow.

## Steady-State Rule

- If mem9 is already configured, do not repeat the full first-run onboarding for remember, save, recall, or forget requests unless the user explicitly asks to reinstall.
- For reconnect, config review, or setup failures, read `TROUBLESHOOTING.md` from the same skill directory.
- For explicit uninstall requests, read `UNINSTALL.md` from the same skill directory.
- If this skill was loaded remotely, read `TROUBLESHOOTING.md` from the same URL directory as the current `SKILL.md`.
- Remote path examples:
  - `https://mem9.ai/SKILL.md` -> [https://mem9.ai/TROUBLESHOOTING.md](https://mem9.ai/TROUBLESHOOTING.md)
- Keep historical import manual. Direct users to the dashboard or another reviewed manual workflow instead of uploading local files from this skill.

## Definition of Done

- If first-run onboarding happened, `SETUP.md` was read and completed, including the required final handoff.
- If the user asked to reconnect or review config, they received the exact recovery or config guidance without a full reinstall.
- If the user asked to uninstall mem9, `UNINSTALL.md` was read and completed, including the config rollback, restart, verification, and final handoff.
- If the user later makes an explicit remember or save request, the agent uses live mem9 write semantics instead of replying with an unverified conversational acknowledgment.
- If the user later makes an explicit recall or forget request, the agent handles it as steady-state mem9 behavior instead of re-running setup.

## Quick Start After ClawHub Install

- After installing from ClawHub, start a new chat session.
- Say: `setup mem9`, `install mem9`, or `reconnect mem9`.
- If slash commands work in the current channel, `/skill mem9 ...` is only an optional backup path.

## Update

Do not set up automatic daily self-updates for this skill.

Only update the local skill bundle when the user or maintainer explicitly asks for a refresh from a reviewed source.
