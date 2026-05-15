package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/service"
)

type createSpaceChainRequest = service.CreateSpaceChainRequest

type updateSpaceChainRequest = service.UpdateSpaceChainRequest

type replaceSpaceChainNodesRequest = service.ReplaceSpaceChainNodesRequest

type createSpaceChainBindingRequest = service.CreateSpaceChainBindingRequest

type deleteSpaceChainRequest struct {
	DeletedByUserID string `json:"deleted_by_user_id,omitempty"`
}

type disableSpaceChainBindingRequest struct {
	Disabled         bool   `json:"disabled"`
	DisabledByUserID string `json:"disabled_by_user_id,omitempty"`
}

func (s *Server) createSpaceChain(w http.ResponseWriter, r *http.Request) {
	if s.chains == nil {
		respondError(w, http.StatusServiceUnavailable, "space chain service unavailable")
		return
	}
	var req createSpaceChainRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	result, err := s.chains.Create(r.Context(), req)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusCreated, result)
}

func (s *Server) getSpaceChain(w http.ResponseWriter, r *http.Request) {
	chain, ok := s.authorizeSpaceChainManagement(w, r)
	if !ok {
		return
	}
	respond(w, http.StatusOK, chain)
}

func (s *Server) getSpaceChainByKey(w http.ResponseWriter, r *http.Request) {
	if s.chains == nil {
		respondError(w, http.StatusServiceUnavailable, "space chain service unavailable")
		return
	}
	apiKey := strings.TrimSpace(r.Header.Get(middleware.APIKeyHeader))
	if apiKey == "" || !strings.HasPrefix(apiKey, domain.ChainKeyPrefix) {
		respondError(w, http.StatusUnauthorized, "missing or malformed X-API-Key")
		return
	}
	chain, err := s.chains.GetByKey(r.Context(), apiKey)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusOK, chain)
}

func (s *Server) updateSpaceChain(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorizeSpaceChainManagement(w, r); !ok {
		return
	}
	var req updateSpaceChainRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	chain, err := s.chains.Update(r.Context(), chi.URLParam(r, "chainID"), req)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusOK, chain)
}

func (s *Server) deleteSpaceChain(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorizeSpaceChainManagement(w, r); !ok {
		return
	}
	var req deleteSpaceChainRequest
	if r.Body != nil {
		_ = decode(r, &req)
	}
	if err := s.chains.Delete(r.Context(), chi.URLParam(r, "chainID"), req.DeletedByUserID); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listSpaceChainNodes(w http.ResponseWriter, r *http.Request) {
	chain, ok := s.authorizeSpaceChainManagement(w, r)
	if !ok {
		return
	}
	respond(w, http.StatusOK, map[string]any{"nodes": chain.Nodes})
}

func (s *Server) replaceSpaceChainNodes(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorizeSpaceChainManagement(w, r); !ok {
		return
	}
	var req replaceSpaceChainNodesRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	nodes, err := s.chains.ReplaceNodes(r.Context(), chi.URLParam(r, "chainID"), req)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{"nodes": nodes})
}

func (s *Server) listSpaceChainBindings(w http.ResponseWriter, r *http.Request) {
	chain, ok := s.authorizeSpaceChainManagement(w, r)
	if !ok {
		return
	}
	respond(w, http.StatusOK, map[string]any{"bindings": chain.Bindings})
}

func (s *Server) createSpaceChainBinding(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorizeSpaceChainManagement(w, r); !ok {
		return
	}
	var req createSpaceChainBindingRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	binding, err := s.chains.CreateBinding(r.Context(), chi.URLParam(r, "chainID"), req)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusCreated, binding)
}

func (s *Server) disableSpaceChainBinding(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorizeSpaceChainManagement(w, r); !ok {
		return
	}
	var req disableSpaceChainBindingRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	if !req.Disabled {
		s.handleError(r.Context(), w, &domain.ValidationError{Field: "disabled", Message: "must be true"})
		return
	}
	if err := s.chains.DisableBinding(r.Context(), chi.URLParam(r, "chainID"), chi.URLParam(r, "bindingID"), req.DisabledByUserID); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) authorizeSpaceChainManagement(w http.ResponseWriter, r *http.Request) (*domain.SpaceChain, bool) {
	if s.chains == nil {
		respondError(w, http.StatusServiceUnavailable, "space chain service unavailable")
		return nil, false
	}
	apiKey := strings.TrimSpace(r.Header.Get(middleware.APIKeyHeader))
	if apiKey == "" || !strings.HasPrefix(apiKey, domain.ChainKeyPrefix) {
		respondError(w, http.StatusUnauthorized, "missing or malformed X-API-Key")
		return nil, false
	}
	chain, err := s.chains.AuthorizeManagement(r.Context(), chi.URLParam(r, "chainID"), apiKey)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrNotFound):
			respondError(w, http.StatusNotFound, "space chain not found")
		case errors.Is(err, domain.ErrValidation):
			s.handleError(r.Context(), w, err)
		default:
			logger := s.logger
			if logger == nil {
				logger = slog.Default()
			}
			logger.ErrorContext(r.Context(), "space chain management auth failed", "err", err)
			respondError(w, http.StatusInternalServerError, "space chain auth failed")
		}
		return nil, false
	}
	return chain, true
}
