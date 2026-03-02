import type { MemoryBackend } from "./backend.js";
import type {
  Memory,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
  MnemoConfig,
} from "./types.js";

const SPACE_ID = "default";
const MAX_CONTENT = 50_000;

interface TiDBResponse {
  types?: { name: string }[];
  rows?: unknown[][];
}

/**
 * DirectBackend — talks to TiDB Serverless via HTTP Data API.
 * Uses `fetch` (available in Bun natively) instead of @tidbcloud/serverless driver.
 */
export class DirectBackend implements MemoryBackend {
  private url: string;
  private auth: string;
  private db: string;
  private initialized = false;
  private dims: number;

  constructor(cfg: MnemoConfig) {
    this.url = `https://http-${cfg.dbHost}/v1beta/sql`;
    this.auth = "Basic " + btoa(`${cfg.dbUser}:${cfg.dbPass}`);
    this.db = cfg.dbName;
    this.dims = cfg.embedDims;
  }

  private escape(val: unknown): string {
    if (val === null || val === undefined) return "NULL";
    if (typeof val === "number") return String(val);
    if (typeof val === "boolean") return val ? "1" : "0";
    const s = String(val)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\0/g, "\\0")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\x1a/g, "\\Z");
    return `'${s}'`;
  }

  private interpolate(query: string, params?: unknown[]): string {
    if (!params || params.length === 0) return query;
    let i = 0;
    return query.replace(/\?/g, () => this.escape(params[i++]));
  }

  private async sql(query: string, params?: unknown[]): Promise<TiDBResponse> {
    const body: Record<string, unknown> = { database: this.db, query: this.interpolate(query, params) };

    const resp = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: this.auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`TiDB HTTP API ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<TiDBResponse>;
  }

  private async ensureSchema(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.sql(`CREATE TABLE IF NOT EXISTS memories (
        id          VARCHAR(36)       PRIMARY KEY,
        space_id    VARCHAR(36)       NOT NULL,
        content     TEXT              NOT NULL,
        key_name    VARCHAR(255),
        source      VARCHAR(100),
        tags        JSON,
        metadata    JSON,
        embedding   VECTOR(${this.dims}) NULL,
        version     INT               DEFAULT 1,
        updated_by  VARCHAR(100),
        created_at  TIMESTAMP         DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP         DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX idx_key    (space_id, key_name),
        INDEX idx_space         (space_id),
        INDEX idx_source        (space_id, source),
        INDEX idx_updated       (space_id, updated_at)
      )`);
    } catch {
      // Table may already exist — continue.
    }
    this.initialized = true;
  }

  private rowsToMemories(data: TiDBResponse): Memory[] {
    const cols = data.types?.map((c) => c.name) ?? [];
    return (data.rows ?? []).map((row) => {
      const obj: Record<string, unknown> = {};
      cols.forEach((col, i) => (obj[col] = row[i]));
      let tags = obj.tags;
      if (typeof tags === "string") {
        try { tags = JSON.parse(tags); } catch { tags = []; }
      }
      let metadata = obj.metadata;
      if (typeof metadata === "string") {
        try { metadata = JSON.parse(metadata); } catch { metadata = null; }
      }
      return {
        id: obj.id as string,
        content: obj.content as string,
        key: (obj.key_name as string) || null,
        source: (obj.source as string) || null,
        tags: (tags as string[]) || null,
        metadata: (metadata as Record<string, unknown>) || null,
        version: obj.version as number,
        updated_by: (obj.updated_by as string) || null,
        created_at: String(obj.created_at),
        updated_at: String(obj.updated_at),
      };
    });
  }

  async store(input: CreateMemoryInput): Promise<Memory> {
    await this.ensureSchema();
    if (!input.content || input.content.length > MAX_CONTENT) {
      throw new Error(`content is required and must be <= ${MAX_CONTENT} chars`);
    }

    const id = crypto.randomUUID();
    const tags = JSON.stringify(input.tags ?? []);
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

    await this.sql(
      `INSERT INTO memories (id, space_id, content, key_name, source, tags, metadata, version, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         content = VALUES(content), source = VALUES(source), tags = VALUES(tags),
         metadata = VALUES(metadata), version = version + 1, updated_by = VALUES(updated_by),
         updated_at = NOW()`,
      [id, SPACE_ID, input.content, input.key ?? null, input.source ?? null, tags, metadata, input.source ?? null],
    );

    // Re-read if key was provided (upsert may have updated existing row).
    if (input.key) {
      const result = await this.sql(
        "SELECT * FROM memories WHERE space_id = ? AND key_name = ?",
        [SPACE_ID, input.key],
      );
      const mems = this.rowsToMemories(result);
      if (mems.length > 0) return mems[0];
    }

    const result = await this.sql("SELECT * FROM memories WHERE id = ?", [id]);
    const mems = this.rowsToMemories(result);
    return mems[0] ?? { id, content: input.content, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  }

  async search(input: SearchInput): Promise<SearchResult> {
    await this.ensureSchema();
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);

    const conds: string[] = ["space_id = ?"];
    const params: unknown[] = [SPACE_ID];

    if (input.source) { conds.push("source = ?"); params.push(input.source); }
    if (input.key) { conds.push("key_name = ?"); params.push(input.key); }
    if (input.tags) {
      for (const tag of input.tags.split(",").map((t) => t.trim()).filter(Boolean)) {
        conds.push("JSON_CONTAINS(tags, ?)");
        params.push(JSON.stringify(tag));
      }
    }
    if (input.q) {
      conds.push("content LIKE CONCAT('%', ?, '%')");
      params.push(input.q);
    }

    const where = conds.join(" AND ");

    const countResult = await this.sql(
      `SELECT COUNT(*) as cnt FROM memories WHERE ${where}`, params,
    );
    const total = Number((countResult.rows?.[0]?.[0]) ?? 0);

    const dataResult = await this.sql(
      `SELECT * FROM memories WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return {
      memories: this.rowsToMemories(dataResult),
      total,
      limit,
      offset,
    };
  }

  async get(id: string): Promise<Memory | null> {
    await this.ensureSchema();
    const result = await this.sql(
      "SELECT * FROM memories WHERE id = ? AND space_id = ?", [id, SPACE_ID],
    );
    const mems = this.rowsToMemories(result);
    return mems[0] ?? null;
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    await this.ensureSchema();
    const existing = await this.get(id);
    if (!existing) return null;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.content !== undefined) {
      if (input.content.length > MAX_CONTENT) throw new Error(`content must be <= ${MAX_CONTENT} chars`);
      sets.push("content = ?"); values.push(input.content);
    }
    if (input.key !== undefined) { sets.push("key_name = ?"); values.push(input.key); }
    if (input.source !== undefined) { sets.push("source = ?"); values.push(input.source); }
    if (input.tags !== undefined) { sets.push("tags = ?"); values.push(JSON.stringify(input.tags)); }
    if (input.metadata !== undefined) { sets.push("metadata = ?"); values.push(JSON.stringify(input.metadata)); }

    if (sets.length === 0) return existing;
    sets.push("version = version + 1");

    await this.sql(
      `UPDATE memories SET ${sets.join(", ")} WHERE id = ? AND space_id = ?`,
      [...values, id, SPACE_ID],
    );

    return this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureSchema();
    const existing = await this.get(id);
    if (!existing) return false;
    await this.sql("DELETE FROM memories WHERE id = ? AND space_id = ?", [id, SPACE_ID]);
    return true;
  }

  async listRecent(limit: number): Promise<Memory[]> {
    await this.ensureSchema();
    const result = await this.sql(
      "SELECT * FROM memories WHERE space_id = ? ORDER BY updated_at DESC LIMIT ?",
      [SPACE_ID, limit],
    );
    return this.rowsToMemories(result);
  }
}
