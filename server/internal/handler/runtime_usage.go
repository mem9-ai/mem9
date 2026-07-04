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

const runtimeUsagePostSuccessTimeout = 10 * time.Second

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
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details"`
}

func normalizeRuntimeQuotaErrorBody(status int, body []byte) []byte {
	body = bytes.TrimSpace(body)
	envelope := runtimeQuotaErrorEnvelope{
		Code:    runtimeQuotaDefaultCode(status),
		Message: runtimeQuotaDefaultMessage(status),
		Details: map[string]any{
			"retryable": runtimeQuotaDefaultRetryable(status),
			"mem9Code":  "runtime_quota_denied",
		},
	}
	var parsed map[string]any
	if len(body) > 0 && json.Unmarshal(body, &parsed) == nil {
		if code, ok := parsed["code"].(string); ok && code != "" {
			envelope.Code = code
		}
		if message, ok := parsed["message"].(string); ok && message != "" {
			envelope.Message = message
		}
		if details, ok := parsed["details"].(map[string]any); ok {
			envelope.Details = make(map[string]any, len(details)+2)
			for key, value := range details {
				envelope.Details[key] = value
			}
		}
		if retryable, ok := parsed["retryable"].(bool); ok {
			envelope.Details["retryable"] = retryable
		}
		if mem9Code, ok := parsed["mem9_code"].(string); ok && mem9Code != "" {
			envelope.Details["mem9Code"] = mem9Code
		}
		normalizeRuntimeQuotaRecommendedAction(envelope.Details)
	}
	if _, ok := envelope.Details["retryable"]; !ok {
		envelope.Details["retryable"] = runtimeQuotaDefaultRetryable(status)
	}
	if _, ok := envelope.Details["mem9Code"]; !ok {
		envelope.Details["mem9Code"] = "runtime_quota_denied"
	}
	out, err := json.Marshal(envelope)
	if err != nil {
		if status == http.StatusTooManyRequests {
			return []byte(`{"code":"post_quota_rate_limited","message":"Post-quota rate limit exceeded.","details":{"retryable":true,"mem9Code":"runtime_quota_denied"}}`)
		}
		return []byte(`{"code":"runtime_access_blocked","message":"Runtime access is blocked.","details":{"retryable":false,"mem9Code":"runtime_quota_denied"}}`)
	}
	return out
}

func runtimeQuotaDefaultCode(status int) string {
	if status == http.StatusTooManyRequests {
		return "post_quota_rate_limited"
	}
	return "runtime_access_blocked"
}

func runtimeQuotaDefaultMessage(status int) string {
	if status == http.StatusTooManyRequests {
		return "Post-quota rate limit exceeded."
	}
	return "Runtime access is blocked."
}

func runtimeQuotaDefaultRetryable(status int) bool {
	return status == http.StatusTooManyRequests
}

func normalizeRuntimeQuotaRecommendedAction(details map[string]any) {
	if details == nil {
		return
	}
	action, ok := canonicalRuntimeQuotaAction(details["recommendedAction"])
	if !ok {
		action = make(map[string]any)
	}
	if providerActionCode, ok := runtimeQuotaString(details["upgradeAction"]); ok {
		action["type"] = "openUrl"
		if _, exists := action["providerActionCode"]; !exists {
			action["providerActionCode"] = providerActionCode
		}
	}
	if url, ok := runtimeQuotaString(details["upgradeUrl"]); ok {
		action["type"] = "openUrl"
		if _, exists := action["url"]; !exists {
			action["url"] = url
		}
	}
	delete(details, "bindingState")
	delete(details, "upgradeAction")
	delete(details, "upgradeUrl")
	if len(action) == 0 {
		delete(details, "recommendedAction")
		return
	}
	if _, ok := action["type"]; !ok {
		action["type"] = "openUrl"
	}
	details["recommendedAction"] = action
}

func canonicalRuntimeQuotaAction(raw any) (map[string]any, bool) {
	actionInput, ok := raw.(map[string]any)
	if !ok {
		return nil, false
	}
	action := make(map[string]any)
	if actionType, ok := runtimeQuotaString(actionInput["type"]); ok {
		action["type"] = "openUrl"
		if actionType != "openUrl" {
			action["providerActionCode"] = actionType
		}
	}
	if providerActionCode, ok := runtimeQuotaString(actionInput["providerActionCode"]); ok {
		action["type"] = "openUrl"
		action["providerActionCode"] = providerActionCode
	}
	if severity, ok := runtimeQuotaString(actionInput["severity"]); ok {
		action["severity"] = severity
	}
	if url, ok := runtimeQuotaString(actionInput["url"]); ok {
		action["url"] = url
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
