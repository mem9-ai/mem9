---
name: mem9
version: 1.0.45
homepage: "https://mem9.ai"
description: "Platform router for mem9 install skills. Use the product-specific SKILL.md for OpenClaw or Hermes."
keywords: ["mem9", "install mem9", "openclaw", "hermes", "persistent memory", "cloud memory", "setup mem9"]
user-invocable: true
metadata: {"platforms":["openclaw","hermes"]}
---

# mem9

Use the platform-specific install skill for the client you are connecting.

## Routing

- OpenClaw: `https://mem9.ai/openclaw/SKILL.md`
- Hermes: `https://mem9.ai/hermes/SKILL.md`

## Rules

- If the user explicitly says `OpenClaw`, use the OpenClaw skill and do not mix in Hermes commands or config paths.
- If the user explicitly says `Hermes`, use the Hermes skill and do not mix in OpenClaw commands or config paths.
- If the target client is unclear, ask which product the user wants to connect before making any changes.
- Treat `https://mem9.ai/SKILL.md` as a backward-compatible launcher only. The canonical install skill URLs are under `/openclaw/` and `/hermes/`.
- If this launcher was opened with filtered `utm_*` query params, preserve those same filtered `utm_*` params when handing off to the platform-specific skill URL.

## Definition Of Done

- The correct platform-specific skill was selected.
- No commands or config changes were taken from the wrong client family.
