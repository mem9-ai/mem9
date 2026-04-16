"""
Tests for mem9_hermes hooks.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from mem9_hermes.hooks import (
    MemoryHooks,
    HookConfig,
    SessionContext,
    get_hooks,
)
from mem9_hermes.types import IngestMessage


class TestHookConfig:
    """Tests for HookConfig."""

    def test_defaults(self):
        """Test default configuration."""
        config = HookConfig()
        assert config.auto_recall_enabled is True
        assert config.auto_ingest_enabled is True
        assert config.auto_ingest_mode == "smart"
        assert config.max_ingest_messages == 50
        assert config.context_max_memories == 5

    def test_custom_config(self):
        """Test custom configuration."""
        config = HookConfig(
            auto_recall_enabled=False,
            auto_ingest_mode="raw",
            max_ingest_bytes=10000,
        )
        assert config.auto_recall_enabled is False
        assert config.auto_ingest_mode == "raw"
        assert config.max_ingest_bytes == 10000


class TestSessionContext:
    """Tests for SessionContext."""

    def test_create_context(self):
        """Test creating session context."""
        ctx = SessionContext(session_id="test-123")
        assert ctx.session_id == "test-123"
        assert ctx.agent_id == "hermes"
        assert ctx.messages == []
        assert ctx.total_bytes == 0

    def test_context_with_messages(self):
        """Test context with messages."""
        ctx = SessionContext(
            session_id="test-123",
            agent_id="test-agent",
            messages=[
                IngestMessage(role="user", content="Hello"),
                IngestMessage(role="assistant", content="Hi"),
            ],
            total_bytes=100,
        )
        assert len(ctx.messages) == 2
        assert ctx.total_bytes == 100


class TestMemoryHooks:
    """Tests for MemoryHooks class."""

    def test_hooks_init(self):
        """Test hooks initialization."""
        hooks = MemoryHooks()
        assert hooks.config is not None
        assert hooks._backend is None
        assert hooks._initialized is False

    def test_hooks_with_custom_config(self):
        """Test hooks with custom config."""
        config = HookConfig(auto_recall_enabled=False)
        hooks = MemoryHooks(config=config)
        assert hooks.config.auto_recall_enabled is False

    @pytest.mark.asyncio
    async def test_initialize_without_api_key(self, monkeypatch):
        """Test initialize fails without API key."""
        monkeypatch.delenv("MEM9_API_KEY", raising=False)

        hooks = MemoryHooks()
        result = await hooks.initialize()

        assert result is False
        assert hooks._initialized is False

    @pytest.mark.asyncio
    async def test_on_session_start_not_initialized(self):
        """Test on_session_start when not initialized."""
        hooks = MemoryHooks()

        result = await hooks.on_session_start("test-123")

        assert result == ""

    @pytest.mark.asyncio
    async def test_on_session_start_with_mock(self):
        """Test on_session_start with mocked backend."""
        hooks = MemoryHooks()
        hooks._initialized = True

        mock_backend = MagicMock()
        mock_backend.search = AsyncMock(
            return_value={
                "ok": True,
                "memories": [
                    {
                        "id": "1",
                        "content": "Test memory",
                        "tags": ["test"],
                        "score": 0.9,
                    }
                ],
                "total": 1,
            }
        )
        hooks._backend = mock_backend

        result = await hooks.on_session_start("test-123")

        assert "Test memory" in result
        assert "RELEVANT MEMORIES" in result

    @pytest.mark.asyncio
    async def test_on_session_start_no_memories(self):
        """Test on_session_start with no memories."""
        hooks = MemoryHooks()
        hooks._initialized = True

        mock_backend = MagicMock()
        mock_backend.search = AsyncMock(return_value={"ok": True, "memories": []})
        hooks._backend = mock_backend

        result = await hooks.on_session_start("test-123")

        assert result == ""

    @pytest.mark.asyncio
    async def test_on_user_message_tracks_message(self):
        """Test that on_user_message tracks messages."""
        hooks = MemoryHooks()
        hooks._initialized = True

        # Pre-create session
        hooks._sessions["test-123"] = SessionContext(session_id="test-123")

        await hooks.on_user_message("test-123", "Hello, world!")

        session = hooks._sessions["test-123"]
        assert len(session.messages) == 1
        assert session.messages[0].role == "user"
        assert session.messages[0].content == "Hello, world!"

    @pytest.mark.asyncio
    async def test_on_user_message_limits_messages(self):
        """Test that messages are limited."""
        config = HookConfig(max_ingest_messages=5)
        hooks = MemoryHooks(config=config)
        hooks._initialized = True
        hooks._sessions["test-123"] = SessionContext(session_id="test-123")

        # Add more than max messages
        for i in range(10):
            await hooks.on_user_message("test-123", f"Message {i}")

        session = hooks._sessions["test-123"]
        assert len(session.messages) == 5

    @pytest.mark.asyncio
    async def test_on_assistant_response_tracks_message(self):
        """Test that on_assistant_response tracks messages."""
        hooks = MemoryHooks()
        hooks._initialized = True
        hooks._sessions["test-123"] = SessionContext(session_id="test-123")

        await hooks.on_assistant_response("test-123", "Hello!")

        session = hooks._sessions["test-123"]
        assert len(session.messages) == 1
        assert session.messages[0].role == "assistant"

    @pytest.mark.asyncio
    async def test_on_session_end_ingests(self):
        """Test on_session_end ingests conversation."""
        hooks = MemoryHooks()
        hooks._initialized = True

        # Create session with messages
        session = SessionContext(
            session_id="test-123",
            messages=[
                IngestMessage(role="user", content="Hello"),
                IngestMessage(role="assistant", content="Hi"),
            ],
        )
        hooks._sessions["test-123"] = session

        mock_backend = MagicMock()
        mock_backend._backend.ingest = AsyncMock(
            return_value={"status": "ok", "ingested_count": 2}
        )
        hooks._backend = mock_backend

        result = await hooks.on_session_end("test-123", ingest=True)

        assert result["status"] == "ok"
        assert "test-123" not in hooks._sessions  # Session cleaned up

    @pytest.mark.asyncio
    async def test_on_session_end_no_session(self):
        """Test on_session_end with no session."""
        hooks = MemoryHooks()
        hooks._initialized = True

        result = await hooks.on_session_end("nonexistent")

        assert result["status"] == "no_session"

    @pytest.mark.asyncio
    async def test_on_session_end_skips_byte_limit(self):
        """Test on_session_end skips if over byte limit."""
        config = HookConfig(max_ingest_bytes=100)
        hooks = MemoryHooks(config=config)
        hooks._initialized = True

        # Create session over byte limit with messages
        session = SessionContext(
            session_id="test-123",
            total_bytes=500,  # Over limit
            messages=[
                IngestMessage(role="user", content="Hello"),
            ],
        )
        hooks._sessions["test-123"] = session

        result = await hooks.on_session_end("test-123", ingest=True)

        assert result["status"] == "skipped_byte_limit"

    @pytest.mark.asyncio
    async def test_on_pre_compress(self):
        """Test on_pre_compress stores summary."""
        hooks = MemoryHooks()
        hooks._initialized = True

        mock_backend = MagicMock()
        mock_backend.store = AsyncMock(return_value={"ok": True})
        hooks._backend = mock_backend

        await hooks.on_pre_compress("test-123", "Session summary here")

        mock_backend.store.assert_called_once()


class TestGetHooks:
    """Tests for get_hooks function."""

    def test_get_hooks_creates_instance(self):
        """Test that get_hooks creates instance on first call."""
        hooks = get_hooks()
        assert hooks is not None
        assert isinstance(hooks, MemoryHooks)

    def test_get_hooks_returns_same_instance(self):
        """Test that get_hooks returns same instance."""
        hooks1 = get_hooks()
        hooks2 = get_hooks()
        assert hooks1 is hooks2
