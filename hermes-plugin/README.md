# mem9 Hermes 插件

**持久化云记忆 for Hermes Agent.**

本插件使 Hermes Agent 能够使用 mem9 REST API 存储和检索记忆。记忆跨会话持久化，让你的助手能够记住重要事实、项目上下文和洞察。

## 🎉 新功能：MemoryProvider 集成

mem9 现已作为完整的 **MemoryProvider** 集成到 Hermes Agent 中，提供：

- ✅ **自动记忆召回** - 会话开始和每轮对话自动召回相关记忆
- ✅ **自动记忆存储** - 会话结束自动提取并存储记忆
- ✅ **零配置** - API key 自动配置，无需手动设置
- ✅ **完整工具支持** - 5 个记忆工具 (store/search/get/update/delete)

### 快速激活

```bash
hermes config set memory.provider mem9
hermes chat
```

现在记忆功能完全自动化！

---

## 特性

- **5 Memory Tools**: Store, search, get, update, and delete memories
- **Hybrid Search**: Vector + keyword search with relevance scoring
- **Session Hooks**: Automatic memory recall on session start, conversation ingestion on session end
- **Cloud Persistent**: Memories stored in TiDB/MySQL with vector indexing
- **Multi-Agent Support**: Separate memory spaces per agent via `X-Mnemo-Agent-Id`

## Installation

### Option 1: Install from PyPI (recommended)

```bash
pip install mem9-hermes
```

### Option 2: Install from source

```bash
cd mem9/hermes-plugin
pip install -e .
```

### Option 3: Local development

```bash
cd mem9/hermes-plugin
pip install -e ".[dev]"
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEM9_API_URL` | No | `https://api.mem9.ai` | mem9 API endpoint |
| `MEM9_API_KEY` | **Yes** | - | Tenant API key (UUID) |
| `MEM9_AGENT_ID` | No | `hermes` | Agent identifier |
| `MEM9_DEFAULT_TIMEOUT_MS` | No | `8000` | Default request timeout |
| `MEM9_SEARCH_TIMEOUT_MS` | No | `15000` | Search request timeout |

### Setup

1. **Get your API key** from a mem9 server:

```bash
curl -X POST https://api.mem9.ai/v1alpha1/mem9s
# Returns: {"id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
```

2. **Set environment variables**:

```bash
export MEM9_API_KEY="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
export MEM9_API_URL="https://api.mem9.ai"  # optional
```

3. **Enable the mem9 toolset in Hermes**:

```bash
hermes tools enable mem9
```

## Usage

### Memory Tools

Once enabled, you can use these tools in Hermes conversations:

#### `memory_store` - Store a memory

```
Store a memory to persistent cloud storage.

Parameters:
- content (required): Memory content (max 50000 chars)
- source (optional): Which agent wrote this
- tags (optional): Filterable tags (max 20)
- metadata (optional): Arbitrary structured data
```

Example:
```
Store this memory: "The project uses PostgreSQL 15 with pgvector extension"
Tags: database, infrastructure, postgres
```

#### `memory_search` - Search memories

```
Search stored memories using hybrid vector + keyword search.

Parameters:
- q (required): Search query
- tags (optional): Comma-separated tags (AND logic)
- source (optional): Filter by source agent
- limit (optional): Max results (default 20, max 200)
- offset (optional): Pagination offset
- memory_type (optional): Comma-separated memory types
```

Example:
```
Search for memories about "database configuration"
Limit: 10
```

#### `memory_get` - Get a memory by ID

```
Retrieve a single memory by its UUID.

Parameters:
- id (required): Memory UUID
```

#### `memory_update` - Update a memory

```
Update an existing memory. Only provided fields are changed.

Parameters:
- id (required): Memory UUID to update
- content (optional): New content
- tags (optional): Replacement tags
- source (optional): New source
- metadata (optional): Replacement metadata
```

#### `memory_delete` - Delete a memory

```
Delete a memory by its UUID.

Parameters:
- id (required): Memory UUID to delete
```

### Programmatic Usage

```python
import asyncio
from mem9_hermes import ServerBackend, MemoryBackend
from mem9_hermes.types import CreateMemoryInput, SearchInput

async def main():
    # Initialize backend
    backend = ServerBackend(
        api_url="https://api.mem9.ai",
        api_key="your-api-key",
        agent_id="hermes",
    )
    memory = MemoryBackend(backend)
    
    # Store a memory
    result = await memory.store(
        content="The API uses rate limiting of 100 requests/minute",
        tags=["api", "rate-limit"],
        source="hermes",
    )
    print(result)
    
    # Search memories
    results = await memory.search(
        q="API rate limiting",
        limit=10,
    )
    print(results)
    
    # Get a specific memory
    mem = await memory.get("uuid-here")
    print(mem)
    
    # Update a memory
    updated = await memory.update(
        id="uuid-here",
        content="Updated content here",
    )
    
    # Delete a memory
    deleted = await memory.delete("uuid-here")
    
    await backend.close()

asyncio.run(main())
```

### Session Hooks

Automatic memory management during Hermes sessions:

```python
from mem9_hermes import get_hooks, hermes_session_start, hermes_session_end

async def hermes_session():
    session_id = "session-123"
    
    # On session start - auto-recall memories
    context = await hermes_session_start(session_id)
    if context:
        print(f"Recalled memories:\n{context}")
    
    # During session - track messages
    await hermes_user_message(session_id, "What database do we use?")
    await hermes_assistant_response(session_id, "We use PostgreSQL 15")
    
    # On session end - auto-ingest conversation
    result = await hermes_session_end(session_id)
    print(f"Ingestion result: {result}")
```

## Integration with Hermes Agent

### Register Tools

To register mem9 tools with Hermes:

```python
# In your Hermes tools registration file
from mem9_hermes import register_with_hermes

register_with_hermes()
```

Or manually:

```python
from tools.registry import registry
from mem9_hermes import create_hermes_tools

for tool_def in create_hermes_tools():
    registry.register(
        name=tool_def["name"],
        toolset=tool_def["toolset"],
        schema=tool_def["schema"],
        handler=tool_def["handler"],
        check_fn=tool_def["check_fn"],
        requires_env=tool_def["requires_env"],
    )
```

### Enable Toolset

```bash
hermes tools enable mem9
```

## API Reference

### ServerBackend

Core HTTP client for mem9 API.

```python
ServerBackend(
    api_url: str,           # mem9 API endpoint
    api_key: str,           # Tenant API key
    agent_id: str,          # Agent identifier
    timeouts: BackendTimeouts,  # Optional timeout config
)
```

Methods:
- `register()` - Auto-provision a new tenant
- `store(input: CreateMemoryInput)` - Store a memory
- `search(input: SearchInput)` - Search memories
- `get(id: str)` - Get memory by ID
- `update(id: str, input: UpdateMemoryInput)` - Update memory
- `remove(id: str)` - Delete memory
- `ingest(input: IngestInput)` - Ingest conversation

### MemoryBackend

Simplified wrapper for Hermes tools.

```python
MemoryBackend(backend: ServerBackend)
```

Methods return JSON dicts: `{"ok": bool, "data"?: ..., "error"?: ...}`

## Troubleshooting

### "MEM9_API_KEY not configured"

Set the environment variable:
```bash
export MEM9_API_KEY="your-tenant-uuid"
```

### "Connection refused"

Check that `MEM9_API_URL` is correct and the server is running.

### "memory not found"

The memory ID doesn't exist or you don't have access to it.

### Tool not appearing in Hermes

1. Check `hermes tools list` - mem9 should be listed
2. Enable with `hermes tools enable mem9`
3. Reset session with `/reset`

## Development

### Run Tests

```bash
cd mem9/hermes-plugin
pytest tests/ -v
```

### Type Checking

```bash
pip install mypy
mypy mem9_hermes/
```

### Linting

```bash
pip install ruff
ruff check mem9_hermes/
```

## License

Apache 2.0

## Links

- [mem9 main repo](https://github.com/mem9-ai/mem9)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)
- [mem9 documentation](https://mem9.ai)
