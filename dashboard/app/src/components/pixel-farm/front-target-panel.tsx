import type {
  PixelFarmInteractionDebugInfo,
} from "@/lib/pixel-farm/create-game";

interface PixelFarmFrontTargetPanelProps {
  interactionDebugInfo: PixelFarmInteractionDebugInfo | null;
}

function formatTile(
  tile: PixelFarmInteractionDebugInfo["frontTile"],
): string {
  if (!tile) {
    return "--";
  }

  return `(${tile.column}, ${tile.row})`;
}

export function PixelFarmFrontTargetPanel({
  interactionDebugInfo,
}: PixelFarmFrontTargetPanelProps) {
  const target = interactionDebugInfo?.target ?? null;

  return (
    <aside className="pixel-farm-font rounded-2xl border border-[#f6dca6]/20 bg-[#141109]/88 px-4 py-3 text-[#f6dca6] shadow-2xl backdrop-blur">
      <div className="text-[11px] uppercase tracking-[0.24em] text-[#f6dca6]/55">
        Front Target
      </div>
      <div className="mt-2 space-y-1 text-xs">
        <div>Current Tile: {formatTile(interactionDebugInfo?.currentTile ?? null)}</div>
        <div>Front Tile: {formatTile(interactionDebugInfo?.frontTile ?? null)}</div>
        <div>Target ID: {target?.id ?? "--"}</div>
        <div>Kind: {target?.kind ?? "--"}</div>
        <div>Tag: {target?.tagLabel ?? "--"}</div>
        <div>Memories: {target ? target.memoryCount : "--"}</div>
      </div>
    </aside>
  );
}
