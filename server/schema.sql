CREATE TABLE IF NOT EXISTS space_tokens (
  api_token     VARCHAR(64)   PRIMARY KEY,
  space_id      VARCHAR(36)   NOT NULL,
  space_name    VARCHAR(255)  NOT NULL,
  agent_name    VARCHAR(100)  NOT NULL,
  agent_type    VARCHAR(50),
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_space (space_id)
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
  UNIQUE INDEX idx_key    (space_id, key_name),
  INDEX idx_space         (space_id),
  INDEX idx_source        (space_id, source),
  INDEX idx_updated       (space_id, updated_at)
);

-- Vector index requires TiFlash. May fail on plain MySQL; safe to ignore.
-- ALTER TABLE memories ADD VECTOR INDEX idx_cosine ((VEC_COSINE_DISTANCE(embedding)));
