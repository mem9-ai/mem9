package handler

import (
	"crypto/sha256"
	"crypto/subtle"
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

type updateSpaceChainNodeRoutingPolicyRequest = service.UpdateSpaceChainNodeRoutingPolicyRequest

type deleteSpaceChainRequest struct {
	DeletedByUserID string `json:"deleted_by_user_id,omitempty"`
}

type disableSpaceChainBindingRequest struct {
	Disabled         bool   `json:"disabled"`
	DisabledByUserID string `json:"disabled_by_user_id,omitempty"`
}

// authorizeSpaceChainCreate applies the create gate. It reports whether the
// request may go on; when it returns false the 401 has already been written.
// A missing, malformed or wrong credential all get the same answer.
func (s *Server) authorizeSpaceChainCreate(w http.ResponseWriter, r *http.Request) bool {
	if !s.chainCreateGateRequired {
		return true
	}
	if token, ok := bearerToken(r.Header.Get("Authorization")); ok {
		// Compare fixed-length digests so the comparison time does not depend
		// on how much of the secret was guessed, nor on its length.
		presented := sha256.Sum256([]byte(token))
		if subtle.ConstantTimeCompare(presented[:], s.chainCreateSecretDigest[:]) == 1 {
			return true
		}
	}
	respondError(w, http.StatusUnauthorized, "missing or invalid Authorization bearer token")
	return false
}

// bearerToken returns the token of an "Authorization: Bearer <token>" header
// value. Leading whitespace is ignored, the scheme is matched without regard to
// case, it must be followed by spaces or tabs, and the token is what remains
// after trimming whitespace. The token it returns is never empty: the create
// gate relies on that to stay shut when no secret is configured.
func bearerToken(header string) (string, bool) {
	const scheme = "bearer"
	header = strings.TrimLeft(header, " \t")
	if len(header) <= len(scheme) || !strings.EqualFold(header[:len(scheme)], scheme) {
		return "", false
	}
	rest := header[len(scheme):]
	if rest[0] != ' ' && rest[0] != '\t' {
		return "", false
	}
	token := strings.TrimSpace(rest)
	return token, token != ""
}

func (s *Server) createSpaceChain(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeSpaceChainCreate(w, r) {
		return
	}
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
	respond(w, http.StatusOK, newSpaceChainView(chain))
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
	respond(w, http.StatusOK, newSpaceChainView(chain))
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
	respond(w, http.StatusOK, newSpaceChainView(chain))
}

func (s *Server) deleteSpaceChain(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorizeSpaceChainManagement(w, r); !ok {
		return
	}
	var req deleteSpaceChainRequest
	if r.Body != nil {
		var sizeErr *http.MaxBytesError
		if err := decode(r, &req); errors.As(err, &sizeErr) {
			s.handleError(r.Context(), w, err)
			return
		}
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
	respond(w, http.StatusOK, map[string]any{"nodes": newSpaceChainNodeViews(chain.Nodes)})
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
	respond(w, http.StatusOK, map[string]any{"nodes": newSpaceChainNodeViews(nodes)})
}

func (s *Server) updateSpaceChainNodeRoutingPolicy(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorizeSpaceChainManagement(w, r); !ok {
		return
	}
	var req updateSpaceChainNodeRoutingPolicyRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	node, err := s.chains.UpdateNodeRoutingPolicy(r.Context(), chi.URLParam(r, "chainID"), chi.URLParam(r, "nodeID"), req)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusOK, newSpaceChainNodeView(*node))
}

func (s *Server) listSpaceChainBindings(w http.ResponseWriter, r *http.Request) {
	chain, ok := s.authorizeSpaceChainManagement(w, r)
	if !ok {
		return
	}
	respond(w, http.StatusOK, map[string]any{"bindings": newSpaceChainBindingViews(chain.Bindings)})
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
