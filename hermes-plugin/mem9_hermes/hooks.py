"""
mem9 Hermes Plugin - Session Lifecycle Hooks

Hooks for automatic memory recall and ingestion during Hermes sessions.
Reference: claude-plugin/hooks/
"""

import asyncio
import json
import logging
from typing import Any, Optional, List, Dict
from dataclasses import dataclass, field

from .server_backend import MemoryBackend, ServerBackend, BackendTimeouts
from .types import load_config_from_env, IngestMessage, IngestInput


logger = logging.getLogger(__name__)


@dataclass
class HookConfig:
    """Configuration for memory hooks."""
    
    # Auto-recall settings
    auto_recall_enabled: bool = True
    auto_recall_query: str = ""  # Empty = use session context
    auto_recall_limit: int = 10
    
    # Auto-ingest settings
    auto_ingest_enabled: bool = True
    auto_ingest_mode: str = "smart"  # "smart", "raw", or "summary"
    max_ingest_messages: int = 50
    max_ingest_bytes: int = 50000
    
    # Context injection
    inject_context_enabled: bool = True
    context_max_memories: int = 5
    context_min_score: float = 0.3


@dataclass
class SessionContext:
    """Tracks session state for hooks."""
    
    session_id: str
    agent_id: str = "hermes"
    messages: list[IngestMessage] = field(default_factory=list)
    total_bytes: int = 0
    recalled_memories: List[Dict] = field(default_factory=list)


class MemoryHooks:
    """
    MemoryHooks provides session lifecycle hooks for automatic memory management.
    
    Hooks:
    - on_session_start: Auto-recall relevant memories
    - on_user_message: Inject contextual memories, track message
    - on_session_end: Ingest conversation into memory
    - on_pre_compress: Save session summary
    """
    
    def __init__(
        self,
        config: Optional[HookConfig] = None,
        backend: Optional[MemoryBackend] = None,
    ):
        self.config = config or HookConfig()
        self._backend = backend
        self._sessions: dict[str, SessionContext] = {}
        self._initialized = False
    
    async def _ensure_backend(self) -> MemoryBackend:
        """Ensure backend is initialized."""
        if self._backend is None:
            config = load_config_from_env()
            if not config.api_key:
                raise RuntimeError("MEM9_API_KEY not configured")
            
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
    
    async def initialize(self) -> bool:
        """
        Initialize the hooks system.
        
        Returns True if successfully initialized, False if not configured.
        """
        try:
            await self._ensure_backend()
            self._initialized = True
            logger.info("[mem9] Hooks initialized")
            return True
        except RuntimeError as e:
            logger.warning(f"[mem9] Hooks not initialized: {e}")
            return False
    
    async def close(self) -> None:
        """Clean up resources."""
        if self._backend:
            # Note: MemoryBackend doesn't expose close, need to access internal
            pass
        self._initialized = False
    
    # =========================================================================
    # Session Start Hook
    # =========================================================================
    
    async def on_session_start(
        self,
        session_id: str,
        agent_id: Optional[str] = None,
        context_query: Optional[str] = None,
    ) -> str:
        """
        Called when a new Hermes session starts.
        
        Auto-recalls relevant memories and returns them as context.
        
        Args:
            session_id: Unique session identifier
            agent_id: Agent identifier (optional, uses config default)
            context_query: Optional query for recall (optional, uses default)
        
        Returns:
            Formatted memory context string for injection into system prompt
        """
        if not self._initialized or not self.config.auto_recall_enabled:
            return ""
        
        try:
            backend = await self._ensure_backend()
            
            # Build session context
            session = SessionContext(
                session_id=session_id,
                agent_id=agent_id or "hermes",
            )
            self._sessions[session_id] = session
            
            # Build recall query
            query = context_query or self.config.auto_recall_query
            if not query:
                # Use a generic query to get recent/relevant memories
                query = "project context important facts insights"
            
            # Search for relevant memories
            result = await backend.search(
                q=query,
                limit=self.config.auto_recall_limit,
            )
            
            if result.get("ok") and result.get("memories"):
                memories = result["memories"]
                session.recalled_memories = memories
                
                # Format for injection
                context = self._format_recall_context(memories)
                logger.info(
                    f"[mem9] Recalled {len(memories)} memories for session {session_id}"
                )
                return context
            
            logger.debug(f"[mem9] No memories recalled for session {session_id}")
            return ""
            
        except Exception as e:
            logger.error(f"[mem9] on_session_start error: {e}")
            return ""
    
    def _format_recall_context(self, memories: List[Dict]) -> str:
        """Format recalled memories as context for the system prompt."""
        if not memories:
            return ""
        
        lines = ["\n\n--- RELEVANT MEMORIES (from mem9) ---"]
        
        for i, mem in enumerate(memories[:self.config.context_max_memories], 1):
            content = mem.get("content", "")
            tags = mem.get("tags", [])
            score = mem.get("score", 0)
            
            if score and score < self.config.context_min_score:
                continue
            
            tags_str = f" [{', '.join(tags)}]" if tags else ""
            lines.append(f"{i}. {content}{tags_str}")
        
        lines.append("--- END MEMORIES ---\n")
        return "\n".join(lines)
    
    # =========================================================================
    # User Message Hook
    # =========================================================================
    
    async def on_user_message(
        self,
        session_id: str,
        message: str,
        inject_context: bool = True,
    ) -> str:
        """
        Called when a user sends a message.
        
        Tracks the message for later ingestion and optionally injects context.
        
        Args:
            session_id: Session identifier
            message: User message content
            inject_context: Whether to inject recalled context
        
        Returns:
            Context string to inject (empty if disabled)
        """
        if not self._initialized:
            return ""
        
        try:
            session = self._sessions.get(session_id)
            if session:
                # Track message for ingestion
                session.messages.append(IngestMessage(role="user", content=message))
                session.total_bytes += len(message.encode("utf-8"))
                
                # Limit tracked messages
                if len(session.messages) > self.config.max_ingest_messages:
                    session.messages.pop(0)
            
            # Optionally inject context
            if inject_context and self.config.inject_context_enabled:
                # Use part of the user message as query
                query = message[:200]  # Use first 200 chars as query
                return await self._recall_for_query(query, session_id)
            
            return ""
            
        except Exception as e:
            logger.error(f"[mem9] on_user_message error: {e}")
            return ""
    
    async def _recall_for_query(
        self,
        query: str,
        session_id: str,
    ) -> str:
        """Recall memories for a specific query."""
        try:
            backend = await self._ensure_backend()
            result = await backend.search(
                q=query,
                limit=self.config.context_max_memories,
            )
            
            if result.get("ok") and result.get("memories"):
                return self._format_recall_context(result["memories"])
            
            return ""
        except Exception:
            return ""
    
    # =========================================================================
    # Assistant Response Hook
    # =========================================================================
    
    async def on_assistant_response(
        self,
        session_id: str,
        response: str,
    ) -> None:
        """
        Called when the assistant responds.
        
        Tracks the response for later ingestion.
        """
        if not self._initialized:
            return
        
        try:
            session = self._sessions.get(session_id)
            if session:
                session.messages.append(IngestMessage(role="assistant", content=response))
                session.total_bytes += len(response.encode("utf-8"))
                
                # Limit tracked messages
                if len(session.messages) > self.config.max_ingest_messages:
                    session.messages.pop(0)
        except Exception as e:
            logger.error(f"[mem9] on_assistant_response error: {e}")
    
    # =========================================================================
    # Session End Hook
    # =========================================================================
    
    async def on_session_end(
        self,
        session_id: str,
        ingest: bool = True,
    ) -> Dict[str, Any]:
        """
        Called when a session ends.
        
        Ingests the conversation into memory if enabled.
        
        Args:
            session_id: Session identifier
            ingest: Whether to ingest the conversation
        
        Returns:
            Result dict with ingestion status
        """
        if not self._initialized:
            return {"status": "not_initialized"}
        
        session = self._sessions.get(session_id)
        if not session:
            return {"status": "no_session"}
        
        try:
            result = {"status": "ok", "session_id": session_id}
            
            if ingest and self.config.auto_ingest_enabled and session.messages:
                # Check byte limit
                if session.total_bytes > self.config.max_ingest_bytes:
                    logger.warning(
                        f"[mem9] Session {session_id} exceeds byte limit "
                        f"({session.total_bytes} > {self.config.max_ingest_bytes})"
                    )
                    result["status"] = "skipped_byte_limit"
                else:
                    # Ingest the conversation
                    backend = await self._ensure_backend()
                    ingest_input = IngestInput(
                        session_id=session_id,
                        agent_id=session.agent_id,
                        messages=session.messages,
                        mode=self.config.auto_ingest_mode,
                    )
                    
                    # Note: IngestInput needs to be converted properly
                    ingest_result = await backend._backend.ingest(ingest_input)
                    result["ingest_result"] = ingest_result
                    logger.info(
                        f"[mem9] Ingested {len(session.messages)} messages "
                        f"for session {session_id}"
                    )
            
            # Clean up session
            del self._sessions[session_id]
            return result
            
        except Exception as e:
            logger.error(f"[mem9] on_session_end error: {e}")
            return {"status": "error", "error": str(e)}
    
    # =========================================================================
    # Pre-Compress Hook
    # =========================================================================
    
    async def on_pre_compress(
        self,
        session_id: str,
        summary: str,
    ) -> None:
        """
        Called before context compression.
        
        Stores the session summary as a memory.
        """
        if not self._initialized:
            return
        
        try:
            backend = await self._ensure_backend()
            
            # Store summary as a memory
            await backend.store(
                content=f"Session Summary: {summary}",
                tags=["summary", "compressed"],
                source="hermes-auto",
            )
            
            logger.info(f"[mem9] Stored summary for session {session_id}")
            
        except Exception as e:
            logger.error(f"[mem9] on_pre_compress error: {e}")


# =============================================================================
# Hermes Integration Hooks
# =============================================================================

# Global hooks instance (lazy initialized)
_hooks_instance: Optional[MemoryHooks] = None


def get_hooks() -> MemoryHooks:
    """Get or create the global hooks instance."""
    global _hooks_instance
    if _hooks_instance is None:
        _hooks_instance = MemoryHooks()
    return _hooks_instance


async def hermes_session_start(
    session_id: str,
    agent_id: Optional[str] = None,
) -> str:
    """
    Hermes hook: Called when a session starts.
    
    Usage in Hermes:
    - Register as a callback in the session initialization
    - Returns context string to inject into system prompt
    """
    hooks = get_hooks()
    await hooks.initialize()
    return await hooks.on_session_start(session_id, agent_id)


async def hermes_user_message(
    session_id: str,
    message: str,
) -> str:
    """
    Hermes hook: Called on each user message.
    
    Returns context to inject before the message is processed.
    """
    hooks = get_hooks()
    return await hooks.on_user_message(session_id, message)


async def hermes_assistant_response(
    session_id: str,
    response: str,
) -> None:
    """
    Hermes hook: Called on each assistant response.
    """
    hooks = get_hooks()
    await hooks.on_assistant_response(session_id, response)


async def hermes_session_end(
    session_id: str,
) -> Dict[str, Any]:
    """
    Hermes hook: Called when a session ends.
    """
    hooks = get_hooks()
    return await hooks.on_session_end(session_id)
