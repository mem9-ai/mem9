#!/usr/bin/env python3
"""MR-NIAH batch runner.

Design goal:
- For each generated session transcript in output/sessions/<sessionId>.jsonl:
  1) Copy transcript into the target OpenClaw profile's sessions dir.
  2) Register the sessionId into that profile's sessions.json store with a unique key
     (so the store can be searched by sessionId).
  3) Run `openclaw agent --local --session-id <sessionId> --message <question> --json`.
  4) Save raw stdout/stderr + extracted prediction.

Why registration is needed:
- OpenClaw's session store (sessions.json) is keyed by sessionKey (usually derived from --to).
- If we don't use --to, we must add store entries ourselves so resolveSessionKeyForRequest()
  can find a key by sessionId.

Usage:
  cd benchmark/MR-NIAH
  python3 run_batch.py --profile mrniah_local --agent main --local --limit 30

Outputs:
- results/predictions.jsonl
- results/raw/<id>-<sessionId>.stdout.json
- results/raw/<id>-<sessionId>.stderr.txt
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "output"
INDEX = OUTPUT / "index.jsonl"
SESS_OUT = OUTPUT / "sessions"
RESULTS = HERE / "results"
RAW = RESULTS / "raw"


def now_ms() -> int:
    return int(time.time() * 1000)


def iso_to_epoch_ms(ts: str) -> Optional[int]:
    if not isinstance(ts, str):
        return None
    normalized = ts.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        dt = _dt.datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return int(dt.timestamp() * 1000)


def transcript_updated_at_ms(session_file: Path) -> Optional[int]:
    last_ts: Optional[str] = None
    try:
        with session_file.open("r", encoding="utf-8") as fh:
            for line in fh:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    obj = json.loads(stripped)
                except json.JSONDecodeError:
                    continue
                ts = obj.get("timestamp")
                if isinstance(ts, str):
                    last_ts = ts
    except FileNotFoundError:
        return None

    if last_ts is None:
        return None

    return iso_to_epoch_ms(last_ts)


def maybe_add_agent_arg(cmd: List[str], agent: str) -> None:
    if agent and agent != "main":
        cmd.extend(["--agent", agent])


def load_index(path: Path) -> List[Dict[str, Any]]:
    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    return [json.loads(ln) for ln in lines]


def read_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def safe_extract_text(payload_obj: Any) -> str:
    """Extract assistant text from OpenClaw CLI --json output.

    Expected shapes we've seen:
    - embedded (--local): {payloads:[{text:...}], meta:{...}}
    - gateway: {runId, status, result:{payloads:[{text:...}]}}

    If payloads empty, return "".
    """

    def flatten(v: Any) -> Optional[str]:
        if isinstance(v, str):
            return v
        if isinstance(v, dict):
            for k in ("text", "content", "value", "output"):
                if k in v:
                    out = flatten(v[k])
                    if out:
                        return out
            return None
        if isinstance(v, list):
            parts = [flatten(x) for x in v]
            parts = [p for p in parts if p]
            if parts:
                return "\n".join(parts)
        return None

    if isinstance(payload_obj, dict):
        # embedded style
        if isinstance(payload_obj.get("payloads"), list) and payload_obj["payloads"]:
            texts = []
            for p in payload_obj["payloads"]:
                if isinstance(p, dict):
                    t = flatten(p.get("text"))
                    if t:
                        texts.append(t)
            if texts:
                return "\n".join(texts).strip()

        # gateway style
        result = payload_obj.get("result")
        if isinstance(result, dict):
            payloads = result.get("payloads")
            if isinstance(payloads, list) and payloads:
                texts = []
                for p in payloads:
                    if isinstance(p, dict):
                        t = flatten(p.get("text"))
                        if t:
                            texts.append(t)
                if texts:
                    return "\n".join(texts).strip()

    return ""


ANSI_RE = re.compile(r"\x1B\[[0-9;]*[A-Za-z]")
JSON_DECODER = json.JSONDecoder()


def strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", text)


def parse_json_stdout(stdout: str) -> Optional[Any]:
    if not stdout:
        return None

    cleaned = strip_ansi(stdout).strip()
    if not cleaned:
        return None

    def try_decode(text: str) -> Optional[Any]:
        if not text:
            return None
        try:
            obj, _ = JSON_DECODER.raw_decode(text)
            return obj
        except json.JSONDecodeError:
            return None

    obj = try_decode(cleaned)
    if obj is not None:
        return obj

    brace_idx = cleaned.find("{")
    # NOTE: bracket_idx is only searched when no '{' exists anywhere in the
    # output, so array-shaped JSON responses are never tried if any '{' is
    # present.  This works for current OpenClaw output shapes but may need a
    # fix if array-only responses become possible.
    bracket_idx = cleaned.find("[") if brace_idx == -1 else -1

    start = -1
    if brace_idx != -1:
        start = brace_idx
    elif bracket_idx != -1:
        start = bracket_idx

    if start == -1:
        return None

    snippet = cleaned[start:].lstrip()
    return try_decode(snippet)


@dataclass
class StorePaths:
    profile: str
    agent: str
    profile_dir: Path
    sessions_dir: Path
    store_path: Path


def resolve_store_paths(profile: str, agent: str) -> StorePaths:
    profile_dir = Path.home() / f".openclaw-{profile}"
    sessions_dir = profile_dir / "agents" / agent / "sessions"
    store_path = sessions_dir / "sessions.json"
    return StorePaths(
        profile=profile,
        agent=agent,
        profile_dir=profile_dir,
        sessions_dir=sessions_dir,
        store_path=store_path,
    )


def ensure_store_initialized(paths: StorePaths, local: bool) -> None:
    """Ensure the profile dir & sessions store exist.

    We initialize by running a single embedded turn; this creates sessions.json.
    """

    paths.sessions_dir.mkdir(parents=True, exist_ok=True)
    if paths.store_path.exists():
        return

    cmd = [
        "openclaw",
        "--profile",
        paths.profile,
        "agent",
    ]
    maybe_add_agent_arg(cmd, paths.agent)
    cmd.extend(
        [
            "--session-id",
            "bootstrap",
            "--message",
            "bootstrap",
            "--json",
        ]
    )
    if local:
        cmd.append("--local")

    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def load_store(paths: StorePaths) -> Dict[str, Any]:
    if not paths.store_path.exists():
        return {}
    return read_json(paths.store_path)


def pick_template_entry(store: Dict[str, Any]) -> Dict[str, Any]:
    """Pick an existing entry to clone optional fields from."""
    # Prefer agent:main:main if present
    for k in ("agent:main:main",):
        v = store.get(k)
        if isinstance(v, dict):
            return v
    # else first dict entry
    for v in store.values():
        if isinstance(v, dict):
            return v
    return {}


def register_session(
    *,
    paths: StorePaths,
    store: Dict[str, Any],
    session_id: str,
    session_file: Path,
    template: Dict[str, Any],
    key: str,
) -> None:
    entry: Dict[str, Any] = {}

    # Keep only safe/likely fields. We keep skillsSnapshot if present to avoid churn.
    for field in (
        "skillsSnapshot",
        "compactionCount",
        "thinkingLevel",
        "verboseLevel",
        "systemSent",
        "abortedLastRun",
        "chatType",
        "deliveryContext",
        "lastTo",
        "origin",
        "lastChannel",
        "channel",
    ):
        if field in template:
            entry[field] = template[field]

    entry["sessionId"] = session_id
    updated_at = transcript_updated_at_ms(session_file)
    entry["updatedAt"] = updated_at if updated_at is not None else now_ms()
    entry["sessionFile"] = str(session_file)

    store[key] = entry
    write_json(paths.store_path, store)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", default="mrniah_local")
    ap.add_argument("--agent", default="main")
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--local", action="store_true")
    args = ap.parse_args()

    if not INDEX.exists():
        raise SystemExit(f"Missing {INDEX}. Run mr-niah-transcript.py first.")

    RESULTS.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)

    paths = resolve_store_paths(args.profile, args.agent)
    ensure_store_initialized(paths, local=args.local)

    index_entries = load_index(INDEX)[: args.limit]

    store = load_store(paths)
    template = pick_template_entry(store)

    pred_path = RESULTS / "predictions.jsonl"
    pred_path.write_text("", encoding="utf-8")

    for entry in index_entries:
        sample_id = entry["id"]
        session_id = entry["session"]
        question = entry["question"]
        answer = entry.get("answer", "")

        src = SESS_OUT / f"{session_id}.jsonl"
        if not src.exists():
            raise FileNotFoundError(f"Missing generated session: {src}")

        dst = paths.sessions_dir / src.name
        shutil.copy2(src, dst)

        # Register into sessions.json under a unique bench key
        bench_key = f"bench:mrniah:{sample_id:04d}"
        register_session(
            paths=paths,
            store=store,
            session_id=session_id,
            session_file=dst,
            template=template,
            key=bench_key,
        )

        cmd = [
            "openclaw",
            "--profile",
            args.profile,
            "agent",
        ]
        maybe_add_agent_arg(cmd, args.agent)
        cmd.extend(
            [
                "--session-id",
                session_id,
                "--message",
                question,
                "--json",
            ]
        )
        if args.local:
            cmd.append("--local")

        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        # Save raw for debugging
        raw_out = RAW / f"{sample_id}-{session_id}.stdout.json"
        raw_err = RAW / f"{sample_id}-{session_id}.stderr.txt"
        raw_out.write_text(proc.stdout, encoding="utf-8")
        raw_err.write_text(proc.stderr, encoding="utf-8")

        prediction = ""
        if proc.returncode == 0:
            obj = parse_json_stdout(proc.stdout)
            if obj is None:
                obj = parse_json_stdout(proc.stderr)
            if obj is not None:
                prediction = safe_extract_text(obj)

        with pred_path.open("a", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {
                        "id": sample_id,
                        "session": session_id,
                        "prediction": prediction,
                        "answer": answer,
                        "profile": args.profile,
                        "agent": args.agent,
                        "local": bool(args.local),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

        print(f"[{sample_id}] session={session_id} pred_len={len(prediction)}")

    print(f"Wrote predictions -> {pred_path}")
    print(f"Raw outputs -> {RAW}")
    print(f"Store -> {paths.store_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
