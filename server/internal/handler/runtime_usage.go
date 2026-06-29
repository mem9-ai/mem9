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
		body := normalizeRuntimeQuotaDeniedBody(denied.ResponseBody())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusPaymentRequired)
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

type runtimeQuotaDeniedEnvelope struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details"`
}

func normalizeRuntimeQuotaDeniedBody(body []byte) []byte {
	body = bytes.TrimSpace(body)
	envelope := runtimeQuotaDeniedEnvelope{
		Code:    "runtime_quota_denied",
		Message: "runtime usage quota denied",
		Details: map[string]any{
			"retryable": false,
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
	}
	if _, ok := envelope.Details["retryable"]; !ok {
		envelope.Details["retryable"] = false
	}
	if _, ok := envelope.Details["mem9Code"]; !ok {
		envelope.Details["mem9Code"] = "runtime_quota_denied"
	}
	out, err := json.Marshal(envelope)
	if err != nil {
		return []byte(`{"code":"runtime_quota_denied","message":"runtime usage quota denied","details":{"retryable":false,"mem9Code":"runtime_quota_denied"}}`)
	}
	return out
}
