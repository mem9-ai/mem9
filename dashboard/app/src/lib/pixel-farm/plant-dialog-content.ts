import i18n from "@/i18n";
import type { PixelFarmDialogEntry } from "@/lib/pixel-farm/dialog-state";
import type { Memory } from "@/types/memory";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function buildPixelFarmPlantDialogEntries(input: {
  bucketTotalMemoryCount: number;
  memories: readonly Memory[];
  tagLabel: string;
  t?: Translate;
}): PixelFarmDialogEntry[] {
  if (input.memories.length < 1) {
    return [];
  }

  const translate = input.t ?? ((key, vars) => i18n.t(key, vars));

  return [
    {
      id: `plant-intro:${input.tagLabel}:${input.bucketTotalMemoryCount}`,
      kind: "intro",
      content: translate("pixel_farm.plant_dialog.intro", {
        tag: input.tagLabel,
        count: input.bucketTotalMemoryCount,
      }),
    },
    ...input.memories.map((memory, index) => ({
      id: memory.id,
      kind: "memory" as const,
      content: memory.content,
      memoryOffset: index,
    })),
  ];
}
