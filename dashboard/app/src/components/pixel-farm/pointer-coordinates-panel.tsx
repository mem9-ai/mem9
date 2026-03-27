import type { PixelFarmPointerDebugInfo } from "@/lib/pixel-farm/create-game";

interface PixelFarmPointerCoordinatesPanelProps {
  pointerDebugInfo: PixelFarmPointerDebugInfo | null;
}

function formatTile(
  tile: PixelFarmPointerDebugInfo["worldTile"],
): string {
  if (!tile) {
    return "--";
  }

  return `(${tile.column}, ${tile.row})`;
}

export function PixelFarmPointerCoordinatesPanel({
  pointerDebugInfo,
}: PixelFarmPointerCoordinatesPanelProps) {
  return (
    <aside className="pixel-farm-font rounded-2xl border border-[#f6dca6]/20 bg-[#141109]/88 px-4 py-3 text-[#f6dca6] shadow-2xl backdrop-blur">
      <div className="text-[11px] uppercase tracking-[0.24em] text-[#f6dca6]/55">
        Pointer Coordinates
      </div>
      <div className="mt-2 space-y-1 text-xs">
        <div>
          World Tile: {formatTile(pointerDebugInfo?.worldTile ?? null)}
        </div>
        <div>
          Island Tile: {formatTile(pointerDebugInfo?.islandTile ?? null)}
        </div>
      </div>
    </aside>
  );
}
