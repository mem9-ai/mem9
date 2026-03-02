#!/usr/bin/env python3
"""
Concurrent edit test with a real-document-like memory.

Phase A: Create a section-doc memory with 10 sections (proposal-like content).
Phase B: Both agents read, make disjoint edits concurrently.
         Agent A: revises odd sections (1,3,5,7,9).
         Agent B: revises even sections (2,4,6,8,10).
Phase C: Verify server merges both agents' edits atomically.
Phase D: Both agents read back — must see all edits.
"""

import json, uuid, urllib.request, urllib.error, sys, copy, time

BASE     = "http://127.0.0.1:18081"
USER_TOKEN = "REDACTED_TOKEN"
AGENT_A  = "agent-a"
AGENT_B  = "agent-b"
DOC_KEY  = f"real-doc-test-{int(time.time())}"

PASS = 0; FAIL = 0
def p(label): global PASS; PASS += 1; print(f"  PASS  {label}")
def f(label): global FAIL; FAIL += 1; print(f"  FAIL  {label}")

def provision(workspace_key, agent_id):
    url = BASE + "/api/spaces/provision"
    body = json.dumps({"workspace_key": workspace_key, "agent_id": agent_id}).encode()
    headers = {"Authorization": f"Bearer {USER_TOKEN}", "Content-Type": "application/json"}
    r = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(r) as resp:
        data = json.loads(resp.read())
    token = data.get("space_token")
    if not token:
        print(f"FATAL: provision failed for {agent_id}: {data}")
        sys.exit(1)
    return token

def req(method, path, token, agent, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Mnemo-Agent-Id": agent,
    }
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else {}, dict(resp.headers)
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else {}, dict(e.headers)

def get_doc(token, agent, doc_id):
    s, m, _ = req("GET", f"/api/memories/{doc_id}", token, agent)
    return m if s == 200 else None

def render_index(sections):
    lines = []
    for name in sorted(sections.keys()):
        s = sections[name]
        first = s["body"].split("\n")[0]
        lines.append(f"[{name}] {s['title']} | {first}")
    return "\n".join(lines)

print("=" * 68)
print("  Concurrent Edit — real document (user/space model)")
print("=" * 68)

WS_KEY = f"e2e-realdoc-{int(time.time())}"
print("\nProvisioning agents...")
TOKEN_A = provision(WS_KEY, AGENT_A)
TOKEN_B = provision(WS_KEY, AGENT_B)
print(f"  Agent A token: {TOKEN_A[:20]}...")
print(f"  Agent B token: {TOKEN_B[:20]}...")

print("\n[PHASE A] Create section-doc memory")

sections_v1 = {
    "section-01": {
        "title": "1. Background",
        "body": (
            "The current claw-memory plugin connects directly to TiDB Serverless.\n"
            "This works for a single agent, but has two fundamental problems:\n"
            "1. No conflict resolution — multiple agents writing the same memory key\n"
            "   concurrently will silently overwrite each other.\n"
            "2. Tight coupling — every OpenClaw instance needs TiDB credentials,\n"
            "   and CRDT logic would need to be duplicated across all plugin instances.\n"
            "This proposal introduces a memory API server as the authoritative layer\n"
            "for all memory operations, with CRDT-based conflict resolution built in."
        ),
        "last_author": "agent-a",
    },
    "section-02": {
        "title": "2. Architecture",
        "body": (
            "Key principle: CRDT logic lives exclusively in the server. Plugins are thin HTTP clients.\n"
            "Stack: OpenClaw Instances (Agent A/B/C with plugins)\n"
            "  → HTTP/gRPC\n"
            "  → claw-memory Server (CRDT merge, auth, vector search, bootstrap injection)\n"
            "  → TiDB Serverless (memories table, auto embedding, vector index)"
        ),
        "last_author": "agent-a",
    },
    "section-03": {
        "title": "3. CRDT Selection",
        "body": (
            "Selected: LWW-Register (Last-Write-Wins) with Vector Clocks\n"
            "Why LWW-Register: Memory content is a single value (text), not a set or counter.\n"
            "Why Vector Clocks (not Lamport timestamps): Vector clocks distinguish between\n"
            "  'A happened before B' vs 'A and B are concurrent'.\n"
            "Why not OT or Automerge: OT is designed for collaborative text editing —\n"
            "  overkill for memory key/value pairs.\n"
            "Vector Clock Merge Rules:\n"
            "  merged[k] = max(Ci[k] ?? 0, Ce[k] ?? 0)\n"
            "  Ci > Ce iff ∀k: Ci[k] >= Ce[k] AND ∃k: Ci[k] > Ce[k]\n"
            "Deletion: Tombstone (not hard delete)."
        ),
        "last_author": "agent-a",
    },
    "section-04": {
        "title": "4. What the Plugin Does",
        "body": (
            "The OpenClaw plugin becomes a thin HTTP client:\n"
            "- Maintain a local agent_id (stable per OpenClaw instance)\n"
            "- Maintain a local vector clock (persisted to disk, updated on every write)\n"
            "- Call the memory API for all read/write/search operations\n"
            "- Inject memories into agent bootstrap via agent:bootstrap hook\n"
            "- No TiDB credentials needed — only API endpoint + auth token"
        ),
        "last_author": "agent-a",
    },
    "section-05": {
        "title": "5. What the Server Does",
        "body": (
            "- Authenticate requests (validate space_token or API key)\n"
            "- Execute CRDT merge on every write\n"
            "- Proxy vector search to TiDB\n"
            "- Serve bootstrap memories for session initialization\n"
            "- (Future) Push change notifications via WebSocket\n"
            "Stack: Go, stateless, horizontally scalable"
        ),
        "last_author": "agent-a",
    },
    "section-06": {
        "title": "6. Database Schema",
        "body": (
            "New columns added to memories table:\n"
            "  vector_clock  JSON NOT NULL DEFAULT '{}'\n"
            "  origin_agent  VARCHAR(64)\n"
            "  tombstone     BOOLEAN NOT NULL DEFAULT FALSE\n"
            "  last_write_id VARCHAR(36)\n"
            "  last_write_snapshot JSON\n"
            "  last_write_status   INT\n"
            "  INDEX idx_tombstone (space_token, tombstone)"
        ),
        "last_author": "agent-a",
    },
    "section-07": {
        "title": "7. API Design",
        "body": (
            "Base URL: https://memory.your-domain.com/v1\n"
            "Auth: Authorization: Bearer <token>\n"
            "Endpoints:\n"
            "  POST   /v1/memories           — Write/upsert with CRDT merge\n"
            "  GET    /v1/memories/search    — Hybrid vector + keyword search\n"
            "  GET    /v1/memories/bootstrap — Session bootstrap injection\n"
            "  GET    /v1/memories/:id       — Get by ID\n"
            "  GET    /v1/memories           — List (auto-filters tombstone=FALSE)\n"
            "  DELETE /v1/memories/:id       — Logical delete (tombstone=TRUE)"
        ),
        "last_author": "agent-a",
    },
    "section-08": {
        "title": "8. Phased Implementation",
        "body": (
            "Phase 1: API Server (no CRDT yet)\n"
            "  HTTP server wrapping TiDB queries, plugin switches from direct DB to HTTP client\n"
            "Phase 2: CRDT\n"
            "  Add 3 columns, implement vector clock merge in server,\n"
            "  plugin maintains local clock\n"
            "Phase 3: Bootstrap Injection\n"
            "  agent:bootstrap hook, /v1/memories/bootstrap endpoint\n"
            "Phase 4: Deprecate File Memory\n"
            "  Migrate MEMORY.md and memory/*.md to TiDB"
        ),
        "last_author": "agent-a",
    },
    "section-09": {
        "title": "9. Plugin Interface",
        "body": (
            "Tools registered (unchanged names, internals switch from direct DB to HTTP):\n"
            "  memory_store, memory_search, memory_get, memory_update, memory_delete\n"
            "Hooks:\n"
            "  agent:bootstrap      — inject TiDB memories into system prompt at session start\n"
            "  before_compaction    — flush memories to TiDB before compaction\n"
            "  before_prompt_build  — inject relevant memories into system prompt per turn"
        ),
        "last_author": "agent-a",
    },
    "section-10": {
        "title": "10. Open Questions",
        "body": (
            "1. Auth model — per-user token? per-space token? OAuth?\n"
            "2. Bootstrap selection strategy — recency only, or semantic relevance?\n"
            "3. Clock storage — persist to disk (survive restarts) or re-derive from DB?\n"
            "4. Server hosting — same EC2 as OpenClaw, or separate service?\n"
            "5. Conflict notification — should losing agents be notified when their\n"
            "   write was discarded?"
        ),
        "last_author": "agent-a",
    },
}

index_v1 = render_index(sections_v1)
meta_v1  = {"sections": sections_v1, "schema": "section-doc-v1"}

cur_clock = {AGENT_A: 1}

s, m, hdrs = req("POST", "/api/memories", TOKEN_A, AGENT_A, {
    "content":  index_v1,
    "key":      DOC_KEY,
    "metadata": meta_v1,
    "clock":    cur_clock,
    "write_id": str(uuid.uuid4()),
})
dominated = hdrs.get("X-Mnemo-Dominated","").lower() == "true"
if s == 201 and not dominated:
    DOC_ID = m["id"]
    p(f"Created section-doc: 10 sections, clock={m.get('clock')}, version={m.get('version')}, id={DOC_ID}")
else:
    f(f"Conversion failed: status={s}, dominated={dominated}, err={m.get('error','')}")
    sys.exit(1)

print("\n[PHASE B] Both agents read current snapshot")
snap_a = get_doc(TOKEN_A, AGENT_A, DOC_ID)
snap_b = get_doc(TOKEN_B, AGENT_B, DOC_ID)
if not snap_a or not snap_b:
    f("Read failed"); sys.exit(1)

base_sections = snap_a["metadata"]["sections"]
clock_at_read = snap_a.get("clock", {})
p(f"Both agents read version={snap_a['version']}, clock={clock_at_read}")

print("\n[PHASE C] Concurrent edits — Agent A: odd sections, Agent B: even sections")

secs_a = copy.deepcopy(base_sections)
secs_b = copy.deepcopy(base_sections)

for name in ["section-01","section-03","section-05","section-07","section-09"]:
    secs_a[name]["body"] += (
        f"\n\n[AGENT-A REVISION] Updated by agent-a: clarified scope, "
        f"added implementation notes, cross-referenced with current server code in "
        f"server/internal/service/ and server/internal/repository/."
    )
    secs_a[name]["last_author"] = AGENT_A

for name in ["section-02","section-04","section-06","section-08","section-10"]:
    secs_b[name]["body"] += (
        f"\n\n[AGENT-B REVISION] Updated by agent-b: added operational details, "
        f"deployment considerations, and lessons learned from the CRDT E2E test run."
    )
    secs_b[name]["last_author"] = AGENT_B

clock_a = dict(clock_at_read); clock_a[AGENT_A] = clock_a.get(AGENT_A, 0) + 1
clock_b = dict(clock_at_read); clock_b[AGENT_B] = clock_b.get(AGENT_B, 0) + 1

print(f"  Agent A clock: {clock_a}")
print(f"  Agent B clock: {clock_b}")
print(f"  Both clocks are concurrent — server should merge, not dominate")

s_a, m_a, hdrs_a = req("POST", "/api/memories", TOKEN_A, AGENT_A, {
    "content":  render_index(secs_a),
    "key":      DOC_KEY,
    "metadata": {"sections": secs_a, "schema": "section-doc-v1"},
    "clock":    clock_a,
    "write_id": str(uuid.uuid4()),
})
s_b, m_b, hdrs_b = req("POST", "/api/memories", TOKEN_B, AGENT_B, {
    "content":  render_index(secs_b),
    "key":      DOC_KEY,
    "metadata": {"sections": secs_b, "schema": "section-doc-v1"},
    "clock":    clock_b,
    "write_id": str(uuid.uuid4()),
})

dom_a    = hdrs_a.get("X-Mnemo-Dominated","").lower() == "true"
dom_b    = hdrs_b.get("X-Mnemo-Dominated","").lower() == "true"
merged_a = hdrs_a.get("X-Mnemo-Merged","").lower() == "true"
merged_b = hdrs_b.get("X-Mnemo-Merged","").lower() == "true"

print(f"\n  Agent A: HTTP {s_a}, dominated={dom_a}, merged={merged_a}")
print(f"  Agent B: HTTP {s_b}, dominated={dom_b}, merged={merged_b}")

if s_a == 201 and not dom_a and s_b == 201 and not dom_b and merged_b:
    p("Server merged both writes — HTTP 201 for both, X-Mnemo-Merged on B's write")
elif dom_b:
    f(f"Agent B was dominated — section merge did not fire (check metadata.sections parsing)")
    sys.exit(1)
else:
    f(f"Unexpected result: s_a={s_a} dom_a={dom_a} s_b={s_b} dom_b={dom_b}")
    sys.exit(1)

# ── Phase D: both agents read final state ────────────────────────────────────
print("\n[PHASE D] Both agents read final document")
final_a = get_doc(TOKEN_A, AGENT_A, DOC_ID)
final_b = get_doc(TOKEN_B, AGENT_B, DOC_ID)
if not final_a or not final_b:
    f("Read failed"); sys.exit(1)

if final_a["content"] == final_b["content"]:
    p("Agent A and Agent B read identical content")
else:
    f("Content differs between agents")

fs      = final_a["metadata"]["sections"]
fa      = sorted([k for k,v in fs.items() if v["last_author"] == "agent-a"])
fb      = sorted([k for k,v in fs.items() if v["last_author"] == "agent-b"])
fc      = final_a.get("clock", {})
version = final_a.get("version")

print(f"\n  version      : {version}")
print(f"  clock        : {fc}")
print(f"  merged_by    : {final_a['metadata'].get('merged_by','(not set)')}")
print(f"  agent-a owns : {fa}")
print(f"  agent-b owns : {fb}")

if len(fa) == 5: p(f"Agent A's revisions in final doc: {fa}")
else: f(f"Agent A revisions: expected 5, got {len(fa)}")

if len(fb) == 5: p(f"Agent B's revisions in final doc: {fb}")
else: f(f"Agent B revisions: expected 5, got {len(fb)}")

odd  = ["section-01","section-03","section-05","section-07","section-09"]
even = ["section-02","section-04","section-06","section-08","section-10"]
if all(fs[s]["last_author"] == "agent-a" for s in odd):
    p("Odd  sections (1,3,5,7,9)  → agent-a")
else:
    f(f"Wrong: {[(s,fs[s]['last_author']) for s in odd if fs[s]['last_author']!='agent-a']}")
if all(fs[s]["last_author"] == "agent-b" for s in even):
    p("Even sections (2,4,6,8,10) → agent-b")
else:
    f(f"Wrong: {[(s,fs[s]['last_author']) for s in even if fs[s]['last_author']!='agent-b']}")

if "[AGENT-A REVISION]" in fs["section-01"]["body"]:
    p("section-01 body contains agent-a revision text")
else:
    f("section-01 missing agent-a revision")
if "[AGENT-B REVISION]" in fs["section-02"]["body"]:
    p("section-02 body contains agent-b revision text")
else:
    f("section-02 missing agent-b revision")
if "[AGENT-A REVISION]" not in fs["section-02"]["body"]:
    p("section-02 body has no agent-a contamination")
else:
    f("section-02 body was overwritten by agent-a")
if "[AGENT-B REVISION]" not in fs["section-01"]["body"]:
    p("section-01 body has no agent-b contamination")
else:
    f("section-01 body was overwritten by agent-b")

if "agent-a" in fc and "agent-b" in fc:
    p(f"Clock tracks both agents: {fc}")
else:
    f(f"Clock incomplete: {fc}")

print()
print("=" * 68)
print(f"  Results: {PASS} passed, {FAIL} failed")
print("=" * 68)
if FAIL == 0:
    print(f"""
Real-document concurrent edit verified:

  Document : {DOC_KEY} (ID: {DOC_ID})
  Sections : 10 (created as section-doc in Phase A)
  Edit     : Agent A revised sections 1,3,5,7,9 simultaneously with
             Agent B revising sections 2,4,6,8,10
  Merge    : Server merged atomically — no domination, no client re-write
  Final    : Both agents read identical content with all 10 edits
  Clock    : {fc}
""")
else:
    sys.exit(1)
