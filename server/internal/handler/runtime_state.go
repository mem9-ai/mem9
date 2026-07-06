package handler

import (
	"log/slog"
	"net/http"

	"github.com/qiffang/mnemos/server/internal/runtimeusage"
)

func (s *Server) getRuntimeState(w http.ResponseWriter, r *http.Request) {
	if s == nil || s.runtimeUsage == nil {
		respond(w, http.StatusOK, runtimeusage.RuntimeUsageDisabledState())
		return
	}

	state, err := s.runtimeUsage.RuntimeState(r.Context(), subjectFromAuth(authInfo(r)))
	if err != nil {
		logger := s.logger
		if logger == nil {
			logger = slog.Default()
		}
		logger.WarnContext(r.Context(), "runtime state fallback returned",
			"err", err,
		)
		state = runtimeusage.RuntimeStateProviderUnavailable()
	}
	respond(w, http.StatusOK, state)
}
