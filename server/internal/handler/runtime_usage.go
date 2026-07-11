package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/runtimeusage"
)

const (
	runtimeUsagePostSuccessTimeout  = 10 * time.Second
	runtimeQuotaPublicErrorCategory = "runtime_quota_denied"
)

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

func withRuntimeUsagePostSuccessContext(run func(context.Context) error) error {
	// Post-success finalization must survive request cancellation after tenant writes commit.
	ctx, cancel := context.WithTimeout(context.Background(), runtimeUsagePostSuccessTimeout)
	defer cancel()
	return run(ctx)
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

func (s *Server) handleRuntimeUsageError(w http.ResponseWriter, err error) {
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
