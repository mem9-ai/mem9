import type {
  Memory,
  MemoryListParams,
  MemoryListResponse,
  MemoryBatchCreateResponse,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryStats,
  SpaceInfo,
} from "../types/memory";
import { mockMemories, mockSpaceInfo } from "./mock-data";

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
const API_BASE = import.meta.env.VITE_API_BASE || "/your-memory/api";
const AGENT_ID = "dashboard";
const EMPTY_TIMESTAMP = new Date(0).toISOString();

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeSpaceId(spaceId: string): string {
  return spaceId.trim();
}

let mockStore = mockMemories.map((m) => ({ ...m }));

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag): tag is string => typeof tag === "string");
}

function normalizeMemory(memory: Partial<Memory>): Memory {
  return {
    id: memory.id ?? "",
    content: memory.content ?? "",
    memory_type: memory.memory_type ?? "pinned",
    source: memory.source ?? "",
    tags: normalizeTags(memory.tags),
    metadata: memory.metadata ?? null,
    agent_id: memory.agent_id ?? "",
    session_id: memory.session_id ?? "",
    state: memory.state ?? "active",
    version: memory.version ?? 0,
    updated_by: memory.updated_by ?? "",
    created_at: memory.created_at ?? EMPTY_TIMESTAMP,
    updated_at: memory.updated_at ?? EMPTY_TIMESTAMP,
    score: memory.score,
  };
}

function normalizeMemoryListResponse(
  response: Partial<MemoryListResponse>,
): MemoryListResponse {
  return {
    memories: Array.isArray(response.memories)
      ? response.memories.map(normalizeMemory)
      : [],
    total: response.total ?? 0,
    limit: response.limit ?? 0,
    offset: response.offset ?? 0,
  };
}

async function request<T>(
  spaceId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${API_BASE}/${encodeURIComponent(normalizeSpaceId(spaceId))}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Mnemo-Agent-Id": AGENT_ID,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Mock helpers ───

function mockList(params: MemoryListParams): MemoryListResponse {
  let result = [...mockStore];

  if (params.q) {
    const q = params.q.toLowerCase();
    result = result.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  if (params.memory_type) {
    result = result.filter((m) => m.memory_type === params.memory_type);
  }

  result.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  const total = result.length;
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 50;
  const page = result.slice(offset, offset + limit);

  return { memories: page, total, limit, offset };
}

function mockStats(): MemoryStats {
  return {
    total: mockStore.length,
    pinned: mockStore.filter((m) => m.memory_type === "pinned").length,
    insight: mockStore.filter((m) => m.memory_type === "insight").length,
  };
}

// ─── Public API ───

export const api = {
  async verifySpace(spaceId: string): Promise<SpaceInfo> {
    const normalizedSpaceId = normalizeSpaceId(spaceId);
    if (USE_MOCK) {
      await delay(400);
      if (!normalizedSpaceId || normalizedSpaceId.length < 8) {
        throw new Error("Cannot access this space. Please check your ID.");
      }
      return { ...mockSpaceInfo, tenant_id: normalizedSpaceId };
    }
    try {
      return await request<SpaceInfo>(normalizedSpaceId, "/info");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/not found|API error 404/i.test(message)) {
        throw err;
      }

      // Some deployed API versions expose list endpoints before /info.
      const fallback = await request<MemoryListResponse>(
        normalizedSpaceId,
        "/memories?limit=1",
      );
      return {
        tenant_id: normalizedSpaceId,
        name: normalizedSpaceId,
        status: "active",
        provider: "unknown",
        memory_count: fallback.total,
        created_at: "",
      };
    }
  },

  async listMemories(
    spaceId: string,
    params: MemoryListParams = {},
  ): Promise<MemoryListResponse> {
    if (USE_MOCK) {
      await delay(300);
      return mockList(params);
    }
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.memory_type) qs.set("memory_type", params.memory_type);
    qs.set("limit", String(params.limit ?? 50));
    qs.set("offset", String(params.offset ?? 0));
    const response = await request<MemoryListResponse>(
      spaceId,
      `/memories?${qs}`,
    );
    return normalizeMemoryListResponse(response);
  },

  async getStats(spaceId: string): Promise<MemoryStats> {
    if (USE_MOCK) {
      await delay(200);
      return mockStats();
    }
    const [all, pinned, insight] = await Promise.all([
      request<MemoryListResponse>(spaceId, "/memories?limit=1"),
      request<MemoryListResponse>(
        spaceId,
        "/memories?memory_type=pinned&limit=1",
      ),
      request<MemoryListResponse>(
        spaceId,
        "/memories?memory_type=insight&limit=1",
      ),
    ]);
    return {
      total: all.total,
      pinned: pinned.total,
      insight: insight.total,
    };
  },

  async getMemory(spaceId: string, memoryId: string): Promise<Memory> {
    if (USE_MOCK) {
      await delay(150);
      const mem = mockStore.find((m) => m.id === memoryId);
      if (!mem) throw new Error("Memory not found");
      return { ...mem };
    }
    const response = await request<Memory>(spaceId, `/memories/${memoryId}`);
    return normalizeMemory(response);
  },

  async createMemory(
    spaceId: string,
    input: MemoryCreateInput,
  ): Promise<Memory> {
    if (USE_MOCK) {
      await delay(500);
      const mem: Memory = {
        id: `mem-${Date.now()}`,
        content: input.content,
        memory_type: "pinned",
        source: "dashboard",
        tags: input.tags ?? [],
        metadata: null,
        agent_id: AGENT_ID,
        session_id: "",
        state: "active",
        version: 1,
        updated_by: AGENT_ID,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockStore.unshift(mem);
      return mem;
    }
    const res = await request<MemoryBatchCreateResponse>(
      spaceId,
      "/memories/batch",
      {
        method: "POST",
        body: JSON.stringify({ memories: [input] }),
      },
    );
    const created = res.memories[0];
    if (!created) throw new Error("No memory returned from batch create");
    return normalizeMemory(created);
  },

  async deleteMemory(spaceId: string, memoryId: string): Promise<void> {
    if (USE_MOCK) {
      await delay(300);
      mockStore = mockStore.filter((m) => m.id !== memoryId);
      return;
    }
    return request<void>(spaceId, `/memories/${memoryId}`, {
      method: "DELETE",
    });
  },

  async updateMemory(
    spaceId: string,
    memoryId: string,
    input: MemoryUpdateInput,
    version?: number,
  ): Promise<Memory> {
    if (USE_MOCK) {
      await delay(400);
      const existing = mockStore.find((m) => m.id === memoryId);
      if (!existing) throw new Error("Memory not found");
      const updated: Memory = {
        ...existing,
        content: input.content ?? existing.content,
        tags: input.tags ?? existing.tags,
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
        updated_by: AGENT_ID,
      };
      const idx = mockStore.indexOf(existing);
      mockStore[idx] = updated;
      return { ...updated };
    }
    const headers: Record<string, string> = {};
    if (version !== undefined) headers["If-Match"] = String(version);
    const response = await request<Memory>(spaceId, `/memories/${memoryId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(input),
    });
    return normalizeMemory(response);
  },

  resetMockData(): void {
    mockStore = mockMemories.map((m) => ({ ...m }));
  },
};
