"""
mem9 Hermes Plugin - Tool Definitions

Defines the 5 core memory tools for Hermes Agent.
Reference: openclaw-plugin/index.ts (buildTools function)
"""

import json
from typing import Any, Optional, List, Dict

from .server_backend import MemoryBackend, ServerBackend, BackendTimeouts
from .types import load_config_from_env


# =============================================================================
# Tool Schemas (OpenAI function calling format)
# =============================================================================

MEMORY_STORE_SCHEMA = {
    "name": "memory_store",
    "description": (
        "Store a memory to persistent cloud storage. "
        "Returns the stored memory with its assigned ID. "
        "Use this to save important facts, insights, or context for future sessions."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "Memory content to store (required, max 50000 chars)",
            },
            "source": {
                "type": "string",
                "description": "Which agent or system wrote this memory (optional)",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Filterable tags for categorization (max 20)",
            },
            "metadata": {
                "type": "object",
                "description": "Arbitrary structured data (optional)",
            },
        },
        "required": ["content"],
    },
}

MEMORY_SEARCH_SCHEMA = {
    "name": "memory_search",
    "description": (
        "Search stored memories using hybrid vector + keyword search. "
        "Higher score = more relevant. Returns matching memories with scores."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "q": {
                "type": "string",
                "description": "Search query (required)",
            },
            "tags": {
                "type": "string",
                "description": "Comma-separated tags to filter by (AND logic, optional)",
            },
            "source": {
                "type": "string",
                "description": "Filter by source agent (optional)",
            },
            "limit": {
                "type": "integer",
                "description": "Max results to return (default 20, max 200)",
            },
            "offset": {
                "type": "integer",
                "description": "Pagination offset (default 0)",
            },
            "memory_type": {
                "type": "string",
                "description": "Comma-separated memory types (e.g. insight,pinned)",
            },
        },
        "required": ["q"],
    },
}

MEMORY_GET_SCHEMA = {
    "name": "memory_get",
    "description": "Retrieve a single memory by its UUID.",
    "parameters": {
        "type": "object",
        "properties": {
            "id": {
                "type": "string",
                "description": "Memory UUID to retrieve",
            },
        },
        "required": ["id"],
    },
}

MEMORY_UPDATE_SCHEMA = {
    "name": "memory_update",
    "description": "Update an existing memory. Only provided fields are changed.",
    "parameters": {
        "type": "object",
        "properties": {
            "id": {
                "type": "string",
                "description": "Memory UUID to update",
            },
            "content": {
                "type": "string",
                "description": "New content (optional)",
            },
            "source": {
                "type": "string",
                "description": "New source (optional)",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Replacement tags (optional)",
            },
            "metadata": {
                "type": "object",
                "description": "Replacement metadata (optional)",
            },
        },
        "required": ["id"],
    },
}

MEMORY_DELETE_SCHEMA = {
    "name": "memory_delete",
    "description": "Delete a memory by its UUID.",
    "parameters": {
        "type": "object",
        "properties": {
            "id": {
                "type": "string",
                "description": "Memory UUID to delete",
            },
        },
        "required": ["id"],
    },
}

# All tool schemas for registration
ALL_TOOL_SCHEMAS = [
    MEMORY_STORE_SCHEMA,
    MEMORY_SEARCH_SCHEMA,
    MEMORY_GET_SCHEMA,
    MEMORY_UPDATE_SCHEMA,
    MEMORY_DELETE_SCHEMA,
]


# =============================================================================
# Tool Handlers
# =============================================================================

async def memory_store_handler(
    backend: MemoryBackend,
    content: str,
    source: Optional[str] = None,
    tags: Optional[List[str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Store a memory.
    
    Args:
        backend: MemoryBackend instance
        content: Memory content (required)
        source: Optional source identifier
        tags: Optional list of tags
        metadata: Optional metadata dict
    
    Returns:
        JSON string with {ok: bool, data?: Memory, error?: string}
    """
    try:
        result = await backend.store(
            content=content,
            tags=tags,
            source=source,
            metadata=metadata,
        )
        return json.dumps(result, default=str)
    except Exception as e:
        return json.dumps({"ok": False, "error": str(e)}, default=str)


async def memory_search_handler(
    backend: MemoryBackend,
    q: str,
    tags: Optional[str] = None,
    source: Optional[str] = None,
    limit: Optional[int] = None,
    offset: Optional[int] = None,
    memory_type: Optional[str] = None,
) -> str:
    """
    Search memories.
    
    Args:
        backend: MemoryBackend instance
        q: Search query (required)
        tags: Comma-separated tags filter
        source: Source filter
        limit: Max results
        offset: Pagination offset
        memory_type: Memory type filter
    
    Returns:
        JSON string with {ok: bool, memories?: [], total?: int, error?: string}
    """
    result = await backend.search(
        q=q,
        tags=tags,
        source=source,
        limit=limit,
        offset=offset,
        memory_type=memory_type,
    )
    return json.dumps(result, default=str)


async def memory_get_handler(
    backend: MemoryBackend,
    id: str,
) -> str:
    """
    Get a single memory by ID.
    
    Args:
        backend: MemoryBackend instance
        id: Memory UUID
    
    Returns:
        JSON string with {ok: bool, data?: Memory, error?: string}
    """
    result = await backend.get(id)
    return json.dumps(result, default=str)


async def memory_update_handler(
    backend: MemoryBackend,
    id: str,
    content: Optional[str] = None,
    tags: Optional[List[str]] = None,
    source: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Update a memory.
    
    Args:
        backend: MemoryBackend instance
        id: Memory UUID (required)
        content: New content (optional)
        tags: New tags (optional)
        source: New source (optional)
        metadata: New metadata (optional)
    
    Returns:
        JSON string with {ok: bool, data?: Memory, error?: string}
    """
    try:
        result = await backend.update(
            id=id,
            content=content,
            tags=tags,
            source=source,
            metadata=metadata,
        )
        if result is None:
            return json.dumps({"ok": False, "error": "memory not found"}, default=str)
        return json.dumps(result, default=str)
    except Exception as e:
        return json.dumps({"ok": False, "error": str(e)}, default=str)


async def memory_delete_handler(
    backend: MemoryBackend,
    id: str,
) -> str:
    """
    Delete a memory.
    
    Args:
        backend: MemoryBackend instance
        id: Memory UUID
    
    Returns:
        JSON string with {ok: bool, error?: string}
    """
    result = await backend.delete(id)
    return json.dumps(result, default=str)


# =============================================================================
# Hermes Toolset Registration
# =============================================================================

def check_mem9_requirements() -> bool:
    """Check if mem9 is properly configured."""
    import os
    return bool(os.getenv("MEM9_API_KEY"))


def create_hermes_tools() -> list[Dict[str, Any]]:
    """
    Create Hermes tool definitions for registration.
    
    Returns a list of tool dicts that can be registered with Hermes.
    Each tool has: name, toolset, schema, handler, check_fn, requires_env
    """
    # Lazy import to avoid circular dependencies
    from .server_backend import ServerBackend, BackendTimeouts, MemoryBackend
    from .types import load_config_from_env
    
    def make_handler(tool_name: str):
        """Factory to create tool handlers with proper backend initialization."""
        async def handler(args: Dict[str, Any], **kwargs) -> str:
            config = load_config_from_env()
            
            if not config.api_key:
                return json.dumps({
                    "ok": False,
                    "error": "MEM9_API_KEY not configured. Set environment variable or run setup.",
                })
            
            backend_impl = ServerBackend(
                api_url=config.api_url,
                api_key=config.api_key,
                agent_id=config.agent_id,
                timeouts=BackendTimeouts(
                    default_timeout_ms=config.default_timeout_ms,
                    search_timeout_ms=config.search_timeout_ms,
                ),
            )
            backend = MemoryBackend(backend_impl)
            
            try:
                if tool_name == "memory_store":
                    return await memory_store_handler(
                        backend,
                        content=args.get("content", ""),
                        source=args.get("source"),
                        tags=args.get("tags"),
                        metadata=args.get("metadata"),
                    )
                elif tool_name == "memory_search":
                    return await memory_search_handler(
                        backend,
                        q=args.get("q", ""),
                        tags=args.get("tags"),
                        source=args.get("source"),
                        limit=args.get("limit"),
                        offset=args.get("offset"),
                        memory_type=args.get("memory_type"),
                    )
                elif tool_name == "memory_get":
                    return await memory_get_handler(
                        backend,
                        id=args.get("id", ""),
                    )
                elif tool_name == "memory_update":
                    return await memory_update_handler(
                        backend,
                        id=args.get("id", ""),
                        content=args.get("content"),
                        tags=args.get("tags"),
                        source=args.get("source"),
                        metadata=args.get("metadata"),
                    )
                elif tool_name == "memory_delete":
                    return await memory_delete_handler(
                        backend,
                        id=args.get("id", ""),
                    )
                else:
                    return json.dumps({"ok": False, "error": f"Unknown tool: {tool_name}"})
            finally:
                await backend_impl.close()
        
        return handler
    
    return [
        {
            "name": "memory_store",
            "toolset": "mem9",
            "schema": MEMORY_STORE_SCHEMA,
            "handler": make_handler("memory_store"),
            "check_fn": check_mem9_requirements,
            "requires_env": ["MEM9_API_KEY"],
        },
        {
            "name": "memory_search",
            "toolset": "mem9",
            "schema": MEMORY_SEARCH_SCHEMA,
            "handler": make_handler("memory_search"),
            "check_fn": check_mem9_requirements,
            "requires_env": ["MEM9_API_KEY"],
        },
        {
            "name": "memory_get",
            "toolset": "mem9",
            "schema": MEMORY_GET_SCHEMA,
            "handler": make_handler("memory_get"),
            "check_fn": check_mem9_requirements,
            "requires_env": ["MEM9_API_KEY"],
        },
        {
            "name": "memory_update",
            "toolset": "mem9",
            "schema": MEMORY_UPDATE_SCHEMA,
            "handler": make_handler("memory_update"),
            "check_fn": check_mem9_requirements,
            "requires_env": ["MEM9_API_KEY"],
        },
        {
            "name": "memory_delete",
            "toolset": "mem9",
            "schema": MEMORY_DELETE_SCHEMA,
            "handler": make_handler("memory_delete"),
            "check_fn": check_mem9_requirements,
            "requires_env": ["MEM9_API_KEY"],
        },
    ]


def register_with_hermes() -> None:
    """
    Register mem9 tools with Hermes Agent.
    
    This function should be called during Hermes initialization.
    It registers all 5 memory tools with the Hermes tool registry.
    """
    try:
        from tools.registry import registry
        
        tools = create_hermes_tools()
        for tool_def in tools:
            registry.register(
                name=tool_def["name"],
                toolset=tool_def["toolset"],
                schema=tool_def["schema"],
                handler=tool_def["handler"],
                check_fn=tool_def["check_fn"],
                requires_env=tool_def["requires_env"],
            )
    except ImportError:
        # Hermes not available (running outside Hermes context)
        pass
