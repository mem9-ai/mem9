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
type ErrorResponse = {
  error?: string;
  request_id?: string;
};

class Mem9HttpError extends Error {
  readonly status: number;
  readonly requestID: string | null;

  constructor(status: number, message: string, requestID: string | null) {
    super(requestID ? `${message} [request_id: ${requestID}]` : message);
    this.name = "Mem9HttpError";
    this.status = status;
    this.requestID = requestID;
  }
}

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

    if (!resp.ok) {
      await this.throwErrorResponse(resp);
    }

    const data = await resp.json();
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
      if (err instanceof Mem9HttpError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    try {
      return await this.request<Memory>("PUT", this.tenantPath(`/memories/${id}`), input);
    } catch (err) {
      if (err instanceof Mem9HttpError && err.status === 404) {
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

  private async throwErrorResponse(resp: Response, fallbackMessage?: string): Promise<never> {
    const headerRequestID = resp.headers.get("X-Request-Id");
    const contentType = resp.headers.get("Content-Type") ?? "";
    const body = await resp.text();
    const rawBody = body.trim();

    let message = rawBody || fallbackMessage || `HTTP ${resp.status}`;
    let bodyRequestID: string | null = null;

    if (contentType.includes("application/json") && body) {
      try {
        const data = JSON.parse(body) as ErrorResponse;
        if (data.error) {
          message = data.error;
        }
        if (data.request_id) {
          bodyRequestID = data.request_id;
        }
      } catch {
        // fall through to raw body text
      }
    }

    throw new Mem9HttpError(resp.status, message, bodyRequestID ?? headerRequestID);
  }
}
