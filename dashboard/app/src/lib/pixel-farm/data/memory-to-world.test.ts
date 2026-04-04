import { describe, expect, it } from "vitest";
import type { Memory } from "@/types/memory";
import { buildPixelFarmWorldState } from "./memory-to-world";

function createMemory(
  id: string,
  tag: string,
  createdAt: string,
  updatedAt = createdAt,
): Memory {
  return {
    id,
    content: id,
    memory_type: "insight",
    source: "test",
    tags: [tag],
    metadata: null,
    agent_id: "agent-1",
    session_id: "session-1",
    state: "active",
    version: 1,
    updated_by: "test",
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

describe("buildPixelFarmWorldState", () => {
  it("builds crop-only buckets with a shared plant capacity and contiguous slices", () => {
    const workMemories = Array.from({ length: 52 }, (_, index) =>
      createMemory(
        `work-${index}`,
        "Work",
        `2026-03-01T00:${String(index).padStart(2, "0")}:00.000Z`,
        `2026-04-01T00:${String(index).padStart(2, "0")}:00.000Z`,
      ),
    );
    const lifeMemories = Array.from({ length: 17 }, (_, index) =>
      createMemory(
        `life-${index}`,
        "Life",
        `2026-02-01T00:${String(index).padStart(2, "0")}:00.000Z`,
      ),
    );

    const world = buildPixelFarmWorldState({
      fetchedAt: "2026-04-04T00:00:00.000Z",
      memories: [...lifeMemories, ...workMemories],
      recentEvents: [],
      seedTags: [
        { key: "work", label: "Work", count: 52 },
        { key: "life", label: "Life", count: 17 },
      ],
      spaceId: "space-1",
      totalMemories: 69,
    });

    expect(world.memoryBuckets).toHaveLength(2);
    const workBucket = world.memoryBuckets[0];
    const lifeBucket = world.memoryBuckets[1];

    expect(workBucket).toBeDefined();
    expect(lifeBucket).toBeDefined();
    expect(workBucket).toMatchObject({
      tagKey: "work",
      totalMemoryCount: 52,
      plantCapacity: 10,
      plantCount: 6,
    });
    expect(workBucket?.sortedMemoryIds[0]).toBe("work-51");
    expect(workBucket?.plants[0]).toMatchObject({
      startIndexInclusive: 0,
      endIndexExclusive: 10,
      memoryCount: 10,
    });
    expect(workBucket?.plants[5]).toMatchObject({
      startIndexInclusive: 50,
      endIndexExclusive: 52,
      memoryCount: 2,
    });
    expect(lifeBucket).toMatchObject({
      tagKey: "life",
      plantCapacity: 10,
      plantCount: 2,
    });
    expect(world.fields.mainField.cells.length).toBeGreaterThan(0);
    expect(world.npcs).toHaveLength(8);
    expect(world.npcs.filter((npc) => npc.kind === "cow")).toHaveLength(2);
    expect(world.npcs.filter((npc) => npc.kind === "baby-cow")).toHaveLength(2);
    expect(world.npcs.filter((npc) => npc.kind === "chicken")).toHaveLength(4);
  });
});
