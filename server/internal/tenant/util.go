package tenant

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/go-sql-driver/mysql"
)

// IsIndexExistsError reports whether err is a duplicate index error (MySQL 1061).
func IsIndexExistsError(err error) bool {
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		return mysqlErr.Number == 1061
	}
	return strings.Contains(err.Error(), "already exists")
}

// IsTableNotFoundError reports whether err is a table-not-found error (MySQL 1146).
func IsTableNotFoundError(err error) bool {
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		return mysqlErr.Number == 1146
	}
	return strings.Contains(err.Error(), "doesn't exist")
}

// IndexExists reports whether the named index exists on the given table in the current database.
func IndexExists(ctx context.Context, db *sql.DB, table, indexName string) (bool, error) {
	var count int
	err := db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.STATISTICS
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = ?
		   AND INDEX_NAME = ?`,
		table, indexName,
	).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}
