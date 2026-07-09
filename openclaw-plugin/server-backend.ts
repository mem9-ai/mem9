import { readFileSync } from "node:fs";

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
import {
  Mem9HttpError,
  messageFromErrorBody,
  parseJsonOrUndefined,
} from "./quota-error.js";

type ProvisionMem9sResponse = {
  id: string;
};

export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;
const MEM9_PLUGIN_USER_AGENT = `mem9-plugin/openclaw/${readPackageVersion()}`;

function readPackageVersion(): string {
  for (const relativePath of ["./package.json", "../package.json"]) {
    try {
      const pkg = JSON.parse(
        readFileSync(new URL(relativePath, import.meta.url), "utf8"),
      );
      if (typeof pkg.version === "string" && pkg.version.trim()) {
        return pkg.version.trim();
      }
    } catch {
      continue;
    }
  }

  return "unknown";
}

export interface BackendTimeouts {
  defaultTimeoutMs?: number;
  searchTimeoutMs?: number;
}

interface ServerBackendOptions {
  timeouts?: BackendTimeouts;
  provisionQueryParams?: Record<string, string>;
}

interface RequestOptions {
  timeoutMs?: number;
}

export class ServerBackend implements MemoryBackend {
  private baseUrl: string;
  private apiKey: string;
  private agentName: string;
  private provisionQueryParams: Record<string, string>;
  private timeouts: Required<BackendTimeouts>;

  constructor(
    apiUrl: string,
    apiKey: string,
    agentName: string,
    options: ServerBackendOptions = {},
  ) {
    this.baseUrl = apiUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.agentName = agentName;
    this.provisionQueryParams = options.provisionQueryParams ?? {};
    this.timeouts = {
      defaultTimeoutMs: options.timeouts?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      searchTimeoutMs: options.timeouts?.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
    };
  }

  async register(): Promise<ProvisionMem9sResponse> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(this.provisionQueryParams)) {
      if (!key.startsWith("utm_") || typeof value !== "string" || value === "") {
        continue;
      }

      query.set(key, value);
    }

    const qs = query.toString();
    const resp = await fetch(this.baseUrl + "/v1alpha1/mem9s" + (qs ? `?${qs}` : ""), {
      method: "POST",
      headers: {
        "User-Agent": MEM9_PLUGIN_USER_AGENT,
      },
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

  async ingest(input: IngestInput): Promise<IngestResult> {
    return this.request<IngestResult>("POST", this.memoryPath("/memories"), input);
  }

  async runtimeState(): Promise<unknown> {
    return this.request<unknown>("GET", this.memoryPath("/runtime-state"));
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
      "User-Agent": MEM9_PLUGIN_USER_AGENT,
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
}
