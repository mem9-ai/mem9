// mnemo-credentials runs explicit credential migration operations. It never
// prints source tenant IDs, keys, database errors, DSNs or filesystem paths.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/qiffang/mnemos/server/internal/credentials"
	"github.com/qiffang/mnemos/server/internal/repository"
	keymigrations "github.com/qiffang/mnemos/server/migrations/api-keys"
)

func main() {
	action := flag.String("action", "audit", "schema, backfill, outbox, migrate, progress, audit, forget-instance")
	apply := flag.Bool("apply", false, "perform writes; otherwise preview only")
	limit := flag.Int("limit", 100, "maximum records per invocation")
	id := flag.String("credential-id", "", "stable credential ID to resume (never a raw key)")
	instance := flag.String("instance-id", "", "verified stopped participant to remove")
	fenced := flag.Bool("participant-fenced", false, "confirm participant process stopped and its upload volume was migrated or retired")
	upgraded := flag.Bool("all-writers-upgraded", false, "confirm all API instances, workers and administrative writers use this version")
	timeout := flag.Duration("timeout", 15*time.Minute, "operation deadline; interrupted tenant migrations remain blocked and resumable")
	flag.Parse()
	if *limit < 1 || *limit > 10000 {
		fail("limit must be between 1 and 10000")
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	backend := os.Getenv("MNEMO_DB_BACKEND")
	if backend == "" {
		backend = "tidb"
	}
	db, err := repository.NewDB(backend, os.Getenv("MNEMO_DSN"))
	if err != nil {
		fail("database connection failed")
	}
	defer db.Close()
	if *action == "schema" {
		data, err := keymigrations.Source(backend)
		if err != nil {
			fail("schema input unavailable")
		}
		if !*apply {
			fmt.Print(string(data))
			return
		}
		if keymigrations.Apply(ctx, db, backend) != nil {
			fail("schema operation failed; inspect migration state without logging credentials")
		}

		fmt.Println("schema applied")
		return
	}
	cfg, err := credentials.LoadConfig()
	if err != nil {
		fail(err.Error())
	}
	uploadDir := os.Getenv("MNEMO_UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "./uploads"
	}
	store, err := credentials.New(db, backend, cfg, uploadDir)
	if err != nil {
		fail(err.Error())
	}
	if store.CheckSchema(ctx) != nil {
		fail("credential schema preflight failed")
	}
	var result any
	switch *action {
	case "backfill":
		n, err := store.Backfill(ctx, *limit, !*apply)
		if err != nil {
			fail("backfill failed; no credential values were printed")
		}
		result = map[string]any{"records": n, "applied": *apply}
	case "outbox":
		if *apply && !*upgraded {
			fail("outbox conversion requires all-writers-upgraded confirmation")
		}
		n, err := store.ConvertOutbox(ctx, *limit, !*apply)
		if err != nil {
			fail("outbox conversion failed; check exact credential coverage")
		}
		result = map[string]any{"rows": n, "applied": *apply}
	case "migrate":
		if *apply && !*upgraded {
			fail("tenant migration requires all-writers-upgraded confirmation")
		}
		ids := []string{*id}
		if *id == "" {
			ids, err = store.MigrationIDs(ctx, *limit)
			if err != nil {
				fail("candidate lookup failed")
			}
		}
		for _, id := range ids {
			json.NewEncoder(os.Stdout).Encode(map[string]any{"credential_id": id, "applying": *apply})
			if err := store.MigrateTenant(ctx, id, !*apply); err != nil {
				fail("tenant migration paused; resume the same credential ID after inspecting participants and progress")
			}
		}
		result = map[string]any{"credentials": ids, "applied": *apply}
	case "progress":
		rows, err := db.QueryContext(ctx, store.SQL("SELECT id,COALESCE(new_tenant_id,''),migration_phase,(SELECT COUNT(*) FROM api_key_readers r WHERE r.api_key_id=k.id) FROM api_keys k WHERE migrating=TRUE ORDER BY id LIMIT ?"), *limit)
		if err != nil {
			fail("migration progress lookup failed")
		}
		defer rows.Close()
		var progress []map[string]any
		for rows.Next() {
			var id, target, phase string
			var readers int
			if rows.Scan(&id, &target, &phase, &readers) != nil {
				fail("migration progress decode failed")
			}
			progress = append(progress, map[string]any{"credential_id": id, "new_tenant_id": target, "phase": phase, "readers": readers})
		}
		if rows.Err() != nil {
			fail("migration progress read failed")
		}
		result = progress
	case "audit":
		result, err = store.Audit(ctx)
		if err != nil {
			fail("credential audit failed")
		}
	case "forget-instance":
		if !*apply || !*fenced || *instance == "" {
			fail("forget-instance requires apply, instance-id and participant-fenced")
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			fail("participant cleanup failed")
		}
		defer tx.Rollback()
		if _, err := tx.ExecContext(ctx, store.SQL("DELETE FROM api_key_readers WHERE instance_id=?"), *instance); err != nil {
			fail("participant reader cleanup failed")
		}
		if _, err := tx.ExecContext(ctx, store.SQL("DELETE FROM api_key_instances WHERE id=?"), *instance); err != nil {
			fail("participant cleanup failed")
		}
		if tx.Commit() != nil {
			fail("participant cleanup commit failed")
		}
		result = map[string]any{"participant_removed": true}
	default:
		fail("unknown action")
	}
	json.NewEncoder(os.Stdout).Encode(result)
}

func fail(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(1) }
