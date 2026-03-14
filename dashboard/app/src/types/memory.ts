export interface Memory {
  id: string;
  content: string;
  memory_type: MemoryType;
  source: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
  agent_id: string;
  session_id: string;
  state: MemoryState;
  version: number;
  updated_by: string;
  created_at: string;
  updated_at: string;
  score?: number;
}

export type MemoryType = "pinned" | "insight";
export type MemoryState = "active" | "paused" | "archived" | "deleted";

export interface MemoryListResponse {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

export interface MemoryCreateInput {
  content: string;
  tags?: string[];
}

export interface MemoryBatchCreateRequest {
  memories: MemoryCreateInput[];
}

export interface MemoryBatchCreateResponse {
  ok: boolean;
  memories: Memory[];
}

export interface MemoryUpdateInput {
  content?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface SpaceInfo {
  tenant_id: string;
  name: string;
  status: "provisioning" | "active" | "suspended" | "deleted";
  provider: string;
  memory_count: number;
  created_at: string;
}

export interface ApiError {
  error: string;
}

export interface MemoryListParams {
  q?: string;
  tags?: string[];
  memory_type?: MemoryType;
  limit?: number;
  offset?: number;
  updated_from?: string;
  updated_to?: string;
  facet?: MemoryFacet;
}

export interface MemoryStats {
  total: number;
  pinned: number;
  insight: number;
}

export type MemoryFacet =
  | "about_you"
  | "preferences"
  | "important_people"
  | "experiences"
  | "plans"
  | "routines"
  | "constraints"
  | "other";

export interface MemoryExportFile {
  schema_version: "mem9.memory_export.v1";
  exported_at: string;
  source_space_id: string;
  agent_id: string;
  memories: MemoryExportEntry[];
}

export interface MemoryExportEntry {
  content: string;
  source: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
  memory_type: MemoryType;
  created_at: string;
  updated_at: string;
}

export interface TopicCount {
  facet: MemoryFacet;
  count: number;
}

export interface TopicSummary {
  topics: TopicCount[];
  total: number;
}
