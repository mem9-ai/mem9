# MR-NIAH Benchmark Agents

The MR-NIAH benchmark replicates the full memory lifecycle used in MR-NIAH, so each agent maps to a concrete step in the workflow:

## Pipeline

- **fetch_data** – Clones or updates the benchmark dataset directly from GitHub into the local `origin/` cache so every downstream step works with the same canonical files.
- **transcript** – Reads the raw data in `origin/` and rewrites it into OpenClaw-compliant `session` JSON, emitting the processed conversations to the `output/` directory for evaluation.
- **run_batch** – Launches an OpenClaw profile run that exercises the scripted scenario once per profile; `run_mem_compare` depends on these logs to stay reproducible.
- **run_mem_compare** – Executes the comparison experiment that contrasts MR-NIAH with its baselines, aggregates metrics from the `run_batch` outputs, and surfaces the final benchmark tables.
- **score** – Invokes the MR-NIAH scoring script so that every experimental run shares the same grading rubric used by the upstream benchmark.

## TODO

1. Persist comparison scores to files instead of only printing them to `stdio`.
2. Surface a `--model` flag in `run_mem_compare` so different models can be compared in one pass.
3. Add a `--hack-memory` boolean switch plus the underlying trigger logic to force manual memory hacks during evaluation.
4. Annotate each result artifact with an explicit flag that states whether automatic compaction was triggered.
