"""
mem9 Hermes Plugin

Persistent cloud memory for Hermes Agent.

This plugin provides:
- 5 memory tools (store, search, get, update, delete)
- Automatic session lifecycle hooks for recall and ingestion
- Hybrid vector + keyword search via mem9 REST API

Environment Variables:
    MEM9_API_URL: mem9 API endpoint (default: https://api.mem9.ai)
    MEM9_API_KEY: Tenant API key (required, obtained from mem9 server)
    MEM9_AGENT_ID: Agent identifier (default: hermes)
    MEM9_DEFAULT_TIMEOUT_MS: Default request timeout (default: 8000)
    MEM9_SEARCH_TIMEOUT_MS: Search request timeout (default: 15000)

Quick Start:
    1. Set MEM9_API_KEY environment variable
    2. Enable mem9 toolset in Hermes: `hermes tools enable mem9`
    3. Use memory tools in conversation

Example:
    from mem9_hermes import MemoryBackend, ServerBackend
    
    backend = ServerBackend(
        api_url="https://api.mem9.ai",
        api_key="your-api-key",
        agent_id="hermes",
    )
    
    # Store a memory
    from mem9_hermes.types import CreateMemoryInput
    await backend.store(CreateMemoryInput(
        content="The project uses PostgreSQL 15",
        tags=["database", "infrastructure"],
    ))
    
    # Search memories
    from mem9_hermes.types import SearchInput
    results = await backend.search(SearchInput(q="database"))
"""

__version__ = "0.1.0"
__author__ = "mem9-ai"
__license__ = "Apache-2.0"

from .types import (
    Memory,
    SearchResult,
    StoreResult,
    CreateMemoryInput,
    UpdateMemoryInput,
    SearchInput,
    IngestInput,
    IngestResult,
    IngestMessage,
    Mem9Config,
    load_config_from_env,
)

from .server_backend import (
    ServerBackend,
    MemoryBackend,
    BackendTimeouts,
    DEFAULT_API_URL,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_SEARCH_TIMEOUT_MS,
)

from .tools import (
    create_hermes_tools,
    register_with_hermes,
    check_mem9_requirements,
    MEMORY_STORE_SCHEMA,
    MEMORY_SEARCH_SCHEMA,
    MEMORY_GET_SCHEMA,
    MEMORY_UPDATE_SCHEMA,
    MEMORY_DELETE_SCHEMA,
    ALL_TOOL_SCHEMAS,
)

from .hooks import (
    MemoryHooks,
    HookConfig,
    SessionContext,
    get_hooks,
    hermes_session_start,
    hermes_user_message,
    hermes_assistant_response,
    hermes_session_end,
)


__all__ = [
    # Version
    "__version__",
    "__author__",
    "__license__",
    
    # Types
    "Memory",
    "SearchResult",
    "StoreResult",
    "CreateMemoryInput",
    "UpdateMemoryInput",
    "SearchInput",
    "IngestInput",
    "IngestResult",
    "IngestMessage",
    "Mem9Config",
    "load_config_from_env",
    
    # Backend
    "ServerBackend",
    "MemoryBackend",
    "BackendTimeouts",
    "DEFAULT_API_URL",
    "DEFAULT_TIMEOUT_MS",
    "DEFAULT_SEARCH_TIMEOUT_MS",
    
    # Tools
    "create_hermes_tools",
    "register_with_hermes",
    "check_mem9_requirements",
    "MEMORY_STORE_SCHEMA",
    "MEMORY_SEARCH_SCHEMA",
    "MEMORY_GET_SCHEMA",
    "MEMORY_UPDATE_SCHEMA",
    "MEMORY_DELETE_SCHEMA",
    "ALL_TOOL_SCHEMAS",
    
    # Hooks
    "MemoryHooks",
    "HookConfig",
    "SessionContext",
    "get_hooks",
    "hermes_session_start",
    "hermes_user_message",
    "hermes_assistant_response",
    "hermes_session_end",
]
