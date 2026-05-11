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
    content_hash    VARCHAR(64)     NULL,
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
    INDEX idx_memory_content_hash (agent_id, state, content_hash),
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
    content_hash    VARCHAR(64)     NULL,
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
CREATE INDEX IF NOT EXISTS idx_memory_content_hash ON memories(agent_id, state, content_hash);
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
    content_hash    VARCHAR(64)     NULL,
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
CREATE INDEX IF NOT EXISTS idx_memory_content_hash ON memories(agent_id, state, content_hash);
CREATE INDEX IF NOT EXISTS idx_memory_updated ON memories(updated_at);
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_memories_updated ON memories;
CREATE TRIGGER trg_memories_updated BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
`

// BuildMemorySchema builds the TiDB memory schema with optional auto-embedding.
func BuildMemorySchema(autoModel string, autoDims int, clientDims int) string {
	var embeddingCol string
	if autoModel != "" {
		sanitizedModel := strings.ReplaceAll(autoModel, "'", "''")
		embeddingCol = fmt.Sprintf(
			`embedding VECTOR(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', content, '{"dimensions": %d}')) STORED,`,
			autoDims, sanitizedModel, autoDims,
		)
	} else {
		dims := clientDims
		if dims <= 0 {
			dims = 1536
		}
		embeddingCol = fmt.Sprintf(`embedding VECTOR(%d) NULL,`, dims)
	}
	return fmt.Sprintf(TenantMemorySchemaBase, embeddingCol)
}

// BuildDB9MemorySchema builds the db9 memory schema with optional auto-embedding.
func BuildDB9MemorySchema(autoModel string, autoDims int, clientDims int) string {
	var embeddingCol string
	if autoModel != "" {
		sanitizedModel := strings.ReplaceAll(autoModel, "'", "''")
		embeddingCol = fmt.Sprintf(
			`embedding VECTOR(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', content, '{"dimensions": %d}')) STORED,`,
			autoDims, sanitizedModel, autoDims,
		)
	} else {
		dims := clientDims
		if dims <= 0 {
			dims = 1536
		}
		embeddingCol = fmt.Sprintf(`embedding VECTOR(%d) NULL,`, dims)
	}
	return fmt.Sprintf(TenantMemorySchemaDB9Base, embeddingCol)
}

const TenantMemoryEntitiesSchemaTiDBBase = `CREATE TABLE IF NOT EXISTS memory_entities (
    agent_id      VARCHAR(100)  NOT NULL DEFAULT '',
    entity_key    VARCHAR(64)   NOT NULL,
    canonical_entity_key VARCHAR(64) NOT NULL DEFAULT '',
    entity_text   VARCHAR(255)  NOT NULL,
    entity_type   VARCHAR(32)   NOT NULL,
    %s
    memory_id     VARCHAR(36)   NOT NULL,
    created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_id, entity_key, memory_id),
    INDEX idx_memory_entities_memory (memory_id),
    INDEX idx_memory_entities_lookup (agent_id, entity_key)
)`

const TenantMemoryEntitiesSchemaPostgresBase = `CREATE TABLE IF NOT EXISTS memory_entities (
    agent_id      VARCHAR(100) NOT NULL DEFAULT '',
    entity_key    VARCHAR(64)  NOT NULL,
    canonical_entity_key VARCHAR(64) NOT NULL DEFAULT '',
    entity_text   VARCHAR(255) NOT NULL,
    entity_type   VARCHAR(32)  NOT NULL,
    %s
    memory_id     VARCHAR(36)  NOT NULL,
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    PRIMARY KEY (agent_id, entity_key, memory_id)
);
CREATE INDEX IF NOT EXISTS idx_memory_entities_memory ON memory_entities(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_entities_lookup ON memory_entities(agent_id, entity_key);
`

func BuildMemoryEntitiesSchema(backend string, autoModel string, autoDims int, clientDims int) string {
	dims := clientDims
	if autoModel != "" {
		dims = autoDims
	}
	if dims <= 0 {
		dims = 1536
	}
	var embeddingCol string
	switch backend {
	case "db9":
		if autoModel != "" {
			sanitizedModel := strings.ReplaceAll(autoModel, "'", "''")
			embeddingCol = fmt.Sprintf(
				`embedding vector(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', entity_text, '{"dimensions": %d}')) STORED,`,
				dims, sanitizedModel, dims,
			)
		} else {
			embeddingCol = fmt.Sprintf(`embedding vector(%d) NULL,`, dims)
		}
		return fmt.Sprintf(TenantMemoryEntitiesSchemaPostgresBase, embeddingCol)
	case "postgres":
		embeddingCol = fmt.Sprintf(`embedding vector(%d) NULL,`, dims)
		return fmt.Sprintf(TenantMemoryEntitiesSchemaPostgresBase, embeddingCol)
	default:
		if autoModel != "" {
			sanitizedModel := strings.ReplaceAll(autoModel, "'", "''")
			embeddingCol = fmt.Sprintf(
				`embedding VECTOR(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', entity_text, '{"dimensions": %d}')) STORED,`,
				dims, sanitizedModel, dims,
			)
		} else {
			embeddingCol = fmt.Sprintf(`embedding VECTOR(%d) NULL,`, dims)
		}
		return fmt.Sprintf(TenantMemoryEntitiesSchemaTiDBBase, embeddingCol)
	}
}

const TenantEntitySupportSchemaTiDBBase = `CREATE TABLE IF NOT EXISTS canonical_memory_entities (
    agent_id      VARCHAR(100)  NOT NULL DEFAULT '',
    entity_key    VARCHAR(64)   NOT NULL,
    entity_text   VARCHAR(255)  NOT NULL,
    entity_type   VARCHAR(32)   NOT NULL,
    %s
    memory_count  INT           NOT NULL DEFAULT 0,
    created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_id, entity_key),
    INDEX idx_canonical_memory_entities_type (agent_id, entity_type)
);
CREATE TABLE IF NOT EXISTS memory_entity_aliases (
    agent_id      VARCHAR(100)  NOT NULL DEFAULT '',
    alias_key     VARCHAR(64)   NOT NULL,
    entity_key    VARCHAR(64)   NOT NULL,
    alias_text    VARCHAR(255)  NOT NULL,
    created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_id, alias_key),
    INDEX idx_memory_entity_aliases_entity (agent_id, entity_key)
);
CREATE TABLE IF NOT EXISTS memory_relationships (
    agent_id          VARCHAR(100) NOT NULL DEFAULT '',
    source_entity_key VARCHAR(64)  NOT NULL,
    target_entity_key VARCHAR(64)  NOT NULL,
    relationship_type VARCHAR(64)  NOT NULL,
    memory_id         VARCHAR(36)  NOT NULL,
    created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_id, source_entity_key, target_entity_key, relationship_type, memory_id),
    INDEX idx_memory_relationships_memory (memory_id),
    INDEX idx_memory_relationships_source (agent_id, source_entity_key),
    INDEX idx_memory_relationships_target (agent_id, target_entity_key)
)`

const TenantEntitySupportSchemaPostgresBase = `CREATE TABLE IF NOT EXISTS canonical_memory_entities (
    agent_id      VARCHAR(100) NOT NULL DEFAULT '',
    entity_key    VARCHAR(64)  NOT NULL,
    entity_text   VARCHAR(255) NOT NULL,
    entity_type   VARCHAR(32)  NOT NULL,
    %s
    memory_count  INT          NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  DEFAULT NOW(),
    PRIMARY KEY (agent_id, entity_key)
);
CREATE INDEX IF NOT EXISTS idx_canonical_memory_entities_type ON canonical_memory_entities(agent_id, entity_type);
CREATE TABLE IF NOT EXISTS memory_entity_aliases (
    agent_id      VARCHAR(100) NOT NULL DEFAULT '',
    alias_key     VARCHAR(64)  NOT NULL,
    entity_key    VARCHAR(64)  NOT NULL,
    alias_text    VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    PRIMARY KEY (agent_id, alias_key)
);
CREATE INDEX IF NOT EXISTS idx_memory_entity_aliases_entity ON memory_entity_aliases(agent_id, entity_key);
CREATE TABLE IF NOT EXISTS memory_relationships (
    agent_id          VARCHAR(100) NOT NULL DEFAULT '',
    source_entity_key VARCHAR(64)  NOT NULL,
    target_entity_key VARCHAR(64)  NOT NULL,
    relationship_type VARCHAR(64)  NOT NULL,
    memory_id         VARCHAR(36)  NOT NULL,
    created_at        TIMESTAMPTZ  DEFAULT NOW(),
    PRIMARY KEY (agent_id, source_entity_key, target_entity_key, relationship_type, memory_id)
);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_memory ON memory_relationships(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_source ON memory_relationships(agent_id, source_entity_key);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_target ON memory_relationships(agent_id, target_entity_key);
`

func BuildEntitySupportSchema(backend string, autoModel string, autoDims int, clientDims int) string {
	dims := clientDims
	if autoModel != "" {
		dims = autoDims
	}
	if dims <= 0 {
		dims = 1536
	}
	switch backend {
	case "db9":
		if autoModel != "" {
			sanitizedModel := strings.ReplaceAll(autoModel, "'", "''")
			return fmt.Sprintf(TenantEntitySupportSchemaPostgresBase, fmt.Sprintf(
				`embedding vector(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', entity_text, '{"dimensions": %d}')) STORED,`,
				dims, sanitizedModel, dims,
			))
		}
		return fmt.Sprintf(TenantEntitySupportSchemaPostgresBase, fmt.Sprintf(`embedding vector(%d) NULL,`, dims))
	case "postgres":
		return fmt.Sprintf(TenantEntitySupportSchemaPostgresBase, fmt.Sprintf(`embedding vector(%d) NULL,`, dims))
	default:
		if autoModel != "" {
			sanitizedModel := strings.ReplaceAll(autoModel, "'", "''")
			return fmt.Sprintf(TenantEntitySupportSchemaTiDBBase, fmt.Sprintf(
				`embedding VECTOR(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', entity_text, '{"dimensions": %d}')) STORED,`,
				dims, sanitizedModel, dims,
			))
		}
		return fmt.Sprintf(TenantEntitySupportSchemaTiDBBase, fmt.Sprintf(`embedding VECTOR(%d) NULL,`, dims))
	}
}

const TenantSessionsSchemaBase = `CREATE TABLE IF NOT EXISTS sessions (
    id           VARCHAR(36)     PRIMARY KEY,
    session_id   VARCHAR(100)    NULL,
    agent_id     VARCHAR(100)    NULL,
    source       VARCHAR(100)    NULL,
    seq          INT             NOT NULL,
    role         VARCHAR(20)     NOT NULL,
    content      MEDIUMTEXT      NOT NULL,
    content_type VARCHAR(20)     NOT NULL DEFAULT 'text',
    content_hash VARCHAR(64)     NOT NULL,
    tags         JSON,
    %s
    state        VARCHAR(20)     NOT NULL DEFAULT 'active',
    created_at   TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX        idx_sessions_session (session_id),
    INDEX        idx_sessions_agent   (agent_id),
    INDEX        idx_sessions_state   (state),
    INDEX        idx_sessions_created (created_at),
    UNIQUE INDEX idx_sessions_dedup   (session_id, content_hash)
)`

// BuildSessionsSchema builds the TiDB sessions schema with optional auto-embedding.
func BuildSessionsSchema(autoModel string, autoDims int, clientDims int) string {
	var embeddingCol string
	if autoModel != "" {
		sanitizedModel := strings.ReplaceAll(autoModel, "'", "''")
		embeddingCol = fmt.Sprintf(
			`embedding VECTOR(%d) GENERATED ALWAYS AS (EMBED_TEXT('%s', content, '{"dimensions": %d}')) STORED,`,
			autoDims, sanitizedModel, autoDims,
		)
	} else {
		dims := clientDims
		if dims <= 0 {
			dims = 1536
		}
		embeddingCol = fmt.Sprintf(`embedding VECTOR(%d) NULL,`, dims)
	}
	return fmt.Sprintf(TenantSessionsSchemaBase, embeddingCol)
}
