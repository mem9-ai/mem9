"""
mem9 Hermes Plugin - Server Backend

HTTP API client for mem9 REST API (v1alpha2).
Reference: openclaw-plugin/server-backend.ts
"""

import asyncio
from typing import Any, Optional, Dict, List
from dataclasses import dataclass, field

import httpx

from .types import (
    Memory,
    SearchResult,
    StoreResult,
    CreateMemoryInput,
    UpdateMemoryInput,
    SearchInput,
    IngestInput,
    IngestResult,
)


DEFAULT_API_URL = "https://api.mem9.ai"
DEFAULT_TIMEOUT_MS = 8000
DEFAULT_SEARCH_TIMEOUT_MS = 15000


@dataclass
class BackendTimeouts:
    """Timeout configuration for backend requests."""
    default_timeout_ms: int = DEFAULT_TIMEOUT_MS
    search_timeout_ms: int = DEFAULT_SEARCH_TIMEOUT_MS


class ServerBackend:
    """
    ServerBackend implements the MemoryBackend interface using the mem9 REST API.
    
    All requests use v1alpha2 endpoints with X-API-Key and X-Mnemo-Agent-Id headers.
    """
    
    def __init__(
        self,
        api_url: str,
        api_key: str,
        agent_id: str,
        timeouts: Optional[BackendTimeouts] = None,
    ):
        self.base_url = api_url.rstrip("/")
        self.api_key = api_key
        self.agent_id = agent_id
        self.timeouts = timeouts or BackendTimeouts()
        
        # Create async client with default headers
        self._client: Optional[httpx.AsyncClient] = None
    
    def _get_headers(self) -> Dict[str, str]:
        """Return standard headers for all API requests."""
        return {
            "Content-Type": "application/json",
            "X-API-Key": self.api_key,
            "X-Mnemo-Agent-Id": self.agent_id,
        }
    
    def _memory_path(self, path: str) -> str:
        """Build v1alpha2 mem9s path."""
        if not self.api_key:
            raise ValueError("API key is not configured")
        return f"/v1alpha2/mem9s{path}"
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the async HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers=self._get_headers(),
                timeout=httpx.Timeout(
                    self.timeouts.default_timeout_ms / 1000.0
                ),
            )
        return self._client
    
    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
    
    async def register(self) -> dict[str, Any]:
        """
        Auto-provision a new tenant.
        POST /v1alpha1/mem9s
        
        Returns the tenant ID which should be used as API key.
        """
        client = await self._get_client()
        
        # Provision endpoint doesn't require auth
        headers = {"Content-Type": "application/json"}
        
        response = await client.post(
            "/v1alpha1/mem9s",
            headers=headers,
            timeout=httpx.Timeout(self.timeouts.default_timeout_ms / 1000.0),
        )
        
        if not response.is_success:
            raise RuntimeError(
                f"mem9s provision failed ({response.status_code}): {response.text}"
            )
        
        data = response.json()
        if not data.get("id"):
            raise RuntimeError("mem9s provision did not return API key")
        
        # Update our API key with the provisioned one
        self.api_key = data["id"]
        # Update client headers
        self._client.headers["X-API-Key"] = self.api_key
        
        return data
    
    async def store(self, input: CreateMemoryInput) -> StoreResult:
        """
        Store a new memory.
        POST /v1alpha2/mem9s/memories
        """
        client = await self._get_client()
        response = await client.post(
            self._memory_path("/memories"),
            json=input.model_dump(exclude_none=True),
        )
        response.raise_for_status()
        return StoreResult.model_validate(response.json())
    
    async def search(self, input: SearchInput) -> SearchResult:
        """
        Search memories using hybrid vector + keyword search.
        GET /v1alpha2/mem9s/memories?q=...&tags=...&limit=...
        """
        client = await self._get_client()
        
        # Build query params
        params: Dict[str, Any] = {}
        if input.q:
            params["q"] = input.q
        if input.tags:
            params["tags"] = input.tags
        if input.source:
            params["source"] = input.source
        if input.limit is not None:
            params["limit"] = input.limit
        if input.offset is not None:
            params["offset"] = input.offset
        if input.memory_type:
            params["memory_type"] = input.memory_type
        
        # Use search timeout
        search_timeout = httpx.Timeout(self.timeouts.search_timeout_ms / 1000.0)
        
        response = await client.get(
            self._memory_path("/memories"),
            params=params,
            timeout=search_timeout,
        )
        response.raise_for_status()
        
        data = response.json()
        return SearchResult(
            memories=[Memory.model_validate(m) for m in data.get("memories", [])],
            total=data.get("total", 0),
            limit=data.get("limit", 0),
            offset=data.get("offset", 0),
        )
    
    async def get(self, id: str) -> Optional[Memory]:
        """
        Get a single memory by ID.
        GET /v1alpha2/mem9s/memories/{id}
        
        Returns None if not found.
        """
        client = await self._get_client()
        try:
            response = await client.get(self._memory_path(f"/memories/{id}"))
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return Memory.model_validate(response.json())
        except httpx.HTTPStatusError:
            return None
    
    async def update(self, id: str, input: UpdateMemoryInput) -> Optional[Memory]:
        """
        Update an existing memory.
        PUT /v1alpha2/mem9s/memories/{id}
        
        Returns None if not found.
        """
        client = await self._get_client()
        try:
            response = await client.put(
                self._memory_path(f"/memories/{id}"),
                json=input.model_dump(exclude_none=True),
            )
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return Memory.model_validate(response.json())
        except httpx.HTTPStatusError:
            return None
    
    async def remove(self, id: str) -> bool:
        """
        Delete a memory by ID.
        DELETE /v1alpha2/mem9s/memories/{id}
        
        Returns False if not found.
        """
        client = await self._get_client()
        try:
            response = await client.delete(self._memory_path(f"/memories/{id}"))
            if response.status_code == 404:
                return False
            response.raise_for_status()
            return True
        except httpx.HTTPStatusError:
            return False
    
    async def ingest(self, input: IngestInput) -> IngestResult:
        """
        Ingest messages into the smart memory pipeline.
        POST /v1alpha2/mem9s/memories
        
        The server will extract and reconcile memories from the conversation.
        """
        client = await self._get_client()
        response = await client.post(
            self._memory_path("/memories"),
            json=input.model_dump(exclude_none=True),
        )
        response.raise_for_status()
        return IngestResult.model_validate(response.json())


class MemoryBackend:
    """
    MemoryBackend interface - wrapper around ServerBackend for Hermes tools.
    
    This provides a simpler interface that Hermes tools can use directly.
    """
    
    def __init__(self, backend: ServerBackend):
        self._backend = backend
    
    async def store(
        self,
        content: str,
        tags: Optional[list[str]] = None,
        source: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Store a memory and return JSON result."""
        try:
            input_data = CreateMemoryInput(
                content=content,
                tags=tags,
                source=source,
                metadata=metadata,
            )
            result = await self._backend.store(input_data)
            return {"ok": True, "data": result.model_dump()}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    
    async def search(
        self,
        q: str,
        tags: Optional[str] = None,
        source: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        memory_type: Optional[str] = None,
    ) -> dict[str, Any]:
        """Search memories and return JSON result."""
        try:
            input_data = SearchInput(
                q=q,
                tags=tags,
                source=source,
                limit=limit,
                offset=offset,
                memory_type=memory_type,
            )
            result = await self._backend.search(input_data)
            return {
                "ok": True,
                "memories": [m.model_dump() for m in result.memories],
                "total": result.total,
                "limit": result.limit,
                "offset": result.offset,
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}
    
    async def get(self, id: str) -> dict[str, Any]:
        """Get a memory by ID and return JSON result."""
        try:
            result = await self._backend.get(id)
            if result is None:
                return {"ok": False, "error": "memory not found"}
            return {"ok": True, "data": result.model_dump()}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    
    async def update(
        self,
        id: str,
        content: Optional[str] = None,
        tags: Optional[list[str]] = None,
        source: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Update a memory and return JSON result."""
        try:
            input_data = UpdateMemoryInput(
                content=content,
                tags=tags,
                source=source,
                metadata=metadata,
            )
            result = await self._backend.update(id, input_data)
            if result is None:
                return {"ok": False, "error": "memory not found"}
            return {"ok": True, "data": result.model_dump()}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    
    async def delete(self, id: str) -> dict[str, Any]:
        """Delete a memory and return JSON result."""
        try:
            deleted = await self._backend.remove(id)
            if not deleted:
                return {"ok": False, "error": "memory not found"}
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}
