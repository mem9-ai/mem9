import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PixelFarmActorPreviewPanel } from "@/components/pixel-farm/actor-preview-panel";
import { PixelFarmFrontTargetPanel } from "@/components/pixel-farm/front-target-panel";
import { PhaserStage } from "@/components/pixel-farm/phaser-stage";
import { PixelFarmPointerCoordinatesPanel } from "@/components/pixel-farm/pointer-coordinates-panel";
import { PixelFarmWorldStatePanel } from "@/components/pixel-farm/world-state-panel";
import {
  createDefaultPixelFarmDebugState,
  type PixelFarmDebugState,
  type PixelFarmInteractionDebugInfo,
  type PixelFarmPointerDebugInfo,
} from "@/lib/pixel-farm/create-game";
import { usePixelFarmWorld } from "@/lib/pixel-farm/data/use-pixel-farm-world";
import { getActiveSpaceId } from "@/lib/session";

export function PixelFarmPage() {
  const { t } = useTranslation();
  const [debugActorState, setDebugActorState] = useState<PixelFarmDebugState>(
    createDefaultPixelFarmDebugState,
  );
  const [pointerDebugInfo, setPointerDebugInfo] = useState<PixelFarmPointerDebugInfo | null>(
    null,
  );
  const [interactionDebugInfo, setInteractionDebugInfo] =
    useState<PixelFarmInteractionDebugInfo | null>(null);
  const [showSpatialDebug, setShowSpatialDebug] = useState(false);
  const [showInteractionDebug, setShowInteractionDebug] = useState(false);
  const showDebugPanel = import.meta.env.DEV;
  const spaceId = getActiveSpaceId() ?? "pixel-farm-demo";
  const worldQuery = usePixelFarmWorld(spaceId);

  return (
    <main className="pixel-farm-font fixed inset-0 overflow-hidden bg-[#0d141b] text-[#f6dca6]">
      <PhaserStage
        debugActorState={showDebugPanel ? debugActorState : null}
        memoryById={worldQuery.memoryById}
        onInteractionDebugChange={showDebugPanel ? setInteractionDebugInfo : null}
        onPointerDebugChange={showDebugPanel ? setPointerDebugInfo : null}
        resolveInteractionMemories={worldQuery.resolveInteractionMemories}
        showInteractionDebug={showDebugPanel ? showInteractionDebug : false}
        showSpatialDebug={showDebugPanel ? showSpatialDebug : false}
        worldState={worldQuery.worldState}
      />
      <aside className="pointer-events-none absolute right-4 bottom-4 z-20 max-w-[18rem] rounded-2xl border border-[#f6dca6]/20 bg-[#141109]/88 px-4 py-3 text-[#f6dca6] shadow-2xl backdrop-blur">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#f6dca6]/72">
          {t("pixel_farm.controls.title")}
        </p>
        <div className="mt-2 space-y-1.5 text-[13px] leading-5">
          <p>
            <span className="font-medium text-[#fff0c6]">WASD</span>
            <span className="mx-1.5 text-[#f6dca6]/45">/</span>
            <span className="font-medium text-[#fff0c6]">↑↓←→</span>
            <span className="ml-2 text-[#f6dca6]/72">{t("pixel_farm.controls.move")}</span>
          </p>
          <p>
            <span className="font-medium text-[#fff0c6]">Space</span>
            <span className="ml-2 text-[#f6dca6]/72">{t("pixel_farm.controls.interact")}</span>
          </p>
        </div>
      </aside>
      {showDebugPanel ? (
        <>
          <div className="absolute top-4 left-4 z-20 flex flex-col gap-3">
            <PixelFarmPointerCoordinatesPanel pointerDebugInfo={pointerDebugInfo} />
            <PixelFarmFrontTargetPanel interactionDebugInfo={interactionDebugInfo} />
          </div>
          <div className="absolute top-4 right-4 z-20 flex max-h-[calc(100vh-2rem)] flex-col items-end gap-3">
            <PixelFarmActorPreviewPanel
              onChange={setDebugActorState}
              onToggleInteractionDebug={() => setShowInteractionDebug((current) => !current)}
              onToggleSpatialDebug={() => setShowSpatialDebug((current) => !current)}
              showInteractionDebug={showInteractionDebug}
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
