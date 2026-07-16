package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/runtimeusage"
)

const (
	runtimeUsagePostRequestTimeout  = 10 * time.Second
	runtimeQuotaPublicErrorCategory = "runtime_quota_denied"
	runtimeUsageStageReserve        = "reserve"
	runtimeUsageStageFinalize       = "finalize"
	runtimeUsageRoleClientResponse  = "client_response"
	runtimeUsageRoleBackground      = "background_finalize"
)

type runtimeUsageErrorDetails struct {
	stage       string
	clusterID   string
	meter       string
	operationID string
}

func (s *Server) runtimeUsageEnabled() bool {
	return s != nil && s.runtimeUsage != nil && s.runtimeUsage.Enabled()
}

func memoryIDs(memories []domain.Memory) []string {
	ids := make([]string, 0, len(memories))
	for _, mem := range memories {
		if mem.ID != "" {
			ids = append(ids, mem.ID)
		}
	}
	return ids
}

func withRuntimeUsagePostSuccessContext(parent context.Context, run func(context.Context) error) error {
	// Post-success finalization must survive request cancellation after tenant writes commit.
	ctx, cancel := runtimeUsagePostRequestContext(parent)
	defer cancel()
	return run(ctx)
}

func withRuntimeUsagePostFailureContext(parent context.Context, run func(context.Context)) {
	ctx, cancel := runtimeUsagePostRequestContext(parent)
	defer cancel()
	run(ctx)
}

func (s *Server) afterRuntimeUsageRecallFailure(parent context.Context, lease *runtimeusage.OperationLease, cause error) {
	withRuntimeUsagePostFailureContext(parent, func(ctx context.Context) {
		s.runtimeUsage.AfterRecallFailure(ctx, lease, cause)
	})
}

func (s *Server) afterRuntimeUsageMemoryCreateFailure(parent context.Context, lease *runtimeusage.OperationLease, cause error) {
	withRuntimeUsagePostFailureContext(parent, func(ctx context.Context) {
		s.runtimeUsage.AfterMemoryCreateFailure(ctx, lease, cause)
	})
}

func (s *Server) afterRuntimeUsageMemoryUpdateFailure(parent context.Context, lease *runtimeusage.OperationLease, cause error) {
	withRuntimeUsagePostFailureContext(parent, func(ctx context.Context) {
		s.runtimeUsage.AfterMemoryUpdateFailure(ctx, lease, cause)
	})
}

func (s *Server) afterRuntimeUsageMemoryDeleteFailure(parent context.Context, lease *runtimeusage.OperationLease, cause error) {
	withRuntimeUsagePostFailureContext(parent, func(ctx context.Context) {
		s.runtimeUsage.AfterMemoryDeleteFailure(ctx, lease, cause)
	})
}

func runtimeUsagePostRequestContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(parent), runtimeUsagePostRequestTimeout)
}

func subjectFromAuth(auth *domain.AuthInfo) runtimeusage.Subject {
	if auth == nil {
		return runtimeusage.Subject{}
	}
	subject := auth.APIKeySubject
	if subject == "" && auth.Chain != nil {
		subject = auth.Chain.APIKey
	}
	if subject == "" {
		subject = auth.TenantID
	}
	return runtimeusage.Subject{
		TenantID:      auth.TenantID,
		ClusterID:     auth.ClusterID,
		APIKeySubject: subject,
		AgentName:     auth.AgentName,
	}
}

func runtimeUsageReserveErrorDetails(auth *domain.AuthInfo, meter string) runtimeUsageErrorDetails {
	return runtimeUsageErrorDetails{
		stage:     runtimeUsageStageReserve,
		clusterID: subjectFromAuth(auth).ClusterID,
		meter:     meter,
	}
}

func runtimeUsageFinalizeErrorDetails(lease *runtimeusage.OperationLease) runtimeUsageErrorDetails {
	details := runtimeUsageErrorDetails{stage: runtimeUsageStageFinalize}
	if lease == nil {
		return details
	}
	details.clusterID = lease.Subject.ClusterID
	details.meter = lease.Meter
	details.operationID = lease.OperationID
	return details
}

func (s *Server) handleRuntimeUsageError(
	ctx context.Context,
	w http.ResponseWriter,
	err error,
	details runtimeUsageErrorDetails,
) {
	s.logRuntimeUsageError(ctx, err, details, runtimeUsageRoleClientResponse)

	var denied *runtimeusage.QuotaDeniedError
	if errors.As(err, &denied) {
		status := denied.Status()
		body := normalizeRuntimeQuotaErrorBody(status, denied.ResponseBody())
		w.Header().Set("Content-Type", "application/json")
		if status == http.StatusTooManyRequests && denied.RetryAfter != "" {
			w.Header().Set("Retry-After", denied.RetryAfter)
		}
		w.WriteHeader(status)
		_, _ = w.Write(body)
		return
	}
	status := runtimeusage.HTTPStatus(err)
	if status == http.StatusBadGateway {
		respondError(w, status, "runtime usage conflict")
		return
	}
	respondError(w, status, "runtime usage unavailable")
}

func (s *Server) logRuntimeUsageBackgroundFinalizeError(ctx context.Context, err error, details runtimeUsageErrorDetails) {
	s.logRuntimeUsageError(ctx, err, details, runtimeUsageRoleBackground)
}

func (s *Server) logRuntimeUsageError(ctx context.Context, err error, details runtimeUsageErrorDetails, errorRole string) {
	errorClass, status, retryable := classifyRuntimeUsageError(err)
	statusField := "http_status"
	message := "runtime usage request failed"
	if errorRole == runtimeUsageRoleBackground {
		statusField = "mapped_status"
		message = "runtime usage background finalization failed"
	}
	attrs := []any{
		"error_class", errorClass,
		"error_source", "runtime_usage",
		"error_role", errorRole,
		"stage", details.stage,
		statusField, status,
		"retryable", retryable,
		"err", err,
	}
	if details.clusterID != "" {
		attrs = append(attrs, "cluster_id", details.clusterID)
	}
	if details.meter != "" {
		attrs = append(attrs, "meter", details.meter)
	}
	if details.operationID != "" {
		attrs = append(attrs, "operation_id", details.operationID)
	}

	logger := s.logger
	if logger == nil {
		logger = slog.Default()
	}
	level := slog.LevelError
	if errorClass == "quota_denied" {
		level = slog.LevelWarn
	}
	logger.Log(ctx, level, message, attrs...)
}

func classifyRuntimeUsageError(err error) (string, int, bool) {
	status := runtimeusage.HTTPStatus(err)
	var denied *runtimeusage.QuotaDeniedError
	if errors.As(err, &denied) {
		return "quota_denied", status, status == http.StatusTooManyRequests
	}
	var conflict *runtimeusage.ConflictError
	if errors.As(err, &conflict) {
		return "conflict", status, true
	}
	return "unavailable", status, true
}

func isRuntimeUsageError(err error) bool {
	var denied *runtimeusage.QuotaDeniedError
	var unavailable *runtimeusage.UnavailableError
	var conflict *runtimeusage.ConflictError
	return errors.As(err, &denied) || errors.As(err, &unavailable) || errors.As(err, &conflict)
}

type runtimeQuotaErrorEnvelope struct {
	Error   string         `json:"error"`
	Details map[string]any `json:"details,omitempty"`
}

func normalizeRuntimeQuotaErrorBody(status int, body []byte) []byte {
	body = bytes.TrimSpace(body)
	runtimeQuota := map[string]any{}
	envelope := runtimeQuotaErrorEnvelope{
		Error: runtimeQuotaDefaultMessage(status),
	}
	var parsed map[string]any
	if len(body) > 0 && json.Unmarshal(body, &parsed) == nil {
		if message, ok := runtimeQuotaString(parsed["message"]); ok {
			envelope.Error = message
		}
		if details, ok := parsed["details"].(map[string]any); ok {
			// Reservation providers return code/message/details; the public API
			// exposes a smaller runtimeQuota contract rather than provider internals.
			runtimeQuota = publicRuntimeQuotaDetails(details)
		}
	}
	envelope.Details = map[string]any{
		"errorCategory": runtimeQuotaPublicErrorCategory,
	}
	if len(runtimeQuota) > 0 {
		envelope.Details["runtimeQuota"] = runtimeQuota
	}
	out, err := json.Marshal(envelope)
	if err != nil {
		if status == http.StatusTooManyRequests {
			return []byte(`{"error":"Post-quota rate limit exceeded.","details":{"errorCategory":"runtime_quota_denied"}}`)
		}
		return []byte(`{"error":"Runtime access is blocked.","details":{"errorCategory":"runtime_quota_denied"}}`)
	}
	return out
}

func runtimeQuotaDefaultMessage(status int) string {
	if status == http.StatusTooManyRequests {
		return "Post-quota rate limit exceeded."
	}
	return "Runtime access is blocked."
}

func publicRuntimeQuotaDetails(details map[string]any) map[string]any {
	runtimeQuota := map[string]any{}
	if meter, ok := runtimeQuotaString(details["meter"]); ok {
		runtimeQuota["meter"] = meter
	}
	if action, ok := publicRuntimeQuotaRecommendedAction(details["recommendedAction"]); ok {
		runtimeQuota["recommendedAction"] = action
	}
	if gateResult, ok := details["quotaGateResult"].(map[string]any); ok {
		runtimeQuota["quotaGateResult"] = gateResult
	}
	return runtimeQuota
}

func publicRuntimeQuotaRecommendedAction(raw any) (map[string]any, bool) {
	actionInput, ok := raw.(map[string]any)
	if !ok {
		return nil, false
	}
	actionType, ok := runtimeQuotaString(actionInput["type"])
	if !ok || actionType != "openUrl" {
		return nil, false
	}
	action := map[string]any{
		"type": actionType,
	}
	for _, key := range []string{"providerActionCode", "severity", "url"} {
		if value, ok := runtimeQuotaString(actionInput[key]); ok {
			action[key] = value
		}
	}
	return action, true
}

func runtimeQuotaString(value any) (string, bool) {
	text, ok := value.(string)
	if !ok || text == "" {
		return "", false
	}
	return text, true
}
