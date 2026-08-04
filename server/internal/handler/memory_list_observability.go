package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/service"
)

const memoryListSlowRequestThreshold = 2 * time.Second

type memoryListObservationContextKey struct{}

type memoryListObservation struct {
	mu                    sync.Mutex
	logger                *slog.Logger
	clusterID             string
	mode                  string
	memoryType            string
	scanAll               bool
	limit                 int
	offset                int
	startedAt             time.Time
	queryDuration         time.Duration
	overlayDuration       time.Duration
	mergeDuration         time.Duration
	memoryQueryDuration   time.Duration
	sessionQueryDuration  time.Duration
	memoryPages           int
	memoryRows            int
	sessionPages          int
	sessionRows           int
	allTypePages          int
	allTypeRows           int
	chainPages            int
	chainRows             int
	chainQueryDuration    time.Duration
	recallBudget          time.Duration
	responseReserve       time.Duration
	pinnedRecallDuration  time.Duration
	insightRecallDuration time.Duration
	sessionRecallDuration time.Duration
	pinnedRecallOutcome   string
	insightRecallOutcome  string
	sessionRecallOutcome  string
	recallPartial         bool
	recallWarnings        []recallWarning
	responseWriteOutcome  string
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
		logger:               logger,
		clusterID:            clusterID,
		mode:                 memoryListMode(auth, filter, contentKeywordSearch),
		memoryType:           memoryListTypeLabel(filter.MemoryType),
		scanAll:              filter.ScanAll,
		limit:                filter.Limit,
		offset:               filter.Offset,
		startedAt:            time.Now(),
		responseWriteOutcome: "not_attempted",
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
	if filter.MemoryType == "" {
		return "all_types_list"
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
	ctx = context.WithValue(ctx, memoryListObservationContextKey{}, observation)
	return domain.WithRecallWarningRecorder(ctx, func(warning domain.RecallWarning) {
		observation.recordRecallPartial([]recallWarning{warning})
	})
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

func (o *memoryListObservation) configureRecallBudget(total, responseReserve time.Duration) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.recallBudget = total
	o.responseReserve = responseReserve
}

func (o *memoryListObservation) recordRecallBranches(branches [3]recallBranchResult) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for _, branch := range branches {
		switch branch.name {
		case string(service.RecallSourcePinned):
			o.pinnedRecallDuration = branch.duration
			o.pinnedRecallOutcome = recallBranchOutcome(branch.err)
		case string(service.RecallSourceInsight):
			o.insightRecallDuration = branch.duration
			o.insightRecallOutcome = recallBranchOutcome(branch.err)
		case string(service.RecallSourceSession):
			o.sessionRecallDuration = branch.duration
			o.sessionRecallOutcome = recallBranchOutcome(branch.err)
		}
	}
}

func (o *memoryListObservation) recordRecallPartial(warnings []recallWarning) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.recallPartial = true
	for _, warning := range warnings {
		seen := false
		for _, existing := range o.recallWarnings {
			if existing == warning {
				seen = true
				break
			}
		}
		if !seen {
			o.recallWarnings = append(o.recallWarnings, warning)
		}
	}
}

func (o *memoryListObservation) recallResponseMetadata() (bool, []recallWarning) {
	o.mu.Lock()
	defer o.mu.Unlock()
	warnings := append([]recallWarning(nil), o.recallWarnings...)
	sort.Slice(warnings, func(i, j int) bool {
		if warnings[i].Branch != warnings[j].Branch {
			return warnings[i].Branch < warnings[j].Branch
		}
		return warnings[i].Code < warnings[j].Code
	})
	return o.recallPartial, warnings
}

func (o *memoryListObservation) recordResponseWrite(err error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.responseWriteOutcome = "success"
	if err != nil {
		o.responseWriteOutcome = "failed"
	}
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
	if filter.Query == "" && filter.MemoryType == "" {
		o.allTypePages = 1
		o.allTypeRows = rows
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
	status := memoryListStatus(ctx, err)
	clientCanceled := isClientCanceledRequest(ctx, err)
	metrics.MemoryListRequestsTotal.WithLabelValues(o.mode, status).Inc()
	metrics.MemoryListDuration.WithLabelValues(o.mode, status).Observe(duration.Seconds())

	if status == "ok" && duration < memoryListSlowRequestThreshold && o.recallBudget == 0 {
		return
	}

	pages := o.memoryPages + o.sessionPages + o.allTypePages
	rows := o.memoryRows + o.sessionRows + o.allTypeRows
	if pages == 0 && o.chainPages > 0 {
		pages = o.chainPages
		rows = o.chainRows
	}
	outcome := status
	cancelOrigin := memoryListCancelOrigin(ctx, err)
	cancelCause := memoryListCancelCause(ctx, err)
	if o.recallPartial {
		outcome = "partial"
		cancelOrigin = "server_deadline"
		cancelCause = "server_budget_exhausted"
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
		slog.Int("all_type_pages", o.allTypePages),
		slog.Int("all_type_rows", o.allTypeRows),
		slog.Int("chain_pages", o.chainPages),
		slog.Int("chain_rows", o.chainRows),
		slog.Int64("memory_query_ms", o.memoryQueryDuration.Milliseconds()),
		slog.Int64("session_query_ms", o.sessionQueryDuration.Milliseconds()),
		slog.Int64("chain_query_ms", o.chainQueryDuration.Milliseconds()),
		slog.Int64("query_ms", o.queryDuration.Milliseconds()),
		slog.Int64("merge_ms", o.mergeDuration.Milliseconds()),
		slog.Int64("overlay_ms", o.overlayDuration.Milliseconds()),
		slog.Int64("duration_ms", duration.Milliseconds()),
		slog.String("outcome", outcome),
		slog.String("cancel_origin", cancelOrigin),
		slog.String("cancel_cause", cancelCause),
	}
	if o.recallBudget > 0 {
		attrs = append(attrs,
			slog.Int64("budget_ms", o.recallBudget.Milliseconds()),
			slog.Int64("response_reserve_ms", o.responseReserve.Milliseconds()),
			slog.String("pinned_outcome", o.pinnedRecallOutcome),
			slog.Int64("pinned_ms", o.pinnedRecallDuration.Milliseconds()),
			slog.String("insight_outcome", o.insightRecallOutcome),
			slog.Int64("insight_ms", o.insightRecallDuration.Milliseconds()),
			slog.String("session_outcome", o.sessionRecallOutcome),
			slog.Int64("session_ms", o.sessionRecallDuration.Milliseconds()),
			slog.Bool("partial", o.recallPartial),
			slog.String("response_write_outcome", o.responseWriteOutcome),
		)
	}
	var budgetErr *memoryListBudgetExceededError
	if errors.As(err, &budgetErr) {
		attrs = append(attrs,
			slog.String("budget_dimension", budgetErr.dimension),
			slog.String("budget_source", budgetErr.source),
			slog.String("error_class", "budget_exceeded"),
			slog.String("error_source", "server_budget"),
			slog.Bool("retryable", false),
		)
	} else if clientCanceled {
		class, source, retryable := clientCanceledClassification()
		attrs = append(attrs,
			slog.String("error_class", class),
			slog.String("error_source", source),
			slog.Bool("retryable", retryable),
			slog.Int("http_status", statusClientClosedRequest),
		)
	} else if isRecallServerDeadline(err) {
		attrs = append(attrs,
			slog.String("error_class", "server_deadline_exceeded"),
			slog.String("error_source", "server_budget"),
			slog.Bool("retryable", true),
			slog.Int("http_status", http.StatusGatewayTimeout),
		)
	} else if status != "ok" {
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
	level := slog.LevelInfo
	if clientCanceled {
		message = "memory list canceled"
		level = slog.LevelInfo
	} else if o.recallPartial {
		level = slog.LevelWarn
	} else if status != "ok" {
		message = "memory list failed"
		level = slog.LevelError
	} else if duration >= memoryListSlowRequestThreshold {
		level = slog.LevelWarn
	}
	o.logger.LogAttrs(ctx, level, message, attrs...)
}

func memoryListStatus(ctx context.Context, err error) string {
	var budgetErr *memoryListBudgetExceededError
	if errors.As(err, &budgetErr) {
		return "budget_exceeded"
	}
	return memoryRecallStatus(ctx, err)
}

func memoryListCancelOrigin(ctx context.Context, err error) string {
	if isRecallServerDeadline(err) {
		return "server_deadline"
	}
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

func memoryListCancelCause(ctx context.Context, err error) string {
	if isRecallServerDeadline(err) {
		return "server_budget_exhausted"
	}
	if isClientCanceledRequest(ctx, err) {
		return "client_disconnect"
	}
	if ctx != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "request_deadline"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "downstream_deadline"
	}
	if errors.Is(err, context.Canceled) {
		return "downstream_cancellation"
	}
	return "none"
}
