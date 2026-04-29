import { describe, expect, it } from "vitest";
import type { Memory } from "@/types/memory";
import { buildPixelFarmPlantDialogEntries } from "./plant-dialog-content";

function createMemory(id: string, content: string): Memory {
  return {
    id,
    content,
    memory_type: "pinned",
    source: "test",
    tags: ["Work"],
    metadata: null,
    agent_id: "agent-1",
    session_id: "session-1",
    state: "active",
    version: 1,
    updated_by: "tester",
    created_at: "2026-04-05T00:00:00.000Z",
    updated_at: "2026-04-05T00:00:00.000Z",
  };
}

describe("plant-dialog-content", () => {
  it("prepends one intro entry before the real plant memories", () => {
    const entries = buildPixelFarmPlantDialogEntries({
      bucketTotalMemoryCount: 12,
      memories: [
        createMemory("m1", "First memory"),
        createMemory("m2", "Second memory"),
      ],
      tagLabel: "Work",
      t: (key, vars) => `${key}:${JSON.stringify(vars ?? {})}`,
    });

    expect(entries).toEqual([
      {
        id: "plant-intro:Work:12",
        kind: "intro",
        content: "pixel_farm.plant_dialog.intro:{\"tag\":\"Work\",\"count\":12}",
      },
      {
        id: "m1",
        kind: "memory",
        content: "First memory",
        memoryOffset: 0,
      },
      {
        id: "m2",
        kind: "memory",
        content: "Second memory",
        memoryOffset: 1,
      },
    ]);
  });

  it("returns no dialog entries when a plant has no real memories", () => {
    expect(buildPixelFarmPlantDialogEntries({
      bucketTotalMemoryCount: 12,
      memories: [],
      tagLabel: "Work",
      t: (key) => key,
    })).toEqual([]);
  });
});
