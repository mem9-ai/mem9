# Benchmark Pipeline

## Overview

`make benchmark` runs `scripts/benchmark.sh`, an A/B test comparing an agent **without** mnemo memory (Profile A / baseline) vs. **with** mnemo memory (Profile B / treatment). Both profiles receive the same prompts within a persistent session; results are compared side-by-side in an HTML report.

## Prerequisites

**Required CLI tools:** `jq`, `mysql`, `openclaw`, `python3`, `go`

**Python packages:** `pyyaml`

**Required environment variables:**

- `CLAUDE_CODE_TOKEN` — Anthropic API key. The script exits immediately if unset.
- `BENCH_PROMPT_FILE` — Path to the prompt YAML file. The script exits immediately if unset.

## Optional environment variables

| Variable | Default | Description |
|---|---|---|
| `TIDB_ZERO_API` | `https://zero.tidbapi.com/v1alpha1/instances` | TiDB Zero provisioning endpoint |
| `MNEMO_DB_NAME` | `test` | Database name |
| `MNEMO_BENCH_PORT` | `18081` | Port for mnemo-server |
| `BENCH_PROMPT_TIMEOUT` | `600` | Per-prompt timeout in seconds |

## Pipeline phases

The benchmark runs through seven sequential phases:

### Phase 1 — Cleanup

Stops any leftover gateways from previous runs and removes old profile/workspace directories (`~/.openclaw-<profile>`, `~/.openclaw/workspace-<profile>`).

### Phase 2 — Provision infrastructure

1. Provisions a TiDB Zero cluster via the REST API.
2. Waits for the database to become reachable (up to 120 s).
3. Applies `server/schema.sql` to the cluster.
4. Builds and starts `mnemo-server` on `MNEMO_BENCH_PORT`.
5. Provisions a tenant via `POST /v1alpha1/mem9s`.

### Phase 3 — Create profiles

Sets up two OpenClaw profiles:

- **Profile A (baseline)** — vanilla agent, no plugins.
- **Profile B (treatment)** — mnemo plugin installed and configured to point at the local mnemo-server and tenant.

Both profiles use `anthropic/claude-sonnet-4-6` and are given the same API key.

### Phase 4 — Workspace setup

Copies shared context files (`SOUL.md`, `IDENTITY.md`, `USER.md`) from `benchmark/workspace/` into both profile workspaces so the agents start with identical context.

### Phase 5 — Start gateways

Launches both OpenClaw gateways and waits for their `/health` endpoints to return successfully (up to 60 s each).

### Phase 6 — Run benchmark

1. **`drive-session.py`** — Reads the prompt YAML file and sends each prompt to both profiles in parallel (one thread per profile). All prompts within a profile share the same session ID, preserving conversation context across turns. Outputs structured JSON and a markdown transcript.
2. **`report.py`** — Consumes the JSON results and generates a self-contained HTML report with a side-by-side comparison layout.

### Phase 7 — Summary

Prints result file paths, running process PIDs, and gateway web UI URLs. Services are left running for manual inspection.

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

## Teardown

The script disables its cleanup trap before exiting, leaving mnemo-server and both gateways running. To tear down manually, kill the PIDs printed in the Phase 7 summary:

```bash
kill <gateway-a-pid> <gateway-b-pid> <mnemo-server-pid>
```
