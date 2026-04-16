"""
mem9 Hermes Plugin - Type Definitions

Shared types for mem9 API communication.
Reference: openclaw-plugin/types.ts
"""

from typing import Any, Optional, List, Dict
from pydantic import BaseModel, Field


class Memory(BaseModel):
    """Memory record returned by the mem9 API."""
    
    id: str
    content: str
    source: Optional[str] = None
    tags: Optional[List[str]] = None
    metadata: Optional[Dict[str, Any]] = None
    version: Optional[int] = None
    updated_by: Optional[str] = None
    created_at: str
    updated_at: str
    score: Optional[float] = None
    
    # Smart memory pipeline fields
    memory_type: Optional[str] = None
    state: Optional[str] = None
    agent_id: Optional[str] = None
    session_id: Optional[str] = None
    
    # Computed field for display
    relative_age: Optional[str] = None


class SearchResult(BaseModel):
    """Search results from mem9 API."""
    
    memories: List[Memory] = Field(default_factory=list)
    total: int = 0
    limit: int = 0
    offset: int = 0


class StoreResult(BaseModel):
    """Result of storing a memory."""
    
    # Direct store returns Memory fields
    id: Optional[str] = None
    content: Optional[str] = None
    source: Optional[str] = None
    tags: Optional[List[str]] = None
    metadata: Optional[Dict[str, Any]] = None
    version: Optional[int] = None
    updated_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    score: Optional[float] = None
    
    # Smart memory pipeline fields
    memory_type: Optional[str] = None
    state: Optional[str] = None
    agent_id: Optional[str] = None
    session_id: Optional[str] = None
    
    # Smart pipeline response
    status: Optional[str] = None
    message: Optional[str] = None


class CreateMemoryInput(BaseModel):
    """Input for creating a new memory."""
    
    content: str = Field(..., min_length=1, max_length=50000)
    source: Optional[str] = None
    tags: Optional[List[str]] = Field(default=None, max_length=20)
    metadata: Optional[Dict[str, Any]] = None


class UpdateMemoryInput(BaseModel):
    """Input for updating an existing memory."""
    
    content: Optional[str] = Field(default=None, min_length=1, max_length=50000)
    source: Optional[str] = None
    tags: Optional[List[str]] = Field(default=None, max_length=20)
    metadata: Optional[Dict[str, Any]] = None


class SearchInput(BaseModel):
    """Input for searching memories."""
    
    q: Optional[str] = None
    tags: Optional[str] = None  # Comma-separated tags for AND filtering
    source: Optional[str] = None
    limit: Optional[int] = Field(default=None, ge=1, le=200)
    offset: Optional[int] = Field(default=None, ge=0)
    memory_type: Optional[str] = None  # Comma-separated memory types


class IngestMessage(BaseModel):
    """A single message for ingestion into smart memory pipeline."""
    
    role: str  # "user" or "assistant"
    content: str


class IngestInput(BaseModel):
    """Input for ingesting conversation messages."""
    
    session_id: str
    agent_id: Optional[str] = None
    messages: list[IngestMessage] = Field(default_factory=list)
    mode: str = "smart"  # "smart", "raw", or "summary"


class IngestResult(BaseModel):
    """Result of ingestion operation."""
    
    ingested_count: int = 0
    extracted_memories: List[Memory] = Field(default_factory=list)
    status: str = "ok"


class Mem9Config(BaseModel):
    """Configuration for mem9 plugin loaded from environment."""
    
    api_url: str = "https://api.mem9.ai"
    api_key: Optional[str] = None
    agent_id: str = "hermes"
    
    # Timeout configuration
    default_timeout_ms: int = 8000
    search_timeout_ms: int = 15000
    
    # Ingest configuration
    max_ingest_bytes: int = 50000
    max_ingest_messages: int = 50


def load_config_from_env() -> Mem9Config:
    """Load configuration from environment variables."""
    import os
    
    return Mem9Config(
        api_url=os.getenv("MEM9_API_URL", "https://api.mem9.ai"),
        api_key=os.getenv("MEM9_API_KEY"),
        agent_id=os.getenv("MEM9_AGENT_ID", "hermes"),
        default_timeout_ms=int(os.getenv("MEM9_DEFAULT_TIMEOUT_MS", "8000")),
        search_timeout_ms=int(os.getenv("MEM9_SEARCH_TIMEOUT_MS", "15000")),
        max_ingest_bytes=int(os.getenv("MEM9_MAX_INGEST_BYTES", "50000")),
        max_ingest_messages=int(os.getenv("MEM9_MAX_INGEST_MESSAGES", "50")),
    )
