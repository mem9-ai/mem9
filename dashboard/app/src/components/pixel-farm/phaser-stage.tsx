import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import {
  createPixelFarmGame,
  type PixelFarmDebugState,
} from "@/lib/pixel-farm/create-game";

interface PhaserStageProps {
  debugActorState?: PixelFarmDebugState | null;
}

export function PhaserStage({ debugActorState = null }: PhaserStageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const debugActorStateRef = useRef<PixelFarmDebugState | null>(debugActorState);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    debugActorStateRef.current = debugActorState;
  }, [debugActorState]);

  useEffect(() => {
    if (!hostRef.current || gameRef.current) {
      return undefined;
    }

    try {
      gameRef.current = createPixelFarmGame(hostRef.current, {
        getDebugActorState: () => debugActorStateRef.current,
      });
      setBootError(null);
    } catch (error) {
      setBootError(error instanceof Error ? error.message : String(error));
    }

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0d141b]">
      <div ref={hostRef} className="h-full w-full touch-none" />
      {bootError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0d141b] px-6 text-center text-sm uppercase tracking-[0.2em] text-[#f6dca6]">
          {bootError}
        </div>
      ) : null}
    </div>
  );
}
