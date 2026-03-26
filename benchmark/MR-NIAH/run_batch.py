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
import atexit
import http.client
import json
import os
import random
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
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
META_SUFFIX = ".meta.json"
PROFILE_MEMORY_DIR = "memory"
OPENCLAW_DEFAULT_WORKSPACE_DIRNAME = ".openclaw"


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


def preview_text(value: Any, max_chars: int) -> Optional[str]:
    if max_chars <= 0:
        return None
    if not isinstance(value, str):
        return None
    s = value.replace("\n", " ").strip()
    if not s:
        return None
    if len(s) <= max_chars:
        return s
    return s[:max_chars] + "..."


def truncate_text(value: str, max_chars: int) -> str:
    if max_chars <= 0:
        return value
    if len(value) <= max_chars:
        return value
    return value[:max_chars]


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

def append_jsonl(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(obj, ensure_ascii=False) + "\n")


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


def mem9_search_memories(
    *,
    api_url: str,
    tenant_id: str,
    agent_id: str,
    query: str,
    limit: int = 10,
    offset: int = 0,
) -> Dict[str, Any]:
    params = urllib.parse.urlencode(
        {
            "q": query,
            "limit": int(limit),
            "offset": int(offset),
        }
    )
    url = f"{api_url}/v1alpha1/mem9s/{tenant_id}/memories?{params}"
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
        raise RuntimeError(f"mem9 search memories returned non-object: {data!r}")
    return data


def mem9v2_create_messages(
    *,
    api_url: str,
    api_key: str,
    agent_id: str,
    session_id: str,
    messages: List[Dict[str, str]],
) -> Dict[str, Any]:
    url = f"{api_url}/v1alpha2/mem9s/memories"
    body = {
        "agent_id": agent_id,
        "session_id": session_id,
        "messages": messages,
    }
    data = http_json(
        method="POST",
        url=url,
        headers={
            "X-Mnemo-Agent-Id": agent_id,
            "X-API-Key": api_key,
            "Content-Type": "application/json",
        },
        body=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        timeout_s=30,
        max_attempts=6,
        retry_base_sleep_s=1.0,
        retry_max_sleep_s=10.0,
    )
    if not isinstance(data, dict):
        raise RuntimeError(f"mem9 v1alpha2 create returned non-object: {data!r}")
    return data


def mem9v2_search_memories(
    *,
    api_url: str,
    api_key: str,
    agent_id: str,
    query: str,
    limit: int = 10,
    offset: int = 0,
    memory_type: str = "",
    session_id: str = "",
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "q": query,
        "limit": int(limit),
        "offset": int(offset),
    }
    if memory_type:
        params["memory_type"] = memory_type
    if session_id:
        params["session_id"] = session_id
    qs = urllib.parse.urlencode(params)
    url = f"{api_url}/v1alpha2/mem9s/memories?{qs}"
    data = http_json(
        method="GET",
        url=url,
        headers={
            "X-Mnemo-Agent-Id": agent_id,
            "X-API-Key": api_key,
        },
        timeout_s=30,
        max_attempts=6,
        retry_base_sleep_s=1.0,
        retry_max_sleep_s=10.0,
    )
    if not isinstance(data, dict):
        raise RuntimeError(f"mem9 v1alpha2 search returned non-object: {data!r}")
    return data


def mem9_clear_memories(
    *,
    api_url: str,
    tenant_id: str,
    agent_id: str,
    max_to_delete: int = 50_000,
    stable_empty_checks: int = 3,
    stable_empty_interval_s: float = 1.0,
    max_duration_s: float = 90.0,
) -> Dict[str, Any]:
    """Delete all tenant memories (best-effort).

    mem9 may add new memories asynchronously (e.g. smart ingest finishing late). To avoid
    flakiness, we require the list endpoint to be empty for N consecutive checks.
    """
    start = time.time()
    deleted = 0
    transient_errors = 0
    empty_streak = 0

    # Keep fetching from offset=0 while deleting, because totals/offsets shift.
    for _ in range(2_000):
        if (time.time() - start) > float(max_duration_s):
            break
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
            empty_streak += 1
            if empty_streak >= max(1, int(stable_empty_checks)):
                break
            time.sleep(float(stable_empty_interval_s))
            continue

        empty_streak = 0

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

    final_page = mem9_list_memories(api_url=api_url, tenant_id=tenant_id, agent_id=agent_id)
    final_memories = final_page.get("memories")
    remaining = len(final_memories) if isinstance(final_memories, list) else None

    verified = remaining == 0
    remaining_sample: Optional[List[Dict[str, Any]]] = None
    if isinstance(final_memories, list) and final_memories:
        sample: List[Dict[str, Any]] = []
        for m in final_memories[:10]:
            if not isinstance(m, dict):
                continue
            sample.append(
                {
                    "id": m.get("id"),
                    "agent_id": m.get("agent_id"),
                    "session_id": m.get("session_id"),
                    "memory_type": m.get("memory_type"),
                    "state": m.get("state"),
                    "created_at": m.get("created_at"),
                    "updated_at": m.get("updated_at"),
                }
            )
        remaining_sample = sample
    return {
        "deleted": deleted,
        "remaining": remaining,
        "verified": verified,
        "durationMs": int((time.time() - start) * 1000),
        "transientErrors": transient_errors,
        "remainingSample": remaining_sample,
    }


def mem9_provision_tenant(*, api_url: str) -> str:
    """Provision a new mem9 tenant/space via POST /v1alpha1/mem9s."""
    created = http_json(
        method="POST",
        url=f"{api_url}/v1alpha1/mem9s",
        headers={},
        timeout_s=30,
        max_attempts=6,
        retry_base_sleep_s=1.0,
        retry_max_sleep_s=10.0,
    )
    tenant_id = created.get("id") if isinstance(created, dict) else None
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise RuntimeError(f"mem9 provision did not return .id: {created!r}")
    return tenant_id.strip()


def _http_probe_ok(*, url: str, timeout_s: int = 5) -> bool:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            code = getattr(resp, "status", None) or resp.getcode()
            return 200 <= int(code) < 300
    except Exception:
        return False


def _wait_gateway_healthy(*, port: int, timeout_s: int = 60) -> None:
    deadline = time.time() + float(timeout_s)
    url = f"http://localhost:{int(port)}/health"
    while time.time() < deadline:
        if _http_probe_ok(url=url, timeout_s=5):
            return
        time.sleep(0.5)
    raise RuntimeError(f"gateway not healthy at {url}")


def _start_gateway(*, profile: str, log_path: Path) -> subprocess.Popen[str]:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    fh = log_path.open("a", encoding="utf-8")
    # NOTE: We intentionally do not pass port/token here; those are read from the profile config.
    proc = subprocess.Popen(
        ["openclaw", "--profile", profile, "gateway"],
        stdout=fh,
        stderr=subprocess.STDOUT,
        text=True,
    )
    # Close our copy of the file handle; the child keeps its own fd.
    try:
        fh.close()
    except Exception:
        pass
    return proc


def _stop_process(proc: Optional[subprocess.Popen[str]]) -> None:
    if proc is None:
        return
    if proc.poll() is not None:
        return
    try:
        proc.terminate()
    except Exception:
        return
    try:
        proc.wait(timeout=10)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _summarize_memories_page(page: Dict[str, Any]) -> Dict[str, Any]:
    memories_raw = page.get("memories")
    memories: List[Dict[str, Any]] = memories_raw if isinstance(memories_raw, list) else []
    sample: List[Dict[str, Any]] = []
    for m in memories[:10]:
        if not isinstance(m, dict):
            continue
        content_preview = preview_text(m.get("content"), 220)
        sample.append(
            {
                "id": m.get("id"),
                "agent_id": m.get("agent_id"),
                "session_id": m.get("session_id"),
                "memory_type": m.get("memory_type"),
                "state": m.get("state"),
                "tags": m.get("tags"),
                "source": m.get("source"),
                "score": m.get("score"),
                "content_preview": content_preview,
                "created_at": m.get("created_at"),
                "updated_at": m.get("updated_at"),
            }
        )
    total = page.get("total")
    return {
        "count": len(memories),
        "total": int(total) if isinstance(total, int) else None,
        "sample": sample if sample else None,
    }


def summarize_memories_page(page: Dict[str, Any], content_preview_chars: int) -> Dict[str, Any]:
    base = _summarize_memories_page(page)
    sample = base.get("sample")
    if not isinstance(sample, list) or content_preview_chars <= 0:
        return base
    for rec in sample:
        if not isinstance(rec, dict):
            continue
        if "content_preview" in rec:
            rec["content_preview"] = preview_text(rec.get("content_preview"), int(content_preview_chars))
    return base


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

def resolve_default_openclaw_workspace_dir(profile: str) -> Path:
    """Best-effort match for OpenClaw's default workspace dir derivation.

    OpenClaw workspaces are stored under ~/.openclaw/workspace[-<profile>].
    Note: the workspace dir is *not* under the profile's state dir.
    """
    base = Path.home() / OPENCLAW_DEFAULT_WORKSPACE_DIRNAME
    prof = (profile or "").strip()
    if prof and prof.lower() != "default":
        return base / f"workspace-{prof}"
    return base / "workspace"

def resolve_profile_workspace_dir(*, profile: str, agent: str, profile_dir: Path) -> Path:
    """Resolve the effective agent workspace dir for this profile (best-effort).

    OpenClaw chooses workspaces in this order:
    1) agents.list[].workspace for the selected agent id
    2) agents.defaults.workspace (for the default agent)
    3) fallback to ~/.openclaw/workspace[-<profile>]

    We mirror that here so injected transcripts have a `cwd` that matches the
    gateway's embedded agent workspace.
    """
    cfg_path = profile_dir / "openclaw.json"
    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    except Exception:
        return resolve_default_openclaw_workspace_dir(profile)

    agents_cfg = cfg.get("agents")
    if isinstance(agents_cfg, dict):
        agent_norm = (agent or "").strip().lower()
        raw_list = agents_cfg.get("list")
        if agent_norm and isinstance(raw_list, list):
            for entry in raw_list:
                if not isinstance(entry, dict):
                    continue
                entry_id = entry.get("id")
                if not isinstance(entry_id, str) or entry_id.strip().lower() != agent_norm:
                    continue
                ws = entry.get("workspace")
                if isinstance(ws, str) and ws.strip():
                    return Path(ws).expanduser()

        defaults = agents_cfg.get("defaults")
        if isinstance(defaults, dict):
            ws = defaults.get("workspace")
            if isinstance(ws, str) and ws.strip():
                return Path(ws).expanduser()

    return resolve_default_openclaw_workspace_dir(profile)

def rewrite_session_header_cwd(*, session_file: Path, cwd: Path) -> None:
    """Rewrite only the first JSONL header line to update `cwd`.

    This keeps SessionManager.open() from inheriting an unrelated cwd (often "/")
    from imported transcripts, which can leak into tool/file behaviors.
    """
    tmp = session_file.with_suffix(session_file.suffix + ".tmp")
    with session_file.open("rb") as src, tmp.open("wb") as dst:
        first = src.readline()
        if not first:
            raise ValueError(f"empty session file: {session_file}")
        try:
            header = json.loads(first.decode("utf-8"))
        except Exception as e:
            raise ValueError(f"invalid session header JSON: {session_file}") from e
        if not (isinstance(header, dict) and header.get("type") == "session"):
            raise ValueError(f"first line is not session header: {session_file}")
        header["cwd"] = str(cwd)
        dst.write((json.dumps(header, ensure_ascii=False) + "\n").encode("utf-8"))
        shutil.copyfileobj(src, dst)
    tmp.replace(session_file)


def _extract_text_blocks(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        chunks: List[str] = []
        for item in value:
            if isinstance(item, str):
                chunks.append(item)
                continue
            if isinstance(item, dict):
                if item.get("type") == "text" and isinstance(item.get("text"), str):
                    chunks.append(item["text"])
                    continue
                for k in ("text", "content", "value", "output"):
                    if k in item and isinstance(item.get(k), str):
                        chunks.append(item[k])
                        break
        return "".join(chunks)
    if isinstance(value, dict):
        for k in ("text", "content", "value", "output"):
            if k in value:
                return _extract_text_blocks(value[k])
    return ""


def extract_openclaw_session_messages(session_file: Path) -> List[Dict[str, Any]]:
    """Extract {role, content, line} from an OpenClaw session transcript JSONL.

    Supports both "simple" {role, content} lines and OpenClaw nested lines:
      {"type":"message","message":{"role":"...","content":[{"type":"text","text":"..."}]}}
    """
    messages: List[Dict[str, Any]] = []
    with session_file.open("rb") as fh:
        for line_number, raw in enumerate(fh, start=1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw.decode("utf-8"))
            except Exception:
                continue
            if not isinstance(obj, dict):
                continue

            role: Optional[str] = None
            content: str = ""

            if isinstance(obj.get("role"), str):
                role = obj.get("role")
                content = _extract_text_blocks(obj.get("content"))
            elif obj.get("type") == "message" and isinstance(obj.get("message"), dict):
                msg = obj["message"]
                if isinstance(msg.get("role"), str):
                    role = msg.get("role")
                content = _extract_text_blocks(msg.get("content"))

            if not role:
                continue
            role = role.strip()
            if role in ("system",):
                continue
            content = (content or "").strip()
            if not content:
                continue
            messages.append({"role": role, "content": content, "line": line_number})
    return messages

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


def load_processed_sample_ids(pred_path: Path) -> set[int]:
    """Load completed sample IDs from an existing predictions.jsonl (best-effort).

    Records written by this script include `ok` / `error`. When resuming, we
    treat failed records as *not processed* so they can be retried automatically.
    """
    if not pred_path.exists():
        return set()
    ids: set[int] = set()
    try:
        for ln in pred_path.read_text(encoding="utf-8").splitlines():
            ln = ln.strip()
            if not ln:
                continue
            try:
                obj = json.loads(ln)
            except Exception:
                continue
            if not isinstance(obj, dict):
                continue
            sid = _coerce_int(obj.get("id"))
            if sid is None:
                continue

            ok = obj.get("ok")
            if ok is False:
                continue
            err = obj.get("error")
            if isinstance(err, str) and err.strip():
                continue

            if sid is not None:
                ids.add(sid)
    except Exception:
        return ids
    return ids


def build_session_entry(
    *,
    session_id: str,
    session_file: Path,
    bench_key: str,
) -> Dict[str, Any]:
    # Keep this lightweight; updatedAt is primarily used for display/sorting in OpenClaw UIs.
    return {
        "sessionId": session_id,
        "updatedAt": now_ms(),
        "sessionFile": str(session_file),
        # Use SessionEntry.label/displayName (string fields) to tag benchmark sessions.
        # SessionEntry.origin is an object in OpenClaw; do not store a string there.
        "label": "bench:mrniah",
        "displayName": bench_key,
    }

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

def wipe_profile_local_memory(paths: StorePaths) -> Dict[str, Any]:
    """Wipe the OpenClaw profile's local memory store (best-effort).

    This prevents cross-case contamination when a profile uses local persistent memory.
    OpenClaw stores this under ~/.openclaw-<profile>/memory/ (e.g. main.sqlite).
    """
    start = time.time()
    memory_dir = paths.profile_dir / PROFILE_MEMORY_DIR
    existed = memory_dir.exists()
    deleted = 0
    err: Optional[str] = None

    if existed:
        try:
            for p in memory_dir.rglob("*"):
                if p.is_file():
                    deleted += 1
            shutil.rmtree(memory_dir)
        except Exception as e:
            err = str(e)

    try:
        memory_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        if err:
            err = err + "; " + str(e)
        else:
            err = str(e)

    return {
        "ok": err is None,
        "existed": existed,
        "deletedFiles": deleted,
        "error": err,
        "durationMs": int((time.time() - start) * 1000),
        "path": str(memory_dir),
    }

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--output-dir",
        default="",
        help="Directory containing MR-NIAH generated transcripts (expects <dir>/index.jsonl and <dir>/sessions/*.jsonl). Default: benchmark/MR-NIAH/output/",
    )
    ap.add_argument("--profile", default="mrniah_local")
    ap.add_argument("--agent", default="main")
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument(
        "--resume",
        type=int,
        default=-1,
        help="Resume from sample id (inclusive) by appending to results/predictions.jsonl instead of overwriting it.",
    )
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--reset", action="store_true", help="Prefix each question with /reset")
    group.add_argument(
        "--new",
        action="store_true",
        help="Prefix each question with /new",
    )
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
        "--results-dir",
        default="",
        help="Write outputs into this directory (default: benchmark/MR-NIAH/results).",
    )
    ap.add_argument(
        "--case-id",
        type=int,
        default=-1,
        help="Run a single sample id (useful for re-running failures).",
    )
    ap.set_defaults(continue_on_error=True)
    ap.add_argument(
        "--continue-on-error",
        dest="continue_on_error",
        action="store_true",
        help="Continue running when a case fails (default).",
    )
    ap.add_argument(
        "--fail-fast",
        dest="continue_on_error",
        action="store_false",
        help="Abort the batch on the first failed case.",
    )
    ap.add_argument(
        "--wipe-local-memory",
        action="store_true",
        help="Wipe the OpenClaw profile's local persistent memory before each case (~/.openclaw-<profile>/memory/*).",
    )
    ap.add_argument(
        "--import-sessions",
        action="store_true",
        help="If the profile has a mem9 plugin configured, import the session transcript into mem9 before each agent turn.",
    )
    ap.add_argument(
        "--mem9-provision-per-case",
        action="store_true",
        help="When --import-sessions is set, provision a fresh mem9 tenant for each case (one tenant per session-id).",
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
        "--mem9-load-method",
        choices=["import-session", "line-write"],
        default="line-write",
        help="How to load session history into mem9 when --import-sessions is set (default: line-write).",
    )
    ap.add_argument(
        "--mem9-line-write-sleep-ms",
        type=int,
        default=0,
        help="Sleep N ms after each v1alpha2 /memories write when --mem9-load-method=line-write (default 0).",
    )
    ap.add_argument(
        "--mem9-line-write-verify-timeout",
        type=float,
        default=20.0,
        help="Seconds to wait for v1alpha2 recall to observe the written session lines (default 20).",
    )
    ap.add_argument(
        "--mem9-line-write-verify-interval",
        type=float,
        default=0.5,
        help="Polling interval seconds for write verification when --mem9-load-method=line-write (default 0.5).",
    )
    ap.add_argument(
        "--gateway-port",
        type=int,
        default=0,
        help="Gateway port for --profile (required for --mem9-provision-per-case because the gateway is restarted per case).",
    )
    ap.add_argument(
        "--gateway-log",
        default="",
        help="Path to append gateway logs when --mem9-provision-per-case is enabled.",
    )
    ap.add_argument(
        "--mem9-import-timeout",
        type=int,
        default=3600,
        help="Timeout (seconds) for each mem9 /imports task (only when --import-sessions is set).",
    )
    ap.add_argument(
        "--mem9-import-poll-interval",
        type=float,
        default=1.0,
        help="Polling interval (seconds) for each mem9 /imports task.",
    )
    ap.add_argument(
        "--mem9-trace-limit",
        type=int,
        default=5,
        help="Max memories to print per trace section (default 5).",
    )
    ap.add_argument(
        "--mem9-trace-chars",
        type=int,
        default=220,
        help="Max chars per memory content preview (default 220).",
    )
    ap.add_argument(
        "--mem9-trace-query-chars",
        type=int,
        default=800,
        help="Max chars from question to use for recall preview query (default 800).",
    )
    args = ap.parse_args()

    output_dir = (args.output_dir or "").strip()
    if output_dir:
        p = Path(output_dir).expanduser()
        if not p.is_absolute():
            p = (HERE / p)
        output_path = p.resolve()
    else:
        output_path = OUTPUT
    index_path = output_path / "index.jsonl"
    sess_out = output_path / "sessions"

    if not index_path.exists():
        raise SystemExit(f"Missing {index_path}. Run mr-niah-transcript.py first (or pass --output-dir).")

    results_dir = (
        Path(args.results_dir).expanduser()
        if (args.results_dir or "").strip()
        else (HERE / "results")
    )
    raw_dir = results_dir / "raw"
    results_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)

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
        api_url = api_url.rstrip("/") if api_url else ""
        if not api_url:
            raise SystemExit(
                "ERROR: --import-sessions requires mem9 apiUrl.\n"
                "Provide --mem9-api-url, or set MEM9_BASE_URL."
            )
        if args.mem9_provision_per_case:
            mem9_cfg = (api_url, "")
        else:
            if api_url and tenant_id:
                mem9_cfg = (api_url, tenant_id)
            if mem9_cfg is None:
                raise SystemExit(
                    "ERROR: --import-sessions requires a mem9 apiUrl + tenantID (unless --mem9-provision-per-case is set).\n"
                    "Provide --mem9-api-url/--mem9-tenant-id, or set MEM9_BASE_URL/MEM9_TENANT_ID."
                )

    if args.mem9_provision_per_case:
        if not args.import_sessions:
            raise SystemExit("ERROR: --mem9-provision-per-case requires --import-sessions")
        if not args.gateway_port or args.gateway_port <= 0:
            raise SystemExit("ERROR: --mem9-provision-per-case requires --gateway-port")
        if not (args.gateway_log or "").strip():
            raise SystemExit("ERROR: --mem9-provision-per-case requires --gateway-log")
        if args.mem9_clear_memories:
            raise SystemExit("ERROR: --mem9-provision-per-case and --mem9-clear-memories are mutually exclusive")

    if args.case_id is not None and int(args.case_id) >= 0:
        # Single-case runs should ignore --limit so any id can be rerun.
        index_entries = load_index(index_path)
        wanted = int(args.case_id)
        index_entries = [e for e in index_entries if _coerce_int(e.get("id")) == wanted]
        if not index_entries:
            raise SystemExit(f"ERROR: --case-id={wanted} not found in {index_path}.")
    else:
        index_entries = load_index(index_path)[: args.limit]

    pred_path = results_dir / "predictions.jsonl"
    resume_from = int(args.resume) if args.resume is not None else -1
    processed_ids: set[int] = set()
    if resume_from >= 0 and args.case_id < 0:
        processed_ids = load_processed_sample_ids(pred_path)
        print(
            f"[resume] from={resume_from} already_done={len(processed_ids)} pred_path={pred_path}",
            flush=True,
        )
    elif args.case_id < 0:
        pred_path.write_text("", encoding="utf-8")

    gateway_proc: Optional[subprocess.Popen[str]] = None
    gateway_log_path = Path(args.gateway_log).expanduser() if (args.gateway_log or "").strip() else None
    if args.mem9_provision_per_case:
        atexit.register(lambda: _stop_process(gateway_proc))
    failures: List[Dict[str, Any]] = []
    for entry in index_entries:
        stage = "init"
        sample_id_int: Optional[int] = None
        session_id: Optional[str] = None
        question: Optional[str] = None
        answer: str = ""
        raw_meta: Optional[Path] = None
        try:
            sample_id = entry["id"]
            sample_id_int = _coerce_int(sample_id)
            if sample_id_int is None:
                raise RuntimeError(f"index entry missing int-like id: {entry!r}")

            if args.case_id < 0:
                if resume_from >= 0 and sample_id_int < resume_from:
                    continue
                if resume_from >= 0 and sample_id_int in processed_ids:
                    print(f"[{sample_id_int}] skipping=already_done", flush=True)
                    continue

            session_id = entry["session"]
            question = entry["question"]
            answer = entry.get("answer", "")
            if not isinstance(session_id, str) or not session_id:
                raise RuntimeError(f"index entry missing session: {entry!r}")
            if not isinstance(question, str) or not question:
                raise RuntimeError(f"index entry missing question: {entry!r}")

            raw_meta = raw_dir / f"{sample_id_int}-{session_id}{META_SUFFIX}"
            print(f"[{sample_id_int}] session={session_id} running=prepare", flush=True)

            stage = "wipe_local_memory"
            local_memory_wipe: Optional[Dict[str, Any]] = None
            if args.wipe_local_memory:
                # If a gateway is running from a previous case (mem9 per-case mode),
                # stop it before deleting the profile's SQLite files.
                _stop_process(gateway_proc)
                gateway_proc = None
                print(
                    f"[{sample_id_int}] session={session_id} running=wipe_local_memory",
                    flush=True,
                )
                local_memory_wipe = wipe_profile_local_memory(paths)
                if local_memory_wipe.get("ok") is not True:
                    raise RuntimeError(f"wipe local memory failed: {local_memory_wipe!r}")

            stage = "prepare_session"
            src = sess_out / f"{session_id}.jsonl"
            if not src.exists():
                raise FileNotFoundError(f"Missing generated session: {src}")

            dst = paths.sessions_dir / src.name
            shutil.copy2(src, dst)

            # Register into sessions.json under a unique bench key
            bench_key = f"bench:mrniah:{sample_id_int:04d}"
            try:
                rewrite_session_header_cwd(
                    session_file=dst,
                    cwd=resolve_profile_workspace_dir(
                        profile=args.profile,
                        agent=args.agent,
                        profile_dir=paths.profile_dir,
                    ),
                )
            except Exception as e:
                # Best-effort: still allow the run, but the session cwd may be less faithful.
                print(
                    f"[{sample_id_int}] session={session_id} WARNING: rewrite cwd failed: {e}",
                    file=sys.stderr,
                    flush=True,
                )

            bench_entry = build_session_entry(session_id=session_id, session_file=dst, bench_key=bench_key)
            upsert_store_entry(paths=paths, key=bench_key, entry=bench_entry)

            stage = "mem9"
            mem9_import: Optional[Dict[str, Any]] = None
            mem9_load_method: str = ""
            mem9_line_write: Optional[Dict[str, Any]] = None
            mem9_clear_pre: Optional[Dict[str, Any]] = None
            mem9_clear_post: Optional[Dict[str, Any]] = None
            mem9_recall_preview: Optional[Dict[str, Any]] = None
            mem9_tenant_id: Optional[str] = None
            if mem9_cfg is not None:
                api_url, tenant_id = mem9_cfg
                if args.mem9_provision_per_case:
                    stage = "mem9_provision"
                    print(f"[{sample_id_int}] session={session_id} running=mem9_provision", flush=True)
                    mem9_tenant_id = mem9_provision_tenant(api_url=api_url)
                    print(
                        f"[mem9] provisioned tenant={mem9_tenant_id} session={session_id}",
                        flush=True,
                    )
                    # Update OpenClaw profile config so the gateway uses this tenant for this case.
                    try:
                        # The OpenClaw mem9 plugin treats apiKey as the primary v1alpha2 credential.
                        # Keep tenantID in sync for backward compatibility / debugging, but always
                        # set apiKey so the plugin does not keep using a stale placeholder.
                        for key in (
                            "plugins.entries.mem9.config.apiKey",
                            "plugins.entries.mem9.config.tenantID",
                        ):
                            subprocess.run(
                                [
                                    "openclaw",
                                    "--profile",
                                    args.profile,
                                    "config",
                                    "set",
                                    key,
                                    mem9_tenant_id,
                                ],
                                check=True,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                text=True,
                            )
                    except subprocess.CalledProcessError as e:
                        msg = (e.stderr or e.stdout or "").strip()
                        raise RuntimeError(f"openclaw config set mem9 apiKey failed: {msg}") from e
                    # Restart gateway per case to ensure it picks up the new tenant config.
                    _stop_process(gateway_proc)
                    gateway_proc = None
                    assert gateway_log_path is not None
                    gateway_proc = _start_gateway(profile=args.profile, log_path=gateway_log_path)
                    _wait_gateway_healthy(port=int(args.gateway_port), timeout_s=60)
                    tenant_id = mem9_tenant_id

                if args.mem9_clear_memories:
                    stage = "mem9_clear_pre"
                    print(f"[{sample_id_int}] session={session_id} running=mem9_clear_pre", flush=True)
                    mem9_clear_pre = mem9_clear_memories(
                        api_url=api_url,
                        tenant_id=tenant_id,
                        agent_id=args.agent,
                    )
                    print(
                        f"[mem9] clear(pre) deleted={mem9_clear_pre.get('deleted')} remaining={mem9_clear_pre.get('remaining')} verified={mem9_clear_pre.get('verified')}",
                        flush=True,
                    )
                    if mem9_clear_pre.get("verified") is not True:
                        raise RuntimeError(f"mem9 clear(pre) did not verify empty: {mem9_clear_pre!r}")

                mem9_load_method = (args.mem9_load_method or "").strip() or "line-write"
                if mem9_load_method == "import-session":
                    stage = "mem9_import"
                    import_path = raw_dir / f"{sample_id_int}-{session_id}.import.session.jsonl"
                    shutil.copy2(dst, import_path)
                    print(f"[{sample_id_int}] session={session_id} running=mem9_import", flush=True)
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
                elif mem9_load_method == "line-write":
                    stage = "mem9_line_write"
                    start_s = time.time()
                    extracted = extract_openclaw_session_messages(dst)
                    total_lines = len(extracted)
                    posted = 0
                    failed = 0
                    first_errors: List[Dict[str, Any]] = []
                    sleep_ms = max(0, int(args.mem9_line_write_sleep_ms))
                    print(
                        f"[{sample_id_int}] session={session_id} running=mem9_line_write lines={total_lines}",
                        flush=True,
                    )
                    for rec in extracted:
                        role = rec.get("role")
                        content = rec.get("content")
                        line_no = rec.get("line")
                        if not isinstance(role, str) or not isinstance(content, str):
                            continue
                        try:
                            mem9v2_create_messages(
                                api_url=api_url,
                                api_key=tenant_id,
                                agent_id=args.agent,
                                session_id=session_id,
                                messages=[{"role": role, "content": content}],
                            )
                            posted += 1
                        except Exception as e:
                            failed += 1
                            if len(first_errors) < 5:
                                first_errors.append(
                                    {
                                        "line": line_no,
                                        "role": role,
                                        "error": str(e),
                                    }
                                )
                        if sleep_ms > 0:
                            time.sleep(sleep_ms / 1000.0)
                    mem9_line_write = {
                        "linesExtracted": total_lines,
                        "posted": posted,
                        "failed": failed,
                        "sleepMs": sleep_ms,
                        "durationMs": int((time.time() - start_s) * 1000),
                        "firstErrors": first_errors if first_errors else None,
                    }

                    # Best-effort verification: poll until session-scoped recall sees at least one hit.
                    stage = "mem9_line_write_verify"
                    verify_start_s = time.time()
                    attempts = 0
                    ok = False
                    preview_query = truncate_text(question, int(args.mem9_trace_query_chars))
                    timeout_s = max(0.0, float(args.mem9_line_write_verify_timeout))
                    interval_s = max(0.05, float(args.mem9_line_write_verify_interval))
                    last_summary: Optional[Dict[str, Any]] = None
                    while (time.time() - verify_start_s) < timeout_s:
                        attempts += 1
                        try:
                            page = mem9v2_search_memories(
                                api_url=api_url,
                                api_key=tenant_id,
                                agent_id=args.agent,
                                query=preview_query,
                                limit=1,
                                memory_type="session",
                                session_id=session_id,
                            )
                            last_summary = summarize_memories_page(page, int(args.mem9_trace_chars))
                            if int(last_summary.get("count") or 0) > 0:
                                ok = True
                                break
                        except Exception:
                            last_summary = None
                        time.sleep(interval_s)
                    mem9_line_write["verify"] = {
                        "ok": ok,
                        "attempts": attempts,
                        "durationMs": int((time.time() - verify_start_s) * 1000),
                        "summary": last_summary,
                    }
                else:
                    raise RuntimeError(f"unsupported mem9 load method: {mem9_load_method!r}")

                # Snapshot "writes" (best-effort): list memories after load (insights/pinned/session search behavior depends on q).
                try:
                    memories_page = mem9v2_search_memories(
                        api_url=api_url,
                        api_key=tenant_id,
                        agent_id=args.agent,
                        query="",
                        limit=200,
                    )
                    summary = summarize_memories_page(memories_page, int(args.mem9_trace_chars))
                    if mem9_import is not None:
                        mem9_import["memoriesAfterImport"] = summary
                    if mem9_line_write is not None:
                        mem9_line_write["memoriesAfterWrite"] = summary
                    print(
                        f"[mem9] memories after load count={summary.get('count')} total={summary.get('total')}",
                        flush=True,
                    )
                    limit = max(0, int(args.mem9_trace_limit))
                    chars = max(0, int(args.mem9_trace_chars))
                    sample = summary.get("sample")
                    if isinstance(sample, list) and sample and limit > 0:
                        print(f"[mem9] wrote(after load) sample={min(limit, len(sample))}", flush=True)
                        for rec in sample[:limit]:
                            if not isinstance(rec, dict):
                                continue
                            cid = rec.get("id")
                            ctype = rec.get("memory_type")
                            score = rec.get("score")
                            content_preview = preview_text(rec.get("content_preview"), chars) or ""
                            print(
                                f"[mem9] wrote id={cid} type={ctype} score={score} content={content_preview}",
                                flush=True,
                            )
                except Exception as e:
                    print(f"[mem9] WARNING: list memories after load failed: {e}", flush=True)
                    if mem9_import is not None:
                        mem9_import["memoriesAfterImportError"] = str(e)
                    if mem9_line_write is not None:
                        mem9_line_write["memoriesAfterWriteError"] = str(e)

                # Recall preview (v1alpha2): what a typical prompt query would retrieve.
                try:
                    preview_query = truncate_text(question, int(args.mem9_trace_query_chars))
                    limit = max(1, int(args.mem9_trace_limit))
                    recall_page = mem9v2_search_memories(
                        api_url=api_url,
                        api_key=tenant_id,
                        agent_id=args.agent,
                        query=preview_query,
                        limit=limit,
                    )
                    mem9_recall_preview = {
                        "query": preview_query,
                        "queryTruncated": bool(len(preview_query) != len(question)),
                        "page": summarize_memories_page(recall_page, int(args.mem9_trace_chars)),
                    }
                    page_summary = mem9_recall_preview["page"]
                    print(
                        f"[mem9] recall(pre) q_len={len(preview_query)} count={page_summary.get('count')} total={page_summary.get('total')}",
                        flush=True,
                    )
                    sample = page_summary.get("sample")
                    chars = max(0, int(args.mem9_trace_chars))
                    if isinstance(sample, list) and sample and limit > 0:
                        for rec in sample[:limit]:
                            if not isinstance(rec, dict):
                                continue
                            cid = rec.get("id")
                            ctype = rec.get("memory_type")
                            score = rec.get("score")
                            content_preview = preview_text(rec.get("content_preview"), chars) or ""
                            print(
                                f"[mem9] recall id={cid} type={ctype} score={score} content={content_preview}",
                                flush=True,
                            )
                except Exception as e:
                    print(f"[mem9] WARNING: recall preview failed: {e}", flush=True)
                    mem9_recall_preview = {
                        "query": truncate_text(question, int(args.mem9_trace_query_chars)),
                        "queryTruncated": True,
                        "error": str(e),
                    }

            stage = "openclaw"
            sent_message = f"/reset {question}" if args.reset else f"/new {question}" if args.new else question
            cmd = [
                "openclaw",
                "--profile",
                args.profile,
                "agent",
            ]
            maybe_add_agent_arg(cmd, args.agent)
            cmd.extend(["--session-id", session_id, "--message", sent_message, "--json"])
            if args.openclaw_timeout and args.openclaw_timeout > 0:
                cmd.extend(["--timeout", str(int(args.openclaw_timeout))])

            print(f"[{sample_id_int}] session={session_id} running=openclaw", flush=True)
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

            raw_out = raw_dir / f"{sample_id_int}-{session_id}.stdout.json"
            raw_err = raw_dir / f"{sample_id_int}-{session_id}.stderr.txt"
            raw_out.write_text(proc.stdout, encoding="utf-8")
            raw_err.write_text(proc.stderr, encoding="utf-8")

            parsed_obj: Optional[Any] = None
            if proc.returncode == 0:
                parsed_obj = parse_json_stdout(proc.stdout)
                if parsed_obj is None:
                    parsed_obj = parse_json_stdout(proc.stderr)

            store_after = load_store(paths)
            effective_session_id = extract_effective_session_id(parsed_obj) if parsed_obj is not None else None
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
            if compaction["compactionCountDelta"] > 0:
                compaction_event = extract_last_compaction_event(effective_session_file)
            compaction_occurred = isinstance(compaction_event, dict)
            compaction["compactionTriggered"] = bool(compaction_occurred) or bool(compaction["compactionCountDelta"])

            event_first_kept = (
                coerce_str(compaction_event.get("firstKeptEntryId"))
                if isinstance(compaction_event, dict)
                else None
            )
            event_summary = compaction_event.get("summary") if isinstance(compaction_event, dict) else None
            if not isinstance(event_summary, str):
                event_summary = None
            summary_truncated = False
            if event_summary is not None:
                event_summary, summary_truncated = maybe_truncate(
                    event_summary, int(args.compaction_summary_max_chars)
                )

            write_json(
                raw_meta,
                {
                    "id": sample_id_int,
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
                    "mem9TenantId": mem9_tenant_id,
                    "mem9LoadMethod": mem9_load_method or None,
                    "mem9Import": mem9_import,
                    "mem9LineWrite": mem9_line_write,
                    "mem9RecallPreview": mem9_recall_preview,
                    "mem9Clear": {
                        "pre": mem9_clear_pre,
                        "post": mem9_clear_post,
                    }
                    if mem9_cfg is not None and args.mem9_clear_memories
                    else None,
                    "localMemoryWipe": local_memory_wipe,
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
            ok = proc.returncode == 0
            error: Optional[str] = None
            error_stage: Optional[str] = None
            if proc.returncode == 0:
                if parsed_obj is not None:
                    prediction = safe_extract_text(parsed_obj)
            else:
                error_stage = "openclaw"
                error = f"openclaw agent exited with code {proc.returncode}"

            append_jsonl(
                pred_path,
                {
                    "id": sample_id_int,
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
                    "ok": ok,
                    "error": error,
                    "errorStage": error_stage,
                    "stdoutPath": str(raw_out),
                    "stderrPath": str(raw_err),
                    "metaPath": str(raw_meta),
                    "mem9TenantId": mem9_tenant_id,
                    "mem9LoadMethod": mem9_load_method or None,
                    "mem9ImportTaskId": mem9_import.get("taskId") if isinstance(mem9_import, dict) else None,
                    "mem9ImportStatus": mem9_import.get("status") if isinstance(mem9_import, dict) else None,
                    "mem9ImportVerified": mem9_import.get("verified") if isinstance(mem9_import, dict) else None,
                    "mem9ImportTotalChunks": mem9_import.get("totalChunks") if isinstance(mem9_import, dict) else None,
                    "mem9ImportDoneChunks": mem9_import.get("doneChunks") if isinstance(mem9_import, dict) else None,
                    "mem9LineWritePosted": mem9_line_write.get("posted") if isinstance(mem9_line_write, dict) else None,
                    "mem9LineWriteFailed": mem9_line_write.get("failed") if isinstance(mem9_line_write, dict) else None,
                    "compactionTriggered": compaction["compactionTriggered"],
                    "compactionCountDelta": compaction["compactionCountDelta"],
                    "compactionCountAfter": compaction["compactionCountAfter"],
                    "totalTokens": compaction["totalTokens"],
                    "totalTokensFresh": compaction["totalTokensFresh"],
                    "firstKeptEntryId": event_first_kept,
                    "compactionSummary": event_summary,
                    "compactionSummaryTruncated": summary_truncated if event_summary is not None else None,
                },
            )

            comp = "yes" if compaction["compactionTriggered"] else "no"
            status = "ok" if ok else "failed"
            print(
                f"[{sample_id_int}] session={session_id} status={status} pred_len={len(prediction)} compaction={comp}",
                flush=True,
            )

            # Post-clear is best-effort: do not let it abort the batch.
            if mem9_cfg is not None and args.mem9_clear_memories:
                try:
                    api_url, tenant_id = mem9_cfg
                    stage = "mem9_clear_post"
                    print(f"[{sample_id_int}] session={session_id} running=mem9_clear_post", flush=True)
                    mem9_clear_post = mem9_clear_memories(
                        api_url=api_url,
                        tenant_id=tenant_id,
                        agent_id=args.agent,
                    )
                    print(
                        f"[mem9] clear(post) deleted={mem9_clear_post.get('deleted')} remaining={mem9_clear_post.get('remaining')} verified={mem9_clear_post.get('verified')}",
                        flush=True,
                    )
                    if mem9_clear_post.get("verified") is not True:
                        print(
                            f"[mem9] WARNING: clear(post) did not verify empty (will rely on next pre-clear): {mem9_clear_post!r}",
                            flush=True,
                        )
                    try:
                        meta_obj = json.loads(raw_meta.read_text(encoding="utf-8"))
                        if isinstance(meta_obj, dict) and isinstance(meta_obj.get("mem9Clear"), dict):
                            meta_obj["mem9Clear"]["post"] = mem9_clear_post
                            raw_meta.write_text(
                                json.dumps(meta_obj, ensure_ascii=False, indent=2) + "\n",
                                encoding="utf-8",
                            )
                    except Exception:
                        pass
                except Exception as e:
                    print(f"[mem9] WARNING: clear(post) failed: {e}", flush=True)

            if not ok:
                failures.append({"id": sample_id_int, "session": session_id, "stage": error_stage, "error": error})

        except Exception as e:
            if sample_id_int is not None and session_id:
                if raw_meta is None:
                    raw_meta = raw_dir / f"{sample_id_int}-{session_id}{META_SUFFIX}"
                try:
                    write_json(
                        raw_meta,
                        {
                            "id": sample_id_int,
                            "session": session_id,
                            "profile": args.profile,
                            "agent": args.agent,
                            "errorStage": stage,
                            "error": str(e),
                        },
                    )
                except Exception:
                    pass
                try:
                    append_jsonl(
                        pred_path,
                        {
                            "id": sample_id_int,
                            "session": session_id,
                            "question": question,
                            "message": None,
                            "reset": bool(args.reset),
                            "new": bool(args.new),
                            "prediction": "",
                            "answer": answer,
                            "profile": args.profile,
                            "agent": args.agent,
                            "ok": False,
                            "error": str(e),
                            "errorStage": stage,
                            "metaPath": str(raw_meta),
                        },
                    )
                except Exception:
                    pass
            failures.append({"id": sample_id_int, "session": session_id, "stage": stage, "error": str(e)})
            print(f"[{sample_id_int}] session={session_id} status=failed stage={stage} err={e}", flush=True)
            if not args.continue_on_error:
                raise

    if failures:
        ids = sorted({f["id"] for f in failures if isinstance(f.get("id"), int)})
        preview = ids[:30]
        print(
            f"[summary] failed_cases={len(ids)} ids={preview}{'...' if len(ids) > len(preview) else ''}",
            flush=True,
        )
    print(f"Wrote predictions -> {pred_path}", flush=True)
    print(f"Raw outputs -> {raw_dir}", flush=True)
    print(f"Store -> {paths.store_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
