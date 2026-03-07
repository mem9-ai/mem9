import type { MemoryBackend } from "./backend.js";
import type {
  Memory,
  StoreResult,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
  IngestInput,
  IngestResult,
} from "./types.js";

type ProvisionMem9sResponse = {
  id: string;
  claim_url?: string;
};

export class ServerBackend implements MemoryBackend {
  private baseUrl: string;
  private tenantID: string;
  private agentName: string;

  constructor(apiUrl: string, tenantID: string, agentName: string) {
    this.baseUrl = apiUrl.replace(/\/+$/, "");
    this.tenantID = tenantID;
    this.agentName = agentName;
  }

  async register(): Promise<ProvisionMem9sResponse> {
    const resp = await fetch(this.baseUrl + "/v1alpha1/mem9s", {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`mem9s provision failed (${resp.status}): ${body}`);
    }

    const data = (await resp.json()) as ProvisionMem9sResponse;
    if (!data?.id) {
      throw new Error("mem9s provision did not return tenant ID");
    }

    this.tenantID = data.id;
    return data;
  }

  private tenantPath(path: string): string {
    if (!this.tenantID) {
      throw new Error("tenant ID is not configured");
    }
    return `/v1alpha1/mem9s/${this.tenantID}${path}`;
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
      data: raw.memories ?? [],
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    };
  }

  async get(id: string): Promise<Memory | null> {
    try {
      return await this.request<Memory>("GET", this.tenantPath(`/memories/${id}`));
    } catch {
      return null;
    }
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    try {
      return await this.request<Memory>("PUT", this.tenantPath(`/memories/${id}`), input);
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.request("DELETE", this.tenantPath(`/memories/${id}`));
      return true;
    } catch {
      return false;
    }
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    return this.request<IngestResult>("POST", this.tenantPath("/memories"), input);
  }

  private async requestRaw(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Mnemo-Agent-Id": this.agentName,
    };
    return fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8_000),
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
