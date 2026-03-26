# MR-NIAH Usage Guide

This document explains how to prepare an OpenClaw profile, set up the required dependencies, and run the MR-NIAH benchmark pipeline end-to-end.

## Prerequisites

### OpenClaw profiles

There are two ways to run:

1) **Full baseline-vs-mem comparison (recommended)**: `run_mem_compare.sh` defaults to managed profiles and recreates fresh OpenClaw profiles per run from `benchmark/MR-NIAH/config/openclaw/`. You do not need to manually initialize `~/.openclaw-<profile>` beforehand.

2) **Single-profile batch runs** (e.g. calling `run_batch.py` directly): initialize your profile with the OpenClaw CLI so that `~/.openclaw-<profile>/openclaw.json` exists.

#### (Optional) Managed profiles (template + .env)

If you do not want to manually maintain two profiles (baseline + mem) and risk configuration drift (e.g. compaction settings), `run_mem_compare.sh` can recreate profiles from a template directory each run.

For full baseline-vs-mem comparisons, managed profiles are enabled by default to avoid accidental reuse of existing profiles. If you do not pass `--base-profile/--mem-profile`, the runner appends a `_yyyymmddhhmmss` suffix automatically.

Requirements:

- A template directory that contains at least an `openclaw.json` (it can also include `agents/`, `workspace/`, etc).
- An `.env` file that contains your secret API keys and any other required environment variables.
  - The runner treats it as opaque and never prints it.
  - `.env` is gitignored.

Default locations (in this repo):

- Template dir: `benchmark/MR-NIAH/config/openclaw/` (must contain `openclaw.json`)
- Env file: `benchmark/MR-NIAH/config/openclaw/.env`

Setup:

1) Copy `example.env` to `.env`:

```
cp benchmark/MR-NIAH/config/openclaw/example.env benchmark/MR-NIAH/config/openclaw/.env
```

2) Edit `benchmark/MR-NIAH/config/openclaw/.env` to set your keys.

3) Ensure `benchmark/MR-NIAH/config/openclaw/openclaw.json` references the same variable names (it typically uses `${ENV_VAR}` placeholders).

Example (recreate baseline + mem from a local template, set model + compaction preset):

```
./run_mem_compare.sh \
  --model "dashscope/qwen3.5-plus" \
  --compact "safeguard-20k"
```

Compaction presets live under `benchmark/MR-NIAH/openclaw/compact/` (a default `safeguard-20k` preset is included).

### Software and infrastructure

| Requirement                                                               | Why you need it                                                                                 | Notes                                                                                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Python 3.10+ & pip                                                        | Runs `fetch_data.py`, `mr-niah-transcript.py`, `run_batch.py`, and `score.py`.                  | Install dependencies with `python3 -m pip install -r requirements.txt` from the repo root if available, or install `requests`, `click`, and `rich` manually. |
| Git + network access to MiniMax’s MR-NIAH repo                            | `fetch_data.py` mirrors upstream datasets via GitHub.                                           | Works with anonymous HTTPS; provide a token if your network requires it.                                                                                     |
| OpenClaw CLI (latest)                                                     | Executes agents for each regenerated session.                                                   | Verify `openclaw --version` works and that the CLI can run your chosen profile interactively.                                                                |
| Access to the hosted mem9 API (or another mem9-compatible endpoint)       | Stores mem9 state whenever you run the comparison flow.                                         | By default the script uses `https://api.mem9.ai`; pass `--mem9-base-url` if you want a different endpoint.                                                   |

## Pipeline

### 1. Fetch MR-NIAH datasets

```
cd benchmark/MR-NIAH
python3 fetch_data.py [--lang LANG] [--tokens BUCKET ...] [--paths FILE ...]
```

- Without flags the script mirrors every published bucket (both languages) into `origin/`.
- Use `--lang {chinese|english|all|none}` and `--tokens` to narrow the dump, or `--paths` for explicit files such as `data/chinese/10240_tokens.jsonl`.
- `--dest` overrides the target directory, `--revision` pins to a GitHub ref, and `--dry-run` previews the plan.

### 2. Generate OpenClaw transcripts

```
python3 mr-niah-transcript.py [--lang LANG] [--tokens BUCKET ...] [--input FILE ...] [--limit N]
```

- The script wipes `output/`, converts each dataset entry so that the final user turn becomes the question, and emits:
  - `output/sessions/<uuid>.jsonl` – session history ready for OpenClaw.
  - `output/index.jsonl` – metadata that downstream steps consume.
- The defaults read all files in `origin/` if present; pass explicit files with `--input` or disable auto-selection via `--lang none`.
- If `benchmark/MR-NIAH/output/` is not writable (or you want to keep it immutable), write transcripts somewhere else:

```
python3 mr-niah-transcript.py --output-dir /tmp/mrniah-output
```

### 3. Run OpenClaw batches

```
python3 run_batch.py --profile mrniah_local --agent main --limit 30
```

- The script copies each transcript into `<profile>/agents/<agent>/sessions/`, registers it in `sessions.json`, calls `openclaw agent --session-id ... --message "<question>" --json`, and stores both structured JSON and raw logs under `results/`.
- Key flags:
  - `--profile` – target OpenClaw profile (must already exist as described above).
  - `--agent` – agent directory name inside the profile. Defaults to `main`.
  - `--limit` – cap the number of MR-NIAH samples processed.
  - `--output-dir` – where to read `index.jsonl` and `sessions/*.jsonl` from (default: `output/`).
  - `--import-sessions` – uploads the session transcript to mem9 via `/imports` before each agent turn. Requires mem9 tenant details via `--mem9-api-url/--mem9-tenant-id` (or env vars / profile config).
- Artifacts land in `results/predictions.jsonl` plus `results/raw/*.stdout.json` / `.stderr.txt`.

### 4. (Optional) Baseline vs mem9 comparison

```
./run_mem_compare.sh --limit 30
```

If you generated transcripts into a non-default output directory, pass the same location to the runner:

```
./run_mem_compare.sh --output-dir /tmp/mrniah-output --limit 10
```

To rerun only one side (useful when baseline already exists and you just want to retry the mem9 run):

```
./run_mem_compare.sh --profile mrniah_mem --limit 30
```

To resume a failed single-profile run from a specific sample id (keeps `benchmark/MR-NIAH/results-<profile>/` and appends to `predictions.jsonl`):

```
./run_mem_compare.sh --profile mrniah_mem --resume 91
```

To re-run a single case (useful for patching up failures after the batch finishes):

```
./run_mem_compare.sh --profile mrniah_mem --case 91
```

By default, the runner continues on per-case failures and records them into `predictions.jsonl`.
To stop immediately on the first failure, add `--fail-fast`.

To compare existing runs without re-running (e.g. baseline succeeded earlier, mem was re-run later):

```
./run_mem_compare.sh --compare
```

#### Common options

- `--model <provider/model>`: sets `agents.defaults.model.primary` for both baseline + mem profiles.
- `--compact <preset|path.json>`: applies a compaction preset to both baseline + mem profiles (`agents.defaults.contextTokens` + `agents.defaults.compaction`).
- `--model-context-window <n>`: best-effort patch of the selected model catalog entry in `openclaw.json` (`models.providers.*.models[].contextWindow`). This is only applied when the profile `openclaw.json` contains a matching model entry.
- `--mem9-base-url <url>`: overrides the default mem9 base URL for this run.

#### Post-processing (archive)

When you run a full baseline-vs-mem comparison (not `--profile`, not `--compare`, not `--case`, not `--resume`) and the script completes successfully, it automatically creates a tarball in `results-logs/` containing:

- both `results-<profile>/` directories
- the main compare log file

1. Verifies `output/index.jsonl` exists (generate it if missing).
2. Creates `~/.openclaw-<mem-profile>` by cloning `~/.openclaw-<base-profile>` when the mem profile is missing, or when you pass `--reset-mem-profile`.
3. Uses the hosted mem9 API by default (`https://api.mem9.ai`), or the endpoint you provide via `--mem9-base-url`.
4. Chooses a mem9 isolation strategy via `--mem9-isolation`:
   - `tenant` (default): provisions a fresh mem9 space per case (strong isolation; recommended).
   - `clear`: provisions one mem9 space for the run and clears memories before/after each case.
5. Chooses a mem9 history load strategy via `--mem9-load-method`:
   - `line-write` (default): replays the transcript by posting each JSONL message line to `v1alpha2 /memories` sequentially.
   - `import-session`: uploads the full transcript via `v1alpha1 /imports` (`file_type=session`) and polls the task.
6. Installs the `openclaw-plugin` into the memory profile, adds `plugins.allow=["mem9"]`, and writes the tenant credentials into `plugins.entries.mem9.config`.
7. Calls `run_batch.py` twice (baseline vs mem), writing into `results-${profile}` for baseline and `results-${mem_profile}` for the mem run.
8. Prints accuracy for both runs and the delta.

Key flags for reproducibility:

- `--base-profile` / `--mem-profile` / `--agent` / `--limit`
- `--mem9-base-url` / `--mem9-isolation` / `--mem9-load-method`
- `--mem9-line-write-*` and `--mem9-import-*` (depending on load method)
- `--mem9-trace-*`
- `--parallel` / `--sequential`
- `--openclaw-timeout`
- `--reset-mem-profile`

Workspace note:

- The scripts configure each OpenClaw profile to use a benchmark workspace under `~/.openclaw-<profile>/workspace` (not under `~/.openclaw/`).

### 5. Score predictions

```
python3 score.py [results/predictions.jsonl] [--max-errors 5]
```

- Splits each ground-truth answer into key phrases and checks whether each phrase appears as a substring in the model prediction (case-sensitive). The per-sample score is the fraction of matched phrases. Refusal responses are scored as 0.
- Use `--max-errors` to print mismatched samples for manual inspection.
- Point the script at the comparison artifacts (`results-mrniah_local/predictions.jsonl`, `results-mrniah_mem/predictions.jsonl`) to evaluate each run independently.

### Troubleshooting tips

- Regenerating transcripts is safe—`mr-niah-transcript.py` deletes and recreates `output/` on every run.
- If OpenClaw logs include ANSI escape sequences, `run_batch.py` strips them before parsing JSON. Check `results/raw/*.stderr.txt` when a session fails.
- If the hosted mem9 API rejects provisioning or rate-limits requests, wait a bit and rerun, or point `--mem9-base-url` to another mem9-compatible endpoint.
