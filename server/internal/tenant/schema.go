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
    app_id          VARCHAR(100)    NOT NULL DEFAULT '',
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
    INDEX idx_app                 (app_id),
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
    app_id          VARCHAR(100)    NOT NULL DEFAULT '',
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
CREATE INDEX IF NOT EXISTS idx_app ON memories(app_id);
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
    app_id          VARCHAR(100)    NOT NULL DEFAULT '',
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
CREATE INDEX IF NOT EXISTS idx_memory_app ON memories(app_id);
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
    app_id       VARCHAR(100)    NOT NULL DEFAULT '',
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
    INDEX        idx_sess_session (session_id),
    INDEX        idx_sess_agent   (agent_id),
    INDEX        idx_sess_app     (app_id),
    INDEX        idx_sess_state   (state),
    INDEX        idx_sess_created (created_at),
    UNIQUE INDEX idx_sess_dedup   (app_id, session_id, content_hash)
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
	if err := EnsureTiDBTenantRuntimeSchema(ctx, db, autoModel, autoDims, clientDims, ftsEnabled); err != nil {
		return fmt.Errorf("init schema: %w", err)
	}
	return nil
}

// EnsureTiDBTenantRuntimeSchema creates missing tenant tables and search indexes,
// then validates the offline-migrated app-scoped schema without mutating it.
func EnsureTiDBTenantRuntimeSchema(ctx context.Context, db *sql.DB, autoModel string, autoDims int, clientDims int, ftsEnabled bool) error {
	if err := ensureTiDBTenantTablesAndSearchIndexes(ctx, db, autoModel, autoDims, clientDims, ftsEnabled); err != nil {
		return err
	}
	if err := ValidateTiDBTenantRuntimeSchema(ctx, db, autoModel, ftsEnabled); err != nil {
		return fmt.Errorf("runtime validation: %w", err)
	}
	return nil
}

func ensureTiDBTenantTablesAndSearchIndexes(ctx context.Context, db *sql.DB, autoModel string, autoDims int, clientDims int, ftsEnabled bool) error {
	if db == nil {
		return fmt.Errorf("db connection is nil")
	}

	if err := CheckEmbeddingSchemaCompatibility(ctx, db, autoModel); err != nil {
		return fmt.Errorf("embedding schema compatibility: %w", err)
	}

	if err := ensureTable(ctx, db, "memories", BuildMemorySchema(autoModel, autoDims, clientDims)); err != nil {
		return fmt.Errorf("memories table: %w", err)
	}
	if err := ensureVectorIndex(ctx, db, "memories", "idx_cosine"); err != nil {
		return fmt.Errorf("memories vector index: %w", err)
	}
	if ftsEnabled {
		if err := ensureFullTextIndex(ctx, db, "memories", "idx_fts_content"); err != nil {
			return fmt.Errorf("memories fulltext index: %w", err)
		}
	}

	if err := ensureTable(ctx, db, "sessions", BuildSessionsSchema(autoModel, autoDims, clientDims)); err != nil {
		return fmt.Errorf("sessions table: %w", err)
	}
	if err := ensureVectorIndex(ctx, db, "sessions", "idx_sess_cosine"); err != nil {
		return fmt.Errorf("sessions vector index: %w", err)
	}
	if ftsEnabled {
		if err := ensureFullTextIndex(ctx, db, "sessions", "idx_sess_fts"); err != nil {
			return fmt.Errorf("sessions fulltext index: %w", err)
		}
	}
	return nil
}

// ValidateTiDBTenantRuntimeSchema checks the tenant schema expected after
// provisioning or offline migration without mutating existing tables.
func ValidateTiDBTenantRuntimeSchema(ctx context.Context, db *sql.DB, autoModel string, ftsEnabled bool) error {
	if db == nil {
		return fmt.Errorf("validate schema: db connection is nil")
	}
	if err := CheckEmbeddingSchemaCompatibility(ctx, db, autoModel); err != nil {
		return fmt.Errorf("validate schema: embedding schema compatibility: %w", err)
	}

	if err := requireTable(ctx, db, "memories"); err != nil {
		return fmt.Errorf("validate schema: memories table: %w", err)
	}
	if err := requireColumn(ctx, db, "memories", "app_id"); err != nil {
		return fmt.Errorf("validate schema: memories app_id column: %w", err)
	}
	if err := requireIndex(ctx, db, "memories", "idx_app"); err != nil {
		return fmt.Errorf("validate schema: memories app_id index: %w", err)
	}
	if err := requireIndex(ctx, db, "memories", "idx_cosine"); err != nil {
		return fmt.Errorf("validate schema: memories vector index: %w", err)
	}
	if ftsEnabled {
		if err := requireIndex(ctx, db, "memories", "idx_fts_content"); err != nil {
			return fmt.Errorf("validate schema: memories fulltext index: %w", err)
		}
	}

	if err := requireTable(ctx, db, "sessions"); err != nil {
		return fmt.Errorf("validate schema: sessions table: %w", err)
	}
	if err := requireColumn(ctx, db, "sessions", "app_id"); err != nil {
		return fmt.Errorf("validate schema: sessions app_id column: %w", err)
	}
	if err := requireIndex(ctx, db, "sessions", "idx_sess_app"); err != nil {
		return fmt.Errorf("validate schema: sessions app_id index: %w", err)
	}
	if err := requireUniqueIndexColumns(ctx, db, "sessions", "idx_sess_dedup", []string{"app_id", "session_id", "content_hash"}); err != nil {
		return fmt.Errorf("validate schema: sessions dedup index: %w", err)
	}
	if err := requireIndex(ctx, db, "sessions", "idx_sess_cosine"); err != nil {
		return fmt.Errorf("validate schema: sessions vector index: %w", err)
	}
	if ftsEnabled {
		if err := requireIndex(ctx, db, "sessions", "idx_sess_fts"); err != nil {
			return fmt.Errorf("validate schema: sessions fulltext index: %w", err)
		}
	}
	return nil
}

func ValidatePostgresMemoryRuntimeSchema(ctx context.Context, db *sql.DB, backend string) error {
	if db == nil {
		return fmt.Errorf("validate schema: db connection is nil")
	}
	if err := requirePostgresColumn(ctx, db, "memories", "app_id"); err != nil {
		return fmt.Errorf("validate schema: memories app_id column: %w", err)
	}
	indexName := "idx_app"
	if backend == "db9" {
		indexName = "idx_memory_app"
	}
	if err := requirePostgresIndex(ctx, db, "memories", indexName); err != nil {
		return fmt.Errorf("validate schema: memories app_id index: %w", err)
	}
	return nil
}

func requireTable(ctx context.Context, db *sql.DB, table string) error {
	exists, err := TableExists(ctx, db, table)
	if err != nil {
		return fmt.Errorf("check table: %w", err)
	}
	if !exists {
		return fmt.Errorf("%s table is missing", table)
	}
	return nil
}

func requireColumn(ctx context.Context, db *sql.DB, table, column string) error {
	exists, err := ColumnExists(ctx, db, table, column)
	if err != nil {
		return fmt.Errorf("check column: %w", err)
	}
	if !exists {
		return fmt.Errorf("%s.%s is missing", table, column)
	}
	return nil
}

func requireIndex(ctx context.Context, db *sql.DB, table, indexName string) error {
	exists, err := IndexExists(ctx, db, table, indexName)
	if err != nil {
		return fmt.Errorf("check index: %w", err)
	}
	if !exists {
		return fmt.Errorf("%s.%s is missing", table, indexName)
	}
	return nil
}

func requirePostgresColumn(ctx context.Context, db *sql.DB, table, column string) error {
	exists, err := postgresColumnExists(ctx, db, table, column)
	if err != nil {
		return fmt.Errorf("check column: %w", err)
	}
	if !exists {
		return fmt.Errorf("%s.%s is missing", table, column)
	}
	return nil
}

func postgresColumnExists(ctx context.Context, db *sql.DB, table, column string) (bool, error) {
	var count int
	err := db.QueryRowContext(ctx,
		`SELECT COUNT(*)
		   FROM information_schema.columns
		  WHERE table_schema = current_schema()
		    AND table_name = $1
		    AND column_name = $2`,
		table, column,
	).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func requirePostgresIndex(ctx context.Context, db *sql.DB, table, indexName string) error {
	exists, err := postgresIndexExists(ctx, db, table, indexName)
	if err != nil {
		return fmt.Errorf("check index: %w", err)
	}
	if !exists {
		return fmt.Errorf("%s.%s is missing", table, indexName)
	}
	return nil
}

func postgresIndexExists(ctx context.Context, db *sql.DB, table, indexName string) (bool, error) {
	var count int
	err := db.QueryRowContext(ctx,
		`SELECT COUNT(*)
		   FROM pg_indexes
		  WHERE schemaname = current_schema()
		    AND tablename = $1
		    AND indexname = $2`,
		table, indexName,
	).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func requireUniqueIndexColumns(ctx context.Context, db *sql.DB, table, indexName string, want []string) error {
	columns, unique, err := indexDefinition(ctx, db, table, indexName)
	if err != nil {
		return fmt.Errorf("check index columns: %w", err)
	}
	if strings.Join(columns, ",") != strings.Join(want, ",") {
		return fmt.Errorf("%s.%s columns = %q, want %q", table, indexName, strings.Join(columns, ","), strings.Join(want, ","))
	}
	if !unique {
		return fmt.Errorf("%s.%s is not unique", table, indexName)
	}
	return nil
}

func indexDefinition(ctx context.Context, db *sql.DB, table, indexName string) ([]string, bool, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT COLUMN_NAME, NON_UNIQUE
		   FROM information_schema.STATISTICS
		  WHERE TABLE_SCHEMA = DATABASE()
		    AND TABLE_NAME = ?
		    AND INDEX_NAME = ?
		  ORDER BY SEQ_IN_INDEX`,
		table, indexName,
	)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	var columns []string
	unique := true
	for rows.Next() {
		var column string
		var nonUnique int
		if err := rows.Scan(&column, &nonUnique); err != nil {
			return nil, false, err
		}
		columns = append(columns, column)
		if nonUnique != 0 {
			unique = false
		}
	}
	return columns, unique, rows.Err()
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
