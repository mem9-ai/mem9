"""
Pytest configuration and fixtures for mem9_hermes tests.
"""

import pytest
import os


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Clean mem9-related environment variables before each test."""
    for key in [
        "MEM9_API_URL",
        "MEM9_API_KEY",
        "MEM9_AGENT_ID",
        "MEM9_DEFAULT_TIMEOUT_MS",
        "MEM9_SEARCH_TIMEOUT_MS",
        "MEM9_MAX_INGEST_BYTES",
        "MEM9_MAX_INGEST_MESSAGES",
    ]:
        monkeypatch.delenv(key, raising=False)
    yield


@pytest.fixture
def mock_env_config(monkeypatch):
    """Set up mock environment configuration."""
    monkeypatch.setenv("MEM9_API_URL", "http://test:8080")
    monkeypatch.setenv("MEM9_API_KEY", "test-api-key")
    monkeypatch.setenv("MEM9_AGENT_ID", "test-agent")
    return {
        "api_url": "http://test:8080",
        "api_key": "test-api-key",
        "agent_id": "test-agent",
    }


@pytest.fixture
def sample_memory():
    """Return a sample memory dict."""
    return {
        "id": "test-memory-id",
        "content": "This is a test memory content",
        "source": "test-agent",
        "tags": ["test", "sample"],
        "metadata": {"key": "value"},
        "created_at": "2026-04-15T00:00:00Z",
        "updated_at": "2026-04-15T00:00:00Z",
        "score": 0.95,
    }


@pytest.fixture
def sample_memories():
    """Return a list of sample memories."""
    return [
        {
            "id": f"memory-{i}",
            "content": f"Memory content {i}",
            "tags": [f"tag{i}"],
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T00:00:00Z",
            "score": 0.9 - (i * 0.1),
        }
        for i in range(5)
    ]


@pytest.fixture
def sample_search_result(sample_memories):
    """Return a sample search result."""
    return {
        "ok": True,
        "memories": sample_memories,
        "total": len(sample_memories),
        "limit": 20,
        "offset": 0,
    }


@pytest.fixture
def sample_session_id():
    """Return a sample session ID."""
    return "test-session-123"


@pytest.fixture
def sample_messages():
    """Return sample conversation messages."""
    return [
        {"role": "user", "content": "Hello, how are you?"},
        {"role": "assistant", "content": "I'm doing well, thank you!"},
        {"role": "user", "content": "What is the project about?"},
        {"role": "assistant", "content": "The project is about persistent memory."},
    ]
