import type {
  CreateMemoryInput,
  Memory,
  SearchInput,
  SearchResult,
  StoreResult,
  UpdateMemoryInput,
} from "../shared/types.ts";

export interface IngestMessage {
  role: string;
  content: string;
}

export interface IngestInput {
  messages: IngestMessage[];
  session_id: string;
  agent_id: string;
  mode?: "smart";
}

export interface IngestResult {
  status: string;
  memories_changed?: number;
}

/**
 * MemoryBackend — abstraction for server mode.
 * All tools and hooks call through this interface.
 */
export interface MemoryBackend {
  store(input: CreateMemoryInput): Promise<StoreResult>;
  search(input: SearchInput): Promise<SearchResult>;
  get(id: string): Promise<Memory | null>;
  update(id: string, input: UpdateMemoryInput): Promise<Memory | null>;
  remove(id: string): Promise<boolean>;
  listRecent(limit: number): Promise<Memory[]>;
  ingest(input: IngestInput): Promise<IngestResult>;
}
