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
  private apiKey: string;
  private agentName: string;

  constructor(
    apiUrl: string,
    apiKey: string,
    agentName: string,
  ) {
    this.baseUrl = apiUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.agentName = agentName;
  }

  async register(): Promise<ProvisionMem9sResponse> {
    const resp = await fetch(this.baseUrl + "/v1alpha1/mem9s", {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
    });

    if (!resp.ok) {
      await this.throwErrorResponse(resp, "mem9s provision failed");
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

    const qs = params.toString();
    const raw = await this.request<{
      memories: Memory[];
      total: number;
      limit: number;
      offset: number;
    }>("GET", `${this.memoryPath("/memories")}${qs ? "?" + qs : ""}`);
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

  private async requestRaw(
    method: string,
    path: string,
    body?: unknown
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

    if (!resp.ok) {
      await this.throwErrorResponse(resp);
    }

    const data = await resp.json();
    return data as T;
  }

  private async throwErrorResponse(resp: Response, context?: string): Promise<never> {
    const headerRequestID = resp.headers.get("X-Request-Id");
    const contentType = resp.headers.get("Content-Type") ?? "";
    const body = await resp.text();
    const rawBody = body.trim();

    let message = rawBody || `HTTP ${resp.status}`;
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

    if (context) {
      message = `${context}: ${message}`;
    }

    throw new Mem9HttpError(resp.status, message, bodyRequestID ?? headerRequestID);
  }
}
