package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/webhook"
)

type webhookCreateRequest struct {
	Name    string   `json:"name"`
	URL     string   `json:"url"`
	Enabled *bool    `json:"enabled,omitempty"`
	Events  []string `json:"events"`
}

type webhookUpdateRequest struct {
	Name    *string   `json:"name,omitempty"`
	URL     *string   `json:"url,omitempty"`
	Enabled *bool     `json:"enabled,omitempty"`
	Events  *[]string `json:"events,omitempty"`
}

func (s *Server) listTenantWebhooks(w http.ResponseWriter, r *http.Request) {
	scopeID, ok := s.tenantWebhookScope(w, r)
	if !ok {
		return
	}
	s.listWebhooks(w, r, webhook.ScopeTenant, scopeID)
}

func (s *Server) createTenantWebhook(w http.ResponseWriter, r *http.Request) {
	scopeID, ok := s.tenantWebhookScope(w, r)
	if !ok {
		return
	}
	s.createWebhook(w, r, webhook.ScopeTenant, scopeID)
}

func (s *Server) getTenantWebhook(w http.ResponseWriter, r *http.Request) {
	scopeID, ok := s.tenantWebhookScope(w, r)
	if !ok {
		return
	}
	s.getWebhook(w, r, webhook.ScopeTenant, scopeID)
}

func (s *Server) updateTenantWebhook(w http.ResponseWriter, r *http.Request) {
	scopeID, ok := s.tenantWebhookScope(w, r)
	if !ok {
		return
	}
	s.updateWebhook(w, r, webhook.ScopeTenant, scopeID)
}

func (s *Server) deleteTenantWebhook(w http.ResponseWriter, r *http.Request) {
	scopeID, ok := s.tenantWebhookScope(w, r)
	if !ok {
		return
	}
	s.deleteWebhook(w, r, webhook.ScopeTenant, scopeID)
}

func (s *Server) testTenantWebhook(w http.ResponseWriter, r *http.Request) {
	scopeID, ok := s.tenantWebhookScope(w, r)
	if !ok {
		return
	}
	s.testWebhook(w, r, webhook.ScopeTenant, scopeID)
}

func (s *Server) rotateTenantWebhookSecret(w http.ResponseWriter, r *http.Request) {
	scopeID, ok := s.tenantWebhookScope(w, r)
	if !ok {
		return
	}
	s.rotateWebhookSecret(w, r, webhook.ScopeTenant, scopeID)
}

func (s *Server) listTenantWebhookDeliveries(w http.ResponseWriter, r *http.Request) {
	scopeID, ok := s.tenantWebhookScope(w, r)
	if !ok {
		return
	}
	s.listWebhookDeliveries(w, r, webhook.ScopeTenant, scopeID)
}

func (s *Server) listSpaceChainWebhooks(w http.ResponseWriter, r *http.Request) {
	chain, ok := s.authorizeSpaceChainManagement(w, r)
	if !ok {
		return
	}
	s.listWebhooks(w, r, webhook.ScopeChain, chain.ID)
}

func (s *Server) createSpaceChainWebhook(w http.ResponseWriter, r *http.Request) {
	chain, ok := s.authorizeSpaceChainManagement(w, r)
	if !ok {
		return
	}
	s.createWebhook(w, r, webhook.ScopeChain, chain.ID)
}

func (s *Server) getSpaceChainWebhook(w http.ResponseWriter, r *http.Request) {
	chain, ok := s.authorizeSpaceChainManagement(w, r)
	if !ok {
		return
	}
	s.getWebhook(w, r, webhook.ScopeChain, chain.ID)
}

func (s *Server) updateSpaceChainWebhook(w http.ResponseWriter, r *http.Request) {
	chain, ok := s.authorizeSpaceChainManagement(w, r)
	if !ok {
		return
	}
	s.updateWebhook(w, r, webhook.ScopeChain, chain.ID)
}

func (s *Server) deleteSpaceChainWebhook(w http.ResponseWriter, r *http.Request) {
	chain, ok := s.authorizeSpaceChainManagement(w, r)
	if !ok {
		return
	}
	s.deleteWebhook(w, r, webhook.ScopeChain, chain.ID)
}

func (s *Server) testSpaceChainWebhook(w http.ResponseWriter, r *http.Request) {
	chain, ok := s.authorizeSpaceChainManagement(w, r)
	if !ok {
		return
	}
	s.testWebhook(w, r, webhook.ScopeChain, chain.ID)
}

func (s *Server) rotateSpaceChainWebhookSecret(w http.ResponseWriter, r *http.Request) {
	chain, ok := s.authorizeSpaceChainManagement(w, r)
	if !ok {
		return
	}
	s.rotateWebhookSecret(w, r, webhook.ScopeChain, chain.ID)
}

func (s *Server) listSpaceChainWebhookDeliveries(w http.ResponseWriter, r *http.Request) {
	chain, ok := s.authorizeSpaceChainManagement(w, r)
	if !ok {
		return
	}
	s.listWebhookDeliveries(w, r, webhook.ScopeChain, chain.ID)
}

func (s *Server) listWebhooks(w http.ResponseWriter, r *http.Request, scopeType, scopeID string) {
	if !s.requireWebhookService(w) {
		return
	}
	endpoints, err := s.webhooks.ListEndpoints(r.Context(), scopeType, scopeID)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{"webhooks": endpoints})
}

func (s *Server) createWebhook(w http.ResponseWriter, r *http.Request, scopeType, scopeID string) {
	if !s.requireWebhookService(w) {
		return
	}
	var req webhookCreateRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	endpoint, err := s.webhooks.CreateEndpoint(r.Context(), webhook.CreateEndpointInput{
		ScopeType: scopeType,
		ScopeID:   scopeID,
		Name:      req.Name,
		URL:       req.URL,
		Enabled:   enabled,
		Events:    req.Events,
	})
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusCreated, endpoint)
}

func (s *Server) getWebhook(w http.ResponseWriter, r *http.Request, scopeType, scopeID string) {
	if !s.requireWebhookService(w) {
		return
	}
	endpoint, err := s.webhooks.GetEndpoint(r.Context(), scopeType, scopeID, chi.URLParam(r, "webhookID"))
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusOK, endpoint)
}

func (s *Server) updateWebhook(w http.ResponseWriter, r *http.Request, scopeType, scopeID string) {
	if !s.requireWebhookService(w) {
		return
	}
	var req webhookUpdateRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	endpoint, err := s.webhooks.UpdateEndpoint(r.Context(), webhook.UpdateEndpointInput{
		ScopeType:  scopeType,
		ScopeID:    scopeID,
		EndpointID: chi.URLParam(r, "webhookID"),
		Name:       req.Name,
		URL:        req.URL,
		Enabled:    req.Enabled,
		Events:     req.Events,
	})
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusOK, endpoint)
}

func (s *Server) deleteWebhook(w http.ResponseWriter, r *http.Request, scopeType, scopeID string) {
	if !s.requireWebhookService(w) {
		return
	}
	if err := s.webhooks.DeleteEndpoint(r.Context(), scopeType, scopeID, chi.URLParam(r, "webhookID")); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) testWebhook(w http.ResponseWriter, r *http.Request, scopeType, scopeID string) {
	if !s.requireWebhookService(w) {
		return
	}
	delivery, err := s.webhooks.TestEndpoint(r.Context(), scopeType, scopeID, chi.URLParam(r, "webhookID"))
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusAccepted, map[string]any{"delivery": delivery})
}

func (s *Server) rotateWebhookSecret(w http.ResponseWriter, r *http.Request, scopeType, scopeID string) {
	if !s.requireWebhookService(w) {
		return
	}
	endpoint, err := s.webhooks.RotateSecret(r.Context(), scopeType, scopeID, chi.URLParam(r, "webhookID"))
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusOK, endpoint)
}

func (s *Server) listWebhookDeliveries(w http.ResponseWriter, r *http.Request, scopeType, scopeID string) {
	if !s.requireWebhookService(w) {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	deliveries, err := s.webhooks.ListDeliveries(r.Context(), scopeType, scopeID, limit)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{"deliveries": deliveries})
}

func (s *Server) tenantWebhookScope(w http.ResponseWriter, r *http.Request) (string, bool) {
	auth := authInfo(r)
	if auth == nil || auth.IsChain() || strings.TrimSpace(auth.TenantID) == "" {
		respondError(w, http.StatusBadRequest, "tenant API key required")
		return "", false
	}
	return auth.TenantID, true
}

func (s *Server) requireWebhookService(w http.ResponseWriter) bool {
	if s.webhooks == nil {
		respondError(w, http.StatusServiceUnavailable, "webhook service unavailable")
		return false
	}
	return true
}

func webhookScopeForAuth(auth *domain.AuthInfo, source *domain.ChainSource) webhook.EventScope {
	if source != nil {
		return webhook.EventScope{
			Type:            webhook.ScopeTenant,
			TenantID:        source.TenantID,
			ExternalSpaceID: source.ExternalSpaceID,
			ChainID:         source.ChainID,
		}
	}
	return webhook.EventScope{
		Type:     webhook.ScopeTenant,
		TenantID: auth.TenantID,
	}
}
