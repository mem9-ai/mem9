package tidb

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	"github.com/qiffang/mnemos/server/internal/tenant"
)

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
