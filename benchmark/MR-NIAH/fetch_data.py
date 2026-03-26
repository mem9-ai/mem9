#!/usr/bin/env python3
"""Fetch MR-NIAH dataset files from MiniMax's GitHub mirror.

Examples:
  # Full mirror (both languages, all buckets)
  python3 fetch_data.py

  # Only download the Chinese 10,240-token subset
  python3 fetch_data.py --lang chinese --tokens 10240

  # Fetch explicit files regardless of language selection
  python3 fetch_data.py --lang none --paths data/chinese/2048_tokens.jsonl english/10240_tokens.jsonl

  # Preview what would be downloaded
  python3 fetch_data.py --lang english --tokens 2048 10240 --dry-run
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Iterable, List, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
DEFAULT_DEST = ROOT / "origin"
DEFAULT_REVISION = "main"

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

LANGUAGES = ("chinese", "english")
FILE_TEMPLATE = [f"data/{{lang}}/{token}_tokens.jsonl" for token in TOKEN_BUCKETS]
MANIFEST = {lang: [entry.format(lang=lang) for entry in FILE_TEMPLATE] for lang in LANGUAGES}
ALL_TOKENS = TOKEN_BUCKETS


def manifest_paths(langs: Sequence[str]) -> List[str]:
    selected: List[str] = []
    seen: set[str] = set()
    for lang in langs:
        for path in MANIFEST.get(lang, []):
            if path not in seen:
                selected.append(path)
                seen.add(path)
    return selected


def normalize_dataset_path(path: str) -> str:
    norm = path.strip()
    if not norm:
        return ""
    rel = Path(norm.lstrip("/"))
    if any(part == ".." for part in rel.parts):
        raise SystemExit(f"Refusing to traverse '..' in dataset path: {path}")
    if rel.parts and rel.parts[0] != "data":
        rel = Path("data") / rel
    return rel.as_posix()


def dedupe(paths: Iterable[str]) -> List[str]:
    seen: set[str] = set()
    result: List[str] = []
    for path in paths:
        if path and path not in seen:
            result.append(path)
            seen.add(path)
    return result


def collect_paths(langs: Sequence[str], extra: Sequence[str], allowed_tokens: set[str] | None) -> List[str]:
    base = filter_by_tokens(manifest_paths(langs), allowed_tokens)
    normalized_extra: List[str] = []
    for raw in extra:
        norm = normalize_dataset_path(raw)
        if norm:
            normalized_extra.append(norm)
    return dedupe(base + normalized_extra)


def apply_include_filter(paths: Iterable[str], include: Sequence[str]) -> List[str]:
    if not include:
        return list(paths)
    filtered = []
    for path in paths:
        if any(fnmatch.fnmatch(path, pattern) for pattern in include):
            filtered.append(path)
    return filtered


def relative_dest(path: str) -> Path:
    rel = Path(path)
    if rel.parts and rel.parts[0] == "data":
        rel = rel.relative_to("data")
    return rel


def display_path(dest_root: Path, target: Path) -> str:
    try:
        return target.relative_to(dest_root).as_posix()
    except ValueError:
        return str(target)


def token_from_path(path: str) -> str:
    return Path(path).name.split("_", 1)[0]


def filter_by_tokens(paths: Iterable[str], allowed: set[str] | None) -> List[str]:
    if allowed is None:
        return list(paths)
    return [path for path in paths if token_from_path(path) in allowed]


def parse_tokens(values: Sequence[str]) -> set[str] | None:
    if not values:
        return None
    normalized: set[str] = set()
    for value in values:
        token = value.strip().lower()
        if not token:
            continue
        if token == "all":
            return None
        if token not in ALL_TOKENS:
            raise SystemExit(
                f"Unsupported token bucket '{value}'. Valid choices: {', '.join(ALL_TOKENS)} or 'all'."
            )
        normalized.add(token)
    return normalized if normalized else None


def github_url(path: str, revision: str) -> str:
    rel = Path("evaluation") / "MR-NIAH" / path
    return f"https://raw.githubusercontent.com/MiniMax-AI/MiniMax-01/{revision}/{rel.as_posix()}"


def sha256_for_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(8192), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def download_file(url: str, dest: Path, force: bool, label: str) -> bool:
    if dest.exists() and not force:
        print(f"  - Skipping {label} (already exists)")
        return False

    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  - Downloading {url} → {label}")
    try:
        with urlopen(url) as resp, dest.open("wb") as fh:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                fh.write(chunk)
    except HTTPError as exc:
        dest.unlink(missing_ok=True)
        raise RuntimeError(f"HTTP error {exc.code} for {url}") from exc
    except URLError as exc:
        dest.unlink(missing_ok=True)
        raise RuntimeError(f"Network error for {url}: {exc.reason}") from exc
    return True


def list_manifest() -> None:
    data = {lang: paths for lang, paths in MANIFEST.items()}
    print(json.dumps(data, indent=2))


def invalid_jsonl_lines(path: Path) -> List[int]:
    invalid: List[int] = []
    with path.open("rb") as fh:
        for line_number, raw_line in enumerate(fh, start=1):
            try:
                line = raw_line.decode("utf-8")
            except UnicodeDecodeError:
                invalid.append(line_number)
                continue

            try:
                json.loads(line)
            except Exception:
                invalid.append(line_number)
    return invalid


def sanitize_jsonl_file(path: Path) -> List[int]:
    invalid_lines = invalid_jsonl_lines(path)
    if not invalid_lines:
        return []

    invalid_lookup = set(invalid_lines)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "wb",
            delete=False,
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
        ) as tmp:
            tmp_path = Path(tmp.name)

        with path.open("rb") as src, tmp_path.open("wb") as dst:
            for line_number, raw_line in enumerate(src, start=1):
                if line_number in invalid_lookup:
                    continue
                dst.write(raw_line)
        os.replace(tmp_path, path)
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)

    return invalid_lines


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download MR-NIAH dataset files")
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST, help="Destination directory (default: origin/)")
    parser.add_argument(
        "--lang",
        choices=["chinese", "english", "all", "none"],
        default="all",
        help="Which language subset to include from the built-in manifest",
    )
    parser.add_argument("--paths", nargs="*", default=[], help="Additional dataset-relative paths (e.g. data/chinese/10240_tokens.jsonl)")
    parser.add_argument(
        "--include",
        nargs="*",
        default=[],
        help="Glob filters applied to the resulting path list (e.g. '*10240*')",
    )
    parser.add_argument("--tokens", nargs="+", default=["all"], help="Token buckets to fetch (e.g. 10240 or 'all')")
    parser.add_argument("--revision", default=DEFAULT_REVISION, help="Git revision/branch (default: main)")
    parser.add_argument("--force", action="store_true", help="Redownload files even if they already exist")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without downloading")
    parser.add_argument("--list", action="store_true", help="Print the built-in manifest and exit")
    parser.add_argument("--checksum", action="store_true", help="After download, print SHA-256 digests")
    parser.add_argument(
        "--sanitize-jsonl",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="After download, remove invalid JSON lines from .jsonl files (default: on)",
    )
    parser.add_argument(
        "--sanitize-existing",
        action="store_true",
        help="Sanitize even when a file is skipped because it already exists",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.list:
        list_manifest()
        return 0

    if args.lang == "all":
        langs = list(MANIFEST.keys())
    elif args.lang == "none":
        langs = []
    else:
        langs = [args.lang]

    allowed_tokens = parse_tokens(args.tokens)
    paths = collect_paths(langs, args.paths, allowed_tokens)
    paths = apply_include_filter(paths, args.include)

    if not paths:
        print("No files matched the current selection.", file=sys.stderr)
        return 1

    dest_root = args.dest.resolve()
    print(f"Destination: {dest_root}")
    print(f"Source:      github (revision {args.revision})")
    print(f"Files:       {len(paths)}")

    if args.dry_run:
        for path in paths:
            url = github_url(path, args.revision)
            target = dest_root / relative_dest(path)
            label = display_path(dest_root, target)
            print(f"DRY-RUN  {url} → {label}")
        return 0

    dest_root.mkdir(parents=True, exist_ok=True)

    for path in paths:
        url = github_url(path, args.revision)
        target = dest_root / relative_dest(path)
        label = display_path(dest_root, target)
        try:
            downloaded = download_file(url, target, args.force, label)
        except RuntimeError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2

        if (
            args.sanitize_jsonl
            and target.suffix == ".jsonl"
            and target.exists()
            and (downloaded or args.sanitize_existing)
        ):
            invalid_lines = sanitize_jsonl_file(target)
            for line_number in invalid_lines:
                print(f"    removed invalid json: {label}:{line_number}")
        if args.checksum:
            digest = sha256_for_file(target)
            print(f"    sha256({label}) = {digest}")

    print("All requested files downloaded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
