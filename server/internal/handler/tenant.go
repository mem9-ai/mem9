package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/service"
)

var allowedUTMKeys = map[string]struct{}{
	"utm_source":   {},
	"utm_medium":   {},
	"utm_campaign": {},
	"utm_content":  {},
}

type provisionResponse struct {
	ID string `json:"id"`
}

type keyStatusResponse struct {
	Status domain.KeyStatus `json:"status"`
}

type apiKeyStatusResolution struct {
	Status domain.KeyStatus
	Auth   *domain.AuthInfo
}

func (s *Server) provisionMem9s(w http.ResponseWriter, r *http.Request) {
	result, err := s.tenant.Provision(r.Context(), service.ProvisionRequest{
		UTM: normalizeUTMParams(r.URL.Query()),
	})
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}

	respond(w, http.StatusCreated, provisionResponse{
		ID: result.ID,
	})
}

func normalizeUTMParams(values url.Values) map[string]string {
	if len(values) == 0 {
		return nil
	}

	filtered := make(map[string]string)
	for key, params := range values {
		if _, ok := allowedUTMKeys[key]; !ok {
			continue
		}

		for _, value := range params {
			if value == "" {
				continue
			}

			filtered[key] = value
			break
		}
	}

	if len(filtered) == 0 {
		return nil
	}

	return filtered
}

func (s *Server) getKeyStatus(w http.ResponseWriter, r *http.Request) {
	resolution, ok := s.resolveAPIKeyStatus(w, r)
	if !ok {
		return
	}
	respond(w, http.StatusOK, keyStatusResponse{Status: resolution.Status})
}

func (s *Server) resolveAPIKeyStatus(w http.ResponseWriter, r *http.Request) (apiKeyStatusResolution, bool) {
	apiKey := strings.TrimSpace(r.Header.Get(middleware.APIKeyHeader))
	if apiKey == "" {
		respondError(w, http.StatusUnauthorized, "missing or malformed X-API-Key")
		return apiKeyStatusResolution{}, false
	}
	if strings.HasPrefix(apiKey, domain.ChainKeyPrefix) {
		if s.chains == nil {
			respondError(w, http.StatusInternalServerError, "auth backend unavailable")
			return apiKeyStatusResolution{}, false
		}
		status, err := s.chains.KeyStatus(r.Context(), apiKey)
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrNotFound):
				respondError(w, http.StatusNotFound, "key not found")
			default:
				logger := s.logger
				if logger == nil {
					logger = slog.Default()
				}
				logger.ErrorContext(r.Context(), "chain key status lookup failed", "err", err)
				respondError(w, http.StatusInternalServerError, "auth backend unavailable")
			}
			return apiKeyStatusResolution{}, false
		}
		auth := &domain.AuthInfo{
			APIKeySubject: apiKey,
			AgentName:     r.Header.Get(middleware.AgentIDHeader),
			Chain: &domain.ChainAuth{
				APIKey: apiKey,
			},
		}
		return apiKeyStatusResolution{Status: status, Auth: auth}, true
	}

	if s.tenant == nil {
		respondError(w, http.StatusInternalServerError, "auth backend unavailable")
		return apiKeyStatusResolution{}, false
	}
	statusResult, err := s.tenant.ResolveAPIKeyStatus(r.Context(), apiKey)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrNotFound):
			respondError(w, http.StatusNotFound, "key not found")
		default:
			logger := s.logger
			if logger == nil {
				logger = slog.Default()
			}
			logger.ErrorContext(r.Context(), "key status lookup failed", "err", err)
			respondError(w, http.StatusInternalServerError, "auth backend unavailable")
		}
		return apiKeyStatusResolution{}, false
	}
	auth := &domain.AuthInfo{
		TenantID:      statusResult.TenantID,
		ClusterID:     statusResult.ClusterID,
		APIKeySubject: apiKey,
		AgentName:     r.Header.Get(middleware.AgentIDHeader),
	}
	return apiKeyStatusResolution{Status: statusResult.Status, Auth: auth}, true
}

func (s *Server) getTenantInfo(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)

	info, err := s.tenant.GetInfo(r.Context(), auth.TenantID)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}

	respond(w, http.StatusOK, info)
}
