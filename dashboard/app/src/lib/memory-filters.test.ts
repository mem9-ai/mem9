import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  filterMemoriesForView,
  memoryMatchesRange,
  sortMemoriesByCreatedAtDesc,
} from "./memory-filters";
import type { Memory } from "@/types/memory";

const FIXED_NOW = new Date("2026-03-21T12:00:00Z");

function createMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? "mem-1",
    content: overrides.content ?? "mem9",
    memory_type: overrides.memory_type ?? "insight",
    source: overrides.source ?? "openclaw",
    tags: overrides.tags ?? ["project"],
    metadata: overrides.metadata ?? null,
    agent_id: overrides.agent_id ?? "agent",
    session_id: overrides.session_id ?? "session",
    state: overrides.state ?? "active",
    version: overrides.version ?? 1,
    updated_by: overrides.updated_by ?? "agent",
    created_at: overrides.created_at ?? "2026-03-10T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-03-10T00:00:00Z",
    score: overrides.score,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("memory filters", () => {
  it("sorts memories by created_at when created and updated timestamps diverge", () => {
    const newerByCreatedAt = createMemory({
      id: "mem-new",
      created_at: "2026-03-20T12:00:00Z",
      updated_at: "2026-03-01T12:00:00Z",
    });
    const olderByCreatedAt = createMemory({
      id: "mem-old",
      created_at: "2026-03-01T12:00:00Z",
      updated_at: "2026-03-20T12:00:00Z",
    });

    const result = sortMemoriesByCreatedAtDesc([olderByCreatedAt, newerByCreatedAt]);

    expect(result.map((memory) => memory.id)).toEqual(["mem-new", "mem-old"]);
  });

  it("matches the time range against created_at", () => {
    const insideRange = createMemory({
      id: "mem-inside",
      created_at: "2026-03-18T12:00:00Z",
      updated_at: "2026-03-01T12:00:00Z",
    });
    const outsideRange = createMemory({
      id: "mem-outside",
      created_at: "2026-02-18T12:00:00Z",
      updated_at: "2026-03-20T12:00:00Z",
    });

    expect(memoryMatchesRange(insideRange, "7d")).toBe(true);
    expect(memoryMatchesRange(outsideRange, "7d")).toBe(false);
  });

  it("filters and orders the visible memories by created_at", () => {
    const newest = createMemory({
      id: "mem-newest",
      content: "keep this launch note",
      memory_type: "insight",
      tags: ["launch", "team"],
      created_at: "2026-03-19T12:00:00Z",
      updated_at: "2026-03-01T12:00:00Z",
    });
    const middle = createMemory({
      id: "mem-middle",
      content: "keep this launch plan",
      memory_type: "insight",
      tags: ["launch"],
      created_at: "2026-03-17T12:00:00Z",
      updated_at: "2026-03-20T12:00:00Z",
    });
    const filteredOutByTime = createMemory({
      id: "mem-old",
      content: "keep this launch archive",
      memory_type: "insight",
      tags: ["launch"],
      created_at: "2026-02-10T12:00:00Z",
      updated_at: "2026-03-20T12:00:00Z",
    });
    const filteredOutByQuery = createMemory({
      id: "mem-query",
      content: "ignore this note",
      memory_type: "insight",
      tags: ["notes"],
      created_at: "2026-03-18T12:00:00Z",
      updated_at: "2026-03-18T12:00:00Z",
    });

    const result = filterMemoriesForView(
      [filteredOutByQuery, middle, filteredOutByTime, newest],
      {
        q: "launch",
        memoryType: "insight",
        range: "7d",
      },
    );

    expect(result.map((memory) => memory.id)).toEqual(["mem-newest", "mem-middle"]);
  });
});
