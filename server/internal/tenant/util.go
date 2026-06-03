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

// IsDuplicateColumnError reports whether err is a duplicate column error (MySQL 1060).
func IsDuplicateColumnError(err error) bool {
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		return mysqlErr.Number == 1060
	}
	return strings.Contains(err.Error(), "Duplicate column")
}

// IsIndexNotFoundError reports whether err is an index-not-found error.
func IsIndexNotFoundError(err error) bool {
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		return mysqlErr.Number == 1091
	}
	return strings.Contains(err.Error(), "check that column/key exists")
}

// ColumnExists reports whether the named column exists on the given table in the current database.
func ColumnExists(ctx context.Context, db *sql.DB, table, column string) (bool, error) {
	var count int
	err := db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = ?
		   AND COLUMN_NAME = ?`,
		table, column,
	).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
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

// TableExists reports whether the named table exists in the current database.
func TableExists(ctx context.Context, db *sql.DB, table string) (bool, error) {
	var count int
	err := db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.TABLES
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = ?`,
		table,
	).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}
