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
};

export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;

export interface BackendTimeouts {
  defaultTimeoutMs?: number;
  searchTimeoutMs?: number;
}

interface RequestOptions {
  timeoutMs?: number;
}

export class ServerBackend implements MemoryBackend {
  private baseUrl: string;
  private apiKey: string;
  private agentName: string;
  private timeouts: Required<BackendTimeouts>;

  constructor(
    apiUrl: string,
    apiKey: string,
    agentName: string,
    timeouts: BackendTimeouts = {},
  ) {
    this.baseUrl = apiUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.agentName = agentName;
    this.timeouts = {
      defaultTimeoutMs: timeouts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      searchTimeoutMs: timeouts.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
    };
  }

  async register(): Promise<ProvisionMem9sResponse> {
    const resp = await fetch(this.baseUrl + "/v1alpha1/mem9s", {
      method: "POST",
      signal: AbortSignal.timeout(this.timeouts.defaultTimeoutMs),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`mem9s provision failed (${resp.status}): ${body}`);
    }

    const data = (await resp.json()) as ProvisionMem9sResponse;
    if (!data?.id) {
      throw new Error("mem9s provision did not return API key");
    }

    this.apiKey = data.id;
    return data;
  }

  private memoryPath(path: string): string {
    if (!this.apiKey) {
      throw new Error("API key is not configured");
    }
    return `/v1alpha2/mem9s${path}`;
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
    }>(
      "GET",
      `${this.memoryPath("/memories")}${qs ? "?" + qs : ""}`,
      undefined,
      { timeoutMs: this.timeouts.searchTimeoutMs },
    );
    return {
      data: raw.memories ?? [],
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    };
  }

  async get(id: string): Promise<Memory | null> {
    try {
      return await this.request<Memory>("GET", this.memoryPath(`/memories/${id}`));
    } catch {
      return null;
    }
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    try {
      return await this.request<Memory>("PUT", this.memoryPath(`/memories/${id}`), input);
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.request("DELETE", this.memoryPath(`/memories/${id}`));
      return true;
    } catch {
      return false;
    }
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    return this.request<IngestResult>("POST", this.memoryPath("/memories"), input);
  }

  private async requestRaw(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<Response> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Mnemo-Agent-Id": this.agentName,
      "X-API-Key": this.apiKey,
    };
    return fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(options?.timeoutMs ?? this.timeouts.defaultTimeoutMs),
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const resp = await this.requestRaw(method, path, body, options);

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
