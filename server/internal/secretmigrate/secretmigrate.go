// Package secretmigrate backfills legacy control-plane secret values into the
// field-bound enc:v1 format without exposing row identifiers or secret data.
package secretmigrate

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/qiffang/mnemos/server/internal/secrets"
)

const (
	ModeDryRun   = "dry-run"
	ModeBackfill = "backfill"
	ModeVerify   = "verify"
	ModeScrub    = "scrub"
)

var allFields = []string{
	secrets.FieldTenantDBPassword,
	secrets.FieldTenantClaimURL,
	secrets.FieldWebhookSecret,
	secrets.FieldOutboxAPIKeySubject,
}

// Options are validated command-line options for migrate-secrets.
type Options struct {
	Mode      string
	Fields    []string
	BatchSize int
	Pause     time.Duration
	MaxRows   int
}

// Deps carries the database and protector wiring built by the server command.
type Deps struct {
	DB          *sql.DB
	Backend     string
	Protector   *secrets.Protector
	WriteFormat string
}

// Result contains only aggregate integer counters for one field.
type Result struct {
	Field               string
	Scanned             int64
	Updated             int64
	SkippedEmpty        int64
	CASConflicts        int64
	Errors              int64
	Remaining           int64
	DecryptFailures     int64
	DoneRowsWithSubject int64
}

// Parse parses and validates migrate-secrets arguments.
func Parse(args []string) (Options, error) {
	opts := Options{BatchSize: 100, Pause: 200 * time.Millisecond}
	fs := flag.NewFlagSet("migrate-secrets", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	mode := fs.String("mode", "", "migration mode")
	fields := fs.String("fields", "", "comma-separated protected field constants")
	batchSize := fs.Int("batch-size", 100, "rows per batch")
	pause := fs.Duration("pause", 200*time.Millisecond, "pause between batches")
	maxRows := fs.Int("max-rows", 0, "maximum rows updated per field")
	if err := fs.Parse(args); err != nil {
		return Options{}, errors.New("invalid migrate-secrets arguments")
	}
	if fs.NArg() != 0 {
		return Options{}, errors.New("migrate-secrets accepts flags only")
	}
	opts.Mode = strings.TrimSpace(*mode)
	switch opts.Mode {
	case ModeDryRun, ModeBackfill, ModeVerify, ModeScrub:
	default:
		return Options{}, errors.New("unsupported migrate-secrets mode")
	}
	if *fields != "" {
		for _, raw := range strings.Split(*fields, ",") {
			field := strings.TrimSpace(raw)
			if !knownField(field) {
				return Options{}, errors.New("unknown protected secret field")
			}
			if containsField(opts.Fields, field) {
				return Options{}, errors.New("duplicate protected secret field")
			}
			opts.Fields = append(opts.Fields, field)
		}
	}
	if *batchSize < 1 || *batchSize > 1000 {
		return Options{}, errors.New("batch size must be between 1 and 1000")
	}
	opts.BatchSize = *batchSize
	if *pause < 0 {
		return Options{}, errors.New("pause must not be negative")
	}
	opts.Pause = *pause
	if *maxRows < 0 {
		return Options{}, errors.New("max rows must not be negative")
	}
	opts.MaxRows = *maxRows
	return opts, nil
}

// Run executes the selected mode and returns only aggregate-safe errors.
func Run(ctx context.Context, deps Deps, opts Options, logger *slog.Logger) error {
	if logger == nil {
		logger = slog.Default()
	}
	if deps.DB == nil {
		return errors.New("migrate-secrets requires a database")
	}
	if !validBackend(deps.Backend) {
		return errors.New("migrate-secrets requires a supported database backend")
	}
	fields := opts.Fields
	if len(fields) == 0 {
		if opts.Mode == ModeScrub {
			fields = []string{secrets.FieldOutboxAPIKeySubject}
		} else {
			fields = allFields
		}
	}
	if opts.Mode == ModeScrub {
		for _, field := range fields {
			if field != secrets.FieldOutboxAPIKeySubject {
				return errors.New("scrub only supports the outbox secret field")
			}
		}
	}
	if (opts.Mode == ModeBackfill || opts.Mode == ModeVerify) && deps.Protector == nil {
		return errors.New("migrate-secrets mode requires a secret protector")
	}

	fieldsLabel := strings.Join(fields, ",")
	logger.Info("secret migration started", "mode", opts.Mode, "fields", fieldsLabel, "batch_size", opts.BatchSize, "write_format", deps.WriteFormat)

	var runErr error
	for _, field := range fields {
		var result Result
		var err error
		switch opts.Mode {
		case ModeDryRun:
			result, err = dryRun(ctx, deps, field)
		case ModeBackfill:
			result, err = backfill(ctx, deps, opts, field, logger)
		case ModeVerify:
			result, err = verify(ctx, deps, opts, field)
		case ModeScrub:
			result, err = scrub(ctx, deps, opts, field)
		}
		result.Field = field
		logger.Info("secret migration field summary",
			"field", result.Field,
			"scanned", result.Scanned,
			"updated", result.Updated,
			"skipped_empty", result.SkippedEmpty,
			"cas_conflicts", result.CASConflicts,
			"errors", result.Errors,
			"remaining", result.Remaining,
			"decrypt_failures", result.DecryptFailures,
			"done_rows_with_subject", result.DoneRowsWithSubject,
		)
		if err != nil {
			runErr = err
		}
	}
	if runErr != nil {
		return runErr
	}
	return nil
}

func dryRun(ctx context.Context, deps Deps, field string) (Result, error) {
	return countLegacy(ctx, deps, field)
}

func backfill(ctx context.Context, deps Deps, opts Options, field string, logger *slog.Logger) (Result, error) {
	if deps.WriteFormat != secrets.WriteFormatEncV1 {
		return Result{}, errors.New("backfill requires MNEMO_ENCRYPT_WRITE_FORMAT=enc_v1")
	}
	result := Result{}
	var cursor string
	for {
		if opts.MaxRows > 0 && result.Updated >= int64(opts.MaxRows) {
			break
		}
		rows, err := queryLegacyRows(ctx, deps, field, cursor, opts.BatchSize)
		if err != nil {
			return result, errors.New("query legacy secret rows failed")
		}
		if len(rows) == 0 {
			break
		}
		for _, row := range rows {
			cursor = row.Key
			result.Scanned++
			rowUpdated, rowConflicts, rowErrors := migrateRow(ctx, deps, field, row, &result)
			result.Updated += rowUpdated
			result.CASConflicts += rowConflicts
			result.Errors += rowErrors
			if opts.MaxRows > 0 && result.Updated >= int64(opts.MaxRows) {
				break
			}
		}
		if opts.Pause > 0 && len(rows) == opts.BatchSize {
			select {
			case <-ctx.Done():
				return result, errors.New("secret migration canceled")
			case <-time.After(opts.Pause):
			}
		}
	}
	remaining, err := countRemaining(ctx, deps, field)
	if err != nil {
		return result, errors.New("count remaining secret rows failed")
	}
	result.Remaining = remaining
	if result.Errors > 0 {
		return result, errors.New("secret backfill completed with row errors")
	}
	return result, nil
}

func verify(ctx context.Context, deps Deps, opts Options, field string) (Result, error) {
	remaining, err := countRemaining(ctx, deps, field)
	if err != nil {
		return Result{}, errors.New("count remaining secret rows failed")
	}
	result := Result{Remaining: remaining}
	var cursor string
	for {
		rows, err := queryEncV1Rows(ctx, deps, field, cursor, opts.BatchSize)
		if err != nil {
			return result, errors.New("query encrypted secret rows failed")
		}
		if len(rows) == 0 {
			break
		}
		for _, row := range rows {
			cursor = row.Key
			result.Scanned++
			for _, value := range row.Values {
				if value == "" {
					result.SkippedEmpty++
					continue
				}
				if _, err := deps.Protector.For(field).Decrypt(ctx, value); err != nil {
					result.DecryptFailures++
				}
			}
		}
		if opts.Pause > 0 && len(rows) == opts.BatchSize {
			select {
			case <-ctx.Done():
				return result, errors.New("secret migration canceled")
			case <-time.After(opts.Pause):
			}
		}
	}
	if field == secrets.FieldOutboxAPIKeySubject {
		done, err := countDoneOutboxRows(ctx, deps)
		if err != nil {
			return result, errors.New("count done outbox rows failed")
		}
		result.DoneRowsWithSubject = done
	}
	if result.Remaining > 0 || result.DecryptFailures > 0 || result.DoneRowsWithSubject > 0 {
		return result, errors.New("secret migration verification failed")
	}
	return result, nil
}

func scrub(ctx context.Context, deps Deps, opts Options, field string) (Result, error) {
	result := Result{}
	query := scrubSQL(deps)
	for {
		if opts.MaxRows > 0 && result.Updated >= int64(opts.MaxRows) {
			break
		}
		affected, err := execAffected(ctx, deps, query, opts.BatchSize)
		if err != nil {
			return result, errors.New("scrub done outbox rows failed")
		}
		if affected == 0 {
			break
		}
		result.Updated += affected
		if opts.Pause > 0 {
			select {
			case <-ctx.Done():
				return result, errors.New("secret migration canceled")
			case <-time.After(opts.Pause):
			}
		}
	}
	done, err := countDoneOutboxRows(ctx, deps)
	if err != nil {
		return result, errors.New("count done outbox rows failed")
	}
	result.DoneRowsWithSubject = done
	if done > 0 && opts.MaxRows == 0 {
		return result, errors.New("secret scrub left done outbox rows")
	}
	return result, nil
}

type legacyRow struct {
	Key    string
	Values []string
}

func migrateRow(ctx context.Context, deps Deps, field string, row legacyRow, result *Result) (updated, conflicts, rowErrors int64) {
	if field == secrets.FieldOutboxAPIKeySubject {
		return migrateOutboxRow(ctx, deps, row, result)
	}
	old := row.Values[0]
	encryptor := deps.Protector.For(field)
	plain, err := encryptor.Decrypt(ctx, old)
	if err != nil {
		return 0, 0, 1
	}
	next, err := encryptor.Encrypt(ctx, plain)
	if err != nil || !strings.HasPrefix(next, "enc:v1:") {
		return 0, 0, 1
	}
	selfCheck, err := encryptor.Decrypt(ctx, next)
	if err != nil || selfCheck != plain {
		return 0, 0, 1
	}
	query := simpleUpdateSQL(deps, field)
	affected, err := execAffected(ctx, deps, query, next, row.Key, old)
	if err != nil {
		return 0, 0, 1
	}
	if affected == 0 {
		return 0, 1, 0
	}
	return 1, 0, 0
}

func migrateOutboxRow(ctx context.Context, deps Deps, row legacyRow, result *Result) (updated, conflicts, rowErrors int64) {
	field := secrets.FieldOutboxAPIKeySubject
	encryptor := deps.Protector.For(field)
	anyUpdated := false
	for pathIndex, old := range row.Values {
		if old == "" {
			result.SkippedEmpty++
			continue
		}
		plain, err := encryptor.Decrypt(ctx, old)
		if err != nil {
			rowErrors++
			continue
		}
		next, err := encryptor.Encrypt(ctx, plain)
		if err != nil || !strings.HasPrefix(next, "enc:v1:") {
			rowErrors++
			continue
		}
		selfCheck, err := encryptor.Decrypt(ctx, next)
		if err != nil || selfCheck != plain {
			rowErrors++
			continue
		}
		query := outboxUpdateSQL(deps, pathIndex)
		affected, err := execAffected(ctx, deps, query, next, row.Key, old)
		if err != nil {
			rowErrors++
			continue
		}
		if affected == 0 {
			conflicts++
			continue
		}
		anyUpdated = true
	}
	if anyUpdated {
		updated = 1
	}
	return updated, conflicts, rowErrors
}

func countLegacy(ctx context.Context, deps Deps, field string) (Result, error) {
	remaining, err := countRemaining(ctx, deps, field)
	if err != nil {
		return Result{}, err
	}
	result := Result{Remaining: remaining, Scanned: remaining}
	if field == secrets.FieldOutboxAPIKeySubject {
		done, err := countDoneOutboxRows(ctx, deps)
		if err != nil {
			return Result{}, err
		}
		result.DoneRowsWithSubject = done
	}
	return result, nil
}

func countRemaining(ctx context.Context, deps Deps, field string) (int64, error) {
	query := remainingSQL(deps, field)
	var count int64
	if err := deps.DB.QueryRowContext(ctx, query).Scan(&count); err != nil {
		return 0, errors.New("count remaining secret rows failed")
	}
	return count, nil
}

func countDoneOutboxRows(ctx context.Context, deps Deps) (int64, error) {
	query := doneOutboxCountSQL(deps)
	var count int64
	if err := deps.DB.QueryRowContext(ctx, query).Scan(&count); err != nil {
		return 0, errors.New("count done outbox rows failed")
	}
	return count, nil
}

func execAffected(ctx context.Context, deps Deps, query string, args ...any) (int64, error) {
	result, err := deps.DB.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func knownField(field string) bool {
	for _, candidate := range allFields {
		if candidate == field {
			return true
		}
	}
	return false
}

func containsField(fields []string, field string) bool {
	for _, candidate := range fields {
		if candidate == field {
			return true
		}
	}
	return false
}

func validBackend(backend string) bool {
	return backend == "tidb" || backend == "mysql" || backend == "postgres" || backend == "db9"
}

func postgresBackend(backend string) bool {
	return backend == "postgres" || backend == "db9"
}

func fieldColumn(field string) (table, column, pk string, err error) {
	switch field {
	case secrets.FieldTenantDBPassword:
		return "tenants", "db_password", "id", nil
	case secrets.FieldTenantClaimURL:
		return "tenants", "claim_url", "id", nil
	case secrets.FieldWebhookSecret:
		return "webhook_endpoints", "secret_ciphertext", "id", nil
	case secrets.FieldOutboxAPIKeySubject:
		return "runtime_usage_outbox", "payload_json", "operation_id", nil
	default:
		return "", "", "", errors.New("unknown protected secret field")
	}
}

func remainingSQL(deps Deps, field string) string {
	if field == secrets.FieldOutboxAPIKeySubject {
		return "SELECT COUNT(*) FROM runtime_usage_outbox WHERE status <> 'done' AND (" + outboxLegacyCondition(deps) + ")"
	}
	table, column, _, _ := fieldColumn(field)
	return "SELECT COUNT(*) FROM " + table + " WHERE " + column + " IS NOT NULL AND " + column + " <> '' AND " + column + " NOT LIKE 'enc:%'"
}

func doneOutboxCountSQL(deps Deps) string {
	if postgresBackend(deps.Backend) {
		return "SELECT COUNT(*) FROM runtime_usage_outbox WHERE status = 'done' AND (jsonb_exists(payload_json, 'apiKeySubject') OR payload_json #> '{event,apiKeySubject}' IS NOT NULL)"
	}
	return "SELECT COUNT(*) FROM runtime_usage_outbox WHERE status = 'done' AND (JSON_CONTAINS_PATH(payload_json, 'one', '$.apiKeySubject', '$.event.apiKeySubject'))"
}

func queryLegacyRows(ctx context.Context, deps Deps, field, cursor string, limit int) ([]legacyRow, error) {
	return queryRows(ctx, deps, field, cursor, limit, false)
}

func queryEncV1Rows(ctx context.Context, deps Deps, field, cursor string, limit int) ([]legacyRow, error) {
	return queryRows(ctx, deps, field, cursor, limit, true)
}

func queryRows(ctx context.Context, deps Deps, field, cursor string, limit int, encV1 bool) ([]legacyRow, error) {
	if field != secrets.FieldOutboxAPIKeySubject {
		table, column, pk, err := fieldColumn(field)
		if err != nil {
			return nil, err
		}
		condition := column + " IS NOT NULL AND " + column + " <> '' AND " + column + " NOT LIKE 'enc:%'"
		if encV1 {
			condition = column + " LIKE 'enc:%'"
		}
		query := placeholder(deps, "SELECT "+pk+", "+column+" FROM "+table+" WHERE "+pk+" > ? AND ("+condition+") ORDER BY "+pk+" LIMIT ?")
		rows, err := deps.DB.QueryContext(ctx, query, cursor, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []legacyRow
		for rows.Next() {
			var key, value string
			if err := rows.Scan(&key, &value); err != nil {
				return nil, err
			}
			out = append(out, legacyRow{Key: key, Values: []string{value}})
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return out, nil
	}

	var query string
	if encV1 {
		query = outboxEncV1SelectSQL(deps)
	} else {
		query = outboxSelectPrefix(deps) + "(" + outboxLegacyCondition(deps) + ")) AS extracted ORDER BY operation_id LIMIT ?"
	}
	query = placeholder(deps, query)
	rows, err := deps.DB.QueryContext(ctx, query, cursor, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []legacyRow
	for rows.Next() {
		row := legacyRow{Values: make([]string, 2)}
		var first, second sql.NullString
		if err := rows.Scan(&row.Key, &first, &second); err != nil {
			return nil, err
		}
		row.Values[0], row.Values[1] = nullStringValue(first), nullStringValue(second)
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func outboxLegacyCondition(deps Deps) string {
	var conditions []string
	for _, value := range outboxExtracts(deps) {
		conditions = append(conditions, "("+value+" IS NOT NULL AND "+value+" <> '' AND "+value+" NOT LIKE 'enc:%')")
	}
	return strings.Join(conditions, " OR ")
}

func simpleUpdateSQL(deps Deps, field string) string {
	table, column, pk, _ := fieldColumn(field)
	assignment := column + " = ?"
	if field != secrets.FieldOutboxAPIKeySubject && !postgresBackend(deps.Backend) {
		// MySQL bumps ON UPDATE timestamps unless the column is assigned explicitly.
		assignment += ", updated_at = updated_at"
	}
	return placeholder(deps, "UPDATE "+table+" SET "+assignment+" WHERE "+pk+" = ? AND "+column+" = ?")
}

func outboxUpdateSQL(deps Deps, pathIndex int) string {
	if postgresBackend(deps.Backend) {
		if pathIndex == 0 {
			return placeholder(deps, "UPDATE runtime_usage_outbox SET payload_json = jsonb_set(payload_json, '{apiKeySubject}', to_jsonb(?::text)) WHERE operation_id = ? AND status <> 'done' AND payload_json->>'apiKeySubject' = ?")
		}
		return placeholder(deps, "UPDATE runtime_usage_outbox SET payload_json = jsonb_set(payload_json, '{event,apiKeySubject}', to_jsonb(?::text)) WHERE operation_id = ? AND status <> 'done' AND payload_json #>> '{event,apiKeySubject}' = ?")
	}
	if pathIndex == 0 {
		return "UPDATE runtime_usage_outbox SET payload_json = JSON_SET(payload_json, '$.apiKeySubject', ?) WHERE operation_id = ? AND status <> 'done' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.apiKeySubject')) = ?"
	}
	return "UPDATE runtime_usage_outbox SET payload_json = JSON_SET(payload_json, '$.event.apiKeySubject', ?) WHERE operation_id = ? AND status <> 'done' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.event.apiKeySubject')) = ?"
}

func scrubSQL(deps Deps) string {
	if postgresBackend(deps.Backend) {
		return placeholder(deps, "UPDATE runtime_usage_outbox SET payload_json = payload_json #- '{apiKeySubject}' #- '{event,apiKeySubject}' WHERE operation_id IN (SELECT operation_id FROM runtime_usage_outbox WHERE status = 'done' AND (payload_json->'apiKeySubject' IS NOT NULL OR payload_json #> '{event,apiKeySubject}' IS NOT NULL) LIMIT ?)")
	}
	return "UPDATE runtime_usage_outbox SET payload_json = JSON_REMOVE(payload_json, '$.apiKeySubject', '$.event.apiKeySubject') WHERE status = 'done' AND JSON_CONTAINS_PATH(payload_json, 'one', '$.apiKeySubject', '$.event.apiKeySubject') LIMIT ?"
}

func outboxExtracts(deps Deps) []string {
	if postgresBackend(deps.Backend) {
		return []string{"payload_json->>'apiKeySubject'", "payload_json #>> '{event,apiKeySubject}'"}
	}
	return []string{
		"JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.apiKeySubject'))",
		"JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.event.apiKeySubject'))",
	}
}

func outboxSelectPrefix(deps Deps) string {
	if postgresBackend(deps.Backend) {
		return "SELECT operation_id, apiKeySubject, event_api_key_subject FROM (SELECT operation_id, payload_json->>'apiKeySubject' AS apiKeySubject, payload_json #>> '{event,apiKeySubject}' AS event_api_key_subject FROM runtime_usage_outbox WHERE operation_id > ? AND status <> 'done' AND "
	}
	return "SELECT operation_id, apiKeySubject, event_api_key_subject FROM (SELECT operation_id, JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.apiKeySubject')) AS apiKeySubject, JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.event.apiKeySubject')) AS event_api_key_subject FROM runtime_usage_outbox WHERE operation_id > ? AND status <> 'done' AND "
}

func outboxEncV1SelectSQL(deps Deps) string {
	if postgresBackend(deps.Backend) {
		return "SELECT operation_id, apiKeySubject, event_api_key_subject FROM (SELECT operation_id, payload_json->>'apiKeySubject' AS apiKeySubject, payload_json #>> '{event,apiKeySubject}' AS event_api_key_subject FROM runtime_usage_outbox WHERE operation_id > ? AND (payload_json->>'apiKeySubject' LIKE 'enc:%' OR payload_json #>> '{event,apiKeySubject}' LIKE 'enc:%')) AS extracted ORDER BY operation_id LIMIT ?"
	}
	return "SELECT operation_id, apiKeySubject, event_api_key_subject FROM (SELECT operation_id, JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.apiKeySubject')) AS apiKeySubject, JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.event.apiKeySubject')) AS event_api_key_subject FROM runtime_usage_outbox WHERE operation_id > ? AND (JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.apiKeySubject')) LIKE 'enc:%' OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.event.apiKeySubject')) LIKE 'enc:%')) AS extracted ORDER BY operation_id LIMIT ?"
}

func placeholder(deps Deps, query string) string {
	if !postgresBackend(deps.Backend) {
		return query
	}
	var out strings.Builder
	index := 0
	for _, r := range query {
		if r == '?' {
			index++
			out.WriteString("$" + strconv.Itoa(index))
		} else {
			out.WriteRune(r)
		}
	}
	return out.String()
}
