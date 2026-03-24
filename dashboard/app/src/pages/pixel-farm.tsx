import { useState } from "react";
import { PixelFarmActorPreviewPanel } from "@/components/pixel-farm/actor-preview-panel";
import { PhaserStage } from "@/components/pixel-farm/phaser-stage";
import { PixelFarmWorldStatePanel } from "@/components/pixel-farm/world-state-panel";
import {
  createDefaultPixelFarmDebugState,
  type PixelFarmDebugState,
} from "@/lib/pixel-farm/create-game";
import { usePixelFarmWorld } from "@/lib/pixel-farm/data/use-pixel-farm-world";
import { getActiveSpaceId } from "@/lib/session";

export function PixelFarmPage() {
  const [debugActorState, setDebugActorState] = useState<PixelFarmDebugState>(
    createDefaultPixelFarmDebugState,
  );
  const showDebugPanel = import.meta.env.DEV;
  const spaceId = getActiveSpaceId() ?? "pixel-farm-demo";
  const worldQuery = usePixelFarmWorld(spaceId);

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#0d141b] text-[#f6dca6]">
      <PhaserStage debugActorState={showDebugPanel ? debugActorState : null} />
      {showDebugPanel ? (
        <div className="absolute top-4 right-4 z-20 flex max-h-[calc(100vh-2rem)] flex-col items-end gap-3">
          <PixelFarmActorPreviewPanel
            onChange={setDebugActorState}
            value={debugActorState}
          />
          <PixelFarmWorldStatePanel spaceId={spaceId} worldQuery={worldQuery} />
        </div>
      ) : null}
    </main>
  );
}
