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
  });
});
