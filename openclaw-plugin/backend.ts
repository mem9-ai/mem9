import type {
  Memory,
  SearchResult,
  StoreResult,
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
  store(input: CreateMemoryInput): Promise<StoreResult>;
  search(input: SearchInput): Promise<SearchResult>;
  get(id: string): Promise<Memory | null>;
  update(id: string, input: UpdateMemoryInput): Promise<Memory | null>;
  remove(id: string): Promise<boolean>;

  /**
   * Ingest messages into the smart memory pipeline.
   * POST /v1alpha1/mem9s/{tenantID}/memories (messages body) → LLM extraction + reconciliation.
   */
  ingest(input: IngestInput): Promise<IngestResult>;
}
