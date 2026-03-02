import { connect } from "@tidbcloud/serverless";
import type { Connection } from "@tidbcloud/serverless";
import type { MemoryBackend } from "./backend.js";
import type { Embedder } from "./embedder.js";
import { vecToString } from "./embedder.js";
import { initSchema } from "./schema.js";
import type {
  Memory,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
} from "./types.js";

const SPACE_ID = "default";
const MAX_CONTENT_LENGTH = 50_000;
const MAX_TAGS = 20;

// DB row shape (tags/metadata may come back as strings from @tidbcloud/serverless)
interface MemoryRow {
  id: string;
  space_id: string;
  content: string;
  key_name: string | null;
  source: string | null;
  tags: string[] | string | null;
  metadata: Record<string, unknown> | string | null;
  embedding: string | null;
  version: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  distance?: string;
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function formatMemory(row: MemoryRow, score?: number): Memory {
  return {
    id: row.id,
    content: row.content,
    key: row.key_name,
    source: row.source,
    tags: typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags,
    metadata:
      typeof row.metadata === "string"
        ? JSON.parse(row.metadata)
        : row.metadata,
    version: row.version,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(score !== undefined ? { score } : {}),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * DirectBackend — talks directly to TiDB Serverless via @tidbcloud/serverless.
 * Used when config has host/username/password/database.
 */
export class DirectBackend implements MemoryBackend {
  private conn: Connection;
  private embedder: Embedder | null;
  private initialized: Promise<void>;

  constructor(
    host: string,
    username: string,
    password: string,
    database: string,
    embedder: Embedder | null
  ) {
    this.conn = connect({ host, username, password, database });
    this.embedder = embedder;
    const dims = embedder?.dims ?? 1536;
    this.initialized = initSchema(this.conn, dims).catch(() => {
      // Schema init failed — table may already exist. Continue.
    });
  }

  async store(input: CreateMemoryInput): Promise<Memory> {
    await this.initialized;
    this.validateContent(input.content);

    const id = generateId();
    const embedding = this.embedder
      ? await this.embedder.embed(input.content)
      : null;

    await this.conn.execute(
      `INSERT INTO memories (id, space_id, content, key_name, source, tags, metadata, embedding, version, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        SPACE_ID,
        input.content,
        input.key ?? null,
        input.source ?? null,
        input.tags ? JSON.stringify(input.tags) : null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        embedding ? vecToString(embedding) : null,
        input.source ?? null,
      ]
    );

    const rows = (await this.conn.execute(
      "SELECT * FROM memories WHERE id = ?",
      [id]
    )) as unknown as MemoryRow[];
    return formatMemory(rows[0]);
  }

  async search(input: SearchInput): Promise<SearchResult> {
    await this.initialized;
    const limit = clamp(input.limit ?? 20, 1, 200);
    const offset = Math.max(input.offset ?? 0, 0);

    if (input.q && this.embedder) {
      return this.hybridSearch(input.q, input, limit, offset);
    }
    return this.keywordSearch(input, limit, offset);
  }

  async get(id: string): Promise<Memory | null> {
    await this.initialized;
    const rows = (await this.conn.execute(
      "SELECT * FROM memories WHERE id = ? AND space_id = ?",
      [id, SPACE_ID]
    )) as unknown as MemoryRow[];
    return rows.length > 0 ? formatMemory(rows[0]) : null;
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    await this.initialized;
    const existing = (await this.conn.execute(
      "SELECT id FROM memories WHERE id = ? AND space_id = ?",
      [id, SPACE_ID]
    )) as unknown as MemoryRow[];
    if (existing.length === 0) return null;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.content !== undefined) {
      this.validateContent(input.content);
      sets.push("content = ?");
      values.push(input.content);

      // Re-generate embedding only if content changed.
      if (this.embedder) {
        const embedding = await this.embedder.embed(input.content);
        sets.push("embedding = ?");
        values.push(vecToString(embedding));
      }
    }
    if (input.key !== undefined) {
      sets.push("key_name = ?");
      values.push(input.key);
    }
    if (input.source !== undefined) {
      sets.push("source = ?");
      values.push(input.source);
    }
    if (input.tags !== undefined) {
      sets.push("tags = ?");
      values.push(JSON.stringify(input.tags));
    }
    if (input.metadata !== undefined) {
      sets.push("metadata = ?");
      values.push(JSON.stringify(input.metadata));
    }

    if (sets.length === 0) throw new Error("no fields to update");

    sets.push("version = version + 1");

    await this.conn.execute(
      `UPDATE memories SET ${sets.join(", ")} WHERE id = ? AND space_id = ?`,
      [...values, id, SPACE_ID]
    );

    const rows = (await this.conn.execute(
      "SELECT * FROM memories WHERE id = ?",
      [id]
    )) as unknown as MemoryRow[];
    return formatMemory(rows[0]);
  }

  async remove(id: string): Promise<boolean> {
    await this.initialized;
    const existing = (await this.conn.execute(
      "SELECT id FROM memories WHERE id = ? AND space_id = ?",
      [id, SPACE_ID]
    )) as unknown as MemoryRow[];
    if (existing.length === 0) return false;

    await this.conn.execute(
      "DELETE FROM memories WHERE id = ? AND space_id = ?",
      [id, SPACE_ID]
    );
    return true;
  }

  private async keywordSearch(
    input: SearchInput,
    limit: number,
    offset: number
  ): Promise<SearchResult> {
    const conditions: string[] = ["space_id = ?"];
    const values: unknown[] = [SPACE_ID];

    if (input.source) {
      conditions.push("source = ?");
      values.push(input.source);
    }
    if (input.key) {
      conditions.push("key_name = ?");
      values.push(input.key);
    }
    if (input.tags) {
      for (const tag of input.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)) {
        conditions.push("JSON_CONTAINS(tags, ?)");
        values.push(JSON.stringify(tag));
      }
    }
    if (input.q) {
      conditions.push("content LIKE CONCAT('%', ?, '%')");
      values.push(input.q);
    }

    const where = conditions.join(" AND ");

    const countRows = (await this.conn.execute(
      `SELECT COUNT(*) as cnt FROM memories WHERE ${where}`,
      values
    )) as unknown as { cnt: number }[];
    const total = Number(countRows[0]?.cnt ?? 0);

    const rows = (await this.conn.execute(
      `SELECT * FROM memories WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    )) as unknown as MemoryRow[];

    return {
      data: rows.map((r) => formatMemory(r)),
      total,
      limit,
      offset,
    };
  }

  private async hybridSearch(
    q: string,
    input: SearchInput,
    limit: number,
    offset: number
  ): Promise<SearchResult> {
    const queryVec = await this.embedder!.embed(q);
    const vecStr = vecToString(queryVec);

    const filterConditions: string[] = ["space_id = ?"];
    const filterValues: unknown[] = [SPACE_ID];

    if (input.source) {
      filterConditions.push("source = ?");
      filterValues.push(input.source);
    }
    if (input.key) {
      filterConditions.push("key_name = ?");
      filterValues.push(input.key);
    }
    if (input.tags) {
      for (const tag of input.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)) {
        filterConditions.push("JSON_CONTAINS(tags, ?)");
        filterValues.push(JSON.stringify(tag));
      }
    }

    const filterWhere = filterConditions.join(" AND ");
    const fetchLimit = limit * 3;

    // ANN vector search — ORDER BY must exactly match for VECTOR INDEX usage.
    const vecRows = (await this.conn.execute(
      `SELECT *, VEC_COSINE_DISTANCE(embedding, ?) AS distance
       FROM memories
       WHERE ${filterWhere} AND embedding IS NOT NULL
       ORDER BY VEC_COSINE_DISTANCE(embedding, ?)
       LIMIT ?`,
      [vecStr, ...filterValues, vecStr, fetchLimit]
    )) as unknown as MemoryRow[];

    // Keyword search.
    const kwConditions = [
      ...filterConditions,
      "content LIKE CONCAT('%', ?, '%')",
    ];
    const kwRows = (await this.conn.execute(
      `SELECT * FROM memories WHERE ${kwConditions.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`,
      [...filterValues, q, fetchLimit]
    )) as unknown as MemoryRow[];

    // Merge by id — vector score takes priority.
    const byId = new Map<string, { row: MemoryRow; score: number }>();

    for (const r of vecRows) {
      const dist = parseFloat(r.distance ?? "1");
      byId.set(r.id, { row: r, score: 1 - dist });
    }
    for (const r of kwRows) {
      if (!byId.has(r.id)) {
        byId.set(r.id, { row: r, score: 0.5 });
      }
    }

    const merged = Array.from(byId.values())
      .sort((a, b) => b.score - a.score)
      .slice(offset, offset + limit);

    return {
      data: merged.map(({ row, score }) => formatMemory(row, score)),
      total: byId.size,
      limit,
      offset,
    };
  }

  private validateContent(content: string): void {
    if (!content || typeof content !== "string" || !content.trim()) {
      throw new Error("content is required and must be a non-empty string");
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new Error(`content must be <= ${MAX_CONTENT_LENGTH} characters`);
    }
  }
}
