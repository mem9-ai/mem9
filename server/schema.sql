CREATE TABLE IF NOT EXISTS user_tokens (
  api_token     VARCHAR(64)   PRIMARY KEY,
  user_id       VARCHAR(36)   NOT NULL,
  user_name     VARCHAR(255)  NOT NULL,
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id)
);

CREATE TABLE IF NOT EXISTS space_tokens (
  api_token       VARCHAR(64)   PRIMARY KEY,
  space_id        VARCHAR(36)   NOT NULL,
  space_name      VARCHAR(255)  NOT NULL,
  agent_name      VARCHAR(100)  NOT NULL,
  agent_type      VARCHAR(50),
  user_id         VARCHAR(36)   NOT NULL DEFAULT '',
  workspace_key   VARCHAR(64)   NOT NULL DEFAULT '',
  created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_space (space_id),
  INDEX idx_user_workspace (user_id, workspace_key)
);

CREATE TABLE IF NOT EXISTS memories (
  id          VARCHAR(36)     PRIMARY KEY,
  space_id    VARCHAR(36)     NOT NULL,
  content     TEXT            NOT NULL,
  key_name    VARCHAR(255),
  source      VARCHAR(100),
  tags        JSON,
  metadata    JSON,
  embedding   VECTOR(1536)    NULL,
  version     INT             DEFAULT 1,
  updated_by  VARCHAR(100),
  created_at  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  vector_clock      JSON         NOT NULL DEFAULT ('{}'),
  origin_agent      VARCHAR(64),
  tombstone         TINYINT(1)   NOT NULL DEFAULT 0,
  last_write_id     VARCHAR(36),
  last_write_snapshot JSON,
  last_write_status TINYINT,
  UNIQUE INDEX idx_key    (space_id, key_name),
  INDEX idx_space         (space_id),
  INDEX idx_source        (space_id, source),
  INDEX idx_updated       (space_id, updated_at),
  INDEX idx_tombstone     (space_id, tombstone)
);

-- Vector index requires TiFlash. May fail on plain MySQL; safe to ignore.
-- ALTER TABLE memories ADD VECTOR INDEX idx_cosine ((VEC_COSINE_DISTANCE(embedding)));

-- Auto-embedding variant (TiDB Cloud Serverless only):
-- Replace the embedding column above with a generated column:
--
--   embedding VECTOR(1024) GENERATED ALWAYS AS (
--     EMBED_TEXT("tidbcloud_free/amazon/titan-embed-text-v2", content)
--   ) STORED,
--
-- Then add vector index:
--   VECTOR INDEX idx_cosine ((VEC_COSINE_DISTANCE(embedding)))
--
-- Set MNEMO_EMBED_AUTO_MODEL=tidbcloud_free/amazon/titan-embed-text-v2 to enable.

-- Migration: add CRDT columns to existing memories table.
-- Existing rows get defaults: vector_clock='{}', tombstone=0, others NULL.
-- ALTER TABLE memories
--   ADD COLUMN vector_clock      JSON         NOT NULL DEFAULT ('{}'),
--   ADD COLUMN origin_agent      VARCHAR(64),
--   ADD COLUMN tombstone         TINYINT(1)   NOT NULL DEFAULT 0,
--   ADD COLUMN last_write_id     VARCHAR(36),
--   ADD COLUMN last_write_snapshot JSON,
--   ADD COLUMN last_write_status TINYINT;
-- CREATE INDEX idx_tombstone ON memories(space_id, tombstone);
-- CREATE UNIQUE INDEX idx_last_write_id ON memories(space_id, last_write_id);

-- Migration: add user_tokens table and workspace isolation columns to space_tokens.
-- CREATE TABLE IF NOT EXISTS user_tokens (
--   api_token     VARCHAR(64)   PRIMARY KEY,
--   user_id       VARCHAR(36)   NOT NULL,
--   user_name     VARCHAR(255)  NOT NULL,
--   created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
--   INDEX idx_user (user_id)
-- );
-- ALTER TABLE space_tokens
--   ADD COLUMN user_id       VARCHAR(36) NOT NULL DEFAULT '',
--   ADD COLUMN workspace_key VARCHAR(64) NOT NULL DEFAULT '';
-- CREATE INDEX idx_user_workspace ON space_tokens(user_id, workspace_key);
