---
title: hermes-plugin — Hermes Agent memory integration
---

## Overview

Python plugin for Hermes Agent providing persistent cloud memory via mem9 REST API.

This subtree is self-contained: backend client, tool definitions, session hooks, and types all live here.

## Commands

```bash
# Install for development
cd hermes-plugin && pip install -e ".[dev]"

# Run tests
cd hermes-plugin && pytest tests/ -v

# Type checking
cd hermes-plugin && mypy mem9_hermes/

# Linting
cd hermes-plugin && ruff check mem9_hermes/

# Build package
cd hermes-plugin && pip install build && python -m build
```

## Where to look

| Task | File |
|------|------|
| Package entry point | `mem9_hermes/__init__.py` |
| HTTP API client | `mem9_hermes/server_backend.py` |
| Tool definitions | `mem9_hermes/tools.py` |
| Session hooks | `mem9_hermes/hooks.py` |
| Type definitions | `mem9_hermes/types.py` |
| Build config | `pyproject.toml` |
| Dependencies | `requirements.txt` |
| Tests | `tests/` |

## Local conventions

- Python 3.10+ with type hints
- Async/await for all I/O operations
- Pydantic v2 for data validation
- httpx for async HTTP requests
- JSON return format: `{"ok": bool, "data"?: ..., "error"?: ...}`
- Logging via `logging` module with `[mem9]` prefix

## Architecture

```
┌─────────────────┐
│  Hermes Agent   │
└────────┬────────┘
         │ tool calls
         ▼
┌─────────────────────────────────┐
│  mem9_hermes                    │
│  ┌─────────────────────────┐    │
│  │  tools.py               │    │
│  │  - memory_store         │    │
│  │  - memory_search        │    │
│  │  - memory_get           │    │
│  │  - memory_update        │    │
│  │  - memory_delete        │    │
│  └───────────┬─────────────┘    │
│              │                  │
│  ┌───────────▼─────────────┐    │
│  │  server_backend.py      │    │
│  │  - ServerBackend        │    │
│  │  - MemoryBackend        │    │
│  └───────────┬─────────────┘    │
└──────────────┼──────────────────┘
               │ HTTP (v1alpha2)
               ▼
┌─────────────────────────────────┐
│  mem9 REST API                  │
│  /v1alpha2/mem9s/memories       │
└─────────────────────────────────┘
```

## Configuration

Environment variables (all optional except `MEM9_API_KEY`):

| Variable | Default | Description |
|----------|---------|-------------|
| `MEM9_API_URL` | `https://api.mem9.ai` | API endpoint |
| `MEM9_API_KEY` | **required** | Tenant UUID |
| `MEM9_AGENT_ID` | `hermes` | Agent identifier |
| `MEM9_DEFAULT_TIMEOUT_MS` | `8000` | Default timeout |
| `MEM9_SEARCH_TIMEOUT_MS` | `15000` | Search timeout |
| `MEM9_MAX_INGEST_BYTES` | `50000` | Max ingest size |
| `MEM9_MAX_INGEST_MESSAGES` | `50` | Max messages |

Load config via:
```python
from mem9_hermes import load_config_from_env
config = load_config_from_env()
```

## API Endpoints

All requests use v1alpha2:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1alpha1/mem9s` | Provision tenant (no auth) |
| POST | `/v1alpha2/mem9s/memories` | Store/ingest memory |
| GET | `/v1alpha2/mem9s/memories` | Search memories |
| GET | `/v1alpha2/mem9s/memories/{id}` | Get memory |
| PUT | `/v1alpha2/mem9s/memories/{id}` | Update memory |
| DELETE | `/v1alpha2/mem9s/memories/{id}` | Delete memory |

Headers:
- `Content-Type: application/json`
- `X-API-Key: <tenant-uuid>`
- `X-Mnemo-Agent-Id: <agent-id>`

## Error Handling

- `get()` / `update()` / `remove()` return `None`/`False` for 404
- Unexpected HTTP errors raise exceptions
- Tool handlers catch exceptions and return `{"ok": False, "error": "..."}`

## Testing

Test structure:
- `tests/test_server_backend.py` - Backend HTTP client tests
- `tests/test_tools.py` - Tool handler tests
- `tests/test_hooks.py` - Session hook tests
- `tests/test_types.py` - Pydantic model tests

Run with:
```bash
pytest tests/ -v --cov=mem9_hermes
```

Mock the HTTP client:
```python
import pytest
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_store():
    with patch('httpx.AsyncClient.post') as mock_post:
        mock_post.return_value.is_success = True
        mock_post.return_value.json.return_value = {"id": "...", "content": "..."}
        # Test code here
```

## Integration with Hermes

### Tool Registration

Register tools in Hermes `tools/registry.py`:

```python
from mem9_hermes import create_hermes_tools

for tool_def in create_hermes_tools():
    registry.register(**tool_def)
```

### Toolset Definition

Add to Hermes `toolsets.py`:

```python
_MEM9_TOOLS = [
    "memory_store",
    "memory_search",
    "memory_get",
    "memory_update",
    "memory_delete",
]
```

### Hook Integration

For automatic memory management, integrate hooks into Hermes session lifecycle:

```python
# In Hermes session initialization
from mem9_hermes import hermes_session_start

async def init_session(session_id):
    context = await hermes_session_start(session_id)
    # Inject context into system prompt
```

## Anti-patterns

- Do NOT hardcode `~/.hermes` paths - use `get_hermes_home()`
- Do NOT block the event loop - use async HTTP
- Do NOT skip error handling - always return structured results
- Do NOT assume `MEM9_API_KEY` is set - check and return helpful error
- Do NOT create multiple backends per session - reuse instances

## Version Compatibility

| mem9-hermes | Python | Hermes | mem9 API |
|-------------|--------|--------|----------|
| 0.1.x | 3.10+ | 1.0+ | v1alpha2 |

## Publishing

```bash
# Update version in pyproject.toml
# Build
python -m build

# Publish to PyPI
twine upload dist/*
```

## Related

- `openclaw-plugin/` - TypeScript OpenClaw plugin (reference)
- `opencode-plugin/` - TypeScript OpenCode plugin (reference)
- `claude-plugin/` - Bash hooks for Claude Code (reference)
- `server/` - Go mem9 REST API server
