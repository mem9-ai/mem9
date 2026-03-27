---
title: benchmark/MR-NIAH — Benchmark harness
---

## Overview

MR-NIAH is a bridge from the MiniMax benchmark corpus to OpenClaw sessions and mem9 comparison runs.

## Files and workflow

| File                    | Role                                                  |
| ----------------------- | ----------------------------------------------------- |
| `fetch_data.py`         | Mirror/update upstream dataset into `origin/`         |
| `mr-niah-transcript.py` | Convert raw turns into OpenClaw session JSON          |
| `run_batch.py`          | Replay generated sessions through an OpenClaw profile |
| `run_mem_compare.sh`    | Compare baseline vs mem9-enabled profile              |
| `score.py`              | Apply MR-NIAH scoring rubric to predictions           |
| `USAGE.md`              | Full prerequisites and end-to-end usage               |

## Where to look

- Dataset cache and raw source: `origin/`
- Generated sessions and index: `output/`
- Latest run outputs: `results/`
- Preserved comparison outputs: `results-*/`
- Helper state: `.cache/`

## Commands

```bash
cd benchmark/MR-NIAH && python3 fetch_data.py
cd benchmark/MR-NIAH && python3 mr-niah-transcript.py
cd benchmark/MR-NIAH && python3 run_batch.py --profile mrniah_local --agent main --limit 30
cd benchmark/MR-NIAH && SAMPLE_LIMIT=30 bash run_mem_compare.sh
cd benchmark/MR-NIAH && python3 score.py results/predictions.jsonl
```

## Local conventions

- Treat this as pipeline code, not product code; scripts are orchestrators around local files and external tools.
- Keep generated artifacts out of the source files under review; `origin/`, `output/`, and `results*/` are working directories.
- `run_mem_compare.sh` depends on the rest of the pipeline being reproducible; avoid hidden local assumptions.
- Preserve benchmark comparability: do not change the scoring rubric casually.

## Gotchas

- `run_mem_compare.sh` expects Python 3.10+.
- `run_mem_compare.sh` expects the mem9 API endpoint to be reachable; by default it uses `https://api.mem9.ai`.
- If mem9 space provisioning is rate-limited, wait briefly and rerun, or point `MEM9_BASE_URL` at another mem9-compatible endpoint.

## Anti-patterns

- Do NOT hardcode one-off local result paths into reusable scripts.
- Do NOT mix transcript generation and scoring logic in the same script.
- Do NOT overwrite canonical benchmark data in `origin/` with transformed output.

## Outstanding follow-ups

- Persist comparison scores to files instead of only printing to stdout.
- Add a `--model` flag to `run_mem_compare.sh`.
- Add an explicit flag for forced memory hacks / compaction behavior.
