/** Default mem9 API endpoint. */
export const DEFAULT_API_URL = "https://api.mem9.ai";

/** Env-based configuration for mem9 plugin. */
export interface Mem9Config {
  // Server mode (mem9-server REST API)
  apiUrl?: string;
  tenantID?: string;
  apiToken?: string;
}

export interface Memory {
  id: string;
  content: string;
  source?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  version?: number;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  score?: number;

  // Smart memory pipeline fields (server mode)
  memory_type?: string;
  state?: string;
  agent_id?: string;
  session_id?: string;
}

export interface SearchResult {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateMemoryInput {
  content: string;
  source?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateMemoryInput {
  content?: string;
  source?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface SearchInput {
  q?: string;
  tags?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export interface IngestMessage {
  role: string;
  content: string;
}

export interface IngestInput {
  messages: IngestMessage[];
  session_id: string;
  agent_id: string;
  mode?: "smart" | "raw";
}

export interface IngestResult {
  status: "accepted" | "complete" | "partial" | "failed";
  memories_changed?: number;
  insight_ids?: string[];
  warnings?: number;
  error?: string;
}

export type StoreResult = Memory | IngestResult;

/** Load config from env vars. Supports both MEM9_ and legacy MNEMO_ prefixes. */
export function loadConfig(): Mem9Config {
  return {
    apiUrl:
      process.env.MEM9_API_URL
      ?? process.env.MNEMO_API_URL
      ?? undefined,
    tenantID:
      process.env.MEM9_TENANT_ID
      ?? process.env.MNEMO_TENANT_ID
      ?? process.env.MNEMO_API_TOKEN
      ?? undefined,
    apiToken: process.env.MNEMO_API_TOKEN ?? undefined,
  };
}
