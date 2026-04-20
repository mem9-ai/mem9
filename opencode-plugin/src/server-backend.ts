import type { MemoryBackend } from "./backend.js";
import type {
  Memory,
  StoreResult,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * ServerBackend — talks to mem9 REST API.
 * Used when a runtime API key is available.
 */
export class ServerBackend implements MemoryBackend {
  private baseUrl: string;

  constructor(
    apiUrl: string,
    private apiKey: string,
    private agentName: string = "opencode",
  ) {
    this.baseUrl = apiUrl.replace(/\/+$/, "");
  }

  private memoryPath(path: string): string {
    return `/v1alpha2/mem9s${path}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Mnemo-Agent-Id": this.agentName,
      "X-API-Key": this.apiKey,
    };
    const resp = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8_000),
    });

    if (resp.status === 204) return undefined as T;

    const text = await resp.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!resp.ok) {
      const message =
        isRecord(data) && typeof data.error === "string" ? data.error : `HTTP ${resp.status}`;
      throw new Error(message);
    }
    return data as T;
  }

  async store(input: CreateMemoryInput): Promise<StoreResult> {
    return this.request<StoreResult>("POST", this.memoryPath("/memories"), input);
  }

  async search(input: SearchInput): Promise<SearchResult> {
    const params = new URLSearchParams();
    if (input.q) params.set("q", input.q);
    if (input.tags) params.set("tags", input.tags);
    if (input.source) params.set("source", input.source);
    if (input.limit != null) params.set("limit", String(input.limit));
    if (input.offset != null) params.set("offset", String(input.offset));
    if (input.memory_type) params.set("memory_type", input.memory_type);

    const qs = params.toString();
    const raw = await this.request<{
      memories: Memory[];
      total: number;
      limit: number;
      offset: number;
    }>("GET", `${this.memoryPath("/memories")}${qs ? "?" + qs : ""}`);

    return {
      memories: raw.memories ?? [],
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    };
  }

  async get(id: string): Promise<Memory | null> {
    try {
      return await this.request<Memory>("GET", this.memoryPath(`/memories/${id}`));
    } catch (err) {
      if (err instanceof Error && (err.message.includes("not found") || err.message.includes("404"))) {
        return null;
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    try {
      return await this.request<Memory>("PUT", this.memoryPath(`/memories/${id}`), input);
    } catch (err) {
      if (err instanceof Error && (err.message.includes("not found") || err.message.includes("404"))) {
        return null;
      }
      throw err;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.request("DELETE", this.memoryPath(`/memories/${id}`));
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
