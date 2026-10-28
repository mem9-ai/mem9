// mnemo-credentials prepares the additive mapping table and optionally copies
// existing keys. It never prints keys, tenant IDs, DSNs or raw database errors.
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
	action := flag.String("action", "schema", "schema or backfill")
	apply := flag.Bool("apply", false, "perform writes; otherwise preview only")
	limit := flag.Int("limit", 100, "maximum backfill records per invocation")
	timeout := flag.Duration("timeout", time.Minute, "operation deadline")
	flag.Parse()
	if *action != "schema" && *action != "backfill" {
		fail("action must be schema or backfill")
	}
	if *limit < 1 || *limit > 10000 {
		fail("limit must be between 1 and 10000")
	}
	backend := os.Getenv("MNEMO_DB_BACKEND")
	if backend == "" {
		backend = "tidb"
	}
	if *action == "schema" && !*apply {
		data, err := keymigrations.Source(backend)
		if err != nil {
			fail("schema input unavailable")
		}
		fmt.Print(string(data))
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	db, err := repository.NewDB(backend, os.Getenv("MNEMO_DSN"))
	if err != nil {
		fail("database connection failed")
	}
	defer db.Close()
	if *action == "schema" {
		if keymigrations.Apply(ctx, db, backend) != nil {
			fail("credential schema operation failed")
		}
		fmt.Println("credential schema applied")
		return
	}
	store, err := credentials.New(db, backend, os.Getenv("MNEMO_API_KEYS_SECRET_FILE"))
	if err != nil {
		fail(err.Error())
	}
	if store.CheckSchema(ctx) != nil {
		fail("credential schema preflight failed")
	}
	n, err := store.Backfill(ctx, *limit, !*apply)
	if err != nil {
		fail("credential backfill failed; no credential values were printed")
	}
	if json.NewEncoder(os.Stdout).Encode(map[string]any{"records": n, "applied": *apply}) != nil {
		fail("write backfill result failed")
	}
}

func fail(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(1) }
