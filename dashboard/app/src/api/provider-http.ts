import type { DashboardProvider } from "./provider";
import type {
  Memory,
  MemoryListParams,
  MemoryListResponse,
  MemoryBatchCreateResponse,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryStats,
  MemoryExportFile,
  SpaceInfo,
  TopicSummary,
} from "@/types/memory";
import type { TimeRangeParams } from "@/types/time-range";
import type { ImportTask, ImportTaskList } from "@/types/import";
import {
  removeCachedMemory,
  upsertCachedMemories,
} from "./local-cache";

const API_BASE = import.meta.env.VITE_API_BASE || "/your-memory/api";
const AGENT_ID = "dashboard";
const EMPTY_TIMESTAMP = new Date(0).toISOString();

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
  const url = `${API_BASE}/${encodeURIComponent(spaceId.trim())}${path}`;
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

async function requestRaw(
  spaceId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${API_BASE}/${encodeURIComponent(spaceId.trim())}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Mnemo-Agent-Id": AGENT_ID,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res;
}

export const httpProvider: DashboardProvider = {
  async verifySpace(spaceId: string): Promise<SpaceInfo> {
    const id = spaceId.trim();
    const res = await request<MemoryListResponse>(id, "/memories?limit=1");
    return {
      tenant_id: id,
      name: id,
      status: "active",
      provider: "unknown",
      memory_count: res.total,
      created_at: "",
    };
  },

  async listMemories(
    spaceId: string,
    params: MemoryListParams = {},
  ): Promise<MemoryListResponse> {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.tags?.length) qs.set("tags", params.tags.join(","));
    if (params.memory_type) qs.set("memory_type", params.memory_type);
    if (params.updated_from) qs.set("updated_from", params.updated_from);
    if (params.updated_to) qs.set("updated_to", params.updated_to);
    qs.set("limit", String(params.limit ?? 50));
    qs.set("offset", String(params.offset ?? 0));
    const response = await request<MemoryListResponse>(
      spaceId,
      `/memories?${qs}`,
    );
    const normalized = normalizeMemoryListResponse(response);
    void upsertCachedMemories(spaceId, normalized.memories);
    return normalized;
  },

  async getStats(
    spaceId: string,
    params?: TimeRangeParams,
  ): Promise<MemoryStats> {
    const qs = new URLSearchParams({ limit: "1" });
    if (params?.updated_from) qs.set("updated_from", params.updated_from);
    if (params?.updated_to) qs.set("updated_to", params.updated_to);

    const qsPinned = new URLSearchParams(qs);
    qsPinned.set("memory_type", "pinned");
    const qsInsight = new URLSearchParams(qs);
    qsInsight.set("memory_type", "insight");

    const [all, pinned, insight] = await Promise.all([
      request<MemoryListResponse>(spaceId, `/memories?${qs}`),
      request<MemoryListResponse>(spaceId, `/memories?${qsPinned}`),
      request<MemoryListResponse>(spaceId, `/memories?${qsInsight}`),
    ]);
    return {
      total: all.total,
      pinned: pinned.total,
      insight: insight.total,
    };
  },

  async getMemory(spaceId: string, memoryId: string): Promise<Memory> {
    const response = await request<Memory>(
      spaceId,
      `/memories/${memoryId}`,
    );
    const normalized = normalizeMemory(response);
    void upsertCachedMemories(spaceId, [normalized]);
    return normalized;
  },

  async createMemory(
    spaceId: string,
    input: MemoryCreateInput,
  ): Promise<Memory> {
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
    const normalized = normalizeMemory(created);
    await upsertCachedMemories(spaceId, [normalized]);
    return normalized;
  },

  async updateMemory(
    spaceId: string,
    memoryId: string,
    input: MemoryUpdateInput,
    version?: number,
  ): Promise<Memory> {
    const headers: Record<string, string> = {};
    if (version !== undefined) headers["If-Match"] = String(version);
    const response = await request<Memory>(
      spaceId,
      `/memories/${memoryId}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify(input),
      },
    );
    const normalized = normalizeMemory(response);
    await upsertCachedMemories(spaceId, [normalized]);
    return normalized;
  },

  async deleteMemory(spaceId: string, memoryId: string): Promise<void> {
    await request<void>(spaceId, `/memories/${memoryId}`, {
      method: "DELETE",
    });
    await removeCachedMemory(spaceId, memoryId);
  },

  async exportMemories(spaceId: string): Promise<MemoryExportFile> {
    const PAGE = 200;
    const allMemories: Memory[] = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const page = await this.listMemories(spaceId, {
        limit: PAGE,
        offset,
      });
      allMemories.push(...page.memories);
      total = page.total;
      offset += PAGE;
    }

    return {
      schema_version: "mem9.memory_export.v1",
      exported_at: new Date().toISOString(),
      source_space_id: spaceId,
      agent_id: AGENT_ID,
      memories: allMemories.map((m) => ({
        content: m.content,
        source: m.source,
        tags: m.tags,
        metadata: m.metadata,
        memory_type: m.memory_type,
        created_at: m.created_at,
        updated_at: m.updated_at,
      })),
    };
  },

  async importMemories(spaceId: string, file: File): Promise<ImportTask> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("agent_id", AGENT_ID);
    formData.append("file_type", "memory");

    const res = await requestRaw(spaceId, "/imports", {
      method: "POST",
      body: formData,
    });
    return res.json();
  },

  async getImportTask(
    spaceId: string,
    taskId: string,
  ): Promise<ImportTask> {
    return request<ImportTask>(spaceId, `/imports/${taskId}`);
  },

  async listImportTasks(spaceId: string): Promise<ImportTaskList> {
    const tasks = await request<ImportTask[]>(spaceId, "/imports");
    if (!tasks || tasks.length === 0) {
      return { tasks: [], status: "empty" };
    }

    const hasProcessing = tasks.some(
      (t) => t.status === "pending" || t.status === "processing",
    );
    const hasFailed = tasks.some((t) => t.status === "failed");
    const allDone = tasks.every((t) => t.status === "done");

    let status: "empty" | "processing" | "partial" | "done" = "done";
    if (hasProcessing) status = "processing";
    else if (hasFailed && !allDone) status = "partial";

    return { tasks, status };
  },

  async getTopicSummary(
    _spaceId: string,
    _params?: TimeRangeParams,
  ): Promise<TopicSummary> {
    // Backend /summary not yet available; return empty.
    return { topics: [], total: 0 };
  },
};
