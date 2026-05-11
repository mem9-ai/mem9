package tidb

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"log/slog"
	"net"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

const transientDBMaxAttempts = 3

var transientDBRetryDelays = []time.Duration{
	50 * time.Millisecond,
	150 * time.Millisecond,
}

func queryContextWithRetry(ctx context.Context, db *sql.DB, clusterID, op, query string, args ...any) (*sql.Rows, error) {
	var lastErr error
	for attempt := 1; attempt <= transientDBMaxAttempts; attempt++ {
		rows, err := db.QueryContext(ctx, query, args...)
		if err == nil {
			return rows, nil
		}
		lastErr = err
		if !shouldRetryTransientDBError(ctx, err, attempt) {
			return nil, err
		}
		if err := waitBeforeDBRetry(ctx, clusterID, op, attempt, lastErr); err != nil {
			return nil, err
		}
	}
	return nil, lastErr
}

func execContextWithRetry(ctx context.Context, db *sql.DB, clusterID, op, query string, args ...any) (sql.Result, int, error) {
	var lastErr error
	for attempt := 1; attempt <= transientDBMaxAttempts; attempt++ {
		result, err := db.ExecContext(ctx, query, args...)
		if err == nil {
			return result, attempt, nil
		}
		lastErr = err
		if !shouldRetryTransientDBError(ctx, err, attempt) {
			return nil, attempt, err
		}
		if err := waitBeforeDBRetry(ctx, clusterID, op, attempt, lastErr); err != nil {
			return nil, attempt, err
		}
	}
	return nil, transientDBMaxAttempts, lastErr
}

func queryRowScanWithRetry(ctx context.Context, clusterID, op string, scan func() error) error {
	var lastErr error
	for attempt := 1; attempt <= transientDBMaxAttempts; attempt++ {
		err := scan()
		if err == nil {
			return nil
		}
		lastErr = err
		if !shouldRetryTransientDBError(ctx, err, attempt) {
			return err
		}
		if err := waitBeforeDBRetry(ctx, clusterID, op, attempt, lastErr); err != nil {
			return err
		}
	}
	return lastErr
}

func withTransientDBRetry(ctx context.Context, clusterID, op string, fn func() error) error {
	var lastErr error
	for attempt := 1; attempt <= transientDBMaxAttempts; attempt++ {
		err := fn()
		if err == nil {
			return nil
		}
		lastErr = err
		if !shouldRetryTransientDBError(ctx, err, attempt) {
			return err
		}
		if err := waitBeforeDBRetry(ctx, clusterID, op, attempt, lastErr); err != nil {
			return err
		}
	}
	return lastErr
}

func shouldRetryTransientDBError(ctx context.Context, err error, attempt int) bool {
	if err == nil || attempt >= transientDBMaxAttempts {
		return false
	}
	if ctx != nil && ctx.Err() != nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	if errors.Is(err, driver.ErrBadConn) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	lower := strings.ToLower(err.Error())
	for _, needle := range []string{
		"invalid connection",
		"bad connection",
		"unexpected eof",
		"connection reset",
		"server closed idle connection",
		"broken pipe",
		"tls handshake timeout",
		"temporary failure",
	} {
		if strings.Contains(lower, needle) {
			return true
		}
	}
	return false
}

func waitBeforeDBRetry(ctx context.Context, clusterID, op string, attempt int, err error) error {
	delay := transientDBRetryDelays[min(attempt-1, len(transientDBRetryDelays)-1)]
	slog.WarnContext(ctx, "transient db error; retrying",
		"cluster_id", clusterID,
		"op", op,
		"attempt", attempt,
		"next_attempt", attempt+1,
		"delay_ms", delay.Milliseconds(),
		"err", err,
	)
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func isDuplicateKeyError(err error) bool {
	var mysqlErr *mysql.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == 1062
}
