import type {
  IngestInput,
  IngestResult,
  MemoryBackend,
} from "./backend.ts";
import type {
  Memory,
  StoreResult,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
} from "../shared/types.ts";
import { DEFAULT_SCOPE_CONFIG } from "../shared/defaults.ts";
import {
  Mem9HttpError,
  messageFromErrorBody,
  parseJsonOrUndefined,
} from "./quota-error.ts";
import { MEM9_PLUGIN_USER_AGENT } from "../shared/plugin-user-agent.ts";

function normalizeTimeoutMs(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

export interface ServerBackendOptions {
  defaultTimeoutMs?: number;
  searchTimeoutMs?: number;
}

/**
 * ServerBackend — talks to mem9 REST API.
 * Used when a runtime API key is available.
 */
export class ServerBackend implements MemoryBackend {
  private baseUrl: string;
  private defaultTimeoutMs: number;
  private searchTimeoutMs: number;

  constructor(
    apiUrl: string,
    private apiKey: string,
    private agentName: string = "opencode",
    options: ServerBackendOptions = {},
  ) {
    this.baseUrl = apiUrl.replace(/\/+$/, "");
    this.defaultTimeoutMs = normalizeTimeoutMs(
      options.defaultTimeoutMs,
      DEFAULT_SCOPE_CONFIG.defaultTimeoutMs,
    );
    this.searchTimeoutMs = normalizeTimeoutMs(
      options.searchTimeoutMs,
      DEFAULT_SCOPE_CONFIG.searchTimeoutMs,
    );
  }

  private memoryPath(path: string): string {
    return `/v1alpha2/mem9s${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<T> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Mnemo-Agent-Id": this.agentName,
      "X-API-Key": this.apiKey,
      "User-Agent": MEM9_PLUGIN_USER_AGENT,
    };
    const resp = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (resp.status === 204) return undefined as T;

    const text = await resp.text();
    if (!resp.ok) {
      const data = parseJsonOrUndefined(text);
      throw new Mem9HttpError(
        messageFromErrorBody(resp.status, text, data),
        resp.status,
        text,
        data,
      );
    }
    return JSON.parse(text) as T;
  }

  async store(input: CreateMemoryInput): Promise<StoreResult> {
    return this.request<StoreResult>("POST", this.memoryPath("/memories"), input);
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    return this.request<IngestResult>("POST", this.memoryPath("/memories"), input);
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
      message?: string;
      runtimeState?: unknown;
    }>(
      "GET",
      `${this.memoryPath("/memories")}${qs ? "?" + qs : ""}`,
      undefined,
      this.searchTimeoutMs,
    );

    return {
      memories: raw.memories ?? [],
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
      ...(typeof raw.message === "string" ? { message: raw.message } : {}),
      ...(raw.runtimeState !== undefined ? { runtimeState: raw.runtimeState } : {}),
    };
  }

  async get(id: string): Promise<Memory | null> {
    try {
      return await this.request<Memory>("GET", this.memoryPath(`/memories/${id}`));
    } catch (err) {
      if (err instanceof Mem9HttpError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    try {
      return await this.request<Memory>("PUT", this.memoryPath(`/memories/${id}`), input);
    } catch (err) {
      if (err instanceof Mem9HttpError && err.status === 404) {
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
      if (err instanceof Mem9HttpError && err.status === 404) {
        return false;
      }
      throw err;
    }
  }

  async listRecent(limit: number): Promise<Memory[]> {
    const result = await this.search({ limit, offset: 0 });
    return result.memories;
  }

  async runtimeState(): Promise<unknown> {
    return this.request<unknown>("GET", this.memoryPath("/runtime-state"));
  }
}
