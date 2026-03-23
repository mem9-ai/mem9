import { useState } from "react";
import { ChickenDebugPanel } from "@/components/pixel-farm/chicken-debug-panel";
import { PhaserStage } from "@/components/pixel-farm/phaser-stage";
import {
  createDefaultPixelFarmChickenDebugState,
  type PixelFarmChickenDebugState,
} from "@/lib/pixel-farm/create-game";

export function PixelFarmPage() {
  const [chickenDebugState, setChickenDebugState] = useState<PixelFarmChickenDebugState>(
    createDefaultPixelFarmChickenDebugState,
  );
  const showDebugPanel = import.meta.env.DEV;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#0d141b] text-[#f6dca6]">
      <PhaserStage chickenDebugState={showDebugPanel ? chickenDebugState : null} />
      {showDebugPanel ? (
        <ChickenDebugPanel onChange={setChickenDebugState} value={chickenDebugState} />
      ) : null}
    </main>
  );
}
