package tenant

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/qiffang/mnemos/server/internal/domain"
)

type embeddingColumnInfo struct {
	table     string
	generated bool
}

// CheckEmbeddingSchemaCompatibility verifies that existing tenant embedding
// columns match the current embedding mode. Missing tables are ignored because
// new tenant provisioning opens the DB before schema initialization.
func CheckEmbeddingSchemaCompatibility(ctx context.Context, db *sql.DB, autoModel string) error {
	rows, err := db.QueryContext(ctx,
		`SELECT TABLE_NAME, COALESCE(EXTRA, ''), COALESCE(GENERATION_EXPRESSION, '')
		   FROM information_schema.COLUMNS
		  WHERE TABLE_SCHEMA = DATABASE()
		    AND TABLE_NAME IN ('memories', 'sessions')
		    AND COLUMN_NAME = 'embedding'
		  ORDER BY TABLE_NAME`)
	if err != nil {
		return fmt.Errorf("check embedding schema compatibility: %w", err)
	}
	defer rows.Close()

	var columns []embeddingColumnInfo
	for rows.Next() {
		var table, extra, generationExpression string
		if err := rows.Scan(&table, &extra, &generationExpression); err != nil {
			return fmt.Errorf("scan embedding schema compatibility: %w", err)
		}
		columns = append(columns, embeddingColumnInfo{
			table:     table,
			generated: isGeneratedColumn(extra, generationExpression),
		})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate embedding schema compatibility: %w", err)
	}
	return validateEmbeddingSchemaCompatibility(autoModel != "", columns)
}

func isGeneratedColumn(extra, generationExpression string) bool {
	return strings.Contains(strings.ToUpper(extra), "GENERATED") || strings.TrimSpace(generationExpression) != ""
}

func validateEmbeddingSchemaCompatibility(autoModelEnabled bool, columns []embeddingColumnInfo) error {
	for _, col := range columns {
		if col.generated == autoModelEnabled {
			continue
		}
		return newEmbeddingSchemaMismatchError(col.table, autoModelEnabled, col.generated)
	}
	return nil
}

func newEmbeddingSchemaMismatchError(table string, autoModelEnabled bool, generated bool) error {
	if table == "" {
		table = "memories"
	}
	if generated && !autoModelEnabled {
		return &domain.SchemaCompatibilityError{Message: fmt.Sprintf(
			"tenant schema incompatible with embedding mode: %s.embedding is a generated Auto Embed column, but MNEMO_EMBED_AUTO_MODEL is disabled; re-enable Auto Embed or migrate/recreate this tenant schema",
			table,
		)}
	}
	return &domain.SchemaCompatibilityError{Message: fmt.Sprintf(
		"tenant schema incompatible with embedding mode: %s.embedding is a regular vector column, but MNEMO_EMBED_AUTO_MODEL is enabled; disable Auto Embed or migrate/recreate this tenant schema",
		table,
	)}
}
