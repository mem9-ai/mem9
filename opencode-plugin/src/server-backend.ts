import type { MemoryBackend } from "./backend.js";
import type {
  Memory,
  StoreResult,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
} from "./types.js";

/**
 * ServerBackend — talks to mem9 REST API.
 * Used when MEM9_API_URL + MEM9_TENANT_ID are set.
 */
export class ServerBackend implements MemoryBackend {
  private baseUrl: string;
  private tenantID: string;
  private agentName: string;

  constructor(apiUrl: string, tenantID: string, agentName: string = "opencode") {
    this.baseUrl = apiUrl.replace(/\/+$/, "");
    this.tenantID = tenantID;
    this.agentName = agentName;
  }

  private tenantPath(path: string): string {
    if (!this.tenantID) {
      throw new Error("MEM9_TENANT_ID is required");
    }
    return `/v1alpha1/mem9s/${this.tenantID}${path}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Mnemo-Agent-Id": this.agentName,
    };
    const resp = await fetch(url, {
      method,
      headers,
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

  async store(input: CreateMemoryInput): Promise<StoreResult> {
    return this.request<StoreResult>("POST", this.tenantPath("/memories"), input);
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
    }>("GET", `${this.tenantPath("/memories")}${qs ? "?" + qs : ""}`);

    return {
      memories: raw.memories ?? [],
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    };
  }

  async get(id: string): Promise<Memory | null> {
    try {
      return await this.request<Memory>("GET", this.tenantPath(`/memories/${id}`));
    } catch (err) {
      if (err instanceof Error && (err.message.includes("not found") || err.message.includes("404"))) {
        return null;
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    try {
      return await this.request<Memory>("PUT", this.tenantPath(`/memories/${id}`), input);
    } catch (err) {
      if (err instanceof Error && (err.message.includes("not found") || err.message.includes("404"))) {
        return null;
      }
      throw err;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.request("DELETE", this.tenantPath(`/memories/${id}`));
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
