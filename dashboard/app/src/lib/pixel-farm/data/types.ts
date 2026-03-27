import type { Memory } from "@/types/memory";
import type {
  PixelFarmBucketAnimalTier,
  PixelFarmCropStage,
} from "@/lib/pixel-farm/palette";

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

export interface PixelFarmBucketState {
  id: string;
  active: boolean;
  count: number;
  fillRatio: number;
  stage: PixelFarmCropStage;
}

export interface PixelFarmAnimalState {
  id: string;
  active: boolean;
  tier: PixelFarmBucketAnimalTier;
}

export interface PixelFarmAnimalBucketState {
  id: string;
  instanceCount: number;
  memoryIds: string[];
  rank: number;
  tagKey: string;
  tagLabel: string;
  tier: PixelFarmBucketAnimalTier;
  totalCount: number;
  zone: "chicken-pen" | "cow-pen";
}

export interface PixelFarmCropBucketState {
  id: string;
  cropFamily: string;
  memoryIds: string[];
  plotIndex: number;
  rank: number;
  tagKey: string;
  tagLabel: string;
  totalCount: number;
  instances: PixelFarmBucketState[];
}

export interface PixelFarmRoleState {
  id: string;
  action: "idle" | "sow" | "water" | "harvest" | "clear";
  agentId: string;
  categoryKey: string;
  updatedAt: string;
}

export interface PixelFarmCategoryState {
  key: string;
  label: string;
  kind: "main" | "other";
  plotIndex: number;
  totalCount: number;
  memoryIds: string[];
  cropFamily: string | null;
  decorationFamilies: string[];
  dominantAgentId: string | null;
  buckets: PixelFarmBucketState[];
  animals: PixelFarmAnimalState[];
}

export interface PixelFarmWorldState {
  fetchedAt: string;
  activeSpaceId: string;
  totalMemories: number;
  animalBuckets: PixelFarmAnimalBucketState[];
  cropBuckets: PixelFarmCropBucketState[];
  categories: PixelFarmCategoryState[];
  roles: PixelFarmRoleState[];
  recentEvents: PixelFarmDeltaEvent[];
}

export interface PixelFarmWorldQueryState {
  error: string | null;
  memoryById: Record<string, Memory>;
  resolveInteractionMemories: (tagKey: string) => Promise<Memory[]>;
  status: "idle" | "loading" | "ready" | "error";
  worldState: PixelFarmWorldState | null;
}
