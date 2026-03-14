import type { DashboardProvider } from "./provider";
import type {
  Memory,
  MemoryListParams,
  MemoryListResponse,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryStats,
  MemoryExportFile,
  SpaceInfo,
  TopicSummary,
  MemoryFacet,
} from "@/types/memory";
import type { TimeRangeParams } from "@/types/time-range";
import type {
  ImportTask,
  ImportTaskList,
  ImportTaskListStatus,
  ImportTaskStatus,
} from "@/types/import";
import { mockMemories, mockSpaceInfo } from "./mock-data";

const AGENT_ID = "dashboard";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let mockStore = mockMemories.map((m) => ({ ...m }));

const mockImportTaskStore: ImportTask[] = [
  {
    id: "task-001",
    tenant_id: "demo",
    agent_id: "dashboard",
    file_name: "memories-backup.json",
    file_type: "memory",
    status: "done",
    total_count: 15,
    success_count: 15,
    error_message: "",
    created_at: new Date(Date.now() - 86_400_000 * 2).toISOString(),
    updated_at: new Date(Date.now() - 86_400_000 * 2).toISOString(),
  },
  {
    id: "task-002",
    tenant_id: "demo",
    agent_id: "dashboard",
    file_name: "team-knowledge.json",
    file_type: "memory",
    status: "done",
    total_count: 8,
    success_count: 7,
    error_message: "1 memory skipped: content too long",
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    id: "task-003",
    tenant_id: "demo",
    agent_id: "dashboard",
    file_name: "invalid-format.json",
    file_type: "memory",
    status: "failed",
    total_count: 0,
    success_count: 0,
    error_message: "Invalid JSON format",
    created_at: new Date(Date.now() - 3_600_000 * 5).toISOString(),
    updated_at: new Date(Date.now() - 3_600_000 * 5).toISOString(),
  },
  {
    id: "task-004",
    tenant_id: "demo",
    agent_id: "dashboard",
    file_name: "latest-export.json",
    file_type: "memory",
    status: "processing",
    total_count: 12,
    success_count: 4,
    error_message: "",
    created_at: new Date(Date.now() - 60_000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

function applyTimeFilter(memories: Memory[], params?: TimeRangeParams): Memory[] {
  if (!params?.updated_from && !params?.updated_to) return memories;
  return memories.filter((m) => {
    const t = new Date(m.updated_at).getTime();
    if (params.updated_from && t < new Date(params.updated_from).getTime())
      return false;
    if (params.updated_to && t > new Date(params.updated_to).getTime())
      return false;
    return true;
  });
}

function mockList(params: MemoryListParams): MemoryListResponse {
  let result = [...mockStore];

  if (params.updated_from || params.updated_to) {
    result = applyTimeFilter(result, {
      updated_from: params.updated_from,
      updated_to: params.updated_to,
    });
  }

  if (params.q) {
    const q = params.q.toLowerCase();
    result = result.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  if (params.tags?.length) {
    result = result.filter((m) =>
      params.tags?.every((tag) =>
        m.tags.some((memoryTag) => memoryTag.toLowerCase() === tag.toLowerCase()),
      ),
    );
  }

  if (params.memory_type) {
    result = result.filter((m) => m.memory_type === params.memory_type);
  }

  if (params.facet) {
    result = result.filter(
      (m) =>
        m.metadata &&
        (m.metadata as Record<string, unknown>).facet === params.facet,
    );
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

function mockStats(params?: TimeRangeParams): MemoryStats {
  const filtered = applyTimeFilter(mockStore, params);
  return {
    total: filtered.length,
    pinned: filtered.filter((m) => m.memory_type === "pinned").length,
    insight: filtered.filter((m) => m.memory_type === "insight").length,
  };
}

function mockTopicSummary(params?: TimeRangeParams): TopicSummary {
  const filtered = applyTimeFilter(mockStore, params);
  const counts = new Map<MemoryFacet, number>();

  for (const m of filtered) {
    const facet = (m.metadata as Record<string, unknown> | null)?.facet as
      | MemoryFacet
      | undefined;
    if (facet) {
      counts.set(facet, (counts.get(facet) ?? 0) + 1);
    }
  }

  const topics = Array.from(counts.entries())
    .map(([facet, count]) => ({ facet, count }))
    .sort((a, b) => b.count - a.count);

  return { topics, total: filtered.length };
}

export const mockProvider: DashboardProvider = {
  async verifySpace(spaceId: string): Promise<SpaceInfo> {
    await delay(400);
    const id = spaceId.trim();
    if (!id || id.length < 8) {
      throw new Error("Cannot access this space. Please check your ID.");
    }
    return { ...mockSpaceInfo, tenant_id: id };
  },

  async listMemories(
    _spaceId: string,
    params: MemoryListParams = {},
  ): Promise<MemoryListResponse> {
    await delay(300);
    return mockList(params);
  },

  async getStats(
    _spaceId: string,
    params?: TimeRangeParams,
  ): Promise<MemoryStats> {
    await delay(200);
    return mockStats(params);
  },

  async getMemory(_spaceId: string, memoryId: string): Promise<Memory> {
    await delay(150);
    const mem = mockStore.find((m) => m.id === memoryId);
    if (!mem) throw new Error("Memory not found");
    return { ...mem };
  },

  async createMemory(
    _spaceId: string,
    input: MemoryCreateInput,
  ): Promise<Memory> {
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
  },

  async updateMemory(
    _spaceId: string,
    memoryId: string,
    input: MemoryUpdateInput,
    _version?: number,
  ): Promise<Memory> {
    await delay(400);
    const existing = mockStore.find((m) => m.id === memoryId);
    if (!existing) throw new Error("Memory not found");
    const updated: Memory = {
      ...existing,
      content: input.content ?? existing.content,
      tags: input.tags ?? existing.tags,
      metadata: input.metadata !== undefined
        ? (input.metadata as Record<string, unknown>)
        : existing.metadata,
      version: existing.version + 1,
      updated_at: new Date().toISOString(),
      updated_by: AGENT_ID,
    };
    const idx = mockStore.indexOf(existing);
    mockStore[idx] = updated;
    return { ...updated };
  },

  async deleteMemory(_spaceId: string, memoryId: string): Promise<void> {
    await delay(300);
    mockStore = mockStore.filter((m) => m.id !== memoryId);
  },

  async exportMemories(_spaceId: string): Promise<MemoryExportFile> {
    await delay(500);
    return {
      schema_version: "mem9.memory_export.v1",
      exported_at: new Date().toISOString(),
      source_space_id: _spaceId,
      agent_id: AGENT_ID,
      memories: mockStore.map((m) => ({
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

  async importMemories(
    _spaceId: string,
    file: File,
  ): Promise<ImportTask> {
    await delay(800);
    const task: ImportTask = {
      id: `task-${Date.now()}`,
      tenant_id: _spaceId,
      agent_id: AGENT_ID,
      file_name: file.name,
      file_type: "memory",
      status: "processing",
      total_count: 0,
      success_count: 0,
      error_message: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockImportTaskStore.unshift(task);

    // Simulate async completion
    setTimeout(() => {
      task.status = "done" as ImportTaskStatus;
      task.total_count = 5;
      task.success_count = 5;
      task.updated_at = new Date().toISOString();
    }, 4000);

    return { ...task };
  },

  async getImportTask(
    _spaceId: string,
    taskId: string,
  ): Promise<ImportTask> {
    await delay(300);
    const task = mockImportTaskStore.find((t: ImportTask) => t.id === taskId);
    if (task) return { ...task };
    return {
      id: taskId,
      tenant_id: _spaceId,
      agent_id: AGENT_ID,
      file_name: "import.json",
      file_type: "memory",
      status: "done",
      total_count: 10,
      success_count: 10,
      error_message: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  },

  async listImportTasks(_spaceId: string): Promise<ImportTaskList> {
    await delay(400);
    if (mockImportTaskStore.length === 0) {
      return { tasks: [], status: "empty" };
    }
    const hasProcessing = mockImportTaskStore.some(
      (t: ImportTask) => t.status === "pending" || t.status === "processing",
    );
    const hasFailed = mockImportTaskStore.some(
      (t: ImportTask) => t.status === "failed",
    );
    const allDone = mockImportTaskStore.every(
      (t: ImportTask) => t.status === "done",
    );

    let listStatus: ImportTaskListStatus = "done";
    if (hasProcessing) listStatus = "processing";
    else if (hasFailed && !allDone) listStatus = "partial";

    return { tasks: [...mockImportTaskStore], status: listStatus };
  },

  async getTopicSummary(
    _spaceId: string,
    params?: TimeRangeParams,
  ): Promise<TopicSummary> {
    await delay(250);
    return mockTopicSummary(params);
  },
};
