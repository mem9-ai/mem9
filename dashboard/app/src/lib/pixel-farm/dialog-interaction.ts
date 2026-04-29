import type { PixelFarmOpenBubbleState } from "@/lib/pixel-farm/dialog-state";

export function shouldIgnoreRepeatedDialogInteraction(input: {
  currentBubble: PixelFarmOpenBubbleState | null;
  interactionNonce: number;
  targetKind: "npc" | "plant";
  targetId: string;
}): boolean {
  return Boolean(
    input.targetKind === "plant" &&
    input.currentBubble &&
    input.currentBubble.targetId === input.targetId &&
    input.interactionNonce > input.currentBubble.interactionNonce,
  );
}
