package handler

import (
	"log/slog"
	"net/http"

	"github.com/qiffang/mnemos/server/internal/runtimeusage"
)

func (s *Server) getRuntimeState(w http.ResponseWriter, r *http.Request) {
	resolution, ok := s.resolveAPIKeyStatus(w, r)
	if !ok {
		return
	}
	subject := subjectFromAuth(resolution.Auth)
	subject.APIKeyStatus = string(resolution.Status)

	if s == nil || s.runtimeUsage == nil {
		respond(w, http.StatusOK, runtimeusage.RuntimeUsageDisabledState(subject.APIKeyStatus))
		return
	}

	state, err := s.runtimeUsage.RuntimeState(r.Context(), subject)
	if err != nil {
		logger := s.logger
		if logger == nil {
			logger = slog.Default()
		}
		logger.WarnContext(r.Context(), "runtime state fallback returned",
			"err", err,
		)
		state = runtimeusage.RuntimeStateProviderUnavailable(subject.APIKeyStatus)
	}
	respond(w, http.StatusOK, state)
}
