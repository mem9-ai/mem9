package handler

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metrics"
)

const memoryListSlowRequestThreshold = 2 * time.Second

type memoryListObservationContextKey struct{}

type memoryListObservation struct {
	mu                   sync.Mutex
	logger               *slog.Logger
	clusterID            string
	mode                 string
	memoryType           string
	scanAll              bool
	limit                int
	offset               int
	startedAt            time.Time
	queryDuration        time.Duration
	overlayDuration      time.Duration
	mergeDuration        time.Duration
	memoryQueryDuration  time.Duration
	sessionQueryDuration time.Duration
	memoryPages          int
	memoryRows           int
	sessionPages         int
	sessionRows          int
	chainPages           int
	chainRows            int
	chainQueryDuration   time.Duration
}

func newMemoryListObservation(
	logger *slog.Logger,
	auth *domain.AuthInfo,
	filter domain.MemoryFilter,
	contentKeywordSearch bool,
) *memoryListObservation {
	if logger == nil {
		logger = slog.Default()
	}
	clusterID := ""
	if auth != nil {
		clusterID = auth.ClusterID
	}
	return &memoryListObservation{
		logger:     logger,
		clusterID:  clusterID,
		mode:       memoryListMode(auth, filter, contentKeywordSearch),
		memoryType: memoryListTypeLabel(filter.MemoryType),
		scanAll:    filter.ScanAll,
		limit:      filter.Limit,
		offset:     filter.Offset,
		startedAt:  time.Now(),
	}
}

func memoryListMode(auth *domain.AuthInfo, filter domain.MemoryFilter, contentKeywordSearch bool) string {
	if auth != nil && auth.IsChain() {
		return "chain"
	}
	if filter.Query != "" && contentKeywordSearch {
		return "content_keyword"
	}
	if filter.Query != "" && filter.ScanAll {
		return "scan_all"
	}
	if filter.Query != "" {
		switch filter.MemoryType {
		case "":
			return "default_recall"
		case string(domain.TypeSession), string(domain.TypePinned), string(domain.TypeInsight):
			return "single_pool_recall"
		default:
			return "other"
		}
	}
	if filter.MemoryType == string(domain.TypeSession) {
		return "session_list"
	}
	return "durable_list"
}

func memoryListTypeLabel(memoryType string) string {
	switch strings.TrimSpace(memoryType) {
	case "":
		return "all"
	case string(domain.TypeSession):
		return string(domain.TypeSession)
	case string(domain.TypePinned):
		return string(domain.TypePinned)
	case string(domain.TypeInsight):
		return string(domain.TypeInsight)
	default:
		return "other"
	}
}

func withMemoryListObservation(ctx context.Context, observation *memoryListObservation) context.Context {
	return context.WithValue(ctx, memoryListObservationContextKey{}, observation)
}

func memoryListObservationFromContext(ctx context.Context) *memoryListObservation {
	observation, _ := ctx.Value(memoryListObservationContextKey{}).(*memoryListObservation)
	return observation
}

func (o *memoryListObservation) recordPage(resource string, rows int, duration time.Duration) {
	o.mu.Lock()
	defer o.mu.Unlock()

	switch resource {
	case "memory":
		o.memoryPages++
		o.memoryRows += rows
		o.memoryQueryDuration += duration
	case "session":
		o.sessionPages++
		o.sessionRows += rows
		o.sessionQueryDuration += duration
	case "chain":
		o.chainPages++
		o.chainRows += rows
		o.chainQueryDuration += duration
	}
}

func (o *memoryListObservation) recordMerge(duration time.Duration) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.mergeDuration += duration
}

func (o *memoryListObservation) recordDirectList(auth *domain.AuthInfo, filter domain.MemoryFilter, contentKeywordSearch bool, rows int) {
	if auth != nil && auth.IsChain() {
		return
	}
	if filter.Query != "" && !contentKeywordSearch && !filter.ScanAll {
		return
	}
	if filter.Query != "" && filter.MemoryType == "" {
		return
	}
	if filter.MemoryType == string(domain.TypeSession) {
		o.sessionPages = 1
		o.sessionRows = rows
		return
	}
	o.memoryPages = 1
	o.memoryRows = rows
}

func (o *memoryListObservation) finish(ctx context.Context, err error, returned, total int) {
	duration := time.Since(o.startedAt)
	status := memoryRecallStatus(ctx, err)
	metrics.MemoryListRequestsTotal.WithLabelValues(o.mode, status).Inc()
	metrics.MemoryListDuration.WithLabelValues(o.mode, status).Observe(duration.Seconds())

	if status == "ok" && duration < memoryListSlowRequestThreshold {
		return
	}

	pages := o.memoryPages + o.sessionPages
	rows := o.memoryRows + o.sessionRows
	if pages == 0 && o.chainPages > 0 {
		pages = o.chainPages
		rows = o.chainRows
	}
	attrs := []slog.Attr{
		slog.String("cluster_id", o.clusterID),
		slog.String("mode", o.mode),
		slog.String("memory_type", o.memoryType),
		slog.Bool("scan_all", o.scanAll),
		slog.Int("limit", o.limit),
		slog.Int("offset", o.offset),
		slog.Int("returned", returned),
		slog.Int("total", total),
		slog.Int("pages", pages),
		slog.Int("rows", rows),
		slog.Int("memory_pages", o.memoryPages),
		slog.Int("memory_rows", o.memoryRows),
		slog.Int("session_pages", o.sessionPages),
		slog.Int("session_rows", o.sessionRows),
		slog.Int("chain_pages", o.chainPages),
		slog.Int("chain_rows", o.chainRows),
		slog.Int64("memory_query_ms", o.memoryQueryDuration.Milliseconds()),
		slog.Int64("session_query_ms", o.sessionQueryDuration.Milliseconds()),
		slog.Int64("chain_query_ms", o.chainQueryDuration.Milliseconds()),
		slog.Int64("query_ms", o.queryDuration.Milliseconds()),
		slog.Int64("merge_ms", o.mergeDuration.Milliseconds()),
		slog.Int64("overlay_ms", o.overlayDuration.Milliseconds()),
		slog.Int64("duration_ms", duration.Milliseconds()),
		slog.String("outcome", status),
		slog.String("cancel_origin", memoryListCancelOrigin(ctx, err)),
	}
	if status != "ok" {
		cause := err
		if cause == nil && ctx != nil {
			cause = ctx.Err()
		}
		classification := classifyInternalError(cause)
		attrs = append(attrs,
			slog.String("error_class", classification.class),
			slog.String("error_source", classification.source),
			slog.Bool("retryable", classification.retryable),
		)
	}

	message := "memory list completed"
	level := slog.LevelWarn
	if status != "ok" {
		message = "memory list failed"
		level = slog.LevelError
	}
	o.logger.LogAttrs(ctx, level, message, attrs...)
}

func memoryListCancelOrigin(ctx context.Context, err error) string {
	if ctx != nil {
		switch {
		case errors.Is(ctx.Err(), context.DeadlineExceeded):
			return "deadline"
		case errors.Is(ctx.Err(), context.Canceled):
			return "client"
		}
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "downstream"
	}
	return "none"
}
