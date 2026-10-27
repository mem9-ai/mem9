package keymigrations

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

func Source(backend string) ([]byte, error) {
	name := "001_credentials_tidb.sql"
	if backend == "postgres" || backend == "db9" {
		name = "001_credentials_postgres.sql"
	}
	return Files.ReadFile(name)
}

// Apply is called only by the explicit operator command, never on app startup.
// Each DDL is restartable; the existing column is checked before ALTER TABLE.
func Apply(ctx context.Context, db *sql.DB, backend string) error {
	data, err := Source(backend)
	if err != nil {
		return err
	}
	var lines []string
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			lines = append(lines, line)
		}
	}
	for _, statement := range strings.Split(strings.Join(lines, "\n"), ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if strings.Contains(statement, "ALTER TABLE tenants") {
			var n int
			q := "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='tenants' AND column_name='legacy_key_auth'"
			if backend == "postgres" || backend == "db9" {
				q = "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='tenants' AND column_name='legacy_key_auth'"
			}
			if db.QueryRowContext(ctx, q).Scan(&n) != nil {
				return errors.New("schema preflight failed")
			}
			if n > 0 {
				continue
			}
		}
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return errors.New("credential schema operation failed; inspect database migration state")
		}
	}
	return nil
}
