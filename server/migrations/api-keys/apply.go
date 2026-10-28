package keymigrations

import (
	"context"
	"database/sql"
	"errors"
)

func Source(backend string) ([]byte, error) {
	name := "001_credentials_tidb.sql"
	if backend == "postgres" || backend == "db9" {
		name = "001_credentials_postgres.sql"
	}
	return Files.ReadFile(name)
}

// Apply creates only the mapping table. It never alters or backfills tenants.
// The operator runs it before deployment; application startup only checks it.
func Apply(ctx context.Context, db *sql.DB, backend string) error {
	data, err := Source(backend)
	if err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, string(data)); err != nil {
		return errors.New("credential schema operation failed")
	}
	return nil
}
