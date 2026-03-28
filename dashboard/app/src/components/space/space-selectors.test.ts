import { describe, expect, it } from "vitest";
import type { Memory } from "@/types/memory";
import { selectDisplayedMemories, shouldCompactMemoryOverview } from "./space-selectors";

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

describe("space selectors", () => {
  it("prefers analysis category results over tag and timeline results", () => {
    const memories = [createMemory("mem-1"), createMemory("mem-2"), createMemory("mem-3")];
    const selected = selectDisplayedMemories({
      analysisCategory: "activity",
      tag: "launch",
      timelineSelection: {
        from: "2026-03-01T00:00:00Z",
        to: "2026-03-02T00:00:00Z",
      },
      memories,
      analysisFilteredMemories: [memories[0]!, memories[1]!],
      tagFilteredMemories: [memories[2]!],
      timelineFilteredMemories: [memories[1]!],
      localVisibleCount: 1,
    });

    expect(selected.usingLocalFilteredList).toBe(true);
    expect(selected.baseDisplayedMemories).toEqual([memories[0], memories[1]]);
    expect(selected.displayedMemories).toEqual([memories[0]]);
  });

  it("detects compact overview mode only for desktop panel selection", () => {
    const memory = createMemory("mem-1");

    expect(shouldCompactMemoryOverview(memory, true, "panel")).toBe(true);
    expect(shouldCompactMemoryOverview(memory, true, "sheet")).toBe(false);
    expect(shouldCompactMemoryOverview(memory, false, "panel")).toBe(false);
    expect(shouldCompactMemoryOverview(null, true, "panel")).toBe(false);
  });
});
