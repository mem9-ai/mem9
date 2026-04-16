"""
Tests for mem9_hermes types.
"""

import pytest
from pydantic import ValidationError

from mem9_hermes.types import (
    Memory,
    SearchResult,
    CreateMemoryInput,
    UpdateMemoryInput,
    SearchInput,
    IngestInput,
    IngestMessage,
    Mem9Config,
    load_config_from_env,
)


class TestMemory:
    """Tests for Memory model."""

    def test_memory_minimal(self):
        """Test Memory with required fields only."""
        mem = Memory(
            id="test-id",
            content="Test content",
            created_at="2026-04-15T00:00:00Z",
            updated_at="2026-04-15T00:00:00Z",
        )
        assert mem.id == "test-id"
        assert mem.content == "Test content"
        assert mem.source is None
        assert mem.tags is None

    def test_memory_full(self):
        """Test Memory with all fields."""
        mem = Memory(
            id="test-id",
            content="Test content",
            source="hermes",
            tags=["tag1", "tag2"],
            metadata={"key": "value"},
            version=1,
            score=0.95,
            created_at="2026-04-15T00:00:00Z",
            updated_at="2026-04-15T00:00:00Z",
        )
        assert mem.source == "hermes"
        assert mem.tags == ["tag1", "tag2"]
        assert mem.metadata == {"key": "value"}
        assert mem.score == 0.95


class TestCreateMemoryInput:
    """Tests for CreateMemoryInput model."""

    def test_create_minimal(self):
        """Test with required field only."""
        inp = CreateMemoryInput(content="Test content")
        assert inp.content == "Test content"
        assert inp.source is None
        assert inp.tags is None

    def test_create_full(self):
        """Test with all fields."""
        inp = CreateMemoryInput(
            content="Test content",
            source="hermes",
            tags=["tag1", "tag2"],
            metadata={"key": "value"},
        )
        assert inp.source == "hermes"
        assert inp.tags == ["tag1", "tag2"]

    def test_create_empty_content_fails(self):
        """Test that empty content fails validation."""
        with pytest.raises(ValidationError):
            CreateMemoryInput(content="")

    def test_create_content_too_long_fails(self):
        """Test that content > 50000 chars fails validation."""
        with pytest.raises(ValidationError):
            CreateMemoryInput(content="x" * 50001)

    def test_create_too_many_tags_fails(self):
        """Test that > 20 tags fails validation."""
        with pytest.raises(ValidationError):
            CreateMemoryInput(content="test", tags=[f"tag{i}" for i in range(21)])


class TestSearchInput:
    """Tests for SearchInput model."""

    def test_search_empty(self):
        """Test with no filters."""
        inp = SearchInput()
        assert inp.q is None
        assert inp.limit is None

    def test_search_with_query(self):
        """Test with query."""
        inp = SearchInput(q="database")
        assert inp.q == "database"

    def test_search_with_limit(self):
        """Test with limit."""
        inp = SearchInput(q="test", limit=10)
        assert inp.limit == 10

    def test_search_limit_too_high_fails(self):
        """Test that limit > 200 fails validation."""
        with pytest.raises(ValidationError):
            SearchInput(q="test", limit=201)

    def test_search_negative_offset_fails(self):
        """Test that negative offset fails validation."""
        with pytest.raises(ValidationError):
            SearchInput(q="test", offset=-1)


class TestIngestInput:
    """Tests for IngestInput model."""

    def test_ingest_minimal(self):
        """Test with required field only."""
        inp = IngestInput(session_id="session-123")
        assert inp.session_id == "session-123"
        assert inp.messages == []
        assert inp.mode == "smart"

    def test_ingest_with_messages(self):
        """Test with messages."""
        inp = IngestInput(
            session_id="session-123",
            agent_id="hermes",
            messages=[
                IngestMessage(role="user", content="Hello"),
                IngestMessage(role="assistant", content="Hi there"),
            ],
            mode="raw",
        )
        assert len(inp.messages) == 2
        assert inp.mode == "raw"


class TestMem9Config:
    """Tests for Mem9Config model."""

    def test_config_defaults(self):
        """Test default configuration."""
        cfg = Mem9Config()
        assert cfg.api_url == "https://api.mem9.ai"
        assert cfg.api_key is None
        assert cfg.agent_id == "hermes"
        assert cfg.default_timeout_ms == 8000
        assert cfg.search_timeout_ms == 15000

    def test_config_custom(self):
        """Test custom configuration."""
        cfg = Mem9Config(
            api_url="http://localhost:8080",
            api_key="test-key",
            agent_id="test-agent",
            default_timeout_ms=5000,
        )
        assert cfg.api_url == "http://localhost:8080"
        assert cfg.api_key == "test-key"
        assert cfg.agent_id == "test-agent"
        assert cfg.default_timeout_ms == 5000


class TestLoadConfigFromEnv:
    """Tests for load_config_from_env function."""

    def test_load_from_env(self, monkeypatch):
        """Test loading config from environment variables."""
        monkeypatch.setenv("MEM9_API_URL", "http://test:8080")
        monkeypatch.setenv("MEM9_API_KEY", "test-key")
        monkeypatch.setenv("MEM9_AGENT_ID", "test-agent")
        monkeypatch.setenv("MEM9_DEFAULT_TIMEOUT_MS", "5000")

        cfg = load_config_from_env()
        assert cfg.api_url == "http://test:8080"
        assert cfg.api_key == "test-key"
        assert cfg.agent_id == "test-agent"
        assert cfg.default_timeout_ms == 5000

    def test_load_defaults_when_not_set(self, monkeypatch):
        """Test defaults when env vars not set."""
        # Clear any existing env vars
        for key in [
            "MEM9_API_URL",
            "MEM9_API_KEY",
            "MEM9_AGENT_ID",
            "MEM9_DEFAULT_TIMEOUT_MS",
            "MEM9_SEARCH_TIMEOUT_MS",
        ]:
            monkeypatch.delenv(key, raising=False)

        cfg = load_config_from_env()
        assert cfg.api_url == "https://api.mem9.ai"
        assert cfg.api_key is None
        assert cfg.agent_id == "hermes"


class TestSearchResult:
    """Tests for SearchResult model."""

    def test_search_result_empty(self):
        """Test empty search result."""
        result = SearchResult()
        assert result.memories == []
        assert result.total == 0
        assert result.limit == 0
        assert result.offset == 0

    def test_search_result_with_memories(self):
        """Test search result with memories."""
        result = SearchResult(
            memories=[
                Memory(
                    id="1",
                    content="test",
                    created_at="2026-04-15T00:00:00Z",
                    updated_at="2026-04-15T00:00:00Z",
                )
            ],
            total=1,
            limit=20,
            offset=0,
        )
        assert len(result.memories) == 1
        assert result.total == 1
