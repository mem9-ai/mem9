import i18n from "@/i18n";
import type { PixelFarmDialogEntry } from "@/lib/pixel-farm/dialog-state";

export const PIXEL_FARM_NPC_TIP_IDS = [
  "move",
  "run",
  "interact",
  "bucket-to-crops",
  "bucket-slices",
  "latest-first",
] as const;

export type PixelFarmNpcTipId = (typeof PIXEL_FARM_NPC_TIP_IDS)[number];

export function pickRandomPixelFarmNpcTipId(
  previousTipId: PixelFarmNpcTipId | null,
  random: () => number = Math.random,
): PixelFarmNpcTipId {
  const candidates =
    previousTipId && PIXEL_FARM_NPC_TIP_IDS.length > 1
      ? PIXEL_FARM_NPC_TIP_IDS.filter((tipId) => tipId !== previousTipId)
      : PIXEL_FARM_NPC_TIP_IDS;
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return candidates[index]!;
}

export function getPixelFarmNpcDialogTitle(): string {
  return i18n.t("pixel_farm.npc_tips.title");
}

export function buildPixelFarmNpcDialogEntry(tipId: PixelFarmNpcTipId): PixelFarmDialogEntry {
  return {
    id: `npc-tip-${tipId}`,
    content: i18n.t(`pixel_farm.npc_tips.items.${tipId}`),
  };
}
