import type { MemoryBackend } from "./backend.js";
import type {
  Memory,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
  MnemoConfig,
} from "./types.js";

/**
 * ServerBackend — talks to mnemo-server REST API.
 * Used when MNEMO_API_URL + MNEMO_API_TOKEN are set.
 */
export class ServerBackend implements MemoryBackend {
  private baseUrl: string;
  private token: string;

  constructor(cfg: MnemoConfig) {
    this.baseUrl = (cfg.apiUrl ?? "").replace(/\/+$/, "");
    this.token = cfg.apiToken ?? "";
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const resp = await fetch(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8_000),
    });

    if (resp.status === 204) return undefined as T;

    const data = await resp.json();
    if (!resp.ok) {
      throw new Error((data as { error?: string }).error ?? `HTTP ${resp.status}`);
    }
    return data as T;
  }

  async store(input: CreateMemoryInput): Promise<Memory> {
    return this.request<Memory>("POST", "/api/memories", input);
  }

  async search(input: SearchInput): Promise<SearchResult> {
    const params = new URLSearchParams();
    if (input.q) params.set("q", input.q);
    if (input.tags) params.set("tags", input.tags);
    if (input.source) params.set("source", input.source);
    if (input.limit != null) params.set("limit", String(input.limit));
    if (input.offset != null) params.set("offset", String(input.offset));

    const qs = params.toString();
    const raw = await this.request<{
      memories: Memory[];
      total: number;
      limit: number;
      offset: number;
    }>("GET", `/api/memories${qs ? "?" + qs : ""}`);

    return {
      memories: raw.memories ?? [],
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    };
  }

  async get(id: string): Promise<Memory | null> {
    try {
      return await this.request<Memory>("GET", `/api/memories/${id}`);
    } catch (err) {
      if (err instanceof Error && (err.message.includes("not found") || err.message.includes("404"))) {
        return null;
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    try {
      return await this.request<Memory>("PUT", `/api/memories/${id}`, input);
    } catch (err) {
      if (err instanceof Error && (err.message.includes("not found") || err.message.includes("404"))) {
        return null;
      }
      throw err;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.request("DELETE", `/api/memories/${id}`);
      return true;
    } catch (err) {
      if (err instanceof Error && (err.message.includes("not found") || err.message.includes("404"))) {
        return false;
      }
      throw err;
    }
  }

  async listRecent(limit: number): Promise<Memory[]> {
    const result = await this.search({ limit, offset: 0 });
    return result.memories;
  }
}
