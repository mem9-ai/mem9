import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PixelFarmWorldQueryState } from "@/lib/pixel-farm/data/types";

interface PixelFarmWorldStatePanelProps {
  spaceId: string;
  worldQuery: PixelFarmWorldQueryState;
}

function formatBuckets(count: number): string {
  return count === 1 ? "1 bucket" : `${count} buckets`;
}

function formatPlantCount(count: number): string {
  return count === 1 ? "1 plant" : `${count} plants`;
}

export function PixelFarmWorldStatePanel({
  spaceId,
  worldQuery,
}: PixelFarmWorldStatePanelProps) {
  const [collapsed, setCollapsed] = useState(true);

  if (collapsed) {
    return (
      <aside>
        <Button
          size="sm"
          variant="outline"
          className="rounded-full border-[#f6dca6]/25 bg-[#141109]/92 px-4 text-[#f6dca6] shadow-xl backdrop-blur hover:bg-[#221a0d]"
          onClick={() => setCollapsed(false)}
        >
          Open World Snapshot
        </Button>
      </aside>
    );
  }

  return (
    <aside className="pixel-farm-font w-[26rem] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-[#f6dca6]/20 bg-[#141109]/88 p-4 text-[#f6dca6] shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-[#f6dca6]/55">
            World Snapshot
          </div>
          <h2 className="mt-1 text-sm font-semibold tracking-[0.08em]">
            Memory Farm State
          </h2>
        </div>
        <Button
          size="xs"
          variant="outline"
          className="border-[#f6dca6]/25 bg-transparent text-[#f6dca6] hover:bg-[#f6dca6]/10"
          onClick={() => setCollapsed(true)}
        >
          Collapse
        </Button>
      </div>

      <div className="mt-3 text-sm font-semibold tracking-[0.08em]">
        {worldQuery.status === "ready"
          ? `${worldQuery.worldState?.totalMemories ?? 0} active memories`
          : worldQuery.status}
      </div>
      <div className="mt-1 text-xs text-[#f6dca6]/70">
        Space: {spaceId}
      </div>

      {worldQuery.error ? (
        <div className="mt-3 rounded-xl border border-[#e76f51]/30 bg-[#3c1f1b]/70 px-3 py-2 text-xs text-[#ffd6ce]">
          {worldQuery.error}
        </div>
      ) : null}

      {worldQuery.worldState ? (
        <div className="mt-3 space-y-2 text-xs text-[#f6dca6]/82">
          <div className="rounded-xl border border-[#f6dca6]/12 bg-[#0d141b]/55 px-3 py-2">
            <div>Main field: {worldQuery.worldState.fields.mainField.cells.length} tiles</div>
            <div>
              Event field: {worldQuery.worldState.fields.eventField?.cells.length ?? 0} tiles
            </div>
            <div>NPCs: {worldQuery.worldState.npcs.length}</div>
            <div>Buckets: {formatBuckets(worldQuery.worldState.memoryBuckets.length)}</div>
          </div>
          {worldQuery.worldState.memoryBuckets.map((bucket) => (
            <div
              key={bucket.id}
              className="rounded-xl border border-[#f6dca6]/12 bg-[#0d141b]/55 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-[#f6dca6]">
                  #{bucket.rank} {bucket.tagLabel}
                </span>
                <span className="uppercase tracking-[0.18em] text-[#f6dca6]/50">
                  {bucket.cropFamily}
                </span>
              </div>
              <div className="mt-1">
                {bucket.totalMemoryCount} memories, {formatPlantCount(bucket.plantCount)}
              </div>
              <div className="mt-1">
                Plant capacity: {bucket.plantCapacity}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
