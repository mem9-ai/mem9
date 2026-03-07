import type {
  Memory,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
  IngestInput,
  IngestResult,
} from "./types.js";

/**
 * MemoryBackend — the abstraction that tools and hooks call through.
 */
export interface MemoryBackend {
  store(input: CreateMemoryInput): Promise<Memory>;
  search(input: SearchInput): Promise<SearchResult>;
  get(id: string): Promise<Memory | null>;
  update(id: string, input: UpdateMemoryInput): Promise<Memory | null>;
  remove(id: string): Promise<boolean>;

  /**
   * Ingest messages into the smart memory pipeline.
   * POST /v1alpha1/mem9s/{tenantID}/memories/ingest → LLM extraction + reconciliation.
   */
  ingest(input: IngestInput): Promise<IngestResult>;
}
