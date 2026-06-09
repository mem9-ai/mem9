-- Control plane schema (MNEMO_DSN).

CREATE TABLE IF NOT EXISTS tenants (
  id              VARCHAR(36)   PRIMARY KEY,
  name            VARCHAR(255)  NOT NULL,
  db_host         VARCHAR(255)  NOT NULL,
  db_port         INT           NOT NULL,
  db_user         VARCHAR(255)  NOT NULL,
  db_password     VARCHAR(255)  NOT NULL,
  db_name         VARCHAR(255)  NOT NULL,
  db_tls          TINYINT(1)    NOT NULL DEFAULT 0,
  provider        VARCHAR(50)   NOT NULL,
  cluster_id      VARCHAR(255)  NULL,
  claim_url       TEXT          NULL,
  claim_expires_at TIMESTAMP    NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'provisioning'
                  COMMENT 'provisioning|active|suspended|deleted',
  schema_version  INT           NOT NULL DEFAULT 1,
  created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP     NULL,
  UNIQUE INDEX idx_tenant_name (name),
  INDEX idx_tenant_status (status),
  INDEX idx_tenant_provider (provider)
);

CREATE TABLE IF NOT EXISTS tenant_activity (
  tenant_id                  VARCHAR(36) NOT NULL PRIMARY KEY,
  last_activity_at           TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active_memory_total        BIGINT      NOT NULL DEFAULT 0,
  active_memory_7d_total     BIGINT      NOT NULL DEFAULT 0,
  memory_stats_observed_at   TIMESTAMP   NULL,
  CONSTRAINT fk_tenant_activity FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  INDEX idx_tenant_activity_last_activity (last_activity_at)
);

CREATE TABLE IF NOT EXISTS space_chains (
  id                  VARCHAR(36)   PRIMARY KEY,
  project_id          VARCHAR(255)  NULL,
  name                VARCHAR(255)  NOT NULL,
  description         TEXT          NULL,
  created_by_user_id  VARCHAR(255)  NULL,
  deleted_at          TIMESTAMP     NULL,
  deleted_by_user_id  VARCHAR(255)  NULL,
  created_at          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_space_chains_project (project_id),
  INDEX idx_space_chains_deleted (deleted_at)
);

CREATE TABLE IF NOT EXISTS space_chain_bindings (
  id                  VARCHAR(36)   PRIMARY KEY,
  chain_id            VARCHAR(36)   NOT NULL,
  chain_api_key       VARCHAR(255)  NOT NULL,
  created_by_user_id  VARCHAR(255)  NULL,
  disabled            TINYINT(1)    NOT NULL DEFAULT 0,
  disabled_at         TIMESTAMP     NULL,
  disabled_by_user_id VARCHAR(255)  NULL,
  created_at          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_space_chain_bindings_key (chain_api_key),
  INDEX idx_space_chain_bindings_chain (chain_id),
  CONSTRAINT fk_space_chain_bindings_chain FOREIGN KEY (chain_id) REFERENCES space_chains(id)
);

CREATE TABLE IF NOT EXISTS space_chain_nodes (
  id                  VARCHAR(36)   PRIMARY KEY,
  chain_id            VARCHAR(36)   NOT NULL,
  tenant_id           VARCHAR(36)   NOT NULL,
  external_space_id   VARCHAR(255)  NULL,
  display_name        VARCHAR(255)  NULL,
  position            INT           NOT NULL,
  routing_policy_enabled TINYINT(1) NOT NULL DEFAULT 0,
  routing_policy_prompt  TEXT       NULL,
  routing_policy_webhook_only TINYINT(1) NOT NULL DEFAULT 0,
  created_at          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_space_chain_nodes_tenant (chain_id, tenant_id),
  UNIQUE INDEX idx_space_chain_nodes_external_space (chain_id, external_space_id),
  UNIQUE INDEX idx_space_chain_nodes_position (chain_id, position),
  INDEX idx_space_chain_nodes_external_lookup (external_space_id),
  CONSTRAINT fk_space_chain_nodes_chain FOREIGN KEY (chain_id) REFERENCES space_chains(id),
  CONSTRAINT fk_space_chain_nodes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Tenant data plane schema (per-tenant TiDB Serverless).
CREATE TABLE IF NOT EXISTS memories (
  id              VARCHAR(36)     PRIMARY KEY,
  content         MEDIUMTEXT      NOT NULL,
  source          VARCHAR(100),
  tags            JSON,
  metadata        JSON,
  embedding       VECTOR(1536)    NULL,

  -- Classification
  memory_type     VARCHAR(20)     NOT NULL DEFAULT 'pinned'
                  COMMENT 'pinned|insight|digest',

  -- Agent & session tracking
  agent_id        VARCHAR(100)    NULL     COMMENT 'Agent that created this memory',
  session_id      VARCHAR(100)    NULL     COMMENT 'Session this memory originated from',
  app_id          VARCHAR(100)    NOT NULL DEFAULT '' COMMENT 'Application isolation ID',

  -- Lifecycle
  state           VARCHAR(20)     NOT NULL DEFAULT 'active'
                  COMMENT 'active|paused|archived|deleted',
  version         INT             DEFAULT 1,
  updated_by      VARCHAR(100),
  created_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  superseded_by   VARCHAR(36)     NULL     COMMENT 'ID of the memory that replaced this one',
  INDEX idx_memory_type         (memory_type),
  INDEX idx_source              (source),
  INDEX idx_state               (state),
  INDEX idx_agent               (agent_id),
  INDEX idx_session             (session_id),
  INDEX idx_app                 (app_id),
  INDEX idx_updated             (updated_at)
);

-- Full-text search index (TiDB Cloud Serverless with MULTILINGUAL tokenizer).
-- ADD_COLUMNAR_REPLICA_ON_DEMAND auto-provisions TiFlash on Serverless clusters.
-- Run after the memories table is created. Safe to re-run (fails silently if index exists).
-- ALTER TABLE memories
--   ADD FULLTEXT INDEX idx_fts_content (content)
--   WITH PARSER MULTILINGUAL
--   ADD_COLUMNAR_REPLICA_ON_DEMAND;

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


-- Migration: tombstone -> state (4-step plan).
-- Step 1: Add new columns (backward compatible — existing code still uses tombstone).
-- ALTER TABLE memories
--   ADD COLUMN memory_type  VARCHAR(20) NOT NULL DEFAULT 'pinned',
--   ADD COLUMN agent_id     VARCHAR(100) NULL,
--   ADD COLUMN session_id   VARCHAR(100) NULL,
--   ADD COLUMN app_id       VARCHAR(100) NOT NULL DEFAULT '',
--   ADD COLUMN state        VARCHAR(20) NOT NULL DEFAULT 'active',
--   ADD COLUMN superseded_by VARCHAR(36) NULL;
-- CREATE INDEX idx_memory_type ON memories(memory_type);
-- CREATE INDEX idx_state ON memories(state);
-- CREATE INDEX idx_agent ON memories(agent_id);
-- CREATE INDEX idx_session ON memories(session_id);
-- CREATE INDEX idx_app ON memories(app_id);
-- Step 2: Migrate tombstoned records.
-- UPDATE memories SET state = 'deleted', deleted_at = updated_at WHERE tombstone = 1;
-- Step 3: Add constraint (AFTER code migration).
-- ALTER TABLE memories ADD CONSTRAINT chk_state CHECK (state IN ('active','paused','archived','deleted'));
-- Step 4: Drop tombstone (separate deployment).
-- ALTER TABLE memories DROP COLUMN tombstone;
-- DROP INDEX idx_tombstone ON memories;

-- Marketing attribution captured at provision time (control plane).
CREATE TABLE IF NOT EXISTS tenant_utm (
  tenant_id  VARCHAR(36)   NOT NULL PRIMARY KEY,
  source     VARCHAR(255)  NULL,
  medium     VARCHAR(255)  NULL,
  campaign   VARCHAR(255)  NULL,
  content    VARCHAR(255)  NULL,
  created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tenant_utm FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Upload task tracking (control plane).
CREATE TABLE IF NOT EXISTS upload_tasks (
  task_id       VARCHAR(36)   PRIMARY KEY,
  tenant_id     VARCHAR(36)   NOT NULL,
  file_name     VARCHAR(255)  NOT NULL,
  file_path     TEXT          NOT NULL,
  agent_id      VARCHAR(100)  NULL,
  session_id    VARCHAR(100)  NULL,
  file_type     VARCHAR(20)   NOT NULL COMMENT 'session|memory',
  total_chunks  INT           NOT NULL DEFAULT 0,
  done_chunks   INT           NOT NULL DEFAULT 0,
  status        VARCHAR(20)   NOT NULL DEFAULT 'pending'
                COMMENT 'pending|processing|done|failed',
  error_msg     TEXT          NULL,
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_upload_tenant (tenant_id),
  INDEX idx_upload_poll (status, created_at)
);

CREATE TABLE IF NOT EXISTS runtime_usage_outbox (
  operation_id      VARCHAR(36) PRIMARY KEY,
  tenant_id         VARCHAR(36) NOT NULL,
  cluster_id        VARCHAR(255) NULL,
  subject_version   VARCHAR(32) NOT NULL DEFAULT 'tenant_id_v1',
  step              VARCHAR(32) NOT NULL,
  phase             VARCHAR(32) NOT NULL,
  payload_json      JSON        NOT NULL,
  payload_hash      VARCHAR(64) NOT NULL,
  expires_at        TIMESTAMP   NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count     INT         NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error        TEXT        NULL,
  created_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_runtime_usage_outbox_poll (status, next_attempt_at)
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id                VARCHAR(36)  PRIMARY KEY,
  scope_type        VARCHAR(20)  NOT NULL,
  scope_id          VARCHAR(255) NOT NULL,
  name              VARCHAR(255) NOT NULL,
  url               TEXT         NOT NULL,
  enabled           TINYINT(1)   NOT NULL DEFAULT 1,
  events_json       JSON         NOT NULL,
  secret_ciphertext TEXT         NOT NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP    NULL,
  INDEX idx_webhook_endpoints_scope (scope_type, scope_id, deleted_at)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id           VARCHAR(36)  PRIMARY KEY,
  scope_type   VARCHAR(20)  NOT NULL,
  scope_id     VARCHAR(255) NOT NULL,
  event_type   VARCHAR(100) NOT NULL,
  payload_json JSON         NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_webhook_events_scope (scope_type, scope_id, created_at)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               VARCHAR(36) PRIMARY KEY,
  event_id         VARCHAR(36) NOT NULL,
  endpoint_id      VARCHAR(36) NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count    INT         NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_http_status INT         NULL,
  last_error       TEXT        NULL,
  delivered_at     TIMESTAMP   NULL,
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_webhook_deliveries_poll (status, next_attempt_at),
  INDEX idx_webhook_deliveries_event (event_id),
  CONSTRAINT fk_webhook_deliveries_event FOREIGN KEY (event_id) REFERENCES webhook_events(id),
  CONSTRAINT fk_webhook_deliveries_endpoint FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(id)
);
