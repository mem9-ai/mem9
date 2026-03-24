import { useState } from "react";
import { PixelFarmActorPreviewPanel } from "@/components/pixel-farm/actor-preview-panel";
import { PhaserStage } from "@/components/pixel-farm/phaser-stage";
import { PixelFarmPointerCoordinatesPanel } from "@/components/pixel-farm/pointer-coordinates-panel";
import { PixelFarmWorldStatePanel } from "@/components/pixel-farm/world-state-panel";
import {
  createDefaultPixelFarmDebugState,
  type PixelFarmDebugState,
  type PixelFarmPointerDebugInfo,
} from "@/lib/pixel-farm/create-game";
import { usePixelFarmWorld } from "@/lib/pixel-farm/data/use-pixel-farm-world";
import { getActiveSpaceId } from "@/lib/session";

export function PixelFarmPage() {
  const [debugActorState, setDebugActorState] = useState<PixelFarmDebugState>(
    createDefaultPixelFarmDebugState,
  );
  const [pointerDebugInfo, setPointerDebugInfo] = useState<PixelFarmPointerDebugInfo | null>(
    null,
  );
  const [showSpatialDebug, setShowSpatialDebug] = useState(false);
  const showDebugPanel = import.meta.env.DEV;
  const spaceId = getActiveSpaceId() ?? "pixel-farm-demo";
  const worldQuery = usePixelFarmWorld(spaceId);

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#0d141b] text-[#f6dca6]">
      <PhaserStage
        debugActorState={showDebugPanel ? debugActorState : null}
        onPointerDebugChange={showDebugPanel ? setPointerDebugInfo : null}
        showSpatialDebug={showDebugPanel ? showSpatialDebug : false}
        worldState={worldQuery.worldState}
      />
      {showDebugPanel ? (
        <>
          <div className="absolute top-4 left-4 z-20">
            <PixelFarmPointerCoordinatesPanel pointerDebugInfo={pointerDebugInfo} />
          </div>
          <div className="absolute top-4 right-4 z-20 flex max-h-[calc(100vh-2rem)] flex-col items-end gap-3">
            <PixelFarmActorPreviewPanel
              onChange={setDebugActorState}
              onToggleSpatialDebug={() => setShowSpatialDebug((current) => !current)}
              showSpatialDebug={showSpatialDebug}
              value={debugActorState}
            />
            <PixelFarmWorldStatePanel spaceId={spaceId} worldQuery={worldQuery} />
          </div>
        </>
      ) : null}
    </main>
  );
}
