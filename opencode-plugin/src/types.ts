/** Default mem9 API endpoint. */
export const DEFAULT_API_URL = "https://api.mem9.ai";

/** Env-based configuration for mem9 plugin. */
export interface Mem9Config {
  // Server mode (mem9-server REST API)
  apiUrl?: string;
  tenantID?: string;
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

export type StoreResult = Memory;

/** Load config from env vars. */
export function loadConfig(): Mem9Config {
  return {
    apiUrl: process.env.MEM9_API_URL ?? undefined,
    tenantID: process.env.MEM9_TENANT_ID ?? undefined,
  };
}
