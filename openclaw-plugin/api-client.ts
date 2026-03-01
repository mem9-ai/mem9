/**
 * HTTP client for the mnemo server API.
 * Thin wrapper over fetch — all logic lives server-side.
 */

export interface MnemoConfig {
  apiUrl: string;
  apiToken: string;
}

export interface Memory {
  id: string;
  content: string;
  key?: string;
  source?: string;
  tags?: string[];
  version: number;
  updated_by?: string;
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateMemoryInput {
  content: string;
  key?: string;
  tags?: string[];
}

export interface UpdateMemoryInput {
  content?: string;
  tags?: string[];
}

export interface SearchInput {
  q?: string;
  tags?: string;
  source?: string;
  key?: string;
  limit?: number;
  offset?: number;
}

export class MnemoClient {
  private baseUrl: string;
  private token: string;

  constructor(cfg: MnemoConfig) {
    this.baseUrl = cfg.apiUrl.replace(/\/+$/, "");
    this.token = cfg.apiToken;
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
    return this.request("GET", `/api/memories${qs ? "?" + qs : ""}`);
  }

  async getById(id: string): Promise<Memory> {
    return this.request("GET", `/api/memories/${id}`);
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory> {
    return this.request("PUT", `/api/memories/${id}`, input);
  }

  async remove(id: string): Promise<void> {
    await this.request("DELETE", `/api/memories/${id}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
