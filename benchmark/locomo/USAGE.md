# LoCoMo Benchmark Usage

This guide shows how to run the `mem9` LoCoMo benchmark end-to-end.

## Prerequisites

You need all of the following:

- Node.js 20+ (Node 22+ recommended because the harness uses built-in `fetch`)
- a mem9 **space ID** (the `tenantID` in the API path)
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
# Optional: defaults to the hosted mem9 API.
export MEM9_BASE_URL=https://api.mem9.ai
export MEM9_TENANT_ID=your-space-id
export OPENAI_API_KEY=...
```

Optional but commonly needed:

```bash
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_CHAT_MODEL=gpt-4o-mini
export MEM9_AGENT_ID=locomo-bench
export MEM9_RETRIEVAL_LIMIT=10
export MEM9_CLEAR_SESSION_FIRST=0
```

### What these variables mean

- `MEM9_BASE_URL` — base URL of the mem9 API (defaults to `https://api.mem9.ai`)
- `MEM9_TENANT_ID` — mem9 **space ID**
- `MEM9_AGENT_ID` — agent name sent through the `X-Mnemo-Agent-Id` header and stored on writes
- `OPENAI_BASE_URL` — OpenAI-compatible API base URL
- `OPENAI_CHAT_MODEL` — model used to answer LoCoMo questions
- `MEM9_RETRIEVAL_LIMIT` — number of memories pulled per question
- `MEM9_CLEAR_SESSION_FIRST=1` — delete prior benchmark memories for a sample before re-ingesting it

## 4. Run the benchmark

### Full run

```bash
npm run start -- \
  --data-file ./data/locomo10.json \
  --out-file ./results/locomo-mem9.json
```

### Run only specific samples

```bash
npm run start -- \
  --data-file ./data/locomo10.json \
  --sample-ids 1,2,3
```

### Reuse already ingested memories

```bash
npm run start -- \
  --data-file ./data/locomo10.json \
  --skip-ingest
```

### Enable semantic LLM judge

```bash
npm run start -- \
  --data-file ./data/locomo10.json \
  --use-llm-judge
```

## 5. What the harness does

1. Loads LoCoMo samples from `--data-file`
2. Uses `sample_id` as the `mem9 session_id`
3. Writes each dialogue turn as one raw memory via `POST /v1alpha1/mem9s/{tenantID}/memories`
4. Queries matching memories for each question via `GET /v1alpha1/mem9s/{tenantID}/memories?q=...&session_id=...`
5. Builds a text context from retrieved memories
6. Calls the configured LLM to answer
7. Scores the answer and writes a JSON report

## CLI flags

- `--data-file, -d` — path to `locomo10.json`
- `--out-file, -o` — output results JSON path
- `--sample-ids, -s` — comma-separated subset of sample IDs
- `--skip-ingest` — skip writes and only run retrieval + QA
- `--use-llm-judge` — run the lenient semantic judge in addition to token-F1
- `--concurrency, -c` — concurrent retrieval / generation workers (default: `4`)

## Sanity-check workflow

If you want a quick smoke test before a full run:

```bash
npm run start -- \
  --data-file ./data/locomo10.json \
  --sample-ids 1 \
  --out-file ./results/smoke.json
```

## Notes and caveats

- The benchmark uses **raw memory writes**, not the smart `messages` ingest pipeline. This is intentional.
- Retrieval quality depends on your server-side embedding / search configuration.
- `mem9` accepts raw memory writes asynchronously (`202 Accepted`) in this repo, so the harness polls until the expected sample memories become searchable before evaluation continues.
- If you rerun the same sample repeatedly without cleanup, retrieval may see duplicate benchmark memories. Set `MEM9_CLEAR_SESSION_FIRST=1` if you want fresh sample state per run.
