package tenant

import (
	"fmt"
	"strings"
)

// TenantMemorySchemaBase is the MySQL/TiDB schema template.
const TenantMemorySchemaBase = `CREATE TABLE IF NOT EXISTS memories (
    id              VARCHAR(36)     PRIMARY KEY,
    content         TEXT            NOT NULL,
    source          VARCHAR(100),
    tags            JSON,
    metadata        JSON,
    %s
    memory_type     VARCHAR(20)     NOT NULL DEFAULT 'pinned',
    agent_id        VARCHAR(100)    NULL,
    session_id      VARCHAR(100)    NULL,
    state           VARCHAR(20)     NOT NULL DEFAULT 'active',
    version         INT             DEFAULT 1,
    updated_by      VARCHAR(100),
    superseded_by   VARCHAR(36)     NULL,
    created_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_memory_type         (memory_type),
    INDEX idx_source              (source),
    INDEX idx_state               (state),
    INDEX idx_agent               (agent_id),
    INDEX idx_session             (session_id),
    INDEX idx_updated             (updated_at)
)`

// TenantMemorySchemaPostgres is the PostgreSQL schema with pgvector support.
const TenantMemorySchemaPostgres = `CREATE TABLE IF NOT EXISTS memories (
    id              VARCHAR(36)     PRIMARY KEY,
    content         TEXT            NOT NULL,
    source          VARCHAR(100),
    tags            JSONB,
    metadata        JSONB,
    embedding       vector(1536)    NULL,
    memory_type     VARCHAR(20)     NOT NULL DEFAULT 'pinned',
    agent_id        VARCHAR(100)    NULL,
    session_id      VARCHAR(100)    NULL,
    state           VARCHAR(20)     NOT NULL DEFAULT 'active',
    version         INT             DEFAULT 1,
    updated_by      VARCHAR(100),
    superseded_by   VARCHAR(36)     NULL,
    created_at      TIMESTAMPTZ     DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_source ON memories(source);
CREATE INDEX IF NOT EXISTS idx_state ON memories(state);
CREATE INDEX IF NOT EXISTS idx_agent ON memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_session ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_updated ON memories(updated_at);
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_memories_updated ON memories;
CREATE TRIGGER trg_memories_updated BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
`

// TenantMemorySchemaDB9Base is the db9/PostgreSQL schema template with auto-embedding support.
const TenantMemorySchemaDB9Base = `CREATE TABLE IF NOT EXISTS memories (
    id              VARCHAR(36)     PRIMARY KEY,
    content         TEXT            NOT NULL,
    source          VARCHAR(100),
    tags            JSONB,
    metadata        JSONB,
    %s
    memory_type     VARCHAR(20)     NOT NULL DEFAULT 'pinned',
    agent_id        VARCHAR(100)    NULL,
    session_id      VARCHAR(100)    NULL,
    state           VARCHAR(20)     NOT NULL DEFAULT 'active',
    version         INT             DEFAULT 1,
    updated_by      VARCHAR(100),
    superseded_by   VARCHAR(36)     NULL,
    created_at      TIMESTAMPTZ     DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memory_source ON memories(source);
CREATE INDEX IF NOT EXISTS idx_memory_state ON memories(state);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_session ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_updated ON memories(updated_at);
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_memories_updated ON memories;
CREATE TRIGGER trg_memories_updated BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
`

// BuildMemorySchema builds the TiDB memory schema with optional auto-embedding.
func BuildMemorySchema(autoModel string, autoDims int) string {
	var embeddingCol string
	if autoModel != "" {
		sanitizedModel := strings.ReplaceAll(autoModel, "'", "''")
		embeddingCol = fmt.Sprintf(
			`embedding VECTOR(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', content, '{"dimensions": %d}')) STORED,`,
			autoDims, sanitizedModel, autoDims,
		)
	} else {
		embeddingCol = `embedding VECTOR(1536) NULL,`
	}
	return fmt.Sprintf(TenantMemorySchemaBase, embeddingCol)
}

// BuildDB9MemorySchema builds the db9 memory schema with optional auto-embedding.
func BuildDB9MemorySchema(autoModel string, autoDims int) string {
	var embeddingCol string
	if autoModel != "" {
		sanitizedModel := strings.ReplaceAll(autoModel, "'", "''")
		embeddingCol = fmt.Sprintf(
			`embedding VECTOR(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', content, '{"dimensions": %d}')) STORED,`,
			autoDims, sanitizedModel, autoDims,
		)
	} else {
		embeddingCol = `embedding VECTOR(1536) NULL,`
	}
	return fmt.Sprintf(TenantMemorySchemaDB9Base, embeddingCol)
}
