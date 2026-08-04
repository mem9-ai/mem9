package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

const (
	defaultRecallRequestTimeout  = time.Minute
	defaultRecallResponseReserve = 5 * time.Second
	recallServerDeadlineCode     = "recall_server_deadline_exceeded"
	recallServerDeadlineMessage  = "recall request deadline exceeded"
	recallBranchDeadlineCode     = "recall_branch_deadline_exceeded"
)

type recallBudgetContextKey struct{}

type recallBudgetContext struct {
	total           time.Duration
	responseReserve time.Duration
	startedAt       time.Time
	totalDeadline   time.Time
	workDeadline    time.Time
	totalContext    context.Context
	handlerReached  atomic.Bool
}

type recallServerDeadlineError struct{}

func (*recallServerDeadlineError) Error() string {
	return recallServerDeadlineMessage
}

func (*recallServerDeadlineError) Unwrap() error {
	return context.DeadlineExceeded
}

type recallWarning = domain.RecallWarning

func newRecallRequestBudget(parent context.Context, total, responseReserve time.Duration) (context.Context, context.Context, context.CancelFunc) {
	totalCtx, cancelTotal := newRecallTotalBudget(parent, total, responseReserve)
	workCtx, cancelWork := newRecallWorkContext(totalCtx)
	return totalCtx, workCtx, func() {
		cancelWork()
		cancelTotal()
	}
}

func newRecallTotalBudget(parent context.Context, total, responseReserve time.Duration) (context.Context, context.CancelFunc) {
	startedAt := time.Now()
	totalCtx, cancel := context.WithTimeoutCause(parent, total, &recallServerDeadlineError{})
	totalDeadline, _ := totalCtx.Deadline()
	budget := &recallBudgetContext{
		total:           total,
		responseReserve: responseReserve,
		startedAt:       startedAt,
		totalDeadline:   totalDeadline,
		workDeadline:    totalDeadline.Add(-responseReserve),
	}
	ctx := context.WithValue(totalCtx, recallBudgetContextKey{}, budget)
	budget.totalContext = ctx
	return ctx, cancel
}

func newRecallWorkContext(parent context.Context) (context.Context, context.CancelFunc) {
	budget, ok := recallBudgetFromContext(parent)
	if !ok {
		return context.WithCancel(parent)
	}
	return context.WithDeadlineCause(parent, budget.workDeadline, &recallServerDeadlineError{})
}

func newRecallResponseContext(parent context.Context) (context.Context, context.CancelFunc) {
	budget, ok := recallBudgetFromContext(parent)
	if !ok {
		return context.WithCancel(parent)
	}
	writeReserve := budget.responseReserve / 2
	return context.WithDeadlineCause(parent, budget.totalDeadline.Add(-writeReserve), &recallServerDeadlineError{})
}

func newRecallHandlerContext(handlerCtx context.Context, budget *recallBudgetContext) (context.Context, context.CancelFunc) {
	if budget == nil {
		return context.WithCancel(handlerCtx)
	}
	ctx, cancel := context.WithDeadlineCause(context.WithoutCancel(handlerCtx), budget.totalDeadline, &recallServerDeadlineError{})
	stop := context.AfterFunc(budget.totalContext, func() {
		if errors.Is(context.Cause(budget.totalContext), context.Canceled) {
			cancel()
		}
	})
	return ctx, func() {
		stop()
		cancel()
	}
}

func (s *Server) recallRequestBudgetMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isRecallHTTPRequest(r) {
			next.ServeHTTP(w, r)
			return
		}
		totalCtx, cancelTotal := newRecallTotalBudget(r.Context(), s.recallRequestTimeout, s.recallResponseReserve)
		defer cancelTotal()
		workCtx, cancelWork := newRecallWorkContext(totalCtx)
		defer cancelWork()
		budget, _ := recallBudgetFromContext(totalCtx)
		writer := &recallBudgetResponseWriter{ResponseWriter: w, workCtx: workCtx, budget: budget}
		clearWriteDeadline := setRecallResponseWriteDeadline(w, totalCtx)
		defer clearWriteDeadline()
		next.ServeHTTP(writer, r.WithContext(workCtx))
		writer.completeDeadlineResponse()
		if writer.overrideStatus != 0 {
			logger := s.logger
			if logger == nil {
				logger = slog.Default()
			}
			level := slog.LevelError
			message := "recall request deadline exceeded before handler"
			errorClass := "server_deadline_exceeded"
			errorSource := "server_budget"
			cancelOrigin := "server_deadline"
			cancelCause := "server_budget_exhausted"
			retryable := true
			if writer.overrideStatus == statusClientClosedRequest {
				level = slog.LevelInfo
				message = "recall request canceled before handler"
				errorClass = "client_canceled"
				errorSource = "request_context"
				cancelOrigin = "client"
				cancelCause = "client_disconnect"
				retryable = false
			}
			logger.Log(totalCtx, level, message,
				"error_role", "final",
				"error_class", errorClass,
				"error_source", errorSource,
				"retryable", retryable,
				"http_status", writer.overrideStatus,
				"cancel_origin", cancelOrigin,
				"cancel_cause", cancelCause,
				"budget_ms", budget.total.Milliseconds(),
				"response_reserve_ms", budget.responseReserve.Milliseconds(),
				"response_write_outcome", writer.writeOutcome,
			)
		}
	})
}

type recallBudgetResponseWriter struct {
	http.ResponseWriter
	workCtx        context.Context
	budget         *recallBudgetContext
	wroteHeader    bool
	overrideStatus int
	writeOutcome   string
}

func (w *recallBudgetResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *recallBudgetResponseWriter) WriteHeader(status int) {
	if w.shouldOverride() {
		w.writeDeadlineResponse()
		return
	}
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *recallBudgetResponseWriter) Write(payload []byte) (int, error) {
	if w.shouldOverride() {
		w.writeDeadlineResponse()
		return len(payload), nil
	}
	if w.overrideStatus != 0 {
		return len(payload), nil
	}
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(payload)
}

func (w *recallBudgetResponseWriter) shouldOverride() bool {
	return !w.wroteHeader && w.terminalStatus() != 0
}

func (w *recallBudgetResponseWriter) completeDeadlineResponse() {
	if w.shouldOverride() && w.overrideStatus == 0 {
		w.writeDeadlineResponse()
	}
}

func (w *recallBudgetResponseWriter) terminalStatus() int {
	if w.budget == nil || w.budget.handlerReached.Load() {
		return 0
	}
	if isRecallServerDeadline(recallServerDeadlineFromContext(w.workCtx)) {
		return http.StatusGatewayTimeout
	}
	if errors.Is(w.workCtx.Err(), context.Canceled) && errors.Is(context.Cause(w.workCtx), context.Canceled) {
		return statusClientClosedRequest
	}
	return 0
}

func (w *recallBudgetResponseWriter) writeDeadlineResponse() {
	if w.overrideStatus != 0 {
		return
	}
	w.overrideStatus = w.terminalStatus()
	if w.overrideStatus == 0 {
		return
	}
	w.wroteHeader = true
	w.Header().Del("Content-Length")
	var err error
	if w.overrideStatus == http.StatusGatewayTimeout {
		err = respond(w.ResponseWriter, w.overrideStatus, recallServerDeadlinePayload())
	} else {
		err = respondError(w.ResponseWriter, w.overrideStatus, "client closed request")
	}
	w.writeOutcome = "success"
	if err != nil {
		w.writeOutcome = "failed"
	}
}

func recallServerDeadlinePayload() map[string]string {
	return map[string]string{
		"code":  recallServerDeadlineCode,
		"error": recallServerDeadlineMessage,
	}
}

func isRecallHTTPRequest(r *http.Request) bool {
	if r == nil || r.Method != http.MethodGet || strings.TrimSpace(r.URL.Query().Get("q")) == "" || isContentKeywordSearch(r.URL.Query()) {
		return false
	}
	path := strings.TrimSuffix(r.URL.Path, "/")
	if path == "/v1alpha2/mem9s/memories" {
		return true
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	return len(parts) == 4 && parts[0] == "v1alpha1" && parts[1] == "mem9s" && parts[2] != "" && parts[3] == "memories"
}

func setRecallResponseWriteDeadline(w http.ResponseWriter, ctx context.Context) func() {
	budget, ok := recallBudgetFromContext(ctx)
	if !ok {
		return func() {}
	}
	controller := http.NewResponseController(w)
	if err := controller.SetWriteDeadline(budget.totalDeadline); err != nil {
		return func() {}
	}
	return func() {
		_ = controller.SetWriteDeadline(time.Time{})
	}
}

func newRecallBranchContext(parent context.Context) (context.Context, context.CancelFunc) {
	budget, ok := recallBudgetFromContext(parent)
	if !ok {
		return context.WithCancel(parent)
	}
	return context.WithDeadlineCause(parent, budget.workDeadline, &recallServerDeadlineError{})
}

func recallBudgetFromContext(ctx context.Context) (*recallBudgetContext, bool) {
	budget, ok := ctx.Value(recallBudgetContextKey{}).(*recallBudgetContext)
	return budget, ok
}

func recallServerDeadlineFromContext(ctx context.Context) error {
	var deadlineErr *recallServerDeadlineError
	if errors.As(context.Cause(ctx), &deadlineErr) {
		return deadlineErr
	}
	return nil
}

func isRecallServerDeadline(err error) bool {
	var deadlineErr *recallServerDeadlineError
	return errors.As(err, &deadlineErr)
}

func normalizeRecallBranchError(ctx context.Context, err error) error {
	if err == nil || !recallBranchCanceled(err) {
		return err
	}
	if serverDeadlineErr := recallServerDeadlineFromContext(ctx); serverDeadlineErr != nil {
		return serverDeadlineErr
	}
	return err
}
