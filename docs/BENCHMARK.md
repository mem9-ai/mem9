# Benchmark Pipeline

## Overview

Run the top-level A/B benchmark with:

```bash
bash benchmark/scripts/benchmark.sh
```

The harness compares an agent **without** mem9 memory (Profile A / baseline) vs. **with** mem9 memory (Profile B / treatment). Both profiles receive the same prompts within a persistent session, and results are compared side-by-side in an HTML report.

By default the script provisions a fresh mem9 space on the hosted mem9 service at `https://api.mem9.ai` for every run. You can override the backend with `MEM9_BASE_URL`.

## Prerequisites

**Required CLI tools:** `jq`, `curl`, `openclaw`, `python3`

**Python packages:** `pyyaml`

**Required environment variables:**

- `CLAUDE_CODE_TOKEN` — Anthropic API key. The script exits immediately if unset.
- `BENCH_PROMPT_FILE` — Path to the prompt YAML file. The script exits immediately if unset.

## Optional environment variables

| Variable | Default | Description |
|---|---|---|
| `MEM9_BASE_URL` | `https://api.mem9.ai` | Base URL for the mem9 API |
| `BENCH_PROMPT_TIMEOUT` | `600` | Per-prompt timeout in seconds |

## Pipeline phases

The benchmark runs through seven sequential phases:

### Phase 1 — Cleanup

Stops any leftover gateways from previous runs and removes old temporary profile/workspace directories (`~/.openclaw-<profile>`, `~/.openclaw/workspace-<profile>`).

### Phase 2 — Configure mem9 space

1. Normalizes `MEM9_BASE_URL`.
2. Provisions a fresh mem9 space via `POST /v1alpha1/mem9s`.

### Phase 3 — Create profiles

Sets up two OpenClaw profiles:

- **Profile A (baseline)** — vanilla agent, no plugins.
- **Profile B (treatment)** — mem9 plugin installed and configured to point at the mem9 API and space ID.

Both profiles use `anthropic/claude-sonnet-4-6` and are given the same API key.

### Phase 4 — Workspace setup

Copies shared context files (`SOUL.md`, `IDENTITY.md`, `USER.md`) from `benchmark/workspace/` into both profile workspaces so the agents start with identical context.

### Phase 5 — Start gateways

Launches both OpenClaw gateways and waits for their `/health` endpoints to return successfully (up to 60 s each).

### Phase 6 — Run benchmark

1. **`drive-session.py`** — reads the prompt YAML file and sends each prompt to both profiles in parallel. All prompts within a profile share the same session ID, preserving conversation context across turns. Outputs structured JSON and a markdown transcript.
2. **`report.py`** — consumes the JSON results and generates a self-contained HTML report with a side-by-side comparison layout.

### Phase 7 — Summary

Prints result file paths, mem9 connection details, running gateway PIDs, and gateway web UI URLs. Gateways are left running for manual inspection.

## Prompt file format

Prompt files are YAML with the following schema:

```yaml
name: <scenario-name>
description: <description>
prompts:
  - <prompt-1>
  - <prompt-2>
  - <prompt-3>
```

Each entry in `prompts` is a plain-text string sent to both profiles sequentially. All prompts share a single session per profile, so later prompts can reference earlier conversation turns.

## Results output

Each run writes to `benchmark/results/YYYYMMDD-HHMMSS/`:

| File | Description |
|---|---|
| `benchmark-results.json` | Structured JSON with per-turn prompts, responses, timings, and exit codes |
| `transcript.md` | Human-readable markdown showing prompts and responses side-by-side |
| `report.html` | Self-contained HTML report with dark theme, collapsible turns, and summary stats |
