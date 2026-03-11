---
title: TiDB Native Full-Text Search for Hybrid Search
status: draft
created: 2026-03-03
last_updated: 2026-03-03
open_questions: 0
blocked_by: ""
---

## Summary

Prefer TiDB's native `FTS_MATCH_WORD()` full-text search as the keyword leg in
all mnemos hybrid search implementations, while retaining `LIKE` as a runtime
fallback when FTS is unavailable/disabled. Also upgrade merge strategy from
"vector wins, keyword gets 0.5" to Reciprocal Rank Fusion (RRF). Additionally,
add auto-embed hybrid search to the opencode direct backend and the
claude-plugin direct mode, both of which currently have no vector search path.

In server mode, all three agent plugins (openclaw, opencode, claude code) get
the upgrade automatically with zero plugin changes — the server is the only
component that needs updating. In direct mode, each plugin's backend is updated
independently.

## Context

mnemos hybrid search currently runs two queries and merges results client-side:

1. **Vector leg** — `VEC_COSINE_DISTANCE` / `VEC_EMBED_COSINE_DISTANCE` (already
   indexed, already good)
2. **Keyword leg** — `content LIKE CONCAT('%', ?, '%')` (full table scan, no
   ranking, multi-word queries return 0 results)

The keyword leg is the documented weak point. `CLAUDE.local.md` explicitly notes:
> "Multi-word queries (e.g., gRPC bbolt) return 0 results. Single-term queries
> work. This is expected for current keyword search implementation."

TiDB Cloud Serverless now offers native full-text search via `FTS_MATCH_WORD()`
with BM25 ranking, a `FULLTEXT INDEX`, and multilingual tokenization. This is a
drop-in upgrade for the keyword leg. When FTS is unavailable in a target
cluster, the existing `LIKE` path remains as compatibility fallback.

The opencode direct backend has no vector search path at all — `index.ts`
explicitly logs "does not support vector/hybrid search yet." The claude-plugin
direct mode also has no vector search — `mnemo_search()` only does `LIKE`.
Both can gain auto-embed hybrid search using `VEC_EMBED_COSINE_DISTANCE`, which
requires no external API key since TiDB embeds the query server-side.

## How Server Mode and Direct Mode Differ

### Server mode — zero plugin effort

All three server-backend implementations are pure HTTP pass-through. `search()`
forwards `?q=` to `GET /api/memories` and returns what the server responds with.
The plugins are completely oblivious to how the server executes the search.

```
openclaw ServerBackend.search()  ->  GET /api/memories?q=...  ->  mnemo-server
opencode ServerBackend.search()  ->  GET /api/memories?q=...  ->  mnemo-server
claude   mnemo_server_get()       ->  GET /api/memories?q=...  ->  mnemo-server
```

**Upgrading the server alone upgrades all three agents in server mode.** No plugin
changes needed. The entire server-side effort is ~51 LoC across three files.

### Direct mode — each plugin is independent

Each direct-mode plugin runs its own SQL queries against TiDB. Changes must be
made to each plugin separately.

Current direct-mode search status:

| Plugin | Vector leg | Keyword leg |
|---|---|---|
| **openclaw** | Both `VEC_COSINE_DISTANCE` + `VEC_EMBED_COSINE_DISTANCE` | LIKE |
| **opencode** | None | LIKE |
| **claude hooks** | None | LIKE |

After this proposal:

| Plugin | Vector leg | Keyword leg | Merge |
|---|---|---|---|
| **openclaw** | unchanged | FTS_MATCH_WORD | RRF |
| **opencode** | VEC_EMBED_COSINE_DISTANCE (new) | FTS_MATCH_WORD | RRF |
| **claude hooks** | VEC_EMBED_COSINE_DISTANCE (new) | FTS_MATCH_WORD | RRF |

## Design

### Full-Text Index

Add to all four schemas (server + three direct-mode auto-init):

```sql
ALTER TABLE memories
  ADD FULLTEXT INDEX idx_fts_content (content)
  WITH PARSER MULTILINGUAL
  ADD_COLUMNAR_REPLICA_ON_DEMAND;
```

`WITH PARSER MULTILINGUAL` — auto language detection, supports English, Chinese,
Japanese, Korean, and mixed-language documents.

`ADD_COLUMNAR_REPLICA_ON_DEMAND` — auto-provisions TiFlash on TiDB Cloud
Serverless. Critical for direct mode where TiFlash cannot be manually
pre-provisioned.

**Index creation failure policy**: Do NOT silently swallow DDL errors. The
existing `try/catch` / `|| true` pattern for VECTOR INDEX is insufficient here
because a missing FTS index causes silent full-table scans, not errors — the
search appears to work but returns wrong results. Instead:

- On startup (server and direct-mode init), attempt the `ALTER TABLE` DDL.
- If it fails, log a **WARNING** with the raw error and the remediation command.
- Perform a **capability check** after DDL: run a probe query
  `SELECT fts_match_word('probe', content) FROM memories LIMIT 0` and check
  for error. Two distinct states are possible:
  - `FTS_UNSUPPORTED` — the function is unknown to this TiDB version/edition;
    no retry makes sense. Log `WARN: FTS not supported on this cluster;
    keyword searches will fall back to LIKE` and permanently skip the FTS leg.
  - `FTS_PROVISIONING` — function exists but columnar replica not ready yet
    (prefer SQLSTATE / TiDB error code classification; use message text
    `columnar` / `TiFlash` only as fallback). Log `WARN: FTS index provisioning
    in progress; will retry (attempt N/5)` and retry with 5 s exponential
    backoff, up to 5 attempts (max ~2 min). If still failing after 5 attempts,
    treat as `FTS_UNSUPPORTED` and log accordingly.
- The capability result is stored as an internal boolean field (`ftsAvailable`)
  on the concrete repository/backend struct — not on the interface.
- **Initialization point**: DDL + probe run inside the repository constructor
  (e.g. `tidb.New()` for Go, `ensureSchema()` for TypeScript backends,
  `mnemo_direct_init()` for bash hooks). `main.go` / plugin startup code calls
  the constructor and receives an already-initialized backend. No lazy init.
- **Fail-fast is NOT used**: a cluster without FTS support should still serve
  keyword or vector searches — mnemos must not refuse to start. The degraded
  path is explicit and logged, not silent.

### FTS Query Pattern

The two modes have different schemas. Query contracts are split explicitly.

**Server mode** (has `tombstone` column, has `space_id`):

```sql
SELECT <cols>, fts_match_word(?, content) AS fts_score
FROM memories
WHERE space_id = ?
  AND tombstone = 0
  AND fts_match_word(?, content)
ORDER BY fts_match_word(?, content) DESC
LIMIT ?
```

**Direct mode** (no `tombstone` column; `space_id = 'default'` for
schema-compatibility; filter on `space_id` only):

```sql
SELECT <cols>, fts_match_word(?, content) AS fts_score
FROM memories
WHERE space_id = ?
  AND fts_match_word(?, content)
ORDER BY fts_match_word(?, content) DESC
LIMIT ?
```

The `tombstone = 0` predicate MUST NOT appear in direct-mode queries. Direct
mode uses no soft-delete; adding it would cause a column-not-found error at
runtime. Each backend change item below specifies which contract it follows.

`FTS_MATCH_WORD` appears three times in each pattern: `SELECT` (read BM25
score), `WHERE` (filter non-matching rows), `ORDER BY` (BM25 ranking). Same
constraint as `VEC_COSINE_DISTANCE` must appear identically in both `SELECT`
and `ORDER BY`.

Note: parameter order is `fts_match_word(query, column)` — query first, column
second. This is the opposite of some MySQL full-text functions.

### Merge Strategy: RRF

Replace "vector wins, keyword gets score=0.5" with **Reciprocal Rank Fusion**:

```
final_score = 1/(60 + rank_vec) + 1/(60 + rank_fts)
```

RRF operates on rank position, not raw scores — correct when vector scores
(cosine, 0-1) and BM25 scores (unbounded float) are on incompatible scales.
`k=60` is the standard constant. Results in both sets accumulate two contributions
and rise naturally. The 3x fetch limit stays unchanged.

In Go (mirrored in TypeScript for openclaw/opencode):

```go
const rrfK = 60.0
scores := make(map[string]float64)
mems   := make(map[string]domain.Memory)

for rank, m := range ftsResults {
    scores[m.ID] += 1.0 / (rrfK + float64(rank+1))
    mems[m.ID] = m
}
for rank, m := range vecResults {
    scores[m.ID] += 1.0 / (rrfK + float64(rank+1))
    if _, seen := mems[m.ID]; !seen {
        mems[m.ID] = m
    }
}
```

**Partial failure semantics** (applies to all backends consistently):

| Scenario | Behavior |
|---|---|
| Both legs succeed | Normal RRF merge |
| Selected keyword leg fails (`FTS` or `LIKE`) | Use vector leg results only; log `WARN: keyword leg skipped` |
| Vector leg fails (no embedding column, or VEC error) | Use selected keyword leg results only; log `WARN: vector leg skipped` |
| Both legs fail | Return empty results + log error; do NOT propagate error to caller |
| FTS unavailable at startup | Capability flag set; keyword mode switches to `LIKE` without per-query error |

This policy matches the existing server-mode behavior (`hybridSearch` already
continues when one leg returns no results) and is explicitly extended to direct
modes.

### Embedding Materialization for Direct-Mode Auto-Embed

The vector leg in direct mode requires `embedding IS NOT NULL`. In direct mode,
embeddings are generated by TiDB via a `GENERATED ALWAYS AS` column — **not**
written by the plugin. This section defines how that column is created and how
existing NULL rows are handled.

#### Generated column DDL (direct mode only)

When `MNEMO_AUTO_EMBED_MODEL` is set during schema init, the auto-init
(`ensureSchema()` in opencode/openclaw, `mnemo_direct_init()` in claude hooks)
must create the column as a generated column:

```sql
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1024)
    GENERATED ALWAYS AS (
      EMBED_TEXT('tidbcloud_free/amazon/titan-embed-text-v2', content)
    ) STORED;
```

- `model` and `dims` come from `MNEMO_AUTO_EMBED_MODEL` / `MNEMO_AUTO_EMBED_DIMS`
  (or their TypeScript config equivalents).
- `STORED` is required — TiDB materializes the embedding on insert/update,
  so the column is physically present for `WHERE embedding IS NOT NULL` and
  vector index use.
- **Non-generated column conflict** (chosen strategy): before running the
  `ADD COLUMN` DDL, detect whether a plain (non-generated) `embedding` column
  already exists:

  ```sql
  SELECT EXTRA FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'memories'
    AND COLUMN_NAME  = 'embedding';
  ```

  - If the query returns no row → column absent → run `ADD COLUMN` as above.
  - If `EXTRA` contains `GENERATED` or `DEFAULT_GENERATED` → already a generated
    column (possibly from a previous auto-embed run) → no DDL needed, proceed.
  - If `EXTRA` is empty/absent → plain non-generated column exists → hard-disable
    the vector leg and emit:

    ```
    WARN: embedding column exists as a plain (non-generated) column.
    Auto-embed vector search is disabled until you migrate:
      ALTER TABLE memories DROP COLUMN embedding;
    Then restart — the generated column will be re-created automatically.
    ```

    The vector leg is permanently skipped for this session; the FTS leg still
    runs. **No `ALTER TABLE MODIFY COLUMN` attempt is made** — converting a
    `STORED` generated column requires a full table rewrite on TiDB and is
    not safe to run silently at startup.

#### Model and dims configuration

| Env var | Purpose | Example |
|---|---|---|
| `MNEMO_AUTO_EMBED_MODEL` | TiDB-hosted model identifier | `tidbcloud_free/amazon/titan-embed-text-v2` |
| `MNEMO_AUTO_EMBED_DIMS` | Vector dimensions (must match model) | `1024` |

TypeScript config fields (`autoEmbedModel`, `autoEmbedDims`) map 1:1 to these
env vars. Mismatch between dims and actual model output causes a TiDB error on
first insert; this surfaces as a loud insert failure, not a silent search miss.

#### Pre-existing NULL embeddings

For tables created before auto-embed was configured (rows written without the
generated column present):

- Rows already in the table at the time the `ALTER TABLE ... ADD COLUMN`
  runs will have `embedding` back-filled by TiDB as part of `STORED` column
  materialization — TiDB recomputes all existing rows synchronously during
  the `ALTER TABLE`. This is the standard TiDB behavior for adding a `STORED`
  generated column.
- **Caveat**: on large tables, this `ALTER TABLE` may take significant time.
  Direct-mode startup will block until it completes. This is acceptable for
  the personal-developer scale of direct mode. A log line must be emitted:
  `INFO: adding generated embedding column — may take a moment for existing rows`.
- After migration, `embedding IS NOT NULL` holds for all rows because the
  generated column is `NOT NULL`-equivalent (TiDB computes a value for every
  row; a model error would surface as a DDL failure, not a NULL).

#### Server mode

Server mode already has a `GENERATED ALWAYS AS` embedding column in
`server/schema.sql` when `MNEMO_EMBED_AUTO_MODEL` is set. No change needed
here. The `embedding IS NOT NULL` predicate in server-mode vector queries is
already correct.

### claude-plugin: auto-embed hybrid in bash

The bash hooks use TiDB HTTP Data API (`curl` with inline SQL). Both
`VEC_EMBED_COSINE_DISTANCE` and `FTS_MATCH_WORD` are plain SQL functions that
work identically over the HTTP API — no driver-level differences.

The query string escaping concern is real: user queries may contain single quotes
or special characters. The existing `sql_escape()` Python helper in
`mnemo_post_memory()` handles this correctly. The new hybrid search function
follows the same pattern — build SQL entirely in Python via env vars, never
via bash string interpolation.

When `MNEMO_AUTO_EMBED_MODEL` is set, `mnemo_search()` runs two SQL queries and
merges with RRF entirely inside one Python heredoc block:

```bash
# Hybrid: two queries + RRF merge in Python
hybrid_result=$(MNEMO_Q="$query" \
                MNEMO_LIMIT="$limit" \
                MNEMO_SID="$MNEMO_SPACE_ID" \
                MNEMO_DB="${MNEMO_DB_NAME:-mnemos}" \
                MNEMO_MODEL="$MNEMO_AUTO_EMBED_MODEL" \
                MNEMO_DB_HOST="$MNEMO_DB_HOST" \
                MNEMO_DB_USER="$MNEMO_DB_USER" \
                MNEMO_DB_PASS="$MNEMO_DB_PASS" \
                python3 << 'PYEOF'
import json, os, urllib.request, base64

db    = os.environ['MNEMO_DB']
sid   = os.environ['MNEMO_SID']
q     = os.environ['MNEMO_Q']
lim   = int(os.environ['MNEMO_LIMIT'])
fetch = lim * 3

def sql_escape(s):
    return s.replace("'", "''") if s else ''

eq = sql_escape(q)

vec_sql = f"""SELECT id, content, key_name, source, tags, version,
  updated_by, created_at, updated_at,
  VEC_EMBED_COSINE_DISTANCE(embedding, '{eq}') AS distance
FROM {db}.memories
WHERE space_id = '{sid}' AND embedding IS NOT NULL
ORDER BY VEC_EMBED_COSINE_DISTANCE(embedding, '{eq}')
LIMIT {fetch}"""

fts_sql = f"""SELECT id, content, key_name, source, tags, version,
  updated_by, created_at, updated_at,
  fts_match_word('{eq}', content) AS fts_score
FROM {db}.memories
WHERE space_id = '{sid}' AND fts_match_word('{eq}', content)
ORDER BY fts_match_word('{eq}', content) DESC
LIMIT {fetch}"""

host  = os.environ['MNEMO_DB_HOST']
user  = os.environ['MNEMO_DB_USER']
passw = os.environ['MNEMO_DB_PASS']
url   = f"https://http-{host}/v1beta/sql"
creds = base64.b64encode(f"{user}:{passw}".encode()).decode()
hdrs  = {"Authorization": f"Basic {creds}", "Content-Type": "application/json"}

def run_sql(sql):
    body = json.dumps({"database": db, "query": sql}).encode()
    req  = urllib.request.Request(url, data=body, headers=hdrs)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def parse_rows(data):
    cols = [c['name'] for c in data.get('types', data.get('columns', []))]
    rows = []
    for row in data.get('rows', []):
        m = dict(zip(cols, row))
        if m.get('tags') and isinstance(m['tags'], str):
            try: m['tags'] = json.loads(m['tags'])
            except: m['tags'] = []
        if m.get('key_name'):
            m['key'] = m.pop('key_name')
        else:
            m.pop('key_name', None)
        rows.append(m)
    return rows

try:    vec_rows = parse_rows(run_sql(vec_sql))
except: vec_rows = []
try:    fts_rows = parse_rows(run_sql(fts_sql))
except: fts_rows = []

K = 60.0
scores, mems = {}, {}
for rank, m in enumerate(fts_rows):
    mid = m['id']
    scores[mid] = scores.get(mid, 0.0) + 1.0 / (K + rank + 1)
    mems[mid] = m
for rank, m in enumerate(vec_rows):
    mid = m['id']
    scores[mid] = scores.get(mid, 0.0) + 1.0 / (K + rank + 1)
    if mid not in mems: mems[mid] = m

ranked = sorted(scores, key=lambda i: scores[i], reverse=True)
memories = [dict(**mems[mid], score=round(scores[mid], 6)) for mid in ranked[:lim]]
print(json.dumps({'memories': memories, 'total': len(scores)}))
PYEOF
) || hybrid_result='{"memories":[],"total":0}'
```

Key properties:
- **No embedding API call** — `VEC_EMBED_COSINE_DISTANCE` sends query text to
  TiDB; TiDB embeds it server-side
- **SQL built entirely in Python** — `sql_escape()` handles quotes/special chars,
  no bash string interpolation risk
- **Two HTTP calls inside Python** — avoids bash subshell complexity, single
  coherent heredoc following the `mnemo_post_memory()` pattern
- **RRF merge in Python** — clean, no shell arithmetic

When `MNEMO_AUTO_EMBED_MODEL` is not set, `mnemo_search()` uses keyword-only:
`FTS` when available, otherwise `LIKE`.

### opencode direct: auto-embed hybrid

The opencode `MnemoConfig` already carries `embedDims`. Add `autoEmbedModel`
as a new field read from `MNEMO_AUTO_EMBED_MODEL` env var. When set, the vector
leg uses `VEC_EMBED_COSINE_DISTANCE(embedding, ?)` — TiDB embeds server-side.

Search mode dispatch in `DirectBackend.search()`:

```
MNEMO_AUTO_EMBED_MODEL set  ->  hybridSearch()   (VEC_EMBED + keyword leg, RRF)
MNEMO_EMBED_API_KEY set     ->  keywordSearch()  + warn (client embed deferred)
neither                     ->  keywordSearch()
keywordSearch()             ->  FTSSearch when ftsAvailable, else LIKE fallback
```

`index.ts` startup log updated from "does not support hybrid search yet" to:
```
// MNEMO_AUTO_EMBED_MODEL set:
"[mnemo] Direct mode (auto-embed hybrid: <model>)"
// no vector leg:
"[mnemo] Direct mode (keyword search: FTS preferred, LIKE fallback)"
```

### Graceful degradation

Both vector and FTS are optional. Runtime dispatch follows this matrix:

| Vector enabled | FTS enabled | Behavior |
|---|---|---|
| No | No | `LIKE` only |
| Yes | No | Hybrid: `vector + LIKE` (RRF) |
| No | Yes | `FTS` only |
| Yes | Yes | Hybrid: `vector + FTS` (RRF) |

Where:
- **Vector enabled** means embedder/auto-embed path is available for that backend.
- **FTS enabled** means startup capability check passes (`ftsAvailable = true`).

Additional failure semantics:
- If the selected keyword leg (`FTS` or `LIKE`) errors for a request, use
  vector-only for that request and log `WARN`.
- If the selected vector leg errors for a request, use keyword-only and log `WARN`.
- If both selected legs fail for a request, return empty results + log error.

`KeywordSearch()` is retained as a compatibility fallback path. `FTSSearch()`
is the preferred keyword path when `ftsAvailable=true`.

### Transport compatibility

`FTS_MATCH_WORD()` and `VEC_EMBED_COSINE_DISTANCE()` are plain SQL. Both work
identically over TiDB HTTP Data API and TCP driver. No driver-level differences.

## Changes

### Server-side (upgrades all three agents in server mode)

Query contract: **server mode** (includes `tombstone = 0`).

| File | Change |
|---|---|
| `server/schema.sql` | Add FULLTEXT INDEX DDL comment block; add generated embedding column DDL (auto-embed mode) |
| `server/internal/repository/repository.go` | Add `FTSSearch` in the interface; keep `KeywordSearch` as fallback; availability flag stays internal to concrete impl |
| `server/internal/repository/tidb/memory.go` | Add `FTSSearch`; keep `KeywordSearch` fallback; startup capability check probe; new score scanner |
| `server/internal/service/memory.go` | Add mode-matrix dispatch (vector/FTS optional); RRF in both hybrid modes; partial-failure leg skipping |

### Direct-mode: openclaw

Query contract: **direct mode** (no `tombstone`).

| File | Change |
|---|---|
| `openclaw-plugin/schema.ts` | Add FULLTEXT INDEX to `initSchema()`; add generated embedding column DDL; startup capability check |
| `openclaw-plugin/direct-backend.ts` | Add FTS path (direct-mode SQL contract), keep LIKE fallback when FTS unavailable; upgrade merge to RRF; partial-failure leg skipping |

### Direct-mode: opencode

Query contract: **direct mode** (no `tombstone`).

| File | Change |
|---|---|
| `opencode-plugin/src/types.ts` | Add `autoEmbedModel?: string` to `MnemoConfig` |
| `opencode-plugin/src/direct-backend.ts` | Add `ensureSchema()` FTS index + generated embedding column; `ftsSearch()` (direct-mode SQL); keep LIKE fallback when FTS unavailable; `autoHybridSearch()`; capability check; partial-failure leg skipping |
| `opencode-plugin/src/index.ts` | Update log lines, remove "no hybrid" warning |

### Direct-mode: claude hooks

Query contract: **direct mode** (no `tombstone`).

| File | Change |
|---|---|
| `claude-plugin/hooks/common.sh` | Add FULLTEXT INDEX + generated embedding column to `mnemo_direct_init()`; startup capability check (probe query); upgrade `mnemo_search()` to mode-matrix dispatch: `vector+FTS`, `vector+LIKE`, `FTS-only`, or `LIKE-only`; partial-failure leg skipping via try/except in Python |

## Effort

### Server-side

| File | LoC |
|---|---|
| `server/schema.sql` | ~5 |
| `server/internal/repository/repository.go` | ~5 |
| `server/internal/repository/tidb/memory.go` | ~35 |
| `server/internal/service/memory.go` | ~25 |
| Capability check + partial-failure wiring | ~15 |
| **Subtotal** | **~85** |

### Direct-mode plugins

| File | LoC |
|---|---|
| `openclaw-plugin/schema.ts` | ~15 |
| `openclaw-plugin/direct-backend.ts` | ~45 |
| `opencode-plugin/src/types.ts` | ~5 |
| `opencode-plugin/src/direct-backend.ts` | ~70 |
| `opencode-plugin/src/index.ts` | ~5 |
| `claude-plugin/hooks/common.sh` | ~80 |
| **Subtotal** | **~220** |

### Schema transition + tests

| Task | LoC |
|---|---|
| Migration checklist doc (index verification, backward-compat gate) | ~20 |
| Test checklist implementation (see below) | ~60 |
| **Subtotal** | **~80** |

| | **Total** | **~385 LoC** |

Previous estimate of ~211 LoC excluded: capability checks, generated column
DDL + migration handling, per-backend partial-failure wiring, and test
scaffolding. The revised estimate reflects those additions.

## Future: MCP Plugin for Claude Code

Claude Code now supports plugins bundling MCP servers (`mcpServers` in
`plugin.json`). An MCP server can be a TypeScript/Node.js process registered
as a stdio or HTTP transport. This would allow the claude-plugin to register
real MCP tools (`memory_store`, `memory_search`) identical to the opencode
plugin, replacing the skills system.

The bash hybrid search above is the correct immediate path. An MCP plugin
rewrite is a separate, larger effort (~250 LoC) deferred to a future proposal.

## Test Checklist (per backend)

Each backend change must satisfy the following acceptance criteria before
merging. These are the minimum conformance checks — not an exhaustive test
plan.

### Server (Go)

- [ ] `FTS_MATCH_WORD` query includes `tombstone = 0` predicate
- [ ] `embedding IS NOT NULL` present in vector leg WHERE clause
- [ ] Capability probe runs at startup; failure logs WARN, does not crash
- [ ] Single-leg search (one leg errors) returns the other leg's results
- [ ] RRF scores are monotone: item in both legs scores higher than item in one
- [ ] Response `score` field is present and non-zero for matched results
- [ ] `KeywordSearch` / LIKE path retained only as fallback when `ftsAvailable=false`

### openclaw (TypeScript direct)

- [ ] FTS query uses direct-mode SQL (no `tombstone` column)
- [ ] Generated embedding column DDL executed during `initSchema()`
- [ ] `embedding IS NOT NULL` in vector leg
- [ ] Capability check stored; FTS leg skipped (not errored) when unavailable
- [ ] RRF merge produces correct rank ordering in unit test
- [ ] LIKE path is used only when FTS unavailable (per startup capability flag)

### opencode (TypeScript direct)

- [ ] FTS query uses direct-mode SQL (no `tombstone` column)
- [ ] `autoEmbedModel` config field read from env and passed to SQL
- [ ] Generated embedding column DDL in `ensureSchema()`
- [ ] `embedding IS NOT NULL` in vector leg
- [ ] Startup log shows correct mode: `auto-embed hybrid` or `keyword search (FTS preferred, LIKE fallback)`
- [ ] Mode matrix is respected: FTS unavailable → LIKE keyword path
- [ ] Partial failure: selected keyword leg error → vector-only result, no thrown exception

### claude hooks (bash/Python)

- [ ] FTS query uses direct-mode SQL (no `tombstone` column)
- [ ] Generated embedding column DDL in `mnemo_direct_init()`
- [ ] Capability probe in `mnemo_direct_init()`; result exported as env var
- [ ] `embedding IS NOT NULL` in vector leg SQL
- [ ] SQL built entirely in Python — no bash string interpolation of user input
- [ ] FTS leg `try/except` → empty list on error, not abort
- [ ] Mode matrix is respected: FTS unavailable → LIKE keyword path
- [ ] `|| true` pattern NOT used for capability-gating logic (only for DDL)

## Rollout Checklist

Minimum steps before deploying to any environment:

1. **Index verification**: After applying DDL, run `SHOW INDEX FROM memories`
   and confirm `idx_fts_content` appears with `Index_type = FULLTEXT`.
2. **Capability gate**: Start server/plugin, confirm startup log shows
   `FTS available` or explicit fallback mode (`FTS unavailable -> LIKE fallback`).
   Proceed only if the observed mode matches your target environment policy.
3. **Backward-compat gate**: Confirm existing memories (inserted before FTS
   index) are searchable via FTS. Run a probe search for a known keyword
   and verify non-empty results.
4. **Embedding column gate (direct mode auto-embed)**: After `ALTER TABLE`,
   confirm `SELECT COUNT(*) FROM memories WHERE embedding IS NULL` returns 0.
5. **Rollback**: FTS index can be dropped (`DROP INDEX idx_fts_content ON
   memories`) without data loss; search falls back to `LIKE` keyword mode per
   the dispatch matrix.

## Out of Scope

- Removing `LIKE` fallback entirely
- Client-side embedder for opencode or claude-plugin direct mode (deferred)
- MCP plugin for claude code (deferred — see Future section above)
- Automated migration tooling (e.g. a migration CLI) — manual checklist above is sufficient for direct-mode personal scale
- Partial `ALTER TABLE` recovery (if generated column DDL fails mid-table, operator remediates manually)

## Open Questions

Resolved before implementation starts:

1. ~~**Non-generated column conflict**~~: **Resolved** — detect via
   `INFORMATION_SCHEMA.COLUMNS.EXTRA` before running DDL. If a plain
   non-generated column is found, hard-disable the vector leg and log an
   explicit migration command (`DROP COLUMN embedding` + restart). No silent
   no-op, no `MODIFY COLUMN`. See "Embedding Materialization" section above.

2. ~~**FTS region availability**~~: **Resolved** — operator ensures TiDB Cloud
   Serverless cluster is created in a region that supports FTS. Probe-only is
   sufficient; no TiDB Cloud API pre-check needed.

3. ~~**`ALTER TABLE` blocking on large tables**~~: **Resolved** — TiDB Serverless
   handles `ADD COLUMN ... STORED` on tables with >10k rows without issue. The
   synchronous rewrite is acceptable for direct-mode personal scale.

4. ~~**Capability check scope**~~: **Resolved** — The probe query (`fts_match_word('probe', content)
   LIMIT 0`) can distinguish two states: (a) function unknown → `FTS_UNSUPPORTED`,
   (b) function known but columnar replica not ready → `FTS_PROVISIONING`
   (classified by SQLSTATE/error code where available, with message text
   `columnar`/`TiFlash` as fallback). The `FTS_PROVISIONING` state is handled
   with retry/backoff (up to 5 attempts, ~2 min) before falling back to
   `FTS_UNSUPPORTED`. This is specified in the "Index creation failure policy"
   section above.
