import type { Memory } from "@/types/memory";
import type {
  PixelFarmCropStage,
} from "@/lib/pixel-farm/palette";
import type {
  PixelFarmFieldCell,
  PixelFarmFieldLayout,
} from "@/lib/pixel-farm/field-layout";

export interface PixelFarmSeedTag {
  key: string;
  label: string;
  count: number;
}

export interface PixelFarmInitialSnapshot {
  fetchedAt: string;
  memories: Memory[];
  seedTags?: PixelFarmSeedTag[];
  totalMemories?: number;
}

export interface PixelFarmDeltaEvent {
  seq: number;
  type: "upsert" | "archive" | "delete";
  occurredAt: string;
  memoryId: string;
  memory?: Memory;
  categoryKey: string;
  agentId: string;
}

export interface PixelFarmDeltaBatch {
  cursor: string | null;
  polledAt: string;
  events: PixelFarmDeltaEvent[];
}

export interface PixelFarmPlantState {
  id: string;
  cropStage: PixelFarmCropStage;
  endIndexExclusive: number;
  fillRatio: number;
  memoryCount: number;
  memoryIds: string[];
  startIndexInclusive: number;
}

export interface PixelFarmMemoryBucketState {
  id: string;
  cropFamily: string;
  plantCapacity: number;
  plantCount: number;
  plants: PixelFarmPlantState[];
  rank: number;
  sortedMemoryIds: string[];
  tagKey: string;
  tagLabel: string;
  totalMemoryCount: number;
}

export interface PixelFarmNpcState {
  id: string;
  kind: "baby-cow" | "chicken" | "cow";
  position: PixelFarmFieldCell | null;
}

export interface PixelFarmWorldState {
  activeSpaceId: string;
  fetchedAt: string;
  fields: {
    eventField: PixelFarmFieldLayout | null;
    mainField: PixelFarmFieldLayout;
  };
  memoryBuckets: PixelFarmMemoryBucketState[];
  npcs: PixelFarmNpcState[];
  recentEvents: PixelFarmDeltaEvent[];
  totalMemories: number;
}

export interface PixelFarmWorldQueryState {
  error: string | null;
  memoryById: Record<string, Memory>;
  resolveInteractionMemories: (tagKey: string) => Promise<Memory[]>;
  status: "idle" | "loading" | "ready" | "error";
  worldState: PixelFarmWorldState | null;
}
