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
		body := denied.ResponseBody()
		if body = ensureMem9QuotaDeniedCode(body); len(body) > 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired)
			_, _ = w.Write(body)
			return
		}
		respondError(w, http.StatusPaymentRequired, "runtime usage quota denied")
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

func ensureMem9QuotaDeniedCode(body []byte) []byte {
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		return nil
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return body
	}
	if _, ok := parsed["mem9_code"]; !ok {
		parsed["mem9_code"] = "runtime_quota_denied"
	}
	out, err := json.Marshal(parsed)
	if err != nil {
		return body
	}
	return out
}
