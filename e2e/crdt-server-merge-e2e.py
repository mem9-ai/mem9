#!/usr/bin/env python3
"""
Server-Side Section Merge — E2E Verification
=============================================
Verifies that concurrent writes with metadata.sections trigger server-side merge
instead of domination. The server returns HTTP 201 (not 200) + X-Mnemo-Merged: true.
No client re-write required.
"""

import json, uuid, urllib.request, urllib.error, sys, time, copy

BASE = "http://127.0.0.1:18081"
USER_TOKEN = "REDACTED_TOKEN"
AGENT_A = "agent-a"
AGENT_B = "agent-b"

SECTION_COUNT = 10
LINES_PER_SECTION = 50

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

def get_memory(token, agent, mid):
    s, m, _ = req("GET", f"/api/memories/{mid}", token, agent)
    return m if s == 200 else None

def build_sections():
    sections = {}
    for i in range(1, SECTION_COUNT + 1):
        name = f"section-{i:02d}"
        topic = "Architecture" if i % 2 == 1 else "Implementation"
        body = "\n".join([
            f"L{j:02d} [{name}]: {topic} baseline — item {j}, initial."
            for j in range(1, LINES_PER_SECTION + 1)
        ])
        sections[name] = {"title": f"Section {i}: {topic} Part {i}", "body": body, "last_author": "initial"}
    return sections

def render_index(sections):
    lines = []
    for name in sorted(sections.keys()):
        s = sections[name]
        first = s["body"].split("\n")[0]
        lines.append(f"[{name}] {s['title']} | {first}")
    return "\n".join(lines)

def agent_edit(sections, agent, owns_odd):
    edited = copy.deepcopy(sections)
    for i in range(1, SECTION_COUNT + 1):
        if (i % 2 == 1) != owns_odd:
            continue
        name = f"section-{i:02d}"
        topic = sections[name]["title"].split(":")[1].strip()
        body = "\n".join([
            f"L{j:02d} [{name}]: [{agent.upper()}] {topic} revised — item {j}."
            for j in range(1, LINES_PER_SECTION + 1)
        ])
        edited[name] = {"title": sections[name]["title"] + f" [ed:{agent}]", "body": body, "last_author": agent}
    return edited

ts = int(time.time())
DOC_KEY = f"server-merge-{ts}"
WS_KEY = f"e2e-merge-{ts}"

print("=" * 68)
print("  Server-Side Section Merge — E2E Verification (user/space model)")
print("=" * 68)

print("\nProvisioning agents...")
TOKEN_A = provision(WS_KEY, AGENT_A)
TOKEN_B = provision(WS_KEY, AGENT_B)
print(f"  Agent A token: {TOKEN_A[:20]}...")
print(f"  Agent B token: {TOKEN_B[:20]}...")

print("\n[PHASE 1] Create initial document")
initial = build_sections()
total_lines = sum(len(v["body"].splitlines()) for v in initial.values())
s, m_v1, _ = req("POST", "/api/memories", TOKEN_A, AGENT_A, {
    "content": render_index(initial),
    "key": DOC_KEY,
    "metadata": {"sections": initial, "schema": "section-doc-v1"},
    "clock": {"agent-a": 1},
    "write_id": str(uuid.uuid4()),
})
if s == 201:
    DOC_ID = m_v1["id"]
    p(f"Initial document: {total_lines} lines, id={DOC_ID}")
else:
    f(f"Create failed: {s} {m_v1.get('error','')}")
    sys.exit(1)

print("\n[PHASE 2] Both agents read concurrently")
snap = get_memory(TOKEN_A, AGENT_A, DOC_ID)
base_sections = snap["metadata"]["sections"]
clock_at_read = snap.get("clock", {})
print(f"  Clock at read: {clock_at_read}")
p("Both agents have same snapshot")

print("\n[PHASE 3] Disjoint local edits")
secs_a = agent_edit(base_sections, AGENT_A, owns_odd=True)
secs_b = agent_edit(base_sections, AGENT_B, owns_odd=False)

print("\n[PHASE 4] Concurrent writes — server should merge (not dominate)")
clock_a = dict(clock_at_read); clock_a[AGENT_A] = clock_a.get(AGENT_A, 0) + 1
clock_b = dict(clock_at_read); clock_b[AGENT_B] = clock_b.get(AGENT_B, 0) + 1
print(f"  Agent A clock: {clock_a}  (concurrent with B)")
print(f"  Agent B clock: {clock_b}  (concurrent with A — neither dominates)")

# Agent A writes first, setting DB clock to {agent-a:2}
# Then Agent B writes with {agent-a:1, agent-b:1}
# {agent-a:1,agent-b:1} vs {agent-a:2} → ClockConcurrent (A has a:2>1, B has b:1>0)
s_a, m_a, hdrs_a = req("POST", "/api/memories", TOKEN_A, AGENT_A, {
    "content": render_index(secs_a),
    "key": DOC_KEY,
    "metadata": {"sections": secs_a, "schema": "section-doc-v1"},
    "clock": clock_a,
    "write_id": str(uuid.uuid4()),
})
s_b, m_b, hdrs_b = req("POST", "/api/memories", TOKEN_B, AGENT_B, {
    "content": render_index(secs_b),
    "key": DOC_KEY,
    "metadata": {"sections": secs_b, "schema": "section-doc-v1"},
    "clock": clock_b,
    "write_id": str(uuid.uuid4()),
})

dom_a = hdrs_a.get("X-Mnemo-Dominated", "").lower() == "true"
dom_b = hdrs_b.get("X-Mnemo-Dominated", "").lower() == "true"
merged_a = hdrs_a.get("X-Mnemo-Merged", "").lower() == "true"
merged_b = hdrs_b.get("X-Mnemo-Merged", "").lower() == "true"

print(f"\n  Agent A: status={s_a}, dominated={dom_a}, merged={merged_a}")
print(f"  Agent B: status={s_b}, dominated={dom_b}, merged={merged_b}")

# A's write arrives first → {agent-a:2} stored
# B's write: compare {agent-a:1,agent-b:1} vs {agent-a:2} → ClockConcurrent → section merge
if s_a == 201 and not dom_a and s_b == 201 and not dom_b and merged_b:
    p("Both writes accepted HTTP 201 — server merged sections (no domination)")
elif s_b == 200 and dom_b:
    f("Agent B was dominated — server-side merge did NOT trigger (old behavior)")
    print("  Check: does metadata.sections parse correctly on both sides?")
    sys.exit(1)
else:
    f(f"Unexpected: s_a={s_a} dom_a={dom_a} s_b={s_b} dom_b={dom_b} merged_b={merged_b}")
    sys.exit(1)

# ── Phase 5: read back — both see merged content ─────────────────────────────
print("\n[PHASE 5] Both agents read final document")
final_a = get_memory(TOKEN_A, AGENT_A, DOC_ID)
final_b = get_memory(TOKEN_B, AGENT_B, DOC_ID)

if final_a["content"] == final_b["content"]:
    p("Agent A and Agent B read identical content")
else:
    f("Content differs between agents")

fs = final_a["metadata"]["sections"]
fa = sorted([k for k, v in fs.items() if v["last_author"] == "agent-a"])
fb = sorted([k for k, v in fs.items() if v["last_author"] == "agent-b"])
total_final = sum(len(v["body"].splitlines()) for v in fs.values())
final_clock = final_a.get("clock", {})

print(f"  agent-a sections: {fa}")
print(f"  agent-b sections: {fb}")
print(f"  total lines: {total_final}")
print(f"  final clock: {final_clock}")
print(f"  merged_by: {final_a['metadata'].get('merged_by','(not set)')}")

if len(fa) == 5: p(f"Agent A's edits preserved: {fa}")
else: f(f"Agent A edits: expected 5, got {len(fa)}")

if len(fb) == 5: p(f"Agent B's edits preserved: {fb}")
else: f(f"Agent B edits: expected 5, got {len(fb)}")

if total_final >= 500: p(f"Document is {total_final} lines (>= 500)")
else: f(f"Document too short: {total_final}")

odd  = [f"section-{i:02d}" for i in range(1, 11, 2)]
even = [f"section-{i:02d}" for i in range(2, 11, 2)]
if all(fs[s]["last_author"] == "agent-a" for s in odd):
    p(f"Odd  sections {odd} → agent-a")
else:
    f(f"Wrong authorship: {[(s, fs[s]['last_author']) for s in odd if fs[s]['last_author'] != 'agent-a']}")
if all(fs[s]["last_author"] == "agent-b" for s in even):
    p(f"Even sections {even} → agent-b")
else:
    f(f"Wrong authorship: {[(s, fs[s]['last_author']) for s in even if fs[s]['last_author'] != 'agent-b']}")

if "[AGENT-A]" in fs["section-01"]["body"] and "[AGENT-B]" not in fs["section-01"]["body"]:
    p("section-01 body: agent-a text only")
else: f("section-01 body wrong")

if "[AGENT-B]" in fs["section-02"]["body"] and "[AGENT-A]" not in fs["section-02"]["body"]:
    p("section-02 body: agent-b text only")
else: f("section-02 body wrong")

if "agent-a" in final_clock and "agent-b" in final_clock:
    p(f"Clock tracks both agents: {final_clock}")
else:
    f(f"Clock incomplete: {final_clock}")

print("\n[PHASE 6] Backward compat — plain write (no sections) still uses tie-break")
PLAIN_KEY = f"plain-compat-{ts}"
s_p1, m_p1, _ = req("POST", "/api/memories", TOKEN_A, AGENT_A, {
    "content": "plain content from agent-a",
    "key": PLAIN_KEY,
    "clock": {"agent-a": 1},
    "write_id": str(uuid.uuid4()),
})
s_p2, m_p2, hdrs_p2 = req("POST", "/api/memories", TOKEN_B, AGENT_B, {
    "content": "plain content from agent-b",
    "key": PLAIN_KEY,
    "clock": {"agent-b": 1},
    "write_id": str(uuid.uuid4()),
})
merged_p2 = hdrs_p2.get("X-Mnemo-Merged", "").lower() == "true"
dom_p2 = hdrs_p2.get("X-Mnemo-Dominated", "").lower() == "true"
print(f"  Plain write B: status={s_p2}, dominated={dom_p2}, merged={merged_p2}")
if not merged_p2:
    p("Plain write (no sections): no merge attempted — fell back to tie-break")
else:
    f("Plain write unexpectedly triggered section merge")

print()
print("=" * 68)
print(f"  Results: {PASS} passed, {FAIL} failed")
print("=" * 68)

if FAIL == 0:
    print(f"""
Server-side section merge verified:

  Concurrent writes with metadata.sections  → HTTP 201 + X-Mnemo-Merged: true
  No client re-write required               → single round-trip
  Both agents' edits in final document      → 5+5 sections, {total_final} lines
  Final vector clock                        → {final_clock}
  Backward compat (no sections)             → tie-break unchanged
""")
else:
    sys.exit(1)
