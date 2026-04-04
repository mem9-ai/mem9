import { describe, expect, it } from "vitest";
import {
  createPixelFarmOpenBubbleState,
  formatPixelFarmDialogCounter,
} from "./dialog-state";

function createEntry(id: string) {
  return {
    id,
    content: id,
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
          showCounter: true,
          startIndexInclusive: 50,
          tagLabel: "Work",
        },
      },
      [createEntry("work-50"), createEntry("work-51")],
      null,
    );

    expect(state).toMatchObject({
      animalInstanceId: null,
      entries: [createEntry("work-50"), createEntry("work-51")],
      targetId: "bucket-work-plant-5",
      memoryIndex: 0,
      showCounter: true,
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
});
