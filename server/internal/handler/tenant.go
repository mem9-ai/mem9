package handler

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/qiffang/mnemos/server/internal/service"
)

type provisionResponse struct {
	ID string `json:"id"`
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
		if !strings.HasPrefix(key, "utm_") {
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

func (s *Server) getTenantInfo(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)

	info, err := s.tenant.GetInfo(r.Context(), auth.TenantID)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}

	respond(w, http.StatusOK, info)
}
