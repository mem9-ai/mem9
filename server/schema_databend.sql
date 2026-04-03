-- Control plane schema for Databend backend.

CREATE TABLE IF NOT EXISTS tenants (
  id              VARCHAR       NOT NULL,
  name            VARCHAR       NOT NULL,
  db_host         VARCHAR       NOT NULL,
  db_port         INT           NOT NULL,
  db_user         VARCHAR       NOT NULL,
  db_password     VARCHAR       NOT NULL,
  db_name         VARCHAR       NOT NULL,
  db_tls          BOOLEAN       NOT NULL DEFAULT FALSE,
  provider        VARCHAR       NOT NULL,
  cluster_id      VARCHAR       NULL,
  claim_url       VARCHAR       NULL,
  claim_expires_at TIMESTAMP    NULL,
  status          VARCHAR       NOT NULL DEFAULT 'provisioning',
  schema_version  INT           NOT NULL DEFAULT 1,
  created_at      TIMESTAMP     DEFAULT NOW(),
  updated_at      TIMESTAMP     DEFAULT NOW(),
  deleted_at      TIMESTAMP     NULL
);

-- Tenant data plane schema (per-tenant Databend database).
CREATE TABLE IF NOT EXISTS memories (
  id              VARCHAR       NOT NULL,
  content         VARCHAR       NOT NULL,
  source          VARCHAR       NULL,
  tags            VARIANT       NULL,
  metadata        VARIANT       NULL,
  embedding       VECTOR(1536)  NULL,
  memory_type     VARCHAR       NOT NULL DEFAULT 'pinned',
  agent_id        VARCHAR       NULL,
  session_id      VARCHAR       NULL,
  state           VARCHAR       NOT NULL DEFAULT 'active',
  version         INT           DEFAULT 1,
  updated_by      VARCHAR       NULL,
  superseded_by   VARCHAR       NULL,
  created_at      TIMESTAMP     DEFAULT NOW(),
  updated_at      TIMESTAMP     DEFAULT NOW()
);

-- Full-text search inverted index (Databend Cloud, requires MNEMO_FTS_ENABLED=true).
-- Run after the memories table is created. Refresh is needed for existing data.
-- CREATE INVERTED INDEX IF NOT EXISTS idx_content ON memories(content);
-- REFRESH INVERTED INDEX idx_content ON memories;

-- Vector index for cosine similarity search (Databend Cloud).
-- Run after the memories table is created. Safe to re-run (IF NOT EXISTS).
-- CREATE VECTOR INDEX IF NOT EXISTS idx_embedding ON memories(embedding) distance = 'cosine';

-- Upload task tracking (control plane).
CREATE TABLE IF NOT EXISTS upload_tasks (
  task_id       VARCHAR       NOT NULL,
  tenant_id     VARCHAR       NOT NULL,
  file_name     VARCHAR       NOT NULL,
  file_path     VARCHAR       NOT NULL,
  agent_id      VARCHAR       NULL,
  session_id    VARCHAR       NULL,
  file_type     VARCHAR       NOT NULL,
  total_chunks  INT           NOT NULL DEFAULT 0,
  done_chunks   INT           NOT NULL DEFAULT 0,
  status        VARCHAR       NOT NULL DEFAULT 'pending',
  error_msg     VARCHAR       NULL,
  created_at    TIMESTAMP     DEFAULT NOW(),
  updated_at    TIMESTAMP     DEFAULT NOW()
);
