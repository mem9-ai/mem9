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

export class PendingProvisionError extends Error {
  constructor(
    message = "mem9 create-new setup is waiting for the first post-restart message to finish provisioning",
  ) {
    super(message);
    this.name = "PendingProvisionError";
  }
}

export function isPendingProvisionError(err: unknown): err is PendingProvisionError {
  return err instanceof PendingProvisionError
    || (err instanceof Error && err.name === "PendingProvisionError");
}

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
   * POST /v1alpha{1,2}/mem9s/.../memories (messages body) → LLM extraction + reconciliation.
   */
  ingest(input: IngestInput): Promise<IngestResult>;
}
