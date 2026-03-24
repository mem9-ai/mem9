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

  it("fetches from the API on first call even when hasFullCache is true", async () => {
    const { sourceMemories, api, localCache } = await importModules();
    const staleMemory = createMemory("stale-1");
    const freshMemory = createMemory("fresh-1");

    vi.mocked(localCache.readSyncState).mockResolvedValue({
      spaceId: "space-1",
      hasFullCache: true,
      lastSyncedAt: "2026-03-18T00:00:00Z",
      incrementalCursor: null,
      incrementalTodo: "",
    });
    vi.mocked(localCache.readCachedMemories).mockResolvedValue([staleMemory]);
    vi.mocked(api.listMemories).mockResolvedValue({
      memories: [freshMemory],
      total: 1,
      limit: 200,
      offset: 0,
    });

    const result = await sourceMemories.loadSourceMemories("space-1");

    expect(api.listMemories).toHaveBeenCalled();
    expect(result).toEqual([freshMemory]);
  });

  it("uses IndexedDB cache on second call within the same session", async () => {
    const { sourceMemories, api, localCache } = await importModules();
    const freshMemory = createMemory("fresh-1");

    vi.mocked(localCache.readSyncState).mockResolvedValue({
      spaceId: "space-1",
      hasFullCache: true,
      lastSyncedAt: "2026-03-18T00:00:00Z",
      incrementalCursor: null,
      incrementalTodo: "",
    });
    vi.mocked(localCache.readCachedMemories).mockResolvedValue([freshMemory]);
    vi.mocked(api.listMemories).mockResolvedValue({
      memories: [freshMemory],
      total: 1,
      limit: 200,
      offset: 0,
    });

    // First call: forces sync from API
    await sourceMemories.loadSourceMemories("space-1");
    vi.mocked(api.listMemories).mockClear();

    // Second call: should use cache
    const result = await sourceMemories.loadSourceMemories("space-1");

    expect(api.listMemories).not.toHaveBeenCalled();
    expect(result).toEqual([freshMemory]);
  });

  it("fetches from API on first call after module reload (simulating page refresh)", async () => {
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
    vi.mocked(first.api.listMemories).mockResolvedValue({
      memories: [memory1],
      total: 1,
      limit: 200,
      offset: 0,
    });

    await first.sourceMemories.loadSourceMemories("space-1");

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
    vi.mocked(second.localCache.readCachedMemories).mockResolvedValue([memory1]);
    vi.mocked(second.api.listMemories).mockResolvedValue({
      memories: [memory2],
      total: 1,
      limit: 200,
      offset: 0,
    });

    const result = await second.sourceMemories.loadSourceMemories("space-1");

    expect(second.api.listMemories).toHaveBeenCalled();
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
  });
});
