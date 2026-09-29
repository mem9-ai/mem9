# LoCoMo Benchmark for mem9

This harness evaluates `mem9` against the [LoCoMo](https://github.com/snap-research/locomo) long-term memory benchmark. It uses the hosted mem9 API by default (`https://api.mem9.ai`), but you can point it at another compatible endpoint with `MEM9_BASE_URL`.

The harness works by:

1. ingesting each LoCoMo conversation into a mem9 space through the HTTP API,
2. retrieving memories per question via `GET /v1alpha1/mem9s/{tenantID}/memories`,
3. asking an OpenAI-compatible model to answer from the retrieved context, and
4. scoring answers with the LoCoMo-style per-category rubric.

By default this benchmark uses **raw memory writes** (`content` + metadata) instead of the smart `messages` ingest pipeline so the default run stays focused on retrieval quality over the original dialogue turns. You can also switch to the smart pipeline with `--ingest-mode messages` when you want to evaluate end-to-end ingestion behavior.

## Files

- `src/cli.ts` — benchmark entrypoint
- `src/ingest.ts` — writes LoCoMo turns into mem9
- `src/retrieve.ts` — queries mem9 search/list API and builds retrieval context
- `src/llm.ts` — OpenAI-compatible answer generation + optional LLM judge
- `src/evaluation.ts` — LoCoMo scoring
- `data/` — put your dataset here
- `results/` — local benchmark outputs (ignored by git)
- `USAGE.md` — exact setup and run steps

## Data layout

Place the LoCoMo JSON file at:

```text
data/locomo10.json
```

Run the benchmark with:

```bash
npm run start
```

## Key design choice

Each LoCoMo `sample_id` is mapped to one `mem9 session_id`. In the default `raw` mode, every dialogue turn becomes one memory with structured metadata:

- `sample_id`
- `session_no`
- `turn_index`
- `speaker`
- `date_time`
- `dia_id`

Retrieval then searches within that `session_id` so benchmark samples stay isolated from each other.

For end-to-end commands, see [USAGE.md](./USAGE.md).
