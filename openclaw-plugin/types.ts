export interface PluginConfig {
  // Direct mode (host present → direct)
  host?: string;
  username?: string;
  password?: string;
  database?: string;

  // Server mode (apiUrl present → server)
  apiUrl?: string;
  apiToken?: string;

  // Embedding provider (optional — omit for keyword-only search)
  embedding?: EmbedConfig;
}

export interface EmbedConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  dims?: number;
}

export interface Memory {
  id: string;
  content: string;
  key?: string | null;
  source?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  version?: number;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  score?: number;
}

export interface SearchResult {
  data: Memory[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateMemoryInput {
  content: string;
  key?: string;
  source?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateMemoryInput {
  content?: string;
  key?: string;
  source?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface SearchInput {
  q?: string;
  tags?: string;
  source?: string;
  key?: string;
  limit?: number;
  offset?: number;
}
