import { describe, expect, it } from "vitest";
import {
  createPixelFarmOpenBubbleState,
  formatPixelFarmDialogCounter,
} from "./dialog-state";

function createEntry(id: string, memoryOffset: number) {
  return {
    id,
    kind: "memory" as const,
    content: id,
    memoryOffset,
  };
}

function createIntroEntry() {
  return {
    id: "intro",
    kind: "intro" as const,
    content: "intro",
  };
}

describe("dialog-state", () => {
  it("keeps the dialog scoped to one plant slice and formats bucket-global counters", () => {
    const introEntry = createIntroEntry();
    const firstMemory = createEntry("work-50", 0);
    const secondMemory = createEntry("work-51", 1);
    const state = createPixelFarmOpenBubbleState(
      {
        interactionNonce: 3,
        target: {
          bucketTotalMemoryCount: 52,
          id: "bucket-work-plant-5",
          memoryIds: ["work-50", "work-51"],
          screenX: 120,
          screenY: 180,
          showCounter: true,
          startIndexInclusive: 50,
          tagLabel: "Work",
        },
      },
      [introEntry, firstMemory, secondMemory],
      null,
    );

    expect(state).toMatchObject({
      animalInstanceId: null,
      entries: [introEntry, firstMemory, secondMemory],
      targetId: "bucket-work-plant-5",
      memoryIndex: 0,
      showCounter: true,
      startIndexInclusive: 50,
      bucketTotalMemoryCount: 52,
    });
    expect(
      formatPixelFarmDialogCounter({
        bucketTotalMemoryCount: 52,
        memoryOffset: 1,
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
          showCounter: true,
          startIndexInclusive: 50,
          tagLabel: "Work",
        },
      },
      [],
      null,
    );

    expect(state).toBeNull();
  });

  it("resets the same plant dialog back to intro on a new interaction", () => {
    const state = createPixelFarmOpenBubbleState(
      {
        interactionNonce: 3,
        target: {
          bucketTotalMemoryCount: 52,
          id: "bucket-work-plant-5",
          memoryIds: ["work-50", "work-51"],
          screenX: 120,
          screenY: 180,
          showCounter: true,
          startIndexInclusive: 50,
          tagLabel: "Work",
        },
      },
      [createIntroEntry(), createEntry("work-50", 0), createEntry("work-51", 1)],
      {
        animalInstanceId: null,
        bucketTotalMemoryCount: 52,
        entries: [createIntroEntry(), createEntry("work-50", 0), createEntry("work-51", 1)],
        interactionNonce: 3,
        memoryIndex: 2,
        screenX: 120,
        screenY: 180,
        showCounter: true,
        startIndexInclusive: 50,
        tagLabel: "Work",
        targetId: "bucket-work-plant-5",
      },
    );

    const reopened = createPixelFarmOpenBubbleState(
      {
        interactionNonce: 4,
        target: {
          bucketTotalMemoryCount: 52,
          id: "bucket-work-plant-5",
          memoryIds: ["work-50", "work-51"],
          screenX: 120,
          screenY: 180,
          showCounter: true,
          startIndexInclusive: 50,
          tagLabel: "Work",
        },
      },
      [createIntroEntry(), createEntry("work-50", 0), createEntry("work-51", 1)],
      state,
    );

    expect(reopened?.memoryIndex).toBe(0);
  });
});
