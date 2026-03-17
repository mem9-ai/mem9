package tenant

import (
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
