import { describe, expect, it } from "vitest";
import { shouldIgnoreRepeatedDialogInteraction } from "./dialog-interaction";

describe("shouldIgnoreRepeatedDialogInteraction", () => {
  it("ignores a new interaction when the same target dialog is already open", () => {
    expect(shouldIgnoreRepeatedDialogInteraction({
      currentBubble: {
        animalInstanceId: null,
        bucketTotalMemoryCount: 12,
        entries: [],
        interactionNonce: 3,
        memoryIndex: 1,
        screenX: 100,
        screenY: 120,
        showCounter: true,
        startIndexInclusive: 0,
        tagLabel: "Work",
        targetId: "plant-1",
      },
      interactionNonce: 4,
      targetKind: "plant",
      targetId: "plant-1",
    })).toBe(true);
  });

  it("keeps new interactions when the target changes or no dialog is open", () => {
    expect(shouldIgnoreRepeatedDialogInteraction({
      currentBubble: null,
      interactionNonce: 4,
      targetKind: "plant",
      targetId: "plant-1",
    })).toBe(false);

    expect(shouldIgnoreRepeatedDialogInteraction({
      currentBubble: {
        animalInstanceId: null,
        bucketTotalMemoryCount: 12,
        entries: [],
        interactionNonce: 3,
        memoryIndex: 1,
        screenX: 100,
        screenY: 120,
        showCounter: true,
        startIndexInclusive: 0,
        tagLabel: "Work",
        targetId: "plant-1",
      },
      interactionNonce: 4,
      targetKind: "plant",
      targetId: "plant-2",
    })).toBe(false);
  });

  it("does not ignore repeated npc interactions", () => {
    expect(shouldIgnoreRepeatedDialogInteraction({
      currentBubble: {
        animalInstanceId: "npc-cow-1",
        bucketTotalMemoryCount: 1,
        entries: [],
        interactionNonce: 3,
        memoryIndex: 0,
        screenX: 100,
        screenY: 120,
        showCounter: false,
        startIndexInclusive: 0,
        tagLabel: "Farm Talk",
        targetId: "npc-cow-1",
      },
      interactionNonce: 4,
      targetKind: "npc",
      targetId: "npc-cow-1",
    })).toBe(false);
  });
});
