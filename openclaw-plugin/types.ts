export interface PluginConfig {
  // Direct mode (host present → direct)
  host?: string;
  username?: string;
  password?: string;
  database?: string;

  // Server mode (apiUrl present → server)
  apiUrl?: string;
  apiToken?: string;
  userToken?: string;

  // Agent identity for CRDT vector clock (server mode only).
  // Defaults to "agent" if not set. Overridden by ctx.agentId at runtime.
  agentName?: string;

  // Auto-embedding via TiDB EMBED_TEXT() — takes priority over client-side embedding.
  // Example: "tidbcloud_free/amazon/titan-embed-text-v2"
  autoEmbedModel?: string;
  autoEmbedDims?: number;

  // Client-side embedding provider (optional — omit for keyword-only search)
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
  clock?: Record<string, number> | null;
  origin_agent?: string | null;
  tombstone?: boolean;
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
  clock?: Record<string, number>;
  write_id?: string;
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
