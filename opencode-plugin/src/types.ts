/** Default mem9 API endpoint. */
export const DEFAULT_API_URL = "https://api.mem9.ai";

export interface Mem9ConfigFile {
  schemaVersion: 1;
  profileId?: string;
  debug?: boolean;
  defaultTimeoutMs?: number;
  searchTimeoutMs?: number;
}

export interface Mem9Profile {
  label: string;
  baseUrl: string;
  apiKey: string;
}

export interface Mem9CredentialsFile {
  schemaVersion: 1;
  profiles: Record<string, Mem9Profile>;
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

  relative_age?: string;
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
  memory_type?: string;
}

export type StoreResult = Memory;
