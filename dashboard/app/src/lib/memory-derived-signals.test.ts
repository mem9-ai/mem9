import { describe, expect, it } from "vitest";
import {
  buildLocalDerivedSignalIndex,
  getCombinedTagsForMemory,
  getDerivedTagsForMemory,
} from "./memory-derived-signals";
import type { MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

function createMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    content: "Default memory content",
    memory_type: "insight",
    source: "agent",
    tags: [],
    metadata: null,
    agent_id: "agent",
    session_id: "session",
    state: "active",
    version: 1,
    updated_by: "agent",
    created_at: "2026-03-10T00:00:00Z",
    updated_at: "2026-03-10T00:00:00Z",
    ...overrides,
  };
}

function createMatch(memoryId: string, categories: string[]): MemoryAnalysisMatch {
  return {
    memoryId,
    categories,
    categoryScores: Object.fromEntries(categories.map((category) => [category, 1])),
  };
}

describe("memory-derived-signals", () => {
  it("derives up to two high-confidence tags for memories whose raw tags become empty", () => {
    const memories = [
      createMemory("mem-1", {
        content: "偏好 `OpenClaw`，部署到 /srv/openclaw/config。",
        tags: ["clawd", "md"],
      }),
      createMemory("mem-2", {
        content: "今天继续 `OpenClaw`，部署到 /srv/openclaw/config。",
        tags: ["import", "json"],
      }),
      createMemory("mem-3", {
        content: "Track `OpenClaw` deployment readiness.",
        tags: ["product"],
      }),
    ];

    const signalIndex = buildLocalDerivedSignalIndex({
      memories,
      matchMap: new Map([
        ["mem-1", createMatch("mem-1", ["project"])],
        ["mem-2", createMatch("mem-2", ["project"])],
        ["mem-3", createMatch("mem-3", ["project"])],
      ]),
    });

    expect(getDerivedTagsForMemory(memories[0]!, signalIndex)).toEqual(
      expect.arrayContaining([
        "/openclaw/config",
        "OpenClaw",
      ]),
    );
    expect(getCombinedTagsForMemory(memories[1]!, signalIndex)).toEqual(
      expect.arrayContaining([
        "/openclaw/config",
        "OpenClaw",
      ]),
    );
    expect(signalIndex.tagSourceByValue.get("openclaw")).toBe("derived");
    expect(signalIndex.tagStats.some((stat) => stat.value === "OpenClaw")).toBe(true);
  });

  it("keeps meaningful raw tags untouched and does not append derived tags", () => {
    const memory = createMemory("mem-raw", {
      content: "Use `OpenClaw` in the dashboard.",
      tags: ["customer-sync"],
    });

    const signalIndex = buildLocalDerivedSignalIndex({
      memories: [memory],
    });

    expect(getDerivedTagsForMemory(memory, signalIndex)).toEqual([]);
    expect(getCombinedTagsForMemory(memory, signalIndex)).toEqual(["customer-sync"]);
  });

  it("rejects person-like and low-signal candidates when nothing stable is available", () => {
    const memories = [
      createMemory("mem-1", {
        content: "Alice Johnson",
        tags: ["clawd", "md"],
      }),
      createMemory("mem-2", {
        content: "Ming Zhang",
        tags: ["import", "json"],
      }),
    ];

    const signalIndex = buildLocalDerivedSignalIndex({
      memories,
    });

    expect(getDerivedTagsForMemory(memories[0]!, signalIndex)).toEqual([]);
    expect(getCombinedTagsForMemory(memories[0]!, signalIndex)).toEqual([]);
    expect(signalIndex.tagStats).toEqual([]);
  });

  it("filters English function words and generic collaboration nouns out of derived tags", () => {
    const memories = [
      createMemory("mem-1", {
        content: "`OpenClaw` channel was updated for user sync.",
        tags: ["clawd", "md"],
      }),
      createMemory("mem-2", {
        content: "`OpenClaw` channel should stay available for user sync.",
        tags: ["import", "json"],
      }),
    ];

    const signalIndex = buildLocalDerivedSignalIndex({
      memories,
      matchMap: new Map([
        ["mem-1", createMatch("mem-1", ["project"])],
        ["mem-2", createMatch("mem-2", ["project"])],
      ]),
    });

    expect(getDerivedTagsForMemory(memories[0]!, signalIndex)).toContain("OpenClaw");
    expect(getDerivedTagsForMemory(memories[0]!, signalIndex)).not.toContain("was");
    expect(getDerivedTagsForMemory(memories[0]!, signalIndex)).not.toContain("channel");
    expect(getDerivedTagsForMemory(memories[0]!, signalIndex)).not.toContain("user");
    expect(signalIndex.tagStats.map((stat) => stat.normalizedValue)).not.toContain("was");
    expect(signalIndex.tagStats.map((stat) => stat.normalizedValue)).not.toContain("channel");
    expect(signalIndex.tagStats.map((stat) => stat.normalizedValue)).not.toContain("user");
  });
});
