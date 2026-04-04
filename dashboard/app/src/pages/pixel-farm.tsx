import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PixelFarmActorPreviewPanel } from "@/components/pixel-farm/actor-preview-panel";
import { PixelFarmFeedbackDialog } from "@/components/pixel-farm/feedback-dialog";
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
  const navigate = useNavigate();
  const [debugActorState, setDebugActorState] = useState<PixelFarmDebugState>(
    createDefaultPixelFarmDebugState,
  );
  const [musicEnabled, setMusicEnabled] = useState(true);
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
        musicEnabled={musicEnabled}
        onInteractionDebugChange={showDebugPanel ? setInteractionDebugInfo : null}
        onPointerDebugChange={showDebugPanel ? setPointerDebugInfo : null}
        resolveInteractionMemories={worldQuery.resolveInteractionMemories}
        showInteractionDebug={showDebugPanel ? showInteractionDebug : false}
        showSpatialDebug={showDebugPanel ? showSpatialDebug : false}
        worldState={worldQuery.worldState}
      />
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-3">
        <button
          type="button"
          className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border-[2px] border-[#3f3322] bg-[#f6dca6]/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#3f3322] shadow-[2px_2px_0_0_#3f3322] backdrop-blur-sm transition-all hover:bg-[#f6dca6] active:translate-y-[2px] active:shadow-none"
          onClick={() => {
            if (window.history.length > 1) {
              window.history.back();
              return;
            }
            void navigate({ to: "/space" });
          }}
        >
          <ArrowLeft className="size-3.5" />
          {t("pixel_farm.controls.back")}
        </button>
        {showDebugPanel ? (
          <>
            <PixelFarmPointerCoordinatesPanel pointerDebugInfo={pointerDebugInfo} />
            <PixelFarmFrontTargetPanel interactionDebugInfo={interactionDebugInfo} />
          </>
        ) : null}
      </div>
      <aside className="absolute right-4 bottom-4 z-20 max-w-[16rem] rounded-lg border-[2px] border-[#3f3322] bg-[#f6dca6]/90 px-3 py-2 text-[#3f3322] shadow-[2px_2px_0_0_#3f3322] backdrop-blur-sm transition-opacity hover:bg-[#f6dca6]">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#8d6b43]">
          {t("pixel_farm.controls.title")}
        </p>
        <div className="mt-1.5 space-y-1 text-[11px] font-medium leading-relaxed">
          <p>
            <span className="font-bold text-[#3f3322]">WASD</span>
            <span className="mx-1 text-[#8d6b43]/50">/</span>
            <span className="font-bold text-[#3f3322]">↑↓←→</span>
            <span className="ml-1.5 text-[#5a452b]">{t("pixel_farm.controls.move")}</span>
          </p>
          <p>
            <span className="font-bold text-[#3f3322]">Space</span>
            <span className="ml-1.5 text-[#5a452b]">{t("pixel_farm.controls.interact")}</span>
          </p>
        </div>
        <button
          type="button"
          className="mt-2 inline-flex cursor-pointer items-center rounded-md border-[2px] border-[#8d6b43] bg-[#d2b881] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#5a452b] shadow-[2px_2px_0_0_#8d6b43] transition-all hover:bg-[#dfc48c] active:translate-y-[2px] active:shadow-none"
          onClick={() => setMusicEnabled((current) => !current)}
        >
          {t("pixel_farm.controls.music")}
          <span className="ml-1.5 text-[#8d6b43]">
            {musicEnabled ? t("pixel_farm.controls.on") : t("pixel_farm.controls.off")}
          </span>
        </button>
      </aside>
      <PixelFarmFeedbackDialog />
      {showDebugPanel ? (
        <>
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
