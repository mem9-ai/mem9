import type { MemoryBackend } from "./backend.js";
import type {
  Memory,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
} from "./types.js";

function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export class ServerBackend implements MemoryBackend {
  private baseUrl: string;
  private token: string;
  private agentName: string;

  constructor(apiUrl: string, apiToken: string, agentName: string) {
    this.baseUrl = apiUrl.replace(/\/+$/, "");
    this.token = apiToken;
    this.agentName = agentName;
  }

  async store(input: CreateMemoryInput): Promise<Memory> {
    if (!input.key) {
      return this.request("POST", "/api/memories", input);
    }

    const existing = await this.fetchByKey(input.key);
    const baseClock: Record<string, number> = existing?.clock
      ? { ...existing.clock }
      : {};
    baseClock[this.agentName] = (baseClock[this.agentName] ?? 0) + 1;

    const body: CreateMemoryInput = {
      ...input,
      clock: baseClock,
      write_id: uuidv4(),
    };

    const resp = await this.requestRaw("POST", "/api/memories", body);
    const mem = await resp.json() as Memory;
    return mem;
  }

  private async fetchByKey(key: string): Promise<Memory | null> {
    try {
      const params = new URLSearchParams({ key, limit: "1" });
      const raw = await this.request<{
        memories: Memory[];
        total: number;
      }>("GET", `/api/memories?${params.toString()}`);
      return raw.memories?.[0] ?? null;
    } catch {
      return null;
    }
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

  private async requestRaw(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      "X-Mnemo-Agent-Id": this.agentName,
    };
    return fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const resp = await this.requestRaw(method, path, body);

    if (resp.status === 204) {
      return undefined as T;
    }

    const data = await resp.json();
    if (!resp.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${resp.status}`);
    }
    return data as T;
  }
}
