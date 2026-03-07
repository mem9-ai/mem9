/** Env-based configuration for mnemo plugin. */
export interface MnemoConfig {
  // Server mode (mnemo-server REST API)
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

/** Load config from env vars. */
export function loadConfig(): MnemoConfig {
  return {
    apiUrl: process.env.MNEMO_API_URL || undefined,
    tenantID: process.env.MNEMO_TENANT_ID || process.env.MNEMO_API_TOKEN || undefined,
    apiToken: process.env.MNEMO_API_TOKEN || undefined,
  };
}
