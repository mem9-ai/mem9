"""
mem9 Memory Provider for Hermes Agent

This module implements mem9 as a MemoryProvider, enabling automatic memory
recall and storage throughout the Hermes session lifecycle.

Features:
- Auto-recall relevant memories at session start
- Auto-store conversation insights at session end
- Prefetch memories before each turn
- Tool integration (memory_store, memory_search, etc.)
"""

import asyncio
import json
import logging
import os
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider

logger = logging.getLogger(__name__)

# Import mem9_hermes package
try:
    from mem9_hermes import (
        ServerBackend,
        MemoryBackend,
        BackendTimeouts,
        load_config_from_env,
        MemoryHooks,
        HookConfig,
    )
    MEM9_AVAILABLE = True
except ImportError:
    MEM9_AVAILABLE = False
    logger.warning("mem9_hermes package not installed. mem9 provider will not be available.")


class Mem9MemoryProvider(MemoryProvider):
    """
    mem9 memory provider implementation.
    
    Provides automatic memory recall and storage for Hermes Agent sessions.
    """
    
    @property
    def name(self) -> str:
        return "mem9"
    
    def __init__(self):
        self._backend: Optional[MemoryBackend] = None
        self._hooks: Optional[MemoryHooks] = None
        self._session_id: str = ""
        self._initialized: bool = False
        self._api_key: str = ""
    
    def _get_api_key(self) -> str:
        """Get API key from environment or auto-provisioned file."""
        # Check environment variable
        api_key = os.getenv("MEM9_API_KEY")
        if api_key:
            return api_key
        
        # Check auto-provisioned file
        from pathlib import Path
        api_key_file = Path.home() / ".hermes" / "mem9_api_key"
        if api_key_file.exists():
            try:
                api_key = api_key_file.read_text().strip()
                if api_key:
                    return api_key
            except Exception as e:
                logger.warning(f"Failed to read API key file: {e}")
        
        return ""
    
    def _ensure_backend(self) -> MemoryBackend:
        """Ensure backend is initialized."""
        if self._backend is None:
            api_key = self._get_api_key()
            if not api_key:
                raise RuntimeError("MEM9_API_KEY not configured")
            
            config = load_config_from_env()
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
            self._backend = MemoryBackend(server_backend)
        
        return self._backend
    
    def _ensure_hooks(self) -> MemoryHooks:
        """Ensure hooks system is initialized."""
        if self._hooks is None:
            self._hooks = MemoryHooks(
                config=HookConfig(
                    auto_recall_enabled=True,
                    auto_ingest_enabled=True,
                    auto_ingest_mode="smart",
                    max_ingest_messages=50,
                    max_ingest_bytes=50000,
                    inject_context_enabled=True,
                    context_max_memories=5,
                    context_min_score=0.3,
                )
            )
        return self._hooks
    
    def is_available(self) -> bool:
        """Check if mem9 is configured and ready."""
        if not MEM9_AVAILABLE:
            return False
        
        api_key = self._get_api_key()
        if not api_key:
            return False
        
        return True
    
    def initialize(self, session_id: str, **kwargs) -> None:
        """Initialize mem9 provider for a session."""
        self._session_id = session_id
        
        try:
            backend = self._ensure_backend()
            hooks = self._ensure_hooks()
            
            # Initialize hooks system
            asyncio.run(hooks.initialize())
            
            # Auto-recall memories at session start
            context = asyncio.run(hooks.on_session_start(
                session_id=session_id,
                agent_id=kwargs.get("agent_id", "hermes"),
            ))
            
            if context:
                logger.info(f"[mem9] Recalled context for session {session_id}")
            
            self._initialized = True
            logger.info(f"[mem9] Provider initialized for session {session_id}")
            
        except Exception as e:
            logger.error(f"[mem9] Initialization failed: {e}")
            self._initialized = False
    
    def system_prompt_block(self) -> str:
        """Return static mem9 info for system prompt."""
        if not self._initialized:
            return ""
        
        return """
## mem9 Memory

You have access to mem9 persistent cloud memory. You can:
- Store important facts and insights for future sessions
- Search and recall memories from past conversations
- Update or delete memories as needed

Memories persist across sessions and help you maintain context continuity.
"""
    
    def prefetch(self, query: str, *, session_id: str = "") -> str:
        """Recall relevant context for the upcoming turn."""
        if not self._initialized or not query:
            return ""
        
        try:
            hooks = self._ensure_hooks()
            context = asyncio.run(hooks.on_user_message(
                session_id=self._session_id or session_id,
                message=query,
                inject_context=True,
            ))
            return context
        except Exception as e:
            logger.debug(f"[mem9] Prefetch failed: {e}")
            return ""
    
    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "") -> None:
        """Persist a completed turn to mem9."""
        if not self._initialized:
            return
        
        try:
            hooks = self._ensure_hooks()
            sid = self._session_id or session_id
            
            # Track user message
            asyncio.run(hooks.on_user_message(sid, user_content))
            
            # Track assistant response
            asyncio.run(hooks.on_assistant_response(sid, assistant_content))
            
        except Exception as e:
            logger.debug(f"[mem9] sync_turn failed: {e}")
    
    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """Return mem9 tool schemas."""
        if not MEM9_AVAILABLE:
            return []
        
        try:
            from mem9_hermes.tools import ALL_TOOL_SCHEMAS
            return ALL_TOOL_SCHEMAS
        except Exception as e:
            logger.error(f"[mem9] Failed to get tool schemas: {e}")
            return []
    
    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        """Handle a mem9 tool call."""
        if not self._initialized:
            return json.dumps({"ok": False, "error": "mem9 provider not initialized"})
        
        try:
            backend = self._ensure_backend()
            
            # Import tool handlers
            from mem9_hermes.tools import (
                memory_store_handler,
                memory_search_handler,
                memory_get_handler,
                memory_update_handler,
                memory_delete_handler,
            )
            
            # Dispatch to appropriate handler
            handlers = {
                "memory_store": memory_store_handler,
                "memory_search": memory_search_handler,
                "memory_get": memory_get_handler,
                "memory_update": memory_update_handler,
                "memory_delete": memory_delete_handler,
            }
            
            handler = handlers.get(tool_name)
            if not handler:
                return json.dumps({"ok": False, "error": f"Unknown tool: {tool_name}"})
            
            # Run handler asynchronously
            result = asyncio.run(handler(backend, **args))
            return result
            
        except Exception as e:
            logger.error(f"[mem9] Tool call failed: {e}")
            return json.dumps({"ok": False, "error": str(e)})
    
    def shutdown(self) -> None:
        """Clean shutdown - save session memories."""
        if not self._initialized:
            return
        
        try:
            hooks = self._ensure_hooks()
            
            # Auto-ingest conversation at session end
            result = asyncio.run(hooks.on_session_end(
                session_id=self._session_id,
                ingest=True,
            ))
            
            logger.info(f"[mem9] Session {self._session_id} ended: {result}")
            
            # Close backend
            if self._backend:
                asyncio.run(self._backend._backend.close())
            
        except Exception as e:
            logger.error(f"[mem9] Shutdown failed: {e}")
        
        self._initialized = False
    
    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        """Called when a session ends - extract and store memories."""
        if not self._initialized:
            return
        
        try:
            hooks = self._ensure_hooks()
            
            # Extract and store memories from conversation
            result = asyncio.run(hooks.on_session_end(
                session_id=self._session_id,
                ingest=True,
            ))
            
            logger.info(f"[mem9] on_session_end: {result}")
            
        except Exception as e:
            logger.debug(f"[mem9] on_session_end failed: {e}")
    
    def on_pre_compress(self, messages: List[Dict[str, Any]]) -> str:
        """Called before context compression - extract insights."""
        if not self._initialized:
            return ""
        
        try:
            hooks = self._ensure_hooks()
            
            # Extract session summary before compression
            if messages:
                # Get last assistant message as summary candidate
                for msg in reversed(messages):
                    if msg.get("role") == "assistant":
                        summary = msg.get("content", "")[:500]
                        asyncio.run(hooks.on_pre_compress(self._session_id, summary))
                        break
            
            return ""  # No text to add to compression prompt
            
        except Exception as e:
            logger.debug(f"[mem9] on_pre_compress failed: {e}")
            return ""
    
    def get_config_schema(self) -> List[Dict[str, Any]]:
        """Return config fields for mem9 setup."""
        return [
            {
                "key": "api_url",
                "description": "mem9 API endpoint URL",
                "secret": False,
                "required": False,
                "default": "https://api.mem9.ai",
                "env_var": "MEM9_API_URL",
            },
            {
                "key": "agent_id",
                "description": "Agent identifier for memory tracking",
                "secret": False,
                "required": False,
                "default": "hermes",
                "env_var": "MEM9_AGENT_ID",
            },
        ]
    
    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        """Save mem9 configuration."""
        # mem9 uses auto-provisioned API key, no native config file needed
        pass


# Register provider
def get_provider() -> Mem9MemoryProvider:
    """Factory function to get mem9 provider instance."""
    return Mem9MemoryProvider()
