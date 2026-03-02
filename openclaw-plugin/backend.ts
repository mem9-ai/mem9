import type {
  Memory,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
} from "./types.js";

/**
 * MemoryBackend — the abstraction that both direct and server mode implement.
 * All tools call through this interface, making them mode-agnostic.
 */
export interface MemoryBackend {
  store(input: CreateMemoryInput): Promise<Memory>;
  search(input: SearchInput): Promise<SearchResult>;
  get(id: string): Promise<Memory | null>;
  update(id: string, input: UpdateMemoryInput): Promise<Memory | null>;
  remove(id: string): Promise<boolean>;
}
