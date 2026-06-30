from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any


_VAR_RE = re.compile(r"\$\{([A-Z0-9_]+)(:-([^}]*))?\}")


def _expand_env(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        name = match.group(1)
        default = match.group(3)
        value = os.getenv(name)
        if value:
            return value
        if default is not None:
            return default
        return ""

    return _VAR_RE.sub(repl, text)


def load_manifest(path: str | Path) -> dict[str, Any]:
    manifest_path = Path(path)
    expanded = _expand_env(manifest_path.read_text(encoding="utf-8"))
    data = json.loads(expanded)
    if not isinstance(data, dict):
        raise ValueError(f"manifest must decode to an object: {manifest_path}")
    return data


def resolve_path(value: str) -> str:
    return str(Path(value).expanduser())
