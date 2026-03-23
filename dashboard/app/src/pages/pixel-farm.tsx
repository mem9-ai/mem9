import { useState } from "react";
import { PixelFarmDebugPanel } from "@/components/pixel-farm/debug-panel";
import { PhaserStage } from "@/components/pixel-farm/phaser-stage";
import {
  createDefaultPixelFarmDebugState,
  type PixelFarmDebugState,
} from "@/lib/pixel-farm/create-game";

export function PixelFarmPage() {
  const [debugActorState, setDebugActorState] = useState<PixelFarmDebugState>(
    createDefaultPixelFarmDebugState,
  );
  const showDebugPanel = import.meta.env.DEV;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#0d141b] text-[#f6dca6]">
      <PhaserStage debugActorState={showDebugPanel ? debugActorState : null} />
      {showDebugPanel ? (
        <PixelFarmDebugPanel onChange={setDebugActorState} value={debugActorState} />
      ) : null}
    </main>
  );
}
