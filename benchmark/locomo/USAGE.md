# LoCoMo Benchmark Usage

This guide shows how to run the `mem9` LoCoMo benchmark end-to-end.

## Prerequisites

You need all of the following:

- Node.js 20+ (Node 22+ recommended because the harness uses built-in `fetch`)
- access to the hosted mem9 API (default) or another mem9-compatible endpoint
- an OpenAI-compatible chat/completions endpoint for answer generation
- the LoCoMo dataset JSON file (`locomo10.json`)

## 1. Install benchmark dependencies

From this directory:

```bash
cd benchmark/locomo
npm install
```

## 2. Place the dataset

Copy the LoCoMo file to:

```bash
cp /path/to/locomo10.json data/locomo10.json
```

## 3. Configure environment variables

Minimal configuration:

```bash
export OPENAI_API_KEY=...
# Optional: defaults to the hosted mem9 API.
export MEM9_BASE_URL=https://api.mem9.ai
# Optional: if unset, the harness auto-provisions a fresh space per sample.
export MEM9_TENANT_ID=your-space-id
```

Optional but commonly needed:

```bash
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_CHAT_MODEL=gpt-4o-mini
export OPENAI_JUDGE_MODEL=gpt-4o          # separate model for LLM judge (recommended)
export MEM9_AGENT_ID=locomo-bench
export MEM9_RETRIEVAL_LIMIT=20
export MEM9_CLEAR_SESSION_FIRST=0
```

### What these variables mean

- `MEM9_BASE_URL` — base URL of the mem9 API (defaults to `https://api.mem9.ai`)
- `MEM9_TENANT_ID` — mem9 **space ID** (optional for ingest runs — if unset, the harness auto-provisions a fresh space per sample; **required** with `--skip-ingest`)
- `MEM9_AGENT_ID` — agent name sent through the `X-Mnemo-Agent-Id` header and stored on writes
- `OPENAI_BASE_URL` — OpenAI-compatible API base URL
- `OPENAI_CHAT_MODEL` — model used to answer LoCoMo questions
- `OPENAI_JUDGE_MODEL` — model used for the LLM semantic judge (defaults to `OPENAI_CHAT_MODEL` if not set; use a stronger model like `gpt-4o` for more reliable judging)
- `MEM9_RETRIEVAL_LIMIT` — number of memories pulled per question (default: 20)
- `MEM9_CLEAR_SESSION_FIRST=1` — delete prior benchmark memories for a sample before re-ingesting it

## 4. Run the benchmark

### Full run (raw memory writes)

```bash
npm run start
```

Default paths:

- `--data-file` → `./data/locomo10.json`
- `--out-file` → `./results/<timestamp>.json`

### Full run (smart messages pipeline)

```bash
npm run start -- --ingest-mode messages
```

This sends dialogue turns through the `messages` ingest pipeline (with LLM-based fact extraction and reconciliation) instead of raw memory writes. This tests mem9's full smart-ingest capability.

By default the harness provisions a fresh mem9 space per sample. If you set `MEM9_TENANT_ID`, all samples reuse that one space; in that mode the harness still waits for writes per `session_id`, so concurrent samples do not interfere with each other's ingest-complete checks.

### Run only specific samples

```bash
npm run start -- --sample-ids 1,2,3
```

### Reuse already ingested memories

Requires `MEM9_TENANT_ID` to be set (so the harness knows which space to query).

```bash
export MEM9_TENANT_ID=your-space-id
npm run start -- --skip-ingest
```

### Enable semantic LLM judge

```bash
npm run start -- --use-llm-judge
```

For best results, use a separate (stronger) model for the judge:

```bash
export OPENAI_JUDGE_MODEL=gpt-4o
npm run start -- --use-llm-judge --judge-model gpt-4o
```

## 5. What the harness does

1. Loads LoCoMo samples from `--data-file`
2. Uses `sample_id` as the `mem9 session_id`
3. Writes memories via the selected ingest mode:
   - `raw` (default): each dialogue turn as one raw memory via `POST /memories` with `content`
   - `messages`: groups turns into conversation messages via `POST /memories` with `messages` field
4. Queries matching memories for each question via `GET /v1alpha1/mem9s/{tenantID}/memories?q=...&session_id=...`
5. Builds a text context from retrieved memories
6. Calls the configured LLM to answer
7. Scores the answer (token-F1 + optional LLM judge + evidence recall) and writes a JSON report

## CLI flags

- `--data-file, -d` — path to `locomo10.json`
- `--out-file, -o` — output results JSON path
- `--sample-ids, -s` — comma-separated subset of sample IDs
- `--skip-ingest` — skip writes and only run retrieval + QA (requires `MEM9_TENANT_ID`)
- `--ingest-mode` — `raw` (default) or `messages` (smart pipeline)
- `--use-llm-judge` — run the lenient semantic judge in addition to token-F1
- `--judge-model` — model to use for LLM judge (overrides `OPENAI_JUDGE_MODEL`)
- `--evaluation-concurrency, -c` — concurrent retrieval / generation workers per sample (default: `4`)
- `--ingest-concurrency` — concurrent turn ingestion per sample in raw mode (default: `10`). Values > 1 mean turns are ingested in parallel, so reconciliation may see incomplete state from other concurrent turns. Use `1` for strict sequential conversation replay.
- `--sample-concurrency, -p` — concurrent sample processing (default: `0`, meaning all samples in parallel)

## Metrics

The benchmark reports multiple metrics:

- **Token-F1 (micro)**: average F1 across all questions (weighted by category sample count)
- **Token-F1 (macro)**: average of per-category F1 averages (treats each category equally)
- **LLM Judge**: semantic correctness score (0/1) from an LLM judge (optional)
- **Evidence Recall (ER)**: fraction of gold evidence dialogue turns found in retrieved memories

When comparing with other systems, note that most papers report **macro average**. The micro/macro distinction matters because category sample counts are uneven (Cat 4 has ~841 questions, Cat 3 has ~96).

## Sanity-check workflow

If you want a quick smoke test before a full run:

```bash
npm run start -- --sample-ids 1
```

## Notes and caveats

- The default `--ingest-mode raw` uses raw memory writes, not the smart `messages` pipeline. Use `--ingest-mode messages` to test full mem9 capability.
- Retrieval quality depends on your server-side embedding / search configuration.
- `mem9` writes use `sync: true`, so the API returns once the memory is fully persisted and searchable.
- If you rerun the same sample repeatedly without cleanup, retrieval may see duplicate benchmark memories. Set `MEM9_CLEAR_SESSION_FIRST=1` if you want fresh sample state per run.
- The LLM judge model should ideally be stronger than the answer generation model to avoid self-bias. Set `OPENAI_JUDGE_MODEL=gpt-4o` when using `gpt-4o-mini` for generation.
