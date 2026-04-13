package tidb

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	"github.com/qiffang/mnemos/server/internal/tenant"
)

type PrototypeStoreStatus struct {
	Ready          bool
	Reason         string
	ActiveRowCount int
}

func CheckPrototypeStoreReady(ctx context.Context, db *sql.DB) (PrototypeStoreStatus, error) {
	status := PrototypeStoreStatus{}

	exists, err := tenant.TableExists(ctx, db, "recall_strategy_prototypes")
	if err != nil {
		status.Reason = "table_check_failed"
		return status, fmt.Errorf("check prototype table existence: %w", err)
	}
	if !exists {
		status.Reason = "table_missing"
		return status, nil
	}

	if err := db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM recall_strategy_prototypes WHERE active = 1`,
	).Scan(&status.ActiveRowCount); err != nil {
		status.Reason = "row_count_failed"
		return status, fmt.Errorf("count active prototype rows: %w", err)
	}
	if status.ActiveRowCount <= 0 {
		status.Reason = "table_empty"
		return status, nil
	}

	if err := EnsurePrototypeVectorIndex(ctx, db); err != nil {
		status.Reason = "index_bootstrap_failed"
		return status, err
	}

	status.Ready = true
	status.Reason = "ready"
	return status, nil
}

func EnsurePrototypeVectorIndex(ctx context.Context, db *sql.DB) error {
	exists, err := tenant.IndexExists(ctx, db, "recall_strategy_prototypes", "idx_rsp_vec")
	if err != nil {
		slog.Warn("could not check prototype vector index existence, attempting creation", "err", err)
	}
	if exists {
		slog.Debug("prototype vector index idx_rsp_vec already exists")
		return nil
	}

	start := time.Now()
	_, err = db.ExecContext(ctx,
		`ALTER TABLE recall_strategy_prototypes
		 ADD VECTOR INDEX idx_rsp_vec ((VEC_COSINE_DISTANCE(embedding)))
		 ADD_COLUMNAR_REPLICA_ON_DEMAND`)
	if err != nil {
		if tenant.IsIndexExistsError(err) {
			slog.Info("prototype vector index idx_rsp_vec already exists (race)", "duration_ms", time.Since(start).Milliseconds())
			return nil
		}
		return fmt.Errorf("create prototype vector index: %w", err)
	}
	slog.Info("prototype vector index idx_rsp_vec created", "duration_ms", time.Since(start).Milliseconds())
	return nil
}
