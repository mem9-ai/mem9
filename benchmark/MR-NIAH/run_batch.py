#!/usr/bin/env python3
"""MR-NIAH batch runner.

Design goal:
- For each generated session transcript in output/sessions/<sessionId>.jsonl:
  1) Copy transcript into the target OpenClaw profile's sessions dir.
  2) Register the sessionId into that profile's sessions.json store with a unique key
     (so the store can be searched by sessionId).
  3) Run `openclaw agent --session-id <sessionId> --message <question> --json`.
  4) Save raw stdout/stderr + extracted prediction.

Why registration is needed:
- OpenClaw's session store (sessions.json) is keyed by sessionKey (usually derived from --to).
- If we don't use --to, we must add store entries ourselves so resolveSessionKeyForRequest()
  can find a key by sessionId.

Usage:
  cd benchmark/MR-NIAH
  python3 run_batch.py --profile mrniah_local --agent main --limit 30

Outputs:
- results/predictions.jsonl
- results/raw/<id>-<sessionId>.stdout.json
- results/raw/<id>-<sessionId>.stderr.txt
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import random
import re
import shutil
import socket
import subprocess
import time
import urllib.request
import urllib.error
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "output"
INDEX = OUTPUT / "index.jsonl"
SESS_OUT = OUTPUT / "sessions"
RESULTS = HERE / "results"
RAW = RESULTS / "raw"
META_SUFFIX = ".meta.json"


def now_ms() -> int:
    return int(time.time() * 1000)


def extract_last_compaction_event(session_file: Path) -> Optional[Dict[str, Any]]:
    """Return the last compaction event line (if any) from a session JSONL transcript.

    Transcripts can be very large, so scan from the end (best-effort).
    """
    try:
        with session_file.open("rb") as fh:
            fh.seek(0, 2)
            pos = fh.tell()
            if pos <= 0:
                return None

            block_size = 1024 * 1024  # 1MB
            buf = b""
            max_scan_bytes = 64 * 1024 * 1024  # 64MB
            scanned = 0

            while pos > 0 and scanned < max_scan_bytes:
                read_size = block_size if pos >= block_size else pos
                pos -= read_size
                fh.seek(pos)
                chunk = fh.read(read_size)
                scanned += len(chunk)
                buf = chunk + buf

                if b"\n" not in buf and pos > 0:
                    continue

                lines = buf.split(b"\n")
                buf = lines[0]  # keep incomplete head for next iteration

                for raw in reversed(lines[1:]):
                    raw = raw.strip()
                    if not raw:
                        continue
                    # Fast substring check before JSON parse.
                    if b'"type"' not in raw or b"compaction" not in raw:
                        continue
                    try:
                        obj = json.loads(raw.decode("utf-8"))
                    except Exception:
                        continue
                    if isinstance(obj, dict) and obj.get("type") == "compaction":
                        return obj
    except FileNotFoundError:
        return None
    return None


def coerce_str(value: Any) -> Optional[str]:
    if isinstance(value, str):
        v = value.strip()
        return v if v else None
    return None


def maybe_truncate(text: str, max_chars: int) -> tuple[str, bool]:
    if max_chars <= 0:
        return text, False
    if len(text) <= max_chars:
        return text, False
    return text[:max_chars], True


def compaction_event_key(event: Dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
    """Best-effort stable identifier for comparing compaction events."""
    return (coerce_str(event.get("id")), coerce_str(event.get("timestamp")))


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
    - embedded: {payloads:[{text:...}], meta:{...}}
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

def find_first_str_by_key(obj: Any, keys: set[str]) -> Optional[str]:
    """Best-effort deep search for the first string value for any key in keys."""
    queue: List[Any] = [obj]
    seen = 0
    while queue and seen < 2000:
        cur = queue.pop(0)
        seen += 1
        if isinstance(cur, dict):
            for k, v in cur.items():
                if k in keys and isinstance(v, str):
                    out = v.strip()
                    if out:
                        return out
                queue.append(v)
        elif isinstance(cur, list):
            queue.extend(cur)
    return None


def extract_effective_session_id(payload_obj: Any) -> Optional[str]:
    # Common candidates across embedded/gateway outputs.
    keys = {
        "sessionId",
        "sessionID",
        "session_id",
        "session",
        "effectiveSessionId",
        "newSessionId",
    }
    return find_first_str_by_key(payload_obj, keys)


def extract_run_id(payload_obj: Any) -> Optional[str]:
    keys = {"runId", "runID", "run_id"}
    return find_first_str_by_key(payload_obj, keys)

def build_multipart_form(
    *, fields: Dict[str, str], file_field: str, filename: str, file_bytes: bytes, content_type: str
) -> tuple[bytes, str]:
    boundary = "---------------------------" + uuid.uuid4().hex
    lines: List[bytes] = []

    def add_line(s: str) -> None:
        lines.append(s.encode("utf-8"))

    for k, v in fields.items():
        add_line(f"--{boundary}\r\n")
        add_line(f'Content-Disposition: form-data; name="{k}"\r\n\r\n')
        add_line(f"{v}\r\n")

    add_line(f"--{boundary}\r\n")
    add_line(
        f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
    )
    add_line(f"Content-Type: {content_type}\r\n\r\n")
    lines.append(file_bytes)
    add_line("\r\n")

    add_line(f"--{boundary}--\r\n")
    body = b"".join(lines)
    return body, f"multipart/form-data; boundary={boundary}"


def http_json(
    *,
    method: str,
    url: str,
    headers: Dict[str, str],
    body: Optional[bytes] = None,
    timeout_s: int = 30,
    max_attempts: int = 1,
    retry_base_sleep_s: float = 1.0,
    retry_max_sleep_s: float = 10.0,
) -> Any:
    retryable_http = {408, 425, 429, 500, 502, 503, 504}
    last_exc: Optional[BaseException] = None

    attempts = max(1, int(max_attempts))
    for attempt in range(1, attempts + 1):
        req = urllib.request.Request(url, data=body, method=method.upper())
        for k, v in headers.items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                data = resp.read()
                if not data:
                    return None
                return json.loads(data.decode("utf-8"))
        except urllib.error.HTTPError as e:
            body_bytes = b""
            try:
                body_bytes = e.read() or b""
            except Exception:
                body_bytes = b""
            body_text = body_bytes.decode("utf-8", errors="replace")
            last_exc = RuntimeError(f"HTTP {e.code} {method} {url}: {body_text[:2000]}")
            if attempt < attempts and int(getattr(e, "code", 0) or 0) in retryable_http:
                base = max(0.0, float(retry_base_sleep_s))
                cap = max(base, float(retry_max_sleep_s))
                sleep_s = min(cap, base * (2 ** (attempt - 1)))
                sleep_s = sleep_s * (0.7 + random.random() * 0.6)  # jitter
                time.sleep(sleep_s)
                continue
            raise last_exc from e
        except (
            urllib.error.URLError,
            socket.timeout,
            TimeoutError,
            ConnectionResetError,
            http.client.HTTPException,
        ) as e:
            last_exc = RuntimeError(f"Network error {method} {url}: {e}")
            if attempt < attempts:
                base = max(0.0, float(retry_base_sleep_s))
                cap = max(base, float(retry_max_sleep_s))
                sleep_s = min(cap, base * (2 ** (attempt - 1)))
                sleep_s = sleep_s * (0.7 + random.random() * 0.6)  # jitter
                time.sleep(sleep_s)
                continue
            raise last_exc from e

    if last_exc is not None:
        raise last_exc
    raise RuntimeError(f"Unexpected error {method} {url}")


def mem9_import_session(
    *,
    api_url: str,
    tenant_id: str,
    agent_id: str,
    session_id: str,
    import_file: Path,
    timeout_s: int,
    poll_interval_s: float,
) -> Dict[str, Any]:
    """Upload a session file via /imports and wait for completion.

    Note: This uploads the OpenClaw session JSONL transcript directly. The server supports
    OpenClaw's nested JSONL format and will extract {role, content} for ingest.
    """
    start = time.time()
    import_bytes = import_file.read_bytes()
    body, ct = build_multipart_form(
        fields={"agent_id": agent_id, "file_type": "session", "session_id": session_id},
        file_field="file",
        filename=f"{session_id}.jsonl",
        file_bytes=import_bytes,
        content_type="application/octet-stream",
    )
    headers = {"Content-Type": ct, "X-Mnemo-Agent-Id": agent_id}
    create_url = f"{api_url}/v1alpha1/mem9s/{tenant_id}/imports"
    created = http_json(
        method="POST",
        url=create_url,
        headers=headers,
        body=body,
        timeout_s=60,
        max_attempts=2,
        retry_base_sleep_s=1.0,
        retry_max_sleep_s=10.0,
    )
    task_id = created.get("id") if isinstance(created, dict) else None
    if not isinstance(task_id, str) or not task_id:
        raise RuntimeError(f"mem9 import did not return task id: {created!r}")
    print(
        f"[mem9] import created session={session_id} task={task_id}",
        flush=True,
    )

    detail_url = f"{api_url}/v1alpha1/mem9s/{tenant_id}/imports/{task_id}"
    last_detail: Any = None
    last_status: Any = None
    last_print_s = 0.0
    transient_errors = 0
    while True:
        elapsed = time.time() - start
        if elapsed > timeout_s:
            raise TimeoutError(f"mem9 import task timed out after {timeout_s}s (task={task_id})")
        try:
            detail = http_json(
                method="GET",
                url=detail_url,
                headers={"X-Mnemo-Agent-Id": agent_id},
                timeout_s=60,
                max_attempts=6,
                retry_base_sleep_s=1.0,
                retry_max_sleep_s=10.0,
            )
        except Exception as e:
            transient_errors += 1
            # Treat polling failures as transient; keep waiting until the overall task timeout.
            print(
                f"[mem9] import poll transient_error={transient_errors} task={task_id} err={e}",
                flush=True,
            )
            time.sleep(poll_interval_s)
            continue
        last_detail = detail
        status = detail.get("status") if isinstance(detail, dict) else None
        total = detail.get("total") if isinstance(detail, dict) else None
        done = detail.get("done") if isinstance(detail, dict) else None
        now_s = time.time()
        should_print = False
        if status != last_status:
            should_print = True
        if status in ("done", "failed"):
            should_print = True
        if (now_s - last_print_s) >= 5.0:
            should_print = True
        if should_print:
            last_status = status
            last_print_s = now_s
            print(
                f"[mem9] import poll task={task_id} status={status} done={done} total={total}",
                flush=True,
            )
        if status in ("done", "failed"):
            break
        time.sleep(poll_interval_s)

    total_chunks = last_detail.get("total") if isinstance(last_detail, dict) else None
    done_chunks = last_detail.get("done") if isinstance(last_detail, dict) else None
    error_msg = last_detail.get("error") if isinstance(last_detail, dict) else None
    status_final = (last_detail.get("status") if isinstance(last_detail, dict) else None)
    verified = (
        status_final == "done"
        and not (isinstance(error_msg, str) and error_msg.strip())
        and (
            (isinstance(total_chunks, int) and isinstance(done_chunks, int) and done_chunks >= total_chunks)
            or (not isinstance(total_chunks, int) or not isinstance(done_chunks, int))
        )
    )
    return {
        "create": created,
        "taskId": task_id,
        "status": status_final,
        "detail": last_detail,
        "verified": verified,
        "totalChunks": total_chunks if isinstance(total_chunks, int) else None,
        "doneChunks": done_chunks if isinstance(done_chunks, int) else None,
        "durationMs": int((time.time() - start) * 1000),
        "fileBytes": len(import_bytes),
        "filePath": str(import_file),
        "transientPollErrors": transient_errors,
    }


def mem9_list_memories(
    *,
    api_url: str,
    tenant_id: str,
    agent_id: str,
    limit: int = 200,
    offset: int = 0,
) -> Dict[str, Any]:
    url = f"{api_url}/v1alpha1/mem9s/{tenant_id}/memories?limit={int(limit)}&offset={int(offset)}"
    data = http_json(
        method="GET",
        url=url,
        headers={"X-Mnemo-Agent-Id": agent_id},
        timeout_s=30,
        max_attempts=6,
        retry_base_sleep_s=1.0,
        retry_max_sleep_s=10.0,
    )
    if not isinstance(data, dict):
        raise RuntimeError(f"mem9 list memories returned non-object: {data!r}")
    return data


def mem9_clear_memories(
    *,
    api_url: str,
    tenant_id: str,
    agent_id: str,
    max_to_delete: int = 50_000,
    settle_s: float = 2.0,
) -> Dict[str, Any]:
    """Delete all tenant memories (best-effort scoped by X-Mnemo-Agent-Id on server side)."""
    start = time.time()
    deleted = 0
    transient_errors = 0

    # Keep fetching from offset=0 while deleting, because totals/offsets shift.
    for _ in range(1_000):
        if deleted >= max_to_delete:
            raise RuntimeError(
                f"mem9 clear exceeded max_to_delete={max_to_delete} (tenant={tenant_id})"
            )
        try:
            page = mem9_list_memories(api_url=api_url, tenant_id=tenant_id, agent_id=agent_id)
        except Exception as e:
            transient_errors += 1
            print(f"[mem9] clear list transient_error={transient_errors} err={e}", flush=True)
            time.sleep(1.0)
            continue

        memories = page.get("memories")
        if not isinstance(memories, list):
            raise RuntimeError(f"mem9 list memories missing .memories: {page!r}")

        if len(memories) == 0:
            break

        for m in memories:
            if not isinstance(m, dict):
                continue
            mid = m.get("id")
            if not isinstance(mid, str) or not mid:
                continue
            del_url = f"{api_url}/v1alpha1/mem9s/{tenant_id}/memories/{mid}"
            try:
                http_json(
                    method="DELETE",
                    url=del_url,
                    headers={"X-Mnemo-Agent-Id": agent_id},
                    timeout_s=30,
                    max_attempts=6,
                    retry_base_sleep_s=1.0,
                    retry_max_sleep_s=10.0,
                )
                deleted += 1
            except Exception as e:
                transient_errors += 1
                print(
                    f"[mem9] clear delete transient_error={transient_errors} id={mid} err={e}",
                    flush=True,
                )
                time.sleep(1.0)

    # Settle window: agent_end ingest can be async; wait briefly and verify empty.
    if settle_s > 0:
        time.sleep(float(settle_s))

    final_page = mem9_list_memories(api_url=api_url, tenant_id=tenant_id, agent_id=agent_id)
    final_memories = final_page.get("memories")
    remaining = len(final_memories) if isinstance(final_memories, list) else None

    verified = remaining == 0
    return {
        "deleted": deleted,
        "remaining": remaining,
        "verified": verified,
        "durationMs": int((time.time() - start) * 1000),
        "transientErrors": transient_errors,
    }


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


def ensure_store_initialized(paths: StorePaths) -> None:
    """Ensure sessions dir & store file exist."""
    paths.sessions_dir.mkdir(parents=True, exist_ok=True)
    if not paths.store_path.exists():
        write_json(paths.store_path, {})


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


def _coerce_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return None
        try:
            return int(v, 10)
        except ValueError:
            return None
    return None


def build_session_entry(
    *,
    session_id: str,
    session_file: Path,
    template: Dict[str, Any],
) -> Dict[str, Any]:
    entry: Dict[str, Any] = {}

    # Keep only safe/likely fields. We keep skillsSnapshot if present to avoid churn.
    for field in (
        "skillsSnapshot",
        "thinkingLevel",
        "verboseLevel",
        "chatType",
        "deliveryContext",
        "lastTo",
        "origin",
        "lastChannel",
        "channel",
    ):
        if field in template:
            entry[field] = template[field]

    # New sessions should not inherit compaction / token accounting from any template entry.
    entry["compactionCount"] = 0
    for token_field in (
        "inputTokens",
        "outputTokens",
        "totalTokens",
        "totalTokensFresh",
        "cacheRead",
        "cacheWrite",
        "contextTokens",
        "memoryFlushAt",
        "memoryFlushCompactionCount",
    ):
        entry.pop(token_field, None)

    entry["sessionId"] = session_id
    entry["origin"] = "bench:mrniah"
    # Keep this lightweight; updatedAt is only used for display/sorting in OpenClaw UIs.
    entry["updatedAt"] = now_ms()
    entry["sessionFile"] = str(session_file)
    return entry

def upsert_store_entry(*, paths: StorePaths, key: str, entry: Dict[str, Any]) -> None:
    store = load_store(paths)
    store[key] = entry
    write_json(paths.store_path, store)


def find_store_entry(
    *, store: Dict[str, Any], session_id: str, preferred_key: str
) -> tuple[str, Dict[str, Any]]:
    preferred = store.get(preferred_key)
    if isinstance(preferred, dict) and preferred.get("sessionId") == session_id:
        return preferred_key, preferred
    for k, v in store.items():
        if isinstance(v, dict) and v.get("sessionId") == session_id:
            return k, v
    return preferred_key, {}


def extract_compaction_metrics(
    *, entry_before: Dict[str, Any], entry_after: Dict[str, Any]
) -> Dict[str, Any]:
    before = _coerce_int(entry_before.get("compactionCount")) or 0
    after = _coerce_int(entry_after.get("compactionCount")) or 0
    delta = max(0, after - before)
    total_tokens_fresh = entry_after.get("totalTokensFresh")
    return {
        "compactionCountBefore": before,
        "compactionCountAfter": after,
        "compactionCountDelta": delta,
        "compactionTriggered": bool(delta),
        "totalTokens": _coerce_int(entry_after.get("totalTokens")),
        "totalTokensFresh": total_tokens_fresh if isinstance(total_tokens_fresh, bool) else None,
        "inputTokens": _coerce_int(entry_after.get("inputTokens")),
        "outputTokens": _coerce_int(entry_after.get("outputTokens")),
        "contextTokens": _coerce_int(entry_after.get("contextTokens")),
        "cacheRead": _coerce_int(entry_after.get("cacheRead")),
        "cacheWrite": _coerce_int(entry_after.get("cacheWrite")),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", default="mrniah_local")
    ap.add_argument("--agent", default="main")
    ap.add_argument("--limit", type=int, default=30)
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--reset", action="store_true", help="Prefix each question with /reset")
    group.add_argument("--new", action="store_true", help="Prefix each question with /new")
    ap.add_argument(
        "--compaction-summary-max-chars",
        type=int,
        default=20000,
        help="Truncate compaction summary in predictions.jsonl (0 = no truncation).",
    )
    ap.add_argument(
        "--openclaw-timeout",
        type=int,
        default=0,
        help="Pass --timeout to `openclaw agent` (0 = let OpenClaw decide).",
    )
    ap.add_argument(
        "--import-sessions",
        action="store_true",
        help="If the profile has a mem9 plugin configured, import the session transcript into mem9 before each agent turn.",
    )
    ap.add_argument(
        "--mem9-clear-memories",
        action="store_true",
        help="When --import-sessions is set, clear all mem9 memories before and after each case (to keep cases independent).",
    )
    ap.add_argument(
        "--mem9-api-url",
        default="",
        help="mem9 API base URL (required for --import-sessions unless the profile openclaw.json has a mem9 plugin config).",
    )
    ap.add_argument(
        "--mem9-tenant-id",
        default="",
        help="mem9 tenant ID (required for --import-sessions unless the profile openclaw.json has a mem9 plugin config).",
    )
    ap.add_argument(
        "--mem9-import-timeout",
        type=int,
        default=300,
        help="Timeout (seconds) for each mem9 /imports task (only when --import-sessions is set).",
    )
    ap.add_argument(
        "--mem9-import-poll-interval",
        type=float,
        default=1.0,
        help="Polling interval (seconds) for each mem9 /imports task.",
    )
    args = ap.parse_args()

    if not INDEX.exists():
        raise SystemExit(f"Missing {INDEX}. Run mr-niah-transcript.py first.")

    RESULTS.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)

    paths = resolve_store_paths(args.profile, args.agent)
    ensure_store_initialized(paths)

    mem9_cfg: Optional[tuple[str, str]] = None
    if args.import_sessions:
        api_url = (
            (args.mem9_api_url or "").strip()
            or os.environ.get("MEM9_BASE_URL", "").strip()
            or os.environ.get("MEM9_API_URL", "").strip()
            or os.environ.get("MNEMO_API_URL", "").strip()
        )
        tenant_id = (
            (args.mem9_tenant_id or "").strip()
            or os.environ.get("MEM9_TENANT_ID", "").strip()
            or os.environ.get("MNEMO_TENANT_ID", "").strip()
        )
        if api_url and tenant_id:
            mem9_cfg = (api_url.rstrip("/"), tenant_id)
        if mem9_cfg is None:
            raise SystemExit(
                "ERROR: --import-sessions requires a mem9 apiUrl + tenantID.\n"
                "Provide --mem9-api-url/--mem9-tenant-id, or set MEM9_BASE_URL/MEM9_TENANT_ID."
            )

    index_entries = load_index(INDEX)[: args.limit]

    pred_path = RESULTS / "predictions.jsonl"
    pred_path.write_text("", encoding="utf-8")

    for entry in index_entries:
        sample_id = entry["id"]
        session_id = entry["session"]
        question = entry["question"]
        answer = entry.get("answer", "")

        print(f"[{sample_id}] session={session_id} running=prepare", flush=True)

        src = SESS_OUT / f"{session_id}.jsonl"
        if not src.exists():
            raise FileNotFoundError(f"Missing generated session: {src}")

        dst = paths.sessions_dir / src.name
        shutil.copy2(src, dst)

        # Register into sessions.json under a unique bench key
        bench_key = f"bench:mrniah:{sample_id:04d}"
        store_before = load_store(paths)
        template = pick_template_entry(store_before)
        bench_entry = build_session_entry(
            session_id=session_id,
            session_file=dst,
            template=template,
        )
        upsert_store_entry(paths=paths, key=bench_key, entry=bench_entry)

        mem9_import: Optional[Dict[str, Any]] = None
        mem9_clear_pre: Optional[Dict[str, Any]] = None
        mem9_clear_post: Optional[Dict[str, Any]] = None
        if mem9_cfg is not None:
            api_url, tenant_id = mem9_cfg
            if args.mem9_clear_memories:
                print(f"[{sample_id}] session={session_id} running=mem9_clear_pre", flush=True)
                mem9_clear_pre = mem9_clear_memories(
                    api_url=api_url,
                    tenant_id=tenant_id,
                    agent_id=args.agent,
                )
                if mem9_clear_pre.get("verified") is not True:
                    raise RuntimeError(f"mem9 clear(pre) did not verify empty: {mem9_clear_pre!r}")
            import_path = RAW / f"{sample_id}-{session_id}.import.session.jsonl"
            shutil.copy2(dst, import_path)
            print(f"[{sample_id}] session={session_id} running=mem9_import", flush=True)
            mem9_import = mem9_import_session(
                api_url=api_url,
                tenant_id=tenant_id,
                agent_id=args.agent,
                session_id=session_id,
                import_file=import_path,
                timeout_s=int(args.mem9_import_timeout),
                poll_interval_s=float(args.mem9_import_poll_interval),
            )
            if mem9_import.get("status") != "done" or mem9_import.get("verified") is not True:
                raise RuntimeError(f"mem9 import did not complete successfully: {mem9_import!r}")

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
                (f"/reset {question}" if args.reset else f"/new {question}" if args.new else question),
                "--json",
            ]
        )
        if args.openclaw_timeout and args.openclaw_timeout > 0:
            cmd.extend(["--timeout", str(int(args.openclaw_timeout))])

        print(f"[{sample_id}] session={session_id} running=openclaw", flush=True)
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        if mem9_cfg is not None and args.mem9_clear_memories:
            api_url, tenant_id = mem9_cfg
            print(f"[{sample_id}] session={session_id} running=mem9_clear_post", flush=True)
            mem9_clear_post = mem9_clear_memories(
                api_url=api_url,
                tenant_id=tenant_id,
                agent_id=args.agent,
            )
            if mem9_clear_post.get("verified") is not True:
                raise RuntimeError(f"mem9 clear(post) did not verify empty: {mem9_clear_post!r}")

        # Save raw for debugging
        raw_out = RAW / f"{sample_id}-{session_id}.stdout.json"
        raw_err = RAW / f"{sample_id}-{session_id}.stderr.txt"
        raw_out.write_text(proc.stdout, encoding="utf-8")
        raw_err.write_text(proc.stderr, encoding="utf-8")

        parsed_obj: Optional[Any] = None
        if proc.returncode == 0:
            parsed_obj = parse_json_stdout(proc.stdout)
            if parsed_obj is None:
                parsed_obj = parse_json_stdout(proc.stderr)

        store_after = load_store(paths)
        effective_session_id = (
            extract_effective_session_id(parsed_obj) if parsed_obj is not None else None
        )
        if not effective_session_id:
            effective_session_id = session_id

        resolved_key, entry_after = find_store_entry(
            store=store_after, session_id=effective_session_id, preferred_key=bench_key
        )
        compaction = extract_compaction_metrics(entry_before=bench_entry, entry_after=entry_after)

        effective_session_file = dst
        session_file_raw = entry_after.get("sessionFile") if isinstance(entry_after, dict) else None
        if isinstance(session_file_raw, str) and session_file_raw.strip():
            effective_session_file = Path(session_file_raw).expanduser()

        compaction_event: Optional[Dict[str, Any]] = None
        # MR-NIAH dataset transcripts contain no compaction events by construction.
        # Only scan the transcript if OpenClaw reports that compaction happened in this run.
        if compaction["compactionCountDelta"] > 0:
            compaction_event = extract_last_compaction_event(effective_session_file)
        compaction_occurred = isinstance(compaction_event, dict)

        # Prefer detecting compaction from transcript event deltas; fall back to session-store delta.
        compaction["compactionTriggered"] = bool(compaction_occurred) or bool(
            compaction["compactionCountDelta"]
        )
        event_first_kept = (
            coerce_str(compaction_event.get("firstKeptEntryId"))
            if isinstance(compaction_event, dict)
            else None
        )
        event_summary = (
            compaction_event.get("summary") if isinstance(compaction_event, dict) else None
        )
        if not isinstance(event_summary, str):
            event_summary = None
        summary_truncated = False
        if event_summary is not None:
            event_summary, summary_truncated = maybe_truncate(
                event_summary, int(args.compaction_summary_max_chars)
            )

        raw_meta = RAW / f"{sample_id}-{session_id}{META_SUFFIX}"
        write_json(
            raw_meta,
            {
                "id": sample_id,
                "session": session_id,
                "sessionEffective": effective_session_id,
                "sessionEffectiveChanged": bool(effective_session_id and effective_session_id != session_id),
                "sessionFileEffective": str(effective_session_file),
                "profile": args.profile,
                "agent": args.agent,
                "returncode": proc.returncode,
                "runId": extract_run_id(parsed_obj) if parsed_obj is not None else None,
                "storeKey": resolved_key,
                "storePath": str(paths.store_path),
                "mem9Import": mem9_import,
                "mem9Clear": {
                    "pre": mem9_clear_pre,
                    "post": mem9_clear_post,
                }
                if mem9_cfg is not None and args.mem9_clear_memories
                else None,
                "compaction": compaction,
                "compactionEvent": {
                    "occurred": compaction_occurred,
                    "firstKeptEntryId": event_first_kept,
                    "summaryChars": len(event_summary) if event_summary is not None else None,
                    "summaryTruncated": summary_truncated if event_summary is not None else None,
                    "tokensBefore": compaction_event.get("tokensBefore")
                    if isinstance(compaction_event, dict)
                    else None,
                },
            },
        )

        prediction = ""
        if proc.returncode == 0:
            if parsed_obj is not None:
                prediction = safe_extract_text(parsed_obj)

        sent_message = f"/reset {question}" if args.reset else f"/new {question}" if args.new else question
        with pred_path.open("a", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {
                        "id": sample_id,
                        "session": session_id,
                        "sessionEffective": effective_session_id,
                        "sessionEffectiveChanged": bool(effective_session_id and effective_session_id != session_id),
                        "question": question,
                        "message": sent_message,
                        "reset": bool(args.reset),
                        "new": bool(args.new),
                        "prediction": prediction,
                        "answer": answer,
                        "profile": args.profile,
                        "agent": args.agent,
                        "mem9ImportTaskId": mem9_import.get("taskId")
                        if isinstance(mem9_import, dict)
                        else None,
                        "mem9ImportStatus": mem9_import.get("status")
                        if isinstance(mem9_import, dict)
                        else None,
                        "mem9ImportVerified": mem9_import.get("verified")
                        if isinstance(mem9_import, dict)
                        else None,
                        "mem9ImportTotalChunks": mem9_import.get("totalChunks")
                        if isinstance(mem9_import, dict)
                        else None,
                        "mem9ImportDoneChunks": mem9_import.get("doneChunks")
                        if isinstance(mem9_import, dict)
                        else None,
                        "compactionTriggered": compaction["compactionTriggered"],
                        "compactionCountDelta": compaction["compactionCountDelta"],
                        "compactionCountAfter": compaction["compactionCountAfter"],
                        "totalTokens": compaction["totalTokens"],
                        "totalTokensFresh": compaction["totalTokensFresh"],
                        "firstKeptEntryId": event_first_kept,
                        "compactionSummary": event_summary,
                        "compactionSummaryTruncated": summary_truncated if event_summary is not None else None,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

        comp = "yes" if compaction["compactionTriggered"] else "no"
        print(
            f"[{sample_id}] session={session_id} pred_len={len(prediction)} compaction={comp}",
            flush=True,
        )

    print(f"Wrote predictions -> {pred_path}", flush=True)
    print(f"Raw outputs -> {RAW}", flush=True)
    print(f"Store -> {paths.store_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
