package tenant

import (
	"context"
	"database/sql"
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

// InitTiDBTenantSchema creates or completes the TiDB tenant data-plane schema.
func InitTiDBTenantSchema(ctx context.Context, db *sql.DB, autoModel string, autoDims int, clientDims int, ftsEnabled bool) error {
	if db == nil {
		return fmt.Errorf("init schema: db connection is nil")
	}

	if err := CheckEmbeddingSchemaCompatibility(ctx, db, autoModel); err != nil {
		return fmt.Errorf("init schema: embedding schema compatibility: %w", err)
	}

	if err := ensureTable(ctx, db, "memories", BuildMemorySchema(autoModel, autoDims, clientDims)); err != nil {
		return fmt.Errorf("init schema: memories table: %w", err)
	}
	if err := ensureVectorIndex(ctx, db, "memories", "idx_cosine"); err != nil {
		return fmt.Errorf("init schema: memories vector index: %w", err)
	}
	if ftsEnabled {
		if err := ensureFullTextIndex(ctx, db, "memories", "idx_fts_content"); err != nil {
			return fmt.Errorf("init schema: memories fulltext index: %w", err)
		}
	}

	if err := ensureTable(ctx, db, "sessions", BuildSessionsSchema(autoModel, autoDims, clientDims)); err != nil {
		return fmt.Errorf("init schema: sessions table: %w", err)
	}
	if err := ensureVectorIndex(ctx, db, "sessions", "idx_sessions_cosine"); err != nil {
		return fmt.Errorf("init schema: sessions vector index: %w", err)
	}
	if ftsEnabled {
		if err := ensureFullTextIndex(ctx, db, "sessions", "idx_sessions_fts"); err != nil {
			return fmt.Errorf("init schema: sessions fulltext index: %w", err)
		}
	}
	return nil
}

func ensureTable(ctx context.Context, db *sql.DB, table, createSQL string) error {
	exists, err := TableExists(ctx, db, table)
	if err != nil {
		return fmt.Errorf("check table: %w", err)
	}
	if exists {
		return nil
	}
	if _, err := db.ExecContext(ctx, createSQL); err != nil {
		return fmt.Errorf("create: %w", err)
	}
	return nil
}

func ensureVectorIndex(ctx context.Context, db *sql.DB, table, indexName string) error {
	exists, err := IndexExists(ctx, db, table, indexName)
	if err != nil {
		return fmt.Errorf("check vector index: %w", err)
	}
	if exists {
		return nil
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(
		`ALTER TABLE %s ADD VECTOR INDEX %s ((VEC_COSINE_DISTANCE(embedding))) ADD_COLUMNAR_REPLICA_ON_DEMAND`,
		table,
		indexName,
	)); err != nil && !IsIndexExistsError(err) {
		return err
	}
	return nil
}

func ensureFullTextIndex(ctx context.Context, db *sql.DB, table, indexName string) error {
	exists, err := IndexExists(ctx, db, table, indexName)
	if err != nil {
		return fmt.Errorf("check fulltext index: %w", err)
	}
	if exists {
		return nil
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(
		`ALTER TABLE %s ADD FULLTEXT INDEX %s (content) WITH PARSER MULTILINGUAL ADD_COLUMNAR_REPLICA_ON_DEMAND`,
		table,
		indexName,
	)); err != nil && !IsIndexExistsError(err) {
		return err
	}
	return nil
}
