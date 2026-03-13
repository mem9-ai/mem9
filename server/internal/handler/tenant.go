package handler

import (
	"net/http"
)

type provisionResponse struct {
	ID string `json:"id"`
}

func (s *Server) provisionMem9s(w http.ResponseWriter, r *http.Request) {
	result, err := s.tenant.Provision(r.Context())
	if err != nil {
		s.handleError(w, r, err)
		return
	}

	respond(w, http.StatusCreated, provisionResponse{
		ID: result.ID,
	})
}

func (s *Server) getTenantInfo(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)

	info, err := s.tenant.GetInfo(r.Context(), auth.TenantID)
	if err != nil {
		s.handleError(w, r, err)
		return
	}

	respond(w, http.StatusOK, info)
}
