# MR-NIAH Usage Guide

This document explains how to prepare an OpenClaw profile, set up the required dependencies, and run the MR-NIAH benchmark pipeline end-to-end.

## Prerequisites

### OpenClaw profiles

1. Pick a baseline profile name (defaults to `mrniah_local` throughout the scripts) and initialize it with the OpenClaw CLI so that `~/.openclaw-<profile>/openclaw.json` exists.
2. Ensure the profile includes at least one agent (default: `main`) because `run_batch.py` and `run_mem_compare.sh` drop regenerated transcripts into `<profile>/agents/<agent>/sessions/` and update `sessions.json` automatically.
3. When you plan to run comparisons, keep the baseline profile pristine. The comparison script clones it to `~/.openclaw-${MRNIAH_MEM_PROFILE}` (default `mrniah_mem`) before installing the mem9 plugin, so everything that should be shared—API keys, transports, tools—must already live in the baseline directory.
4. If you are working from an existing team profile, copy the entire folder into `~/.openclaw-<profile>` (or let the CLI initialize it) before you start the pipeline; the scripts never copy data back into the repo.

### Software and infrastructure

| Requirement                                                               | Why you need it                                                                                 | Notes                                                                                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Python 3.10+ & pip                                                        | Runs `fetch_data.py`, `mr-niah-transcript.py`, `run_batch.py`, and `score.py`.                  | Install dependencies with `python3 -m pip install -r requirements.txt` from the repo root if available, or install `requests`, `click`, and `rich` manually. |
| Git + network access to MiniMax’s MR-NIAH repo                            | `fetch_data.py` mirrors upstream datasets via GitHub.                                           | Works with anonymous HTTPS; provide a token if your network requires it.                                                                                     |
| OpenClaw CLI (latest)                                                     | Executes agents for each regenerated session.                                                   | Verify `openclaw --version` works and that the CLI can run your chosen profile interactively.                                                                |
| Access to the hosted mem9 API (or another mem9-compatible endpoint)       | Stores mem9 state whenever you run the comparison flow.                                         | By default the script uses `https://api.mem9.ai`; set `MEM9_BASE_URL` if you want a different endpoint.                                                      |

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

### 3. Run OpenClaw batches

```
python3 run_batch.py --profile mrniah_local --agent main --local --limit 30
```

- The script copies each transcript into `<profile>/agents/<agent>/sessions/`, registers it in `sessions.json`, calls `openclaw agent --session-id ... --message "<question>" --json`, and stores both structured JSON and raw logs under `results/`.
- Key flags:
  - `--profile` – target OpenClaw profile (must already exist as described above).
  - `--agent` – agent directory name inside the profile. Defaults to `main`.
  - `--local` – forwards OpenClaw’s `--local` flag, useful when the agent relies on local transports.
  - `--limit` – cap the number of MR-NIAH samples processed.
- Artifacts land in `results/predictions.jsonl` plus `results/raw/*.stdout.json` / `.stderr.txt`.

### 4. (Optional) Baseline vs mem9 comparison

```
MRNIAH_LIMIT=30 ./run_mem_compare.sh
```

1. Verifies `output/index.jsonl` exists (generate it if missing).
2. Clones `~/.openclaw-${MRNIAH_BASE_PROFILE}` to `~/.openclaw-${MRNIAH_MEM_PROFILE}` unless you export `MRNIAH_RESET_MEM_PROFILE=1`.
3. Uses the hosted mem9 API by default (`https://api.mem9.ai`), or the endpoint you provide via `MEM9_BASE_URL`.
4. Provisions a fresh mem9 space for the run.
5. Installs the `openclaw-plugin` into the memory profile, adds `plugins.allow=["mem9"]`, and writes the tenant credentials into `plugins.entries.mem9.config`.
6. Calls `run_batch.py` twice (baseline vs mem), renaming each `results/` directory to `results-${profile}`.
7. Prints accuracy for both runs and the delta.

Common environment variables:

| Variable                   | Default                                       | Purpose                                                         |
| -------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| `MRNIAH_BASE_PROFILE`      | `mrniah_local`                                | Baseline OpenClaw profile.                                      |
| `MRNIAH_MEM_PROFILE`       | `mrniah_mem`                                  | Copy of the baseline with mem9 enabled.                         |
| `MRNIAH_AGENT`             | `main`                                        | Agent passed through to `run_batch.py`.                         |
| `MRNIAH_LIMIT`             | `300`                                         | Samples processed per run.                                      |
| `MRNIAH_LOCAL`             | `1`                                           | When `1`, adds `--local` to every OpenClaw invocation.          |
| `MEM9_BASE_URL`            | `https://api.mem9.ai`                         | mem9 API endpoint used for the comparison run.                  |
| `MRNIAH_RESET_MEM_PROFILE` | `0`                                           | Set to `1` to delete the mem profile before cloning.            |

### 5. Score predictions

```
python3 score.py [results/predictions.jsonl] [--max-errors 5]
```

- Splits each ground-truth answer into key phrases and checks whether each phrase appears as a substring in the model prediction (case-sensitive). The per-sample score is the fraction of matched phrases. Refusal responses are scored as 0.
- Use `--max-errors` to print mismatched samples for manual inspection.
- Point the script at the comparison artifacts (`results-mrniah_local/predictions.jsonl`, `results-mrniah_mem/predictions.jsonl`) to evaluate each profile independently.

### Troubleshooting tips

- Regenerating transcripts is safe—`mr-niah-transcript.py` deletes and recreates `output/` on every run.
- If OpenClaw logs include ANSI escape sequences, `run_batch.py` strips them before parsing JSON. Check `results/raw/*.stderr.txt` when a session fails.
- If the hosted mem9 API rejects provisioning or rate-limits requests, wait a bit and rerun, or point `MEM9_BASE_URL` to another mem9-compatible endpoint.
