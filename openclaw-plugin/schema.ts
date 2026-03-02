import type { Connection } from "@tidbcloud/serverless";

/**
 * Auto-creates the memories table if it doesn't exist.
 * VECTOR column is nullable — works even without TiFlash.
 */
export async function initSchema(
  conn: Connection,
  dims: number = 1536
): Promise<void> {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS memories (
      id          VARCHAR(36)       PRIMARY KEY,
      space_id    VARCHAR(36)       NOT NULL,
      content     TEXT              NOT NULL,
      key_name    VARCHAR(255),
      source      VARCHAR(100),
      tags        JSON,
      metadata    JSON,
      embedding   VECTOR(${dims})   NULL,
      version     INT               DEFAULT 1,
      updated_by  VARCHAR(100),
      created_at  TIMESTAMP         DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP         DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE INDEX idx_key    (space_id, key_name),
      INDEX idx_space         (space_id),
      INDEX idx_source        (space_id, source),
      INDEX idx_updated       (space_id, updated_at)
    )
  `);

  // Vector index requires TiFlash. Silent failure is fine — keyword search still works.
  try {
    await conn.execute(
      `ALTER TABLE memories ADD VECTOR INDEX idx_cosine ((VEC_COSINE_DISTANCE(embedding)))`
    );
  } catch {
    // Already exists or TiFlash unavailable — no-op.
  }
}
