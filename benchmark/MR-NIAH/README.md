# MR-NIAH (OpenClaw) Benchmark Harness

MR-NIAH is our proving ground for turning legacy multi-turn chatbot benchmarks into first-class OpenClaw sessions. The harness bridges [MiniMax’s MR-NIAH](https://github.com/MiniMax-AI/MiniMax-01/tree/main/evaluation/MR-NIAH) corpus into OpenClaw-compatible transcripts, replays them through baseline and memory-enabled profiles, and reports MR-NIAH scores so existing datasets can drive current memory experiments without hand-curated prompts.

## Background: Bridging Stored Benchmarks to OpenClaw

Research teams have produced numerous memory benchmarks for chatbots, but their formats (JSONL dumps, bespoke timelines, ad-hoc scoring) do not slot into OpenClaw’s profile + session model. This repo demonstrates how to wrap one of those datasets—MR-NIAH—so that every sample can be ingested, replayed, and scored inside OpenClaw without manual transcription. The same pattern applies to other dormant benchmarks: swap in a new transcript conversion script and the rest of the automation stays identical. The value is multiplicative: OpenClaw gains immediate access to a large body of historical evaluation data, and benchmark owners do not need to redesign tasks from scratch.

## What the Harness Provides

- **Dataset mirroring (`fetch_data.py`)** – keeps a local `origin/` mirror of MiniMax’s MR-NIAH dumps.
- **Transcript bridge (`mr-niah-transcript.py`)** – rewrites raw turns into OpenClaw `session` JSON plus an `index`.
- **Batch execution (`run_batch.py`)** – rehydrates sessions into a profile, calls `openclaw agent`, and stores `results/`.
- **Comparison runner (`run_mem_compare.sh`)** – clones the baseline profile, installs the mem9 plugin, provisions a fresh mem9 space on the hosted mem9 API (or another configured mem9 endpoint), runs both profiles, prints accuracy deltas, and (on successful full comparisons) writes a tar.gz archive containing results + logs. Supports `--model` / `--compact`, plus managed profiles (template + `.env`) to avoid baseline/mem drift; defaults to `benchmark/MR-NIAH/config/openclaw/`.
- **Scoring (`score.py`)** – invokes the MR-NIAH exact-match rubric so downstream results remain comparable to prior papers.

Directory layout, helper scripts, and agent responsibilities are summarized below:

- `origin/`, `output/`, `results/`, `results-*/`, `.cache/` – see **Directory layout** and `AGENTS.md` for details.
- [`USAGE.md`](USAGE.md) – prerequisites, dependencies, and end-to-end commands for the full pipeline.
- [`AGENTS.md`](AGENTS.md) – step-by-step agent responsibilities plus outstanding TODOs.

## Directory layout

- `origin/` – upstream dataset dumps mirroring `data/<lang>/<tokens>_tokens.jsonl`.
- `output/` – regenerated sessions plus `output/index.jsonl` for the next run.
- `results/` – latest batch predictions (`results/predictions.jsonl` + raw logs).
- `results-<profile>/` – preserved outputs from comparison runs (baseline vs mem).
- `.cache/` – helper state for benchmark runs.

## Pipeline Overview

The pipeline is unchanged from prior revisions, but documentation now lives in dedicated files:

1. **Fetch** – mirror MR-NIAH data into `origin/` (`fetch_data.py`).
2. **Transcribe** – convert each sample into OpenClaw sessions and `output/index.jsonl` (`mr-niah-transcript.py`).
3. **Replay** – run batches against an OpenClaw profile to populate `results/` (`run_batch.py`).
4. **Compare (optional)** – run baseline vs mem9 via `run_mem_compare.sh`, which depends on `run_batch.py` and `score.py`.
5. **Score** – compute MR-NIAH accuracy for any predictions file (`score.py`).

See [`USAGE.md`](USAGE.md) for flags, environment variables, and troubleshooting guidance.

## Why This Approach Helps

- **Parallelism by design** – transcript generation decouples dataset preparation from OpenClaw execution, so multiple profiles or agents can replay the same `output/` concurrently without re-downloading data.
- **scales to other datasets** – once the transcript conversion is adapted, the remaining steps (batching, comparison, scoring) stay identical, enabling “drop-in” baselines for any legacy memory benchmark.
- **Fast baseline coverage** – by replaying large corpora automatically, teams can collect baseline accuracy for new models or plugins in hours instead of curating bespoke prompts.

MR-NIAH remains the first bridge: it proves the tooling can translate a stored benchmark into OpenClaw runs, execute them in parallel, and surface MR-NIAH scores. The same architecture can now be reused for the broader set of historical datasets while we design the next generation of native OpenClaw memory evaluations.
