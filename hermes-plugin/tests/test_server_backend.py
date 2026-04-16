import httpx
"""
Tests for mem9_hermes server_backend.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from mem9_hermes.server_backend import (
    ServerBackend,
    MemoryBackend,
    BackendTimeouts,
    DEFAULT_API_URL,
    DEFAULT_TIMEOUT_MS,
)
from mem9_hermes.types import CreateMemoryInput, SearchInput


class TestServerBackendInit:
    """Tests for ServerBackend initialization."""

    def test_init_defaults(self):
        """Test initialization with defaults."""
        backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )
        assert backend.base_url == "http://test:8080"
        assert backend.api_key == "test-key"
        assert backend.agent_id == "test-agent"
        assert backend.timeouts.default_timeout_ms == DEFAULT_TIMEOUT_MS

    def test_init_custom_timeouts(self):
        """Test initialization with custom timeouts."""
        timeouts = BackendTimeouts(default_timeout_ms=5000, search_timeout_ms=10000)
        backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
            timeouts=timeouts,
        )
        assert backend.timeouts.default_timeout_ms == 5000
        assert backend.timeouts.search_timeout_ms == 10000

    def test_init_strips_trailing_slash(self):
        """Test that trailing slash is stripped from URL."""
        backend = ServerBackend(
            api_url="http://test:8080/",
            api_key="test-key",
            agent_id="test-agent",
        )
        assert backend.base_url == "http://test:8080"


class TestServerBackendPaths:
    """Tests for path building."""

    def test_memory_path(self):
        """Test memory path building."""
        backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )
        path = backend._memory_path("/memories")
        assert path == "/v1alpha2/mem9s/memories"

    def test_memory_path_no_api_key(self):
        """Test memory path fails without API key."""
        backend = ServerBackend(
            api_url="http://test:8080",
            api_key="",
            agent_id="test-agent",
        )
        with pytest.raises(ValueError, match="API key is not configured"):
            backend._memory_path("/memories")


class TestServerBackendStore:
    """Tests for store operation."""

    @pytest.mark.asyncio
    async def test_store_success(self):
        """Test successful store."""
        backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )

        mock_response = MagicMock()
        mock_response.is_success = True
        mock_response.json.return_value = {
            "id": "test-id",
            "content": "Test content",
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T00:00:00Z",
        }

        with patch.object(backend, "_get_client", new_callable=AsyncMock) as mock_client:
            mock_client.return_value.post = AsyncMock(return_value=mock_response)
            mock_client.return_value.is_closed = False

            input_data = CreateMemoryInput(content="Test content")
            result = await backend.store(input_data)

            assert result.id == "test-id"
            assert result.content == "Test content"

    @pytest.mark.asyncio
    async def test_store_failure(self):
        """Test store failure."""
        backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )

        mock_response = MagicMock()
        mock_response.is_success = False
        mock_response.status_code = 400
        mock_response.text = "Bad request"

        with patch.object(backend, "_get_client", new_callable=AsyncMock) as mock_client:
            mock_client.return_value.post = AsyncMock(return_value=mock_response)
            mock_client.return_value.is_closed = False

            input_data = CreateMemoryInput(content="Test content")

            with pytest.raises(Exception):
                await backend.store(input_data)


class TestServerBackendSearch:
    """Tests for search operation."""

    @pytest.mark.asyncio
    async def test_search_success(self):
        """Test successful search."""
        backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )

        mock_response = MagicMock()
        mock_response.is_success = True
        mock_response.json.return_value = {
            "memories": [
                {
                    "id": "1",
                    "content": "Result 1",
                    "created_at": "2026-04-15T00:00:00Z",
                    "updated_at": "2026-04-15T00:00:00Z",
                }
            ],
            "total": 1,
            "limit": 20,
            "offset": 0,
        }

        def mock_json():
            return {
                "memories": [
                    {
                        "id": "1",
                        "content": "Result 1",
                        "created_at": "2026-04-15T00:00:00Z",
                        "updated_at": "2026-04-15T00:00:00Z",
                    }
                ],
                "total": 1,
                "limit": 20,
                "offset": 0,
            }
        
        mock_response.json = mock_json

        with patch.object(backend, "_get_client", new_callable=AsyncMock) as mock_client:
            mock_client.return_value.get = AsyncMock(return_value=mock_response)
            mock_client.return_value.is_closed = False

            input_data = SearchInput(q="test", limit=10)
            result = await backend.search(input_data)

            assert len(result.memories) == 1
            assert result.total == 1
            assert result.limit == 20  # Mock returns 20

    @pytest.mark.asyncio
    async def test_search_empty(self):
        """Test search with no results."""
        backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )

        mock_response = MagicMock()
        mock_response.is_success = True
        mock_response.json.return_value = {
            "memories": [],
            "total": 0,
            "limit": 20,
            "offset": 0,
        }

        with patch.object(backend, "_get_client", new_callable=AsyncMock) as mock_client:
            mock_client.return_value.get = AsyncMock(return_value=mock_response)
            mock_client.return_value.is_closed = False

            input_data = SearchInput(q="nonexistent")
            result = await backend.search(input_data)

            assert len(result.memories) == 0
            assert result.total == 0


class TestServerBackendGet:
    """Tests for get operation."""

    @pytest.mark.asyncio
    async def test_get_success(self):
        """Test successful get."""
        backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )

        mock_response = MagicMock()
        mock_response.is_success = True
        mock_response.json.return_value = {
            "id": "test-id",
            "content": "Test content",
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T00:00:00Z",
        }

        with patch.object(backend, "_get_client", new_callable=AsyncMock) as mock_client:
            mock_client.return_value.get = AsyncMock(return_value=mock_response)
            mock_client.return_value.is_closed = False

            result = await backend.get("test-id")

            assert result is not None
            assert result.id == "test-id"

    @pytest.mark.asyncio
    async def test_get_not_found(self):
        """Test get returns None for 404."""
        backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )

        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.is_success = False

        async def mock_get_404(*args, **kwargs):
            raise httpx.HTTPStatusError("Not Found", request=MagicMock(), response=MagicMock(status_code=404))
        
        with patch.object(backend, "_get_client", new_callable=AsyncMock) as mock_client:
            mock_client.return_value.get = mock_get_404
            mock_client.return_value.is_closed = False

            result = await backend.get("nonexistent")

            assert result is None


class TestServerBackendRemove:
    """Tests for remove operation."""

    @pytest.mark.asyncio
    async def test_remove_success(self):
        """Test successful remove."""
        backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )

        mock_response = MagicMock()
        mock_response.is_success = True

        with patch.object(backend, "_get_client", new_callable=AsyncMock) as mock_client:
            mock_client.return_value.delete = AsyncMock(return_value=mock_response)
            mock_client.return_value.is_closed = False

            result = await backend.remove("test-id")

            assert result is True

    @pytest.mark.asyncio
    async def test_remove_not_found(self):
        """Test remove returns False for 404."""
        backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )

        async def mock_delete_404(*args, **kwargs):
            raise httpx.HTTPStatusError("Not Found", request=MagicMock(), response=MagicMock(status_code=404))
        
        with patch.object(backend, "_get_client", new_callable=AsyncMock) as mock_client:
            mock_client.return_value.delete = mock_delete_404
            mock_client.return_value.is_closed = False

            result = await backend.remove("nonexistent")

            assert result is False


class TestMemoryBackend:
    """Tests for MemoryBackend wrapper."""

    @pytest.mark.asyncio
    async def test_memory_backend_store(self):
        """Test MemoryBackend store wrapper."""
        server_backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )
        backend = MemoryBackend(server_backend)

        with patch.object(server_backend, "store", new_callable=AsyncMock) as mock_store:
            mock_store.return_value = MagicMock(
                id="test-id",
                content="Test",
                created_at="2026-04-15T00:00:00Z",
                updated_at="2026-04-15T00:00:00Z",
            )

            result = await backend.store(content="Test", tags=["tag1"])

            assert result["ok"] is True
            assert "data" in result

    @pytest.mark.asyncio
    async def test_memory_backend_store_error(self):
        """Test MemoryBackend store error handling."""
        server_backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )
        backend = MemoryBackend(server_backend)

        with patch.object(server_backend, "store", new_callable=AsyncMock) as mock_store:
            mock_store.side_effect = Exception("Connection error")

            result = await backend.store(content="Test")

            assert result["ok"] is False
            assert "error" in result

    @pytest.mark.asyncio
    async def test_memory_backend_search(self):
        """Test MemoryBackend search wrapper."""
        server_backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )
        backend = MemoryBackend(server_backend)

        with patch.object(server_backend, "search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = MagicMock(
                memories=[],
                total=0,
                limit=20,
                offset=0,
            )

            result = await backend.search(q="test")

            assert result["ok"] is True
            assert "memories" in result
            assert "total" in result

    @pytest.mark.asyncio
    async def test_memory_backend_get_not_found(self):
        """Test MemoryBackend get returns error for not found."""
        server_backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )
        backend = MemoryBackend(server_backend)

        with patch.object(server_backend, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = None

            result = await backend.get("nonexistent")

            assert result["ok"] is False
            assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_memory_backend_delete_not_found(self):
        """Test MemoryBackend delete returns error for not found."""
        server_backend = ServerBackend(
            api_url="http://test:8080",
            api_key="test-key",
            agent_id="test-agent",
        )
        backend = MemoryBackend(server_backend)

        with patch.object(server_backend, "remove", new_callable=AsyncMock) as mock_remove:
            mock_remove.return_value = False

            result = await backend.delete("nonexistent")

            assert result["ok"] is False
            assert "not found" in result["error"]
