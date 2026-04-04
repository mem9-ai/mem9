import { describe, expect, it } from "vitest";
import {
  PIXEL_FARM_NPC_TIP_IDS,
  pickRandomPixelFarmNpcTipId,
} from "./npc-tips";

describe("npc-tips", () => {
  it("never repeats the previous tip when multiple tips are available", () => {
    for (const previousTipId of PIXEL_FARM_NPC_TIP_IDS) {
      const nextTipId = pickRandomPixelFarmNpcTipId(previousTipId, () => 0);
      expect(nextTipId).not.toBe(previousTipId);
    }
  });

  it("still returns a valid tip when there is no previous tip", () => {
    const nextTipId = pickRandomPixelFarmNpcTipId(null, () => 0.999999);
    expect(PIXEL_FARM_NPC_TIP_IDS).toContain(nextTipId);
  });
});
