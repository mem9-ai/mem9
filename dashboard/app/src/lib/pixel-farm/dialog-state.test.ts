import { describe, expect, it } from "vitest";
import type { Memory } from "@/types/memory";
import {
  createPixelFarmOpenBubbleState,
  formatPixelFarmDialogCounter,
} from "./dialog-state";

function createMemory(id: string): Memory {
  return {
    id,
    content: id,
    memory_type: "insight",
    source: "test",
    tags: ["Work"],
    metadata: null,
    agent_id: "agent-1",
    session_id: "session-1",
    state: "active",
    version: 1,
    updated_by: "test",
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

describe("dialog-state", () => {
  it("keeps the dialog scoped to one plant slice and formats bucket-global counters", () => {
    const state = createPixelFarmOpenBubbleState(
      {
        interactionNonce: 3,
        target: {
          bucketTotalMemoryCount: 52,
          id: "bucket-work-plant-5",
          memoryIds: ["work-50", "work-51"],
          screenX: 120,
          screenY: 180,
          startIndexInclusive: 50,
          tagLabel: "Work",
        },
      },
      [createMemory("work-50"), createMemory("work-51")],
      null,
    );

    expect(state).toMatchObject({
      targetId: "bucket-work-plant-5",
      memoryIds: ["work-50", "work-51"],
      memoryIndex: 0,
      startIndexInclusive: 50,
      bucketTotalMemoryCount: 52,
    });
    expect(
      formatPixelFarmDialogCounter({
        bucketTotalMemoryCount: 52,
        memoryIndex: 1,
        pageCount: 1,
        pageIndex: 0,
        startIndexInclusive: 50,
      }),
    ).toBe("52 / 52");
  });

  it("returns null when the selected plant has no real memories", () => {
    const state = createPixelFarmOpenBubbleState(
      {
        interactionNonce: 4,
        target: {
          bucketTotalMemoryCount: 52,
          id: "bucket-work-plant-5",
          memoryIds: [],
          screenX: 120,
          screenY: 180,
          startIndexInclusive: 50,
          tagLabel: "Work",
        },
      },
      [],
      null,
    );

    expect(state).toBeNull();
  });
});
