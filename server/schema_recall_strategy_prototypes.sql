-- Control-plane recall strategy prototypes (TiDB-first v1 router support).
CREATE TABLE IF NOT EXISTS recall_strategy_prototypes (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pattern_text   TEXT         NOT NULL,
  strategy_class VARCHAR(64)  NOT NULL,
  answer_family  VARCHAR(64)  NULL,
  language       VARCHAR(16)  NOT NULL DEFAULT 'en',
  source         VARCHAR(32)  NOT NULL DEFAULT 'manual',
  priority       INT          NOT NULL DEFAULT 0,
  active         TINYINT(1)   NOT NULL DEFAULT 1,
  notes          TEXT         NULL,
  embedding      VECTOR(1024) GENERATED ALWAYS AS (
    EMBED_TEXT('tidbcloud_free/amazon/titan-embed-text-v2', pattern_text, '{"dimensions": 1024}')
  ) STORED,
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rsp_active_lang_class (active, language, strategy_class, priority),
  FULLTEXT INDEX idx_rsp_fts (pattern_text) WITH PARSER MULTILINGUAL
);

-- Vector index is created at server startup via EnsurePrototypeVectorIndex()
-- in server/internal/repository/tidb/strategy_bootstrap.go with
-- duplicate-index error handling. Do NOT add ALTER TABLE here.
