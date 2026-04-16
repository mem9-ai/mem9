"""
mem9 Persistent Memory Tools for Hermes Agent

This module registers mem9 memory tools with the Hermes tool registry.
Tools: memory_store, memory_search, memory_get, memory_update, memory_delete

Environment Variables:
    MEM9_API_KEY: Optional - Tenant API key (auto-provisioned if not set)
    MEM9_API_URL: Optional - API endpoint (default: https://api.mem9.ai)
    MEM9_AGENT_ID: Optional - Agent identifier (default: hermes)

Auto-provisioning:
    If MEM9_API_KEY is not set, the plugin will automatically provision a new
    tenant on first use and save the API key to ~/.hermes/mem9_api_key.
"""

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict

from tools.registry import registry

logger = logging.getLogger(__name__)

# Import mem9_hermes package
try:
    from mem9_hermes import (
        ServerBackend,
        MemoryBackend,
        BackendTimeouts,
        load_config_from_env,
    )
    MEM9_AVAILABLE = True
except ImportError:
    MEM9_AVAILABLE = False
    logger.warning("mem9_hermes package not installed. mem9 tools will not be available.")


# Path to store auto-provisioned API key
MEM9_API_KEY_PATH = Path.home() / ".hermes" / "mem9_api_key"


def _load_api_key() -> str:
    """Load API key from environment or auto-provisioned file."""
    # First check environment variable
    api_key = os.getenv("MEM9_API_KEY")
    if api_key:
        return api_key
    
    # Then check auto-provisioned file
    if MEM9_API_KEY_PATH.exists():
        try:
            api_key = MEM9_API_KEY_PATH.read_text().strip()
            if api_key:
                logger.info(f"Loaded mem9 API key from {MEM9_API_KEY_PATH}")
                return api_key
        except Exception as e:
            logger.warning(f"Failed to read API key file: {e}")
    
    return ""


def _save_api_key(api_key: str) -> bool:
    """Save API key to auto-provisioned file."""
    try:
        MEM9_API_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
        MEM9_API_KEY_PATH.write_text(api_key)
        logger.info(f"Saved mem9 API key to {MEM9_API_KEY_PATH}")
        return True
    except Exception as e:
        logger.error(f"Failed to save API key: {e}")
        return False


def _check_mem9_available() -> bool:
    """Check if mem9 is properly configured (or can be auto-provisioned)."""
    if not MEM9_AVAILABLE:
        return False
    
    # Always return True - will auto-provision on first use
    return True


def _get_backend() -> MemoryBackend:
    """Create a MemoryBackend instance from environment config.
    
    Auto-provisions a new tenant if API key is not configured.
    """
    config = load_config_from_env()
    
    # Try to load existing API key
    api_key = _load_api_key()
    
    # If no API key, auto-provision a new tenant
    if not api_key:
        logger.info("No mem9 API key found, auto-provisioning new tenant...")
        try:
            # Create temporary backend for provisioning
            temp_backend = ServerBackend(
                api_url=config.api_url,
                api_key="",  # Not needed for provision endpoint
                agent_id=config.agent_id,
                timeouts=BackendTimeouts(
                    default_timeout_ms=config.default_timeout_ms,
                    search_timeout_ms=config.search_timeout_ms,
                ),
            )
            
            # Provision new tenant
            import asyncio
            from model_tools import _run_async
            
            result = _run_async(temp_backend.register())
            api_key = result.get("id", "")
            
            if api_key:
                _save_api_key(api_key)
                logger.info(f"✅ Auto-provisioned mem9 API key: {api_key[:8]}...{api_key[-4:]}")
            else:
                raise RuntimeError("Provision did not return API key")
                
        except Exception as e:
            logger.error(f"Failed to auto-provision mem9 API key: {e}")
            raise RuntimeError(f"mem9 auto-provision failed: {e}")
    
    # Update config with loaded/provisioned API key
    config.api_key = api_key
    
    server_backend = ServerBackend(
        api_url=config.api_url,
        api_key=config.api_key,
        agent_id=config.agent_id,
        timeouts=BackendTimeouts(
            default_timeout_ms=config.default_timeout_ms,
            search_timeout_ms=config.search_timeout_ms,
        ),
    )
    return MemoryBackend(server_backend)


async def _memory_store_handler(args: Dict[str, Any], **kwargs) -> str:
    """Handler for memory_store tool."""
    try:
        backend = _get_backend()
        result = await backend.store(
            content=args.get("content", ""),
            source=args.get("source"),
            tags=args.get("tags"),
            metadata=args.get("metadata"),
        )
        # Close the backend's HTTP client
        await backend._backend.close()
        return json.dumps(result, default=str)
    except Exception as e:
        logger.error(f"mem9 memory_store error: {e}")
        return json.dumps({"ok": False, "error": str(e)}, default=str)


async def _memory_search_handler(args: Dict[str, Any], **kwargs) -> str:
    """Handler for memory_search tool."""
    try:
        backend = _get_backend()
        result = await backend.search(
            q=args.get("q", ""),
            tags=args.get("tags"),
            source=args.get("source"),
            limit=args.get("limit"),
            offset=args.get("offset"),
            memory_type=args.get("memory_type"),
        )
        await backend._backend.close()
        return json.dumps(result, default=str)
    except Exception as e:
        logger.error(f"mem9 memory_search error: {e}")
        return json.dumps({"ok": False, "error": str(e)}, default=str)


async def _memory_get_handler(args: Dict[str, Any], **kwargs) -> str:
    """Handler for memory_get tool."""
    try:
        backend = _get_backend()
        result = await backend.get(args.get("id", ""))
        await backend._backend.close()
        return json.dumps(result, default=str)
    except Exception as e:
        logger.error(f"mem9 memory_get error: {e}")
        return json.dumps({"ok": False, "error": str(e)}, default=str)


async def _memory_update_handler(args: Dict[str, Any], **kwargs) -> str:
    """Handler for memory_update tool."""
    try:
        backend = _get_backend()
        result = await backend.update(
            id=args.get("id", ""),
            content=args.get("content"),
            tags=args.get("tags"),
            source=args.get("source"),
            metadata=args.get("metadata"),
        )
        await backend._backend.close()
        return json.dumps(result, default=str)
    except Exception as e:
        logger.error(f"mem9 memory_update error: {e}")
        return json.dumps({"ok": False, "error": str(e)}, default=str)


async def _memory_delete_handler(args: Dict[str, Any], **kwargs) -> str:
    """Handler for memory_delete tool."""
    try:
        backend = _get_backend()
        result = await backend.delete(args.get("id", ""))
        await backend._backend.close()
        return json.dumps(result, default=str)
    except Exception as e:
        logger.error(f"mem9 memory_delete error: {e}")
        return json.dumps({"ok": False, "error": str(e)}, default=str)


# =============================================================================
# Register Tools with Hermes Registry
# =============================================================================

# memory_store
registry.register(
    name="memory_store",
    toolset="mem9",
    schema={
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
    },
    handler=_memory_store_handler,
    check_fn=_check_mem9_available,
    requires_env=["MEM9_API_KEY"],
    is_async=True,
    emoji="🧠",
)

# memory_search
registry.register(
    name="memory_search",
    toolset="mem9",
    schema={
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
    },
    handler=_memory_search_handler,
    check_fn=_check_mem9_available,
    requires_env=["MEM9_API_KEY"],
    is_async=True,
    emoji="🔍",
)

# memory_get
registry.register(
    name="memory_get",
    toolset="mem9",
    schema={
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
    },
    handler=_memory_get_handler,
    check_fn=_check_mem9_available,
    requires_env=["MEM9_API_KEY"],
    is_async=True,
    emoji="📄",
)

# memory_update
registry.register(
    name="memory_update",
    toolset="mem9",
    schema={
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
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Replacement tags (optional)",
                },
                "source": {
                    "type": "string",
                    "description": "New source (optional)",
                },
                "metadata": {
                    "type": "object",
                    "description": "Replacement metadata (optional)",
                },
            },
            "required": ["id"],
        },
    },
    handler=_memory_update_handler,
    check_fn=_check_mem9_available,
    requires_env=["MEM9_API_KEY"],
    is_async=True,
    emoji="✏️",
)

# memory_delete
registry.register(
    name="memory_delete",
    toolset="mem9",
    schema={
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
    },
    handler=_memory_delete_handler,
    check_fn=_check_mem9_available,
    requires_env=["MEM9_API_KEY"],
    is_async=True,
    emoji="🗑️",
)

logger.info("mem9 tools registered with Hermes registry")
