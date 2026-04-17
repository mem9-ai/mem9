# mem9 Benchmark Harnesses

This directory contains benchmark helpers and datasets for comparing OpenClaw's built-in file memory against mem9.

## Running the top-level A/B benchmark

Run the benchmark script directly:

```bash
export BENCH_PROMPT_FILE=benchmark/prompts/example.yaml
bash benchmark/scripts/benchmark.sh
```

If you are already inside `benchmark/`, use a prompt path relative to that directory:

```bash
cd benchmark
export BENCH_PROMPT_FILE=prompts/example.yaml
bash scripts/benchmark.sh
```

### Required environment variables

```bash
# Provide one Anthropic credential source.
export CLAUDE_CODE_TOKEN=...
# or
export ANTHROPIC_API_KEY=...
```

If both `CLAUDE_CODE_TOKEN` and `ANTHROPIC_API_KEY` are set, the script prefers `CLAUDE_CODE_TOKEN`.

The script validates the selected Anthropic credential against `https://api.anthropic.com/v1/models` before it starts provisioning profiles. If that preflight returns `401 invalid x-api-key`, the benchmark stops immediately because the model provider key is invalid.

The benchmark starts standalone `openclaw gateway run` processes and injects `ANTHROPIC_API_KEY` directly into those processes. It does not rely on launchd-managed gateway services, which avoids profile daemon environment drift during repeated local runs.

### Optional environment variables

```bash
# Defaults to the hosted mem9 service.
export MEM9_BASE_URL=https://api.mem9.ai

# Optional: per-prompt timeout in seconds.
export BENCH_PROMPT_TIMEOUT=600
```

If `MEM9_BASE_URL` is unset, the harness uses the hosted mem9 API at `https://api.mem9.ai` and provisions a fresh mem9 space for every benchmark run.

## Layout

- `scripts/benchmark.sh` — top-level A/B benchmark runner
- `scripts/drive-session.py` — sends the same prompt sequence to baseline and mem9 profiles
- `scripts/report.py` — renders the HTML comparison report
- `MR-NIAH/` — dataset bridge for the MR-NIAH benchmark
- `locomo/` — LoCoMo benchmark harness
- `workspace/` — shared workspace context copied into temporary benchmark profiles
- `results/` — benchmark outputs

## Notes

- Profile A uses OpenClaw's native memory files.
- Profile B installs the local `openclaw-plugin`, points it at mem9, and gets a fresh space for each run.
- The benchmark leaves the OpenClaw gateways running after completion for manual inspection.
