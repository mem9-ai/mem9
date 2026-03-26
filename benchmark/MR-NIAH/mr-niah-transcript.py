#!/usr/bin/env python3
"""Generate OpenClaw session transcripts from MR-NIAH JSON/JSONL data.

Process:
1. Read one or more MR-NIAH dumps (JSON array/object or JSONL). By default we
   look for `origin/<lang>/10240_tokens.jsonl` for both languages.
2. For each sample:
   - The last `user` turn becomes the **question**.
   - All turns before that last user message become the fixed **history**.
   - The sample's `label` is treated as the expected **answer**.
3. Emit one OpenClaw transcript per sample (history only) and an index file
   describing each session/question/answer tuple.

Outputs live under `output/`:
- `output/sessions/<session-uuid>.jsonl`
- `output/index.jsonl` (one JSON object per sample)

Usage:
  cd benchmark/MR-NIAH
  # Convert both languages' 10,240-token dumps (default behaviour)
  python3 mr-niah-transcript.py
  # Only process Chinese rows from a specific token bucket
  python3 mr-niah-transcript.py --lang chinese --tokens 2048
  # Point to explicit files (absolute, relative, or dataset paths)
  python3 mr-niah-transcript.py origin/chinese/10240_tokens.jsonl --limit 50
  python3 mr-niah-transcript.py --lang none --input data/english/20480_tokens.jsonl
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import shutil
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

try:  # optional dependency; falls back to zero-token counts when missing
    import tiktoken  # type: ignore
except Exception:  # pragma: no cover - defensive import
    tiktoken = None

HERE = Path(__file__).resolve().parent
ORIGIN = HERE / "origin"
OUTPUT = HERE / "output"
SESS_DIR = OUTPUT / "sessions"
INDEX_PATH = OUTPUT / "index.jsonl"

DEFAULT_PROVIDER = "import"
DEFAULT_API = "import"
DEFAULT_MODEL = "import"
# Match pi-ai StopReason semantics; "import" is not a stop reason.
DEFAULT_STOP_REASON = "stop"

LANG_CHOICES = ("chinese", "english")
TOKEN_BUCKETS = [
    "2048",
    "10240",
    "20480",
    "30720",
    "40960",
    "51200",
    "61440",
    "71680",
    "81920",
    "92160",
    "102400",
    "112640",
    "122880",
    "131072",
    "204800",
    "307200",
    "409600",
    "512000",
    "614400",
    "716800",
    "819200",
    "921600",
    "1024000",
]

def canonical_tokens(selection: set[str] | None) -> List[str]:
    if selection is None:
        return list(TOKEN_BUCKETS)
    return [token for token in TOKEN_BUCKETS if token in selection]


def parse_tokens(values: Sequence[str]) -> set[str] | None:
    if not values:
        return {"10240"}
    normalized: set[str] = set()
    for value in values:
        token = value.strip().lower()
        if not token:
            continue
        if token == "all":
            return None
        if token not in TOKEN_BUCKETS:
            raise SystemExit(
                f"Unsupported token bucket '{value}'. Valid choices: {', '.join(TOKEN_BUCKETS)} or 'all'."
            )
        normalized.add(token)
    return normalized if normalized else {"10240"}


def parse_langs(choice: str) -> List[str]:
    if choice == "all":
        return list(LANG_CHOICES)
    if choice == "none":
        return []
    if choice in LANG_CHOICES:
        return [choice]
    raise SystemExit(f"Unsupported language choice: {choice}")


def normalize_dataset_relative(value: str) -> Path:
    rel = Path(value.strip().lstrip("/"))
    if rel.parts and rel.parts[0] == "data":
        rel = rel.relative_to("data")
    return rel


def describe_path(path: Path) -> str:
    try:
        return path.relative_to(HERE).as_posix()
    except ValueError:
        return str(path)


def dedupe_paths(paths: Iterable[Path]) -> List[Path]:
    seen: set[Path] = set()
    result: List[Path] = []
    for p in paths:
        if p not in seen:
            result.append(p)
            seen.add(p)
    return result


def resolve_input_path(value: str) -> Path:
    candidate = Path(value).expanduser()
    if candidate.is_file():
        return candidate
    rel = normalize_dataset_relative(value)
    if rel:
        dataset_path = ORIGIN / rel
        if dataset_path.is_file():
            return dataset_path
    raise SystemExit(f"Input not found: {value}")


def build_auto_inputs(langs: Sequence[str], tokens: Sequence[str]) -> Tuple[List[Path], List[Path]]:
    selected: List[Path] = []
    missing: List[Path] = []
    for lang in langs:
        for token in tokens:
            rel = Path(lang) / f"{token}_tokens.jsonl"
            target = ORIGIN / rel
            fallback = ORIGIN / f"{token}_tokens.jsonl"
            if target.is_file():
                selected.append(target)
            elif fallback.is_file():
                selected.append(fallback)
            else:
                missing.append(target)
    return dedupe_paths(selected), missing


def gather_inputs(positionals: Sequence[str], extras: Sequence[str], lang_choice: str, token_args: Sequence[str]) -> List[Path]:
    explicit = [resolve_input_path(p) for p in list(positionals) + list(extras)]
    if explicit:
        return dedupe_paths(explicit)

    langs = parse_langs(lang_choice)
    if not langs:
        raise SystemExit("No input files specified. Provide --input/positional files or choose --lang/--tokens.")

    token_selection = parse_tokens(token_args)
    tokens = canonical_tokens(token_selection)
    selected, missing = build_auto_inputs(langs, tokens)
    if not selected:
        message = "No matching files found under origin/. Run fetch_data.py first or adjust --lang/--tokens."
        if missing:
            missing_lines = "\n".join(f"  - {describe_path(p)}" for p in missing)
            message += f"\nMissing expected files:\n{missing_lines}"
        raise SystemExit(message)
    if missing:
        print("WARNING: skipping missing files:", file=sys.stderr)
        for miss in missing:
            print(f"  - {describe_path(miss)}", file=sys.stderr)
    return selected



def _build_token_counter():
    def _heuristic(text: str) -> int:
        # pi-coding-agent uses a conservative chars/4 heuristic for compaction.
        # Use it as a fallback when tiktoken isn't available.
        return (len(text) + 3) // 4

    if tiktoken is None:
        print(
            "WARNING: tiktoken not available; falling back to chars/4 token estimates. "
            "Install tiktoken for more accurate counts.",
            file=sys.stderr,
        )
        return _heuristic

    encoding = None
    try:
        encoding = tiktoken.get_encoding("cl100k_base")
    except Exception:
        try:
            encoding = tiktoken.encoding_for_model("gpt-4o-mini")  # pragma: no cover - fallback
        except Exception:
            encoding = None

    if encoding is None:
        print(
            "WARNING: failed to initialize tiktoken; falling back to chars/4 token estimates.",
            file=sys.stderr,
        )
        return _heuristic

    def _count(text: str) -> int:
        try:
            return len(encoding.encode(text))
        except Exception:
            return _heuristic(text)

    return _count


count_tokens = _build_token_counter()


def make_usage_snapshot(*, input_tokens: int, output_tokens: int) -> Dict[str, Any]:
    usage = {
        "input": int(max(0, input_tokens)),
        "output": int(max(0, output_tokens)),
        "cacheRead": 0,
        "cacheWrite": 0,
        "totalTokens": int(max(0, input_tokens) + max(0, output_tokens)),
        "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0,
            "total": 0,
        },
    }
    return usage


def isoformat_utc(dt: _dt.datetime) -> str:
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def utc_now_iso() -> str:
    return isoformat_utc(_dt.datetime.now(tz=_dt.timezone.utc))


def short_hex(counter: int, seed: str) -> str:
    """Deterministic 8-hex id for parentId chaining."""
    # uuid4().hex is 32 chars; take first 8 but mix in order to stay stable.
    return uuid.uuid5(uuid.NAMESPACE_URL, f"{seed}:{counter}").hex[:8]


def make_session_header(session_id: str, ts: str) -> Dict[str, Any]:
    return {"type": "session", "version": 3, "id": session_id, "timestamp": ts, "cwd": "/"}


def make_message_entry(
    entry_id: str,
    parent_id: Optional[str],
    ts_iso: str,
    ts_ms: int,
    role: str,
    text: str,
    *,
    usage_mode: str,
    prompt_tokens: int,
) -> Dict[str, Any]:
    token_count = count_tokens(text)

    base: Dict[str, Any] = {
        "type": "message",
        "id": entry_id,
        "parentId": parent_id,
        "timestamp": ts_iso,
    }

    if role == "user":
        # pi-ai user messages support either a plain string or a [{type:"text"}] list.
        # Keep the block form for better compatibility with transcript consumers.
        base["message"] = {
            "role": "user",
            "content": [{"type": "text", "text": text}],
            "timestamp": int(ts_ms),
        }
        # Real OpenClaw transcripts generally only have usage snapshots on assistant messages
        # (LLM calls), so per-call mode leaves user entries without usage.
        if usage_mode == "per-message":
            base["usage"] = make_usage_snapshot(input_tokens=token_count, output_tokens=0)
        return base

    if role == "assistant":
        if usage_mode == "per-call":
            usage = make_usage_snapshot(input_tokens=prompt_tokens, output_tokens=token_count)
        elif usage_mode == "per-message":
            usage = make_usage_snapshot(input_tokens=0, output_tokens=token_count)
        else:
            raise ValueError(f"unsupported usage_mode: {usage_mode}")

        base["message"] = {
            "role": "assistant",
            "content": [{"type": "text", "text": text}],
            "api": DEFAULT_API,
            "provider": DEFAULT_PROVIDER,
            "model": DEFAULT_MODEL,
            "usage": usage,
            "stopReason": DEFAULT_STOP_REASON,
            "timestamp": int(ts_ms),
        }
        return base

    raise ValueError(f"unsupported role: {role}")


def read_transcript(path: Path) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                entries.append(json.loads(stripped))
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid JSON in {path} at line {line_no}") from exc
    return entries


def clean_output() -> None:
    """Remove everything under output/ so we always start fresh."""
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    SESS_DIR.mkdir(parents=True, exist_ok=True)


def iter_samples(path: Path) -> Iterable[Tuple[int, Dict[str, Any]]]:
    """Yield (line_no, sample) supporting JSON array/object or JSONL.

    Smoke test (JSONL):
        $ cd benchmark/MR-NIAH
        $ python3 mr-niah-transcript.py --limit 2
        # Expect 2 session files and 2 index rows.
    """

    text = path.read_text(encoding="utf-8")
    stripped = text.strip()
    if not stripped:
        return

    nonempty_lines = [
        (line_no, line.strip())
        for line_no, line in enumerate(text.splitlines(), start=1)
        if line.strip()
    ]

    jsonl_rows: Optional[List[Tuple[int, Dict[str, Any]]]] = None
    jsonl_failure: Optional[Tuple[int, json.JSONDecodeError]] = None
    if len(nonempty_lines) > 1:
        jsonl_rows = []
        for line_no, line in nonempty_lines:
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                jsonl_failure = (line_no, exc)
                jsonl_rows = None
                break
            jsonl_rows.append((line_no, obj))  # type: ignore[arg-type]

    if jsonl_rows is not None:
        for row in jsonl_rows:
            yield row
        return

    try:
        obj = json.loads(stripped)
    except json.JSONDecodeError as exc:
        if jsonl_failure:
            line_no, _ = jsonl_failure
            raise ValueError(f"invalid JSON in {path} at line {line_no}") from exc
        raise ValueError(f"invalid JSON in {path}") from exc

    if isinstance(obj, list):
        for idx, item in enumerate(obj, start=1):
            if isinstance(item, dict):
                yield idx, item
            else:
                yield idx, {"value": item}
        return

    if isinstance(obj, dict):
        data = obj.get("data")
        if isinstance(data, list):
            for idx, item in enumerate(data, start=1):
                if isinstance(item, dict):
                    yield idx, item
                else:
                    yield idx, {"value": item}
            return
        yield 1, obj
        return


def normalize_turn(m: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    role = m.get("role") or m.get("from")
    content = m.get("content") or m.get("value") or m.get("text")

    if role == "human":
        role = "user"
    if role in ("gpt", "bot"):
        role = "assistant"

    if role not in ("user", "assistant"):
        return None

    if isinstance(content, list):
        content = json.dumps(content, ensure_ascii=False)
    if not isinstance(content, str):
        return None

    return role, content


def split_history_question(messages: List[Dict[str, Any]]) -> Tuple[List[Tuple[str, str]], str]:
    turns: List[Tuple[str, str]] = []
    for m in messages:
        if isinstance(m, dict):
            t = normalize_turn(m)
            if t:
                turns.append(t)

    if not turns:
        raise ValueError("no valid turns")

    # find last user index
    last_user_idx = None
    for i in range(len(turns) - 1, -1, -1):
        if turns[i][0] == "user":
            last_user_idx = i
            break
    if last_user_idx is None:
        raise ValueError("no user turn found")

    question = turns[last_user_idx][1]
    history = turns[:last_user_idx]  # EXCLUDES final user question
    return history, question


def validate_transcript(lines: List[Dict[str, Any]]) -> None:
    if not lines or lines[0].get("type") != "session":
        raise ValueError("first line must be session header")

    prev = None
    seen = set()
    for i, entry in enumerate(lines[1:], start=2):
        if entry.get("type") != "message":
            raise ValueError(f"bad entry type at line {i}: {entry.get('type')}")
        eid = entry.get("id")
        if not isinstance(eid, str) or len(eid) != 8:
            raise ValueError(f"bad entry id at line {i}: {eid!r}")
        if eid in seen:
            raise ValueError(f"duplicate entry id at line {i}: {eid}")
        seen.add(eid)

        pid = entry.get("parentId")
        if prev is None:
            if pid is not None:
                raise ValueError("first message parentId must be null")
        else:
            if pid != prev:
                raise ValueError(f"parentId chain broken at line {i}: {pid} != {prev}")

        msg = entry.get("message")
        if not isinstance(msg, dict):
            raise ValueError(f"missing message at line {i}")
        role = msg.get("role")
        if role not in ("user", "assistant"):
            raise ValueError(f"bad role at line {i}: {role!r}")

        ts_ms = msg.get("timestamp")
        if not isinstance(ts_ms, int):
            raise ValueError(f"message.timestamp must be int(ms) at line {i}")

        if role == "user":
            # pi-ai user message: { role, content: string, timestamp:number }
            content = msg.get("content")
            if isinstance(content, str):
                if not content:
                    raise ValueError(f"user content missing/invalid at line {i}")
            elif isinstance(content, list):
                if not content:
                    raise ValueError(f"user content missing/invalid at line {i}")
                for chunk in content:
                    if not isinstance(chunk, dict):
                        raise ValueError(f"user content chunk invalid at line {i}")
                    if chunk.get("type") != "text" or not isinstance(chunk.get("text"), str):
                        raise ValueError(f"user content chunk missing text at line {i}")
            else:
                raise ValueError(f"user content missing/invalid at line {i}")

            # Optional token snapshot may be stored on the entry (not on the user message).
            usage = entry.get("usage")
            if usage is not None:
                if not isinstance(usage, dict):
                    raise ValueError(f"entry.usage invalid at line {i}")
                if "totalTokens" not in usage or not isinstance(usage["totalTokens"], int):
                    raise ValueError(f"entry.usage.totalTokens missing/invalid at line {i}")
            prev = eid
            continue

        # assistant
        if not isinstance(msg.get("content"), list) or not msg["content"]:
            raise ValueError(f"assistant content missing/invalid at line {i}")
        for chunk in msg["content"]:
            if not isinstance(chunk, dict):
                raise ValueError(f"assistant content chunk invalid at line {i}")
            if chunk.get("type") != "text" or not isinstance(chunk.get("text"), str):
                raise ValueError(f"assistant content chunk missing text at line {i}")

        for key in ("api", "provider", "model", "stopReason"):
            if not isinstance(msg.get(key), str):
                raise ValueError(f"missing assistant {key} at line {i}")

        usage = msg.get("usage")
        if not isinstance(usage, dict):
            raise ValueError(f"assistant usage missing/invalid at line {i}")
        for field in ("input", "output", "cacheRead", "cacheWrite"):
            if field not in usage:
                raise ValueError(f"assistant usage missing {field} at line {i}")
        if "totalTokens" not in usage or not isinstance(usage["totalTokens"], int):
            raise ValueError(f"assistant usage.totalTokens missing/invalid at line {i}")

        cost = usage.get("cost")
        if not isinstance(cost, dict):
            raise ValueError(f"assistant usage.cost missing/invalid at line {i}")
        for field in ("input", "output", "cacheRead", "cacheWrite", "total"):
            if field not in cost:
                raise ValueError(f"assistant usage.cost missing {field} at line {i}")

        prev = eid


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "inputs",
        nargs="*",
        metavar="INPUT",
        help="Explicit MR-NIAH JSON/JSONL files (repeatable).",
    )
    ap.add_argument(
        "--input",
        dest="extra_inputs",
        action="append",
        default=[],
        help="Additional input file path (repeatable). Accepts absolute paths or dataset-relative values such as data/chinese/10240_tokens.jsonl.",
    )
    ap.add_argument(
        "--lang",
        choices=["chinese", "english", "all", "none"],
        default="all",
        help="Auto-select files from origin/<lang> when no explicit inputs are provided (default: all).",
    )
    ap.add_argument(
        "--tokens",
        nargs="+",
        default=["all"],
        help="Token buckets to load (e.g. 10240 20480 or 'all').",
    )
    ap.add_argument("--limit", type=int, default=0, help="Stop after N samples (0 = all)")
    ap.add_argument(
        "--output-dir",
        default="",
        help="Write outputs under this directory (expects <dir>/sessions/ and <dir>/index.jsonl). Default: benchmark/MR-NIAH/output/",
    )
    ap.add_argument(
        "--usage-mode",
        choices=["per-call", "per-message"],
        default="per-call",
        help="Usage snapshot style: per-call mimics real OpenClaw (assistant usage grows with context); per-message is legacy/import style.",
    )
    ap.add_argument(
        "--base-prompt-tokens",
        type=int,
        default=0,
        help="Fixed prompt token baseline added to every assistant call usage.input (approx system prompt + tooling).",
    )
    ap.add_argument(
        "--message-overhead-tokens",
        type=int,
        default=0,
        help="Extra tokens to add per message when estimating call prompt size (approx chat serialization overhead).",
    )
    args = ap.parse_args()

    output_dir = (args.output_dir or "").strip()
    if output_dir:
        p = Path(output_dir).expanduser()
        if not p.is_absolute():
            p = (HERE / p)
        out_path = p.resolve()
        global OUTPUT, SESS_DIR, INDEX_PATH
        OUTPUT = out_path
        SESS_DIR = OUTPUT / "sessions"
        INDEX_PATH = OUTPUT / "index.jsonl"

    inputs = gather_inputs(args.inputs, args.extra_inputs, args.lang, args.tokens)

    clean_output()

    limit = args.limit if args.limit and args.limit > 0 else None
    count = 0

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)

    with INDEX_PATH.open("w", encoding="utf-8") as index_file:
        for inp in inputs:
            source_label = describe_path(inp)
            print(f"[input] {source_label}")
            for line_no, obj in iter_samples(inp):
                if not isinstance(obj, dict):
                    continue

                messages = obj.get("messages")
                if not isinstance(messages, list):
                    continue

                label = obj.get("label")
                if not isinstance(label, str):
                    label = json.dumps(label, ensure_ascii=False)

                history, question = split_history_question(messages)

                session_id = str(uuid.uuid4())
                salt = session_id
                base_dt = _dt.datetime.now(tz=_dt.timezone.utc)
                entries: List[Dict[str, Any]] = [make_session_header(session_id, isoformat_utc(base_dt))]

                parent = None
                current_dt = base_dt
                # Best-effort: approximate prompt growth by summing tokenized message text.
                # This yields monotonically increasing assistant usage.totalTokens until compaction.
                base_prompt_tokens = max(0, int(args.base_prompt_tokens))
                overhead_tokens = max(0, int(args.message_overhead_tokens))
                context_tokens = 0
                for idx, (role, text_value) in enumerate(history, start=1):
                    current_dt = current_dt + _dt.timedelta(seconds=1)
                    eid = short_hex(idx, salt)
                    ts_iso = isoformat_utc(current_dt)
                    ts_ms = int(current_dt.timestamp() * 1000)
                    prompt_tokens = base_prompt_tokens + context_tokens
                    entries.append(
                        make_message_entry(
                            eid,
                            parent,
                            ts_iso,
                            ts_ms,
                            role,
                            text_value,
                            usage_mode=str(args.usage_mode),
                            prompt_tokens=prompt_tokens,
                        )
                    )
                    parent = eid
                    context_tokens += count_tokens(text_value) + overhead_tokens

                validate_transcript(entries)

                out_path = SESS_DIR / f"{session_id}.jsonl"
                with out_path.open("w", encoding="utf-8") as f:
                    for e in entries:
                        f.write(json.dumps(e, ensure_ascii=False) + "\n")

                written_entries = read_transcript(out_path)
                validate_transcript(written_entries)

                index_file.write(
                    json.dumps(
                        {
                            "id": count,
                            "line": line_no,
                            "sourceFile": source_label,
                            "sourceLine": line_no,
                            "session": session_id,
                            "sessionFile": f"sessions/{session_id}.jsonl",
                            "question": question,
                            "answer": label,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )

                count += 1
                if limit is not None and count >= limit:
                    break
            if limit is not None and count >= limit:
                break

    if count == 0:
        print("WARNING: no sessions generated (check input format)", file=sys.stderr)

    print(f"Generated {count} sessions -> {SESS_DIR}")
    print(f"Index -> {INDEX_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
