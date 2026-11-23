---
name: mem9-store
description: >-
  Store one user-approved fact, preference, or instruction in mem9 using the
  memory_store MCP tool. Use when the user explicitly asks to remember or save something.
---

# Mem9 Store

Use this skill only when the user explicitly asks to remember or save a fact, preference, or instruction in mem9, or approves storing a proposed memory.

## Steps

1. Identify the concise, self-contained fact, preference, or instruction to store.
2. Refuse to store secrets: never call `memory_store` with API keys, passwords, tokens, private keys, or credential file contents (`~/.mem9/.credentials.json`, `${PLUGIN_DATA}/auth.json`).
3. Call the `mem9` MCP tool `memory_store` with `content` (and `tags` or `metadata` only when explicitly helpful or requested).
4. If `memory_store` reports that mem9 is unconfigured, disabled, or missing credentials, tell the user to run `/mem9-setup` first.
5. Confirm back to the user what was saved (including the returned memory ID if available), without echoing any sensitive credentials.
