import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Memory } from "@/types/memory";

function createMemory(id: string): Memory {
  const timestamp = "2026-03-19T00:00:00Z";
  return {
    id,
    content: `memory-${id}`,
    memory_type: "insight",
    source: "agent",
    tags: [],
    metadata: null,
    agent_id: "agent",
    session_id: "",
    state: "active",
    version: 1,
    updated_by: "agent",
    created_at: timestamp,
    updated_at: timestamp,
  };
}

vi.mock("./client", () => ({
  api: {
    listMemories: vi.fn(),
  },
}));

vi.mock("./local-cache", () => ({
  readCachedMemories: vi.fn(),
  readSyncState: vi.fn(),
  clearCachedMemoriesForSpace: vi.fn().mockResolvedValue(undefined),
  upsertCachedMemories: vi.fn().mockResolvedValue(undefined),
  patchSyncState: vi.fn().mockResolvedValue(undefined),
}));

async function importModules() {
  vi.resetModules();
  const sourceMemories = await import("./source-memories");
  const { api } = await import("./client");
  const localCache = await import("./local-cache");
  return { sourceMemories, api, localCache };
}

describe("loadSourceMemories", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses IndexedDB cache when hasFullCache is true", async () => {
    const { sourceMemories, api, localCache } = await importModules();
    const cachedMemory = createMemory("cached-1");

    vi.mocked(localCache.readSyncState).mockResolvedValue({
      spaceId: "space-1",
      hasFullCache: true,
      lastSyncedAt: "2026-03-18T00:00:00Z",
      incrementalCursor: null,
      incrementalTodo: "",
    });
    vi.mocked(localCache.readCachedMemories).mockResolvedValue([cachedMemory]);

    const result = await sourceMemories.loadSourceMemories("space-1");

    expect(api.listMemories).not.toHaveBeenCalled();
    expect(result).toEqual([cachedMemory]);
  });

  it("still uses IndexedDB cache after module reload when hasFullCache is true", async () => {
    // First "session"
    const first = await importModules();
    const memory1 = createMemory("m1");

    vi.mocked(first.localCache.readSyncState).mockResolvedValue({
      spaceId: "space-1",
      hasFullCache: true,
      lastSyncedAt: "2026-03-18T00:00:00Z",
      incrementalCursor: null,
      incrementalTodo: "",
    });
    vi.mocked(first.localCache.readCachedMemories).mockResolvedValue([memory1]);

    const firstResult = await first.sourceMemories.loadSourceMemories("space-1");

    expect(first.api.listMemories).not.toHaveBeenCalled();
    expect(firstResult).toEqual([memory1]);

    // Simulate page refresh: reset modules and re-import
    const second = await importModules();
    const memory2 = createMemory("m2");

    vi.mocked(second.localCache.readSyncState).mockResolvedValue({
      spaceId: "space-1",
      hasFullCache: true,
      lastSyncedAt: "2026-03-18T00:00:00Z",
      incrementalCursor: null,
      incrementalTodo: "",
    });
    vi.mocked(second.localCache.readCachedMemories).mockResolvedValue([memory2]);

    const result = await second.sourceMemories.loadSourceMemories("space-1");

    expect(second.api.listMemories).not.toHaveBeenCalled();
    expect(result).toEqual([memory2]);
  });

  it("fetches from API when hasFullCache is false", async () => {
    const { sourceMemories, api, localCache } = await importModules();
    const freshMemory = createMemory("fresh-1");

    vi.mocked(localCache.readSyncState).mockResolvedValue(null);
    vi.mocked(localCache.readCachedMemories).mockResolvedValue([]);
    vi.mocked(api.listMemories).mockResolvedValue({
      memories: [freshMemory],
      total: 1,
      limit: 200,
      offset: 0,
    });

    const result = await sourceMemories.loadSourceMemories("space-1");

    expect(api.listMemories).toHaveBeenCalled();
    expect(result).toEqual([freshMemory]);
    expect(localCache.patchSyncState).toHaveBeenCalledWith(
      "space-1",
      expect.objectContaining({
        hasFullCache: true,
        incrementalCursor: null,
      }),
    );
  });

  it("stops source sync at the hard budget and keeps the partial cache marked incomplete", async () => {
    const { sourceMemories, api, localCache } = await importModules();
    const total = sourceMemories.SOURCE_MEMORY_SYNC_BUDGET.maxRecords + 1;

    vi.mocked(localCache.readSyncState).mockResolvedValue(null);
    vi.mocked(localCache.readCachedMemories).mockResolvedValue([]);
    vi.mocked(api.listMemories).mockImplementation(
      async (_spaceId, params) => {
        const limit =
          params.limit ?? sourceMemories.SOURCE_MEMORY_SYNC_BUDGET.pageSize;
        const offset = params.offset ?? 0;

        return {
          memories: Array.from({ length: limit }, (_, index) =>
            createMemory(String(offset + index)),
          ),
          total,
          limit,
          offset,
        };
      },
    );

    const result = await sourceMemories.loadSourceMemories("space-1");

    expect(api.listMemories).toHaveBeenCalledTimes(
      sourceMemories.SOURCE_MEMORY_SYNC_BUDGET.maxPages,
    );
    expect(result).toHaveLength(
      sourceMemories.SOURCE_MEMORY_SYNC_BUDGET.maxRecords,
    );
    expect(localCache.patchSyncState).toHaveBeenCalledWith(
      "space-1",
      expect.objectContaining({
        hasFullCache: false,
      }),
    );
  });

  it("advances pagination by the number of records returned", async () => {
    const { sourceMemories, api, localCache } = await importModules();

    vi.mocked(localCache.readSyncState).mockResolvedValue(null);
    vi.mocked(localCache.readCachedMemories).mockResolvedValue([]);
    vi.mocked(api.listMemories)
      .mockResolvedValueOnce({
        memories: [createMemory("m1"), createMemory("m2")],
        total: 3,
        limit: 200,
        offset: 0,
      })
      .mockResolvedValueOnce({
        memories: [createMemory("m3")],
        total: 3,
        limit: 200,
        offset: 2,
      });

    const result = await sourceMemories.loadSourceMemories("space-1");

    expect(api.listMemories).toHaveBeenNthCalledWith(2, "space-1", {
      limit: sourceMemories.SOURCE_MEMORY_SYNC_BUDGET.pageSize,
      offset: 2,
    });
    expect(result).toHaveLength(3);
    expect(localCache.patchSyncState).toHaveBeenCalledWith(
      "space-1",
      expect.objectContaining({
        hasFullCache: true,
      }),
    );
  });
});

describe("useSourceMemories", () => {
  it("does not read cache or issue source requests while disabled", async () => {
    const { sourceMemories, api, localCache } = await importModules();
    const React = await import("react");
    const { renderHook } = await import("@testing-library/react");
    const { QueryClient, QueryClientProvider } = await import(
      "@tanstack/react-query"
    );
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const { result } = renderHook(
      () => sourceMemories.useSourceMemories("space-1", { enabled: false }),
      {
        wrapper: ({ children }) =>
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            children,
          ),
      },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(localCache.readCachedMemories).not.toHaveBeenCalled();
    expect(localCache.readSyncState).not.toHaveBeenCalled();
    expect(api.listMemories).not.toHaveBeenCalled();
  });
});
