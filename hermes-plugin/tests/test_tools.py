"""
Tests for mem9_hermes tools.
"""

import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from mem9_hermes.tools import (
    memory_store_handler,
    memory_search_handler,
    memory_get_handler,
    memory_update_handler,
    memory_delete_handler,
    create_hermes_tools,
    check_mem9_requirements,
    MEMORY_STORE_SCHEMA,
    MEMORY_SEARCH_SCHEMA,
)
from mem9_hermes.server_backend import MemoryBackend


class TestToolSchemas:
    """Tests for tool schemas."""

    def test_memory_store_schema(self):
        """Test memory_store schema structure."""
        assert MEMORY_STORE_SCHEMA["name"] == "memory_store"
        assert "content" in MEMORY_STORE_SCHEMA["parameters"]["required"]
        assert "properties" in MEMORY_STORE_SCHEMA["parameters"]

    def test_memory_search_schema(self):
        """Test memory_search schema structure."""
        assert MEMORY_SEARCH_SCHEMA["name"] == "memory_search"
        assert "q" in MEMORY_SEARCH_SCHEMA["parameters"]["required"]

    def test_all_tool_schemas_have_required_fields(self):
        """Test that all schemas have name and description."""
        from mem9_hermes.tools import ALL_TOOL_SCHEMAS

        for schema in ALL_TOOL_SCHEMAS:
            assert "name" in schema
            assert "description" in schema
            assert "parameters" in schema


class TestCheckRequirements:
    """Tests for check_mem9_requirements function."""

    def test_check_requirements_with_key(self, monkeypatch):
        """Test returns True when MEM9_API_KEY is set."""
        monkeypatch.setenv("MEM9_API_KEY", "test-key")
        assert check_mem9_requirements() is True

    def test_check_requirements_without_key(self, monkeypatch):
        """Test returns False when MEM9_API_KEY is not set."""
        monkeypatch.delenv("MEM9_API_KEY", raising=False)
        assert check_mem9_requirements() is False


class TestMemoryStoreHandler:
    """Tests for memory_store_handler."""

    @pytest.mark.asyncio
    async def test_store_success(self):
        """Test successful store."""
        mock_backend = MagicMock(spec=MemoryBackend)
        mock_backend.store = AsyncMock(
            return_value={
                "ok": True,
                "data": {"id": "test-id", "content": "Test"},
            }
        )

        result = await memory_store_handler(
            mock_backend,
            content="Test content",
            tags=["tag1"],
        )

        parsed = json.loads(result)
        assert parsed["ok"] is True
        assert parsed["data"]["id"] == "test-id"

    @pytest.mark.asyncio
    async def test_store_error(self):
        """Test store error handling."""
        mock_backend = MagicMock(spec=MemoryBackend)
        mock_backend.store = AsyncMock(side_effect=Exception("Connection error"))

        result = await memory_store_handler(mock_backend, content="Test")

        parsed = json.loads(result)
        assert parsed["ok"] is False
        assert "error" in parsed


class TestMemorySearchHandler:
    """Tests for memory_search_handler."""

    @pytest.mark.asyncio
    async def test_search_success(self):
        """Test successful search."""
        mock_backend = MagicMock(spec=MemoryBackend)
        mock_backend.search = AsyncMock(
            return_value={
                "ok": True,
                "memories": [{"id": "1", "content": "Result"}],
                "total": 1,
            }
        )

        result = await memory_search_handler(mock_backend, q="test")

        parsed = json.loads(result)
        assert parsed["ok"] is True
        assert len(parsed["memories"]) == 1

    @pytest.mark.asyncio
    async def test_search_with_filters(self):
        """Test search with filters."""
        mock_backend = MagicMock(spec=MemoryBackend)
        mock_backend.search = AsyncMock(return_value={"ok": True, "memories": []})

        await memory_search_handler(
            mock_backend,
            q="test",
            tags="tag1,tag2",
            source="hermes",
            limit=10,
        )

        mock_backend.search.assert_called_once_with(
            q="test",
            tags="tag1,tag2",
            source="hermes",
            limit=10,
            offset=None,
            memory_type=None,
        )


class TestMemoryGetHandler:
    """Tests for memory_get_handler."""

    @pytest.mark.asyncio
    async def test_get_success(self):
        """Test successful get."""
        mock_backend = MagicMock(spec=MemoryBackend)
        mock_backend.get = AsyncMock(
            return_value={
                "ok": True,
                "data": {"id": "test-id", "content": "Test"},
            }
        )

        result = await memory_get_handler(mock_backend, id="test-id")

        parsed = json.loads(result)
        assert parsed["ok"] is True

    @pytest.mark.asyncio
    async def test_get_not_found(self):
        """Test get not found."""
        mock_backend = MagicMock(spec=MemoryBackend)
        mock_backend.get = AsyncMock(
            return_value={"ok": False, "error": "memory not found"}
        )

        result = await memory_get_handler(mock_backend, id="nonexistent")

        parsed = json.loads(result)
        assert parsed["ok"] is False


class TestMemoryUpdateHandler:
    """Tests for memory_update_handler."""

    @pytest.mark.asyncio
    async def test_update_success(self):
        """Test successful update."""
        mock_backend = MagicMock(spec=MemoryBackend)
        mock_backend.update = AsyncMock(
            return_value={
                "ok": True,
                "data": {"id": "test-id", "content": "Updated"},
            }
        )

        result = await memory_update_handler(
            mock_backend, id="test-id", content="Updated content"
        )

        parsed = json.loads(result)
        assert parsed["ok"] is True

    @pytest.mark.asyncio
    async def test_update_not_found(self):
        """Test update not found."""
        mock_backend = MagicMock(spec=MemoryBackend)
        mock_backend.update = AsyncMock(return_value=None)

        result = await memory_update_handler(mock_backend, id="nonexistent")

        parsed = json.loads(result)
        assert parsed["ok"] is False


class TestMemoryDeleteHandler:
    """Tests for memory_delete_handler."""

    @pytest.mark.asyncio
    async def test_delete_success(self):
        """Test successful delete."""
        mock_backend = MagicMock(spec=MemoryBackend)
        mock_backend.delete = AsyncMock(return_value={"ok": True})

        result = await memory_delete_handler(mock_backend, id="test-id")

        parsed = json.loads(result)
        assert parsed["ok"] is True

    @pytest.mark.asyncio
    async def test_delete_not_found(self):
        """Test delete not found."""
        mock_backend = MagicMock(spec=MemoryBackend)
        mock_backend.delete = AsyncMock(
            return_value={"ok": False, "error": "memory not found"}
        )

        result = await memory_delete_handler(mock_backend, id="nonexistent")

        parsed = json.loads(result)
        assert parsed["ok"] is False


class TestCreateHermesTools:
    """Tests for create_hermes_tools function."""

    def test_creates_five_tools(self):
        """Test that 5 tools are created."""
        tools = create_hermes_tools()
        assert len(tools) == 5

    def test_tool_names(self):
        """Test tool names are correct."""
        tools = create_hermes_tools()
        names = [t["name"] for t in tools]
        assert names == [
            "memory_store",
            "memory_search",
            "memory_get",
            "memory_update",
            "memory_delete",
        ]

    def test_all_tools_have_required_keys(self):
        """Test that all tools have required keys."""
        tools = create_hermes_tools()
        required_keys = ["name", "toolset", "schema", "handler", "check_fn"]

        for tool in tools:
            for key in required_keys:
                assert key in tool, f"Tool {tool['name']} missing {key}"

    def test_all_tools_use_mem9_toolset(self):
        """Test that all tools use mem9 toolset."""
        tools = create_hermes_tools()
        for tool in tools:
            assert tool["toolset"] == "mem9"

    def test_handlers_are_callable(self):
        """Test that handlers are callable."""
        tools = create_hermes_tools()
        for tool in tools:
            assert callable(tool["handler"])
