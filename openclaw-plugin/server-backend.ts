import type { MemoryBackend } from "./backend.js";
import type {
  Memory,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
} from "./types.js";

/**
 * ServerBackend — talks to mnemo-server REST API.
 * Used when config has apiUrl + apiToken.
 */
export class ServerBackend implements MemoryBackend {
  private baseUrl: string;
  private token: string;

  constructor(apiUrl: string, apiToken: string) {
    this.baseUrl = apiUrl.replace(/\/+$/, "");
    this.token = apiToken;
  }

  async store(input: CreateMemoryInput): Promise<Memory> {
    return this.request("POST", "/api/memories", input);
  }

  async search(input: SearchInput): Promise<SearchResult> {
    const params = new URLSearchParams();
    if (input.q) params.set("q", input.q);
    if (input.tags) params.set("tags", input.tags);
    if (input.source) params.set("source", input.source);
    if (input.key) params.set("key", input.key);
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
      data: raw.memories ?? [],
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    };
  }

  async get(id: string): Promise<Memory | null> {
    try {
      return await this.request<Memory>("GET", `/api/memories/${id}`);
    } catch {
      return null;
    }
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    try {
      return await this.request<Memory>("PUT", `/api/memories/${id}`, input);
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.request("DELETE", `/api/memories/${id}`);
      return true;
    } catch {
      return false;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };

    const resp = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });

    if (resp.status === 204) {
      return undefined as T;
    }

    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    return data as T;
  }
}
