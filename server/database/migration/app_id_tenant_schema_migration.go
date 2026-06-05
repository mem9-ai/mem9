package main

import (
	"bufio"
	"context"
	"database/sql"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	tenantddl "github.com/qiffang/mnemos/server/internal/tenant"
)

const (
	successFileName = "success.tsv"
	failedFileName  = "failed.tsv"
	skippedFileName = "skipped.tsv"
)

type options struct {
	stateDir      string
	batchSize     int
	batchSleep    time.Duration
	tenantTimeout time.Duration
	dryRun        bool
	retryFailed   bool
}

type tenantRecord struct {
	id         string
	dbHost     string
	dbPort     int
	dbUser     string
	dbPassword string
	dbName     string
	dbTLS      bool
	provider   string
	status     string
}

type stateSets struct {
	success map[string]struct{}
	failed  map[string]struct{}
}

type stateRecorder struct {
	success io.WriteCloser
	failed  io.WriteCloser
	skipped io.WriteCloser
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "migration failed: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string, out io.Writer) error {
	opts, err := parseOptions(args)
	if err != nil {
		return err
	}

	metaDSN := strings.TrimSpace(os.Getenv("MNEMO_DSN"))
	if metaDSN == "" {
		return fmt.Errorf("MNEMO_DSN is required")
	}

	states, err := loadStates(opts.stateDir)
	if err != nil {
		return err
	}

	metaDB, err := sql.Open("mysql", metaDSN)
	if err != nil {
		return fmt.Errorf("open metadb: %w", err)
	}
	defer metaDB.Close()

	ctx := context.Background()
	tenants, err := fetchActiveTenants(ctx, metaDB)
	if err != nil {
		return err
	}

	var selected []tenantRecord
	var skipped []tenantRecord
	for _, record := range tenants {
		if skip, _ := shouldSkipTenant(record.id, states, opts.retryFailed); skip {
			skipped = append(skipped, record)
			continue
		}
		selected = append(selected, record)
	}

	fmt.Fprintf(out, "loaded tenants=%d selected=%d skipped=%d dry_run=%t retry_failed=%t\n",
		len(tenants), len(selected), len(skipped), opts.dryRun, opts.retryFailed)

	if opts.dryRun {
		for _, record := range skipped {
			_, reason := shouldSkipTenant(record.id, states, opts.retryFailed)
			fmt.Fprintf(out, "dry-run skip tenant_id=%s provider=%s reason=%s\n", record.id, record.provider, reason)
		}
		for _, record := range selected {
			fmt.Fprintf(out, "dry-run migrate tenant_id=%s provider=%s host=%s db=%s\n",
				record.id, record.provider, record.dbHost, record.dbName)
		}
		return nil
	}

	if err := os.MkdirAll(opts.stateDir, 0o700); err != nil {
		return fmt.Errorf("create state dir: %w", err)
	}
	recorder, err := openStateRecorder(opts.stateDir)
	if err != nil {
		return err
	}
	defer recorder.Close()

	for _, record := range skipped {
		_, reason := shouldSkipTenant(record.id, states, opts.retryFailed)
		if err := recorder.RecordSkipped(record.id, reason); err != nil {
			return err
		}
	}

	enc, err := encrypt.New(encrypt.Config{
		Type: encrypt.Type(strings.TrimSpace(os.Getenv("MNEMO_ENCRYPT_TYPE"))),
		Key:  os.Getenv("MNEMO_ENCRYPT_KEY"),
	})
	if err != nil {
		return fmt.Errorf("create encryptor: %w", err)
	}

	batches := splitBatches(selected, opts.batchSize)
	for batchIdx, batch := range batches {
		fmt.Fprintf(out, "starting batch %d/%d size=%d\n", batchIdx+1, len(batches), len(batch))
		for _, record := range batch {
			if err := migrateTenant(ctx, record, enc, opts.tenantTimeout); err != nil {
				fmt.Fprintf(out, "failed tenant_id=%s err=%s\n", record.id, err)
				if recordErr := recorder.RecordFailed(record.id, err); recordErr != nil {
					return recordErr
				}
				continue
			}
			fmt.Fprintf(out, "success tenant_id=%s\n", record.id)
			if err := recorder.RecordSuccess(record.id); err != nil {
				return err
			}
		}
		if batchIdx < len(batches)-1 && opts.batchSleep > 0 {
			fmt.Fprintf(out, "batch %d/%d complete; sleeping %s\n", batchIdx+1, len(batches), opts.batchSleep)
			time.Sleep(opts.batchSleep)
		}
	}

	return nil
}

func parseOptions(args []string) (options, error) {
	opts := options{}
	fs := flag.NewFlagSet("app_id_tenant_schema_migration", flag.ContinueOnError)
	fs.StringVar(&opts.stateDir, "state-dir", defaultStateDir(), "directory for success.tsv, failed.tsv, and skipped.tsv")
	fs.IntVar(&opts.batchSize, "batch-size", 100, "number of tenants to process per batch")
	fs.DurationVar(&opts.batchSleep, "batch-sleep", time.Minute, "sleep duration between batches")
	fs.DurationVar(&opts.tenantTimeout, "tenant-timeout", 2*time.Minute, "timeout for each tenant migration")
	fs.BoolVar(&opts.dryRun, "dry-run", false, "print selected tenants without connecting to tenant databases or running DDL")
	fs.BoolVar(&opts.retryFailed, "retry-failed", false, "retry tenants already listed in failed.tsv")
	if err := fs.Parse(args); err != nil {
		return opts, err
	}
	if opts.batchSize <= 0 {
		return opts, fmt.Errorf("--batch-size must be positive")
	}
	if opts.tenantTimeout <= 0 {
		return opts, fmt.Errorf("--tenant-timeout must be positive")
	}
	if opts.stateDir == "" {
		return opts, fmt.Errorf("--state-dir is required")
	}
	return opts, nil
}

func defaultStateDir() string {
	if cwd, err := os.Getwd(); err == nil && filepath.Base(cwd) == "server" {
		if _, statErr := os.Stat(filepath.Join(cwd, "database", "migration")); statErr == nil {
			return filepath.Join("database", "migration", "app_id_state")
		}
	}
	return filepath.Join("server", "database", "migration", "app_id_state")
}

func fetchActiveTenants(ctx context.Context, db *sql.DB) ([]tenantRecord, error) {
	rows, err := db.QueryContext(ctx, tenantQuery())
	if err != nil {
		return nil, fmt.Errorf("query active tenants: %w", err)
	}
	defer rows.Close()

	var records []tenantRecord
	for rows.Next() {
		var record tenantRecord
		if err := rows.Scan(
			&record.id,
			&record.dbHost,
			&record.dbPort,
			&record.dbUser,
			&record.dbPassword,
			&record.dbName,
			&record.dbTLS,
			&record.provider,
			&record.status,
		); err != nil {
			return nil, fmt.Errorf("scan tenant: %w", err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tenants: %w", err)
	}
	return records, nil
}

func tenantQuery() string {
	return `SELECT id, db_host, db_port, db_user, db_password, db_name, db_tls, provider, status
FROM tenants
WHERE status = 'active'
  AND deleted_at IS NULL
ORDER BY created_at ASC, id ASC`
}

func migrateTenant(ctx context.Context, record tenantRecord, enc encrypt.Encryptor, timeout time.Duration) error {
	tenantCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	password, err := enc.Decrypt(tenantCtx, record.dbPassword)
	if err != nil {
		return fmt.Errorf("decrypt tenant password: %w", err)
	}

	tenantInfo := &domain.Tenant{
		ID:         record.id,
		DBHost:     record.dbHost,
		DBPort:     record.dbPort,
		DBUser:     record.dbUser,
		DBPassword: password,
		DBName:     record.dbName,
		DBTLS:      record.dbTLS,
		Provider:   record.provider,
	}
	tenantDB, err := sql.Open("mysql", tenantInfo.DSNForBackend("tidb"))
	if err != nil {
		return fmt.Errorf("open tenant db: %w", err)
	}
	defer tenantDB.Close()
	tenantDB.SetMaxOpenConns(1)
	tenantDB.SetMaxIdleConns(0)
	tenantDB.SetConnMaxLifetime(timeout)

	if err := tenantDB.PingContext(tenantCtx); err != nil {
		return fmt.Errorf("ping tenant db: %w", err)
	}

	if err := migrateTenantSchema(tenantCtx, tenantDB); err != nil {
		return err
	}
	return nil
}

func migrateTenantSchema(ctx context.Context, db *sql.DB) error {
	if err := requireTable(ctx, db, "memories"); err != nil {
		return err
	}
	if err := ensureColumn(ctx, db, "memories", "app_id", "VARCHAR(100) NOT NULL DEFAULT ''"); err != nil {
		return fmt.Errorf("memories app_id column: %w", err)
	}
	if err := ensureIndex(ctx, db, "memories", "idx_app", "app_id"); err != nil {
		return fmt.Errorf("memories app_id index: %w", err)
	}
	if err := requireTable(ctx, db, "sessions"); err != nil {
		return err
	}
	if err := ensureColumn(ctx, db, "sessions", "app_id", "VARCHAR(100) NOT NULL DEFAULT ''"); err != nil {
		return fmt.Errorf("sessions app_id column: %w", err)
	}
	if err := ensureIndex(ctx, db, "sessions", "idx_sessions_app", "app_id"); err != nil {
		return fmt.Errorf("sessions app_id index: %w", err)
	}
	if err := ensureSessionsDedupIndex(ctx, db); err != nil {
		return fmt.Errorf("sessions dedup index: %w", err)
	}
	return nil
}

func requireTable(ctx context.Context, db *sql.DB, table string) error {
	exists, err := tenantddl.TableExists(ctx, db, table)
	if err != nil {
		return fmt.Errorf("check %s table: %w", table, err)
	}
	if !exists {
		return fmt.Errorf("%s table does not exist", table)
	}
	return nil
}

func ensureColumn(ctx context.Context, db *sql.DB, table, column, definition string) error {
	exists, err := tenantddl.ColumnExists(ctx, db, table, column)
	if err != nil {
		return fmt.Errorf("check column: %w", err)
	}
	if exists {
		return nil
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition)); err != nil && !tenantddl.IsDuplicateColumnError(err) {
		return fmt.Errorf("add column: %w", err)
	}
	return nil
}

func ensureIndex(ctx context.Context, db *sql.DB, table, indexName, columns string) error {
	exists, err := tenantddl.IndexExists(ctx, db, table, indexName)
	if err != nil {
		return fmt.Errorf("check index: %w", err)
	}
	if exists {
		return nil
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf("CREATE INDEX %s ON %s(%s)", indexName, table, columns)); err != nil && !tenantddl.IsIndexExistsError(err) {
		return fmt.Errorf("create index: %w", err)
	}
	return nil
}

func ensureSessionsDedupIndex(ctx context.Context, db *sql.DB) error {
	columns, err := indexColumns(ctx, db, "sessions", "idx_sessions_dedup")
	if err != nil {
		return fmt.Errorf("check index columns: %w", err)
	}
	if strings.Join(columns, ",") == "app_id,session_id,content_hash" {
		return nil
	}
	if _, err := db.ExecContext(ctx, "ALTER TABLE sessions DROP INDEX idx_sessions_dedup"); err != nil && !tenantddl.IsIndexNotFoundError(err) {
		return fmt.Errorf("drop old index: %w", err)
	}
	if _, err := db.ExecContext(ctx, "ALTER TABLE sessions ADD UNIQUE INDEX idx_sessions_dedup (app_id, session_id, content_hash)"); err != nil && !tenantddl.IsIndexExistsError(err) {
		return fmt.Errorf("add new index: %w", err)
	}
	return nil
}

func indexColumns(ctx context.Context, db *sql.DB, table, indexName string) ([]string, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = ?
  AND INDEX_NAME = ?
ORDER BY SEQ_IN_INDEX`,
		table,
		indexName,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []string
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			return nil, err
		}
		columns = append(columns, column)
	}
	return columns, rows.Err()
}

func loadStates(stateDir string) (stateSets, error) {
	success, err := loadIDSet(filepath.Join(stateDir, successFileName))
	if err != nil {
		return stateSets{}, fmt.Errorf("load success state: %w", err)
	}
	failed, err := loadIDSet(filepath.Join(stateDir, failedFileName))
	if err != nil {
		return stateSets{}, fmt.Errorf("load failed state: %w", err)
	}
	return stateSets{success: success, failed: failed}, nil
}

func loadIDSet(path string) (map[string]struct{}, error) {
	ids := make(map[string]struct{})
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return ids, nil
		}
		return nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Split(line, "\t")
		id := strings.TrimSpace(fields[0])
		if id == "" || id == "tenant_id" {
			continue
		}
		ids[id] = struct{}{}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}

func shouldSkipTenant(tenantID string, states stateSets, retryFailed bool) (bool, string) {
	if _, ok := states.success[tenantID]; ok {
		return true, "already-successful"
	}
	if _, ok := states.failed[tenantID]; ok && !retryFailed {
		return true, "already-failed"
	}
	return false, ""
}

func splitBatches(records []tenantRecord, batchSize int) [][]tenantRecord {
	if len(records) == 0 {
		return nil
	}
	var batches [][]tenantRecord
	for start := 0; start < len(records); start += batchSize {
		end := start + batchSize
		if end > len(records) {
			end = len(records)
		}
		batches = append(batches, records[start:end])
	}
	return batches
}

func openStateRecorder(stateDir string) (*stateRecorder, error) {
	success, err := openAppendFile(filepath.Join(stateDir, successFileName))
	if err != nil {
		return nil, err
	}
	failed, err := openAppendFile(filepath.Join(stateDir, failedFileName))
	if err != nil {
		success.Close()
		return nil, err
	}
	skipped, err := openAppendFile(filepath.Join(stateDir, skippedFileName))
	if err != nil {
		success.Close()
		failed.Close()
		return nil, err
	}
	return &stateRecorder{success: success, failed: failed, skipped: skipped}, nil
}

func openAppendFile(path string) (*os.File, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open state file %s: %w", path, err)
	}
	return file, nil
}

func (r *stateRecorder) Close() error {
	var errs []string
	for _, file := range []io.Closer{r.success, r.failed, r.skipped} {
		if file == nil {
			continue
		}
		if err := file.Close(); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("close state files: %s", strings.Join(errs, "; "))
	}
	return nil
}

func (r *stateRecorder) RecordSuccess(tenantID string) error {
	return writeStateLine(r.success, tenantID, time.Now(), "")
}

func (r *stateRecorder) RecordFailed(tenantID string, err error) error {
	return writeStateLine(r.failed, tenantID, time.Now(), err.Error())
}

func (r *stateRecorder) RecordSkipped(tenantID, reason string) error {
	return writeStateLine(r.skipped, tenantID, time.Now(), reason)
}

func writeStateLine(w io.Writer, tenantID string, at time.Time, detail string) error {
	if detail == "" {
		_, err := fmt.Fprintf(w, "%s\t%s\n", sanitizeTSV(tenantID), at.UTC().Format(time.RFC3339))
		return err
	}
	_, err := fmt.Fprintf(w, "%s\t%s\t%s\n", sanitizeTSV(tenantID), at.UTC().Format(time.RFC3339), sanitizeTSV(detail))
	return err
}

func sanitizeTSV(value string) string {
	value = strings.ReplaceAll(value, "\t", " ")
	value = strings.ReplaceAll(value, "\r", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	return strings.TrimSpace(value)
}
