package databend

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/datafuselabs/databend-go"
)

// NewDB creates a configured *sql.DB connection pool for Databend.
func NewDB(dsn string) (*sql.DB, error) {
	db, err := sql.Open("databend", dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return db, nil
}
