package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/qiffang/mnemos/server/internal/domain"
)

type createWebhookRequest struct {
	URL        string             `json:"url"`
	Secret     string             `json:"secret"`
	EventTypes []domain.EventType `json:"event_types"`
}

func (s *Server) createWebhook(w http.ResponseWriter, r *http.Request) {
	if s.webhookSvc == nil {
		respondError(w, http.StatusNotImplemented, "webhooks not configured")
		return
	}

	var req createWebhookRequest
	if err := decode(r, &req); err != nil {
		s.handleError(w, err)
		return
	}
	if req.Secret == "" {
		s.handleError(w, &domain.ValidationError{Field: "secret", Message: "required"})
		return
	}

	auth := authInfo(r)
	hook, err := s.webhookSvc.Create(r.Context(), auth.TenantID, req.URL, req.Secret, req.EventTypes)
	if err != nil {
		s.handleError(w, err)
		return
	}
	respond(w, http.StatusCreated, hook)
}

func (s *Server) listWebhooks(w http.ResponseWriter, r *http.Request) {
	if s.webhookSvc == nil {
		respondError(w, http.StatusNotImplemented, "webhooks not configured")
		return
	}

	auth := authInfo(r)
	hooks, err := s.webhookSvc.List(r.Context(), auth.TenantID)
	if err != nil {
		s.handleError(w, err)
		return
	}
	if hooks == nil {
		hooks = []*domain.Webhook{}
	}
	respond(w, http.StatusOK, hooks)
}

func (s *Server) deleteWebhook(w http.ResponseWriter, r *http.Request) {
	if s.webhookSvc == nil {
		respondError(w, http.StatusNotImplemented, "webhooks not configured")
		return
	}

	auth := authInfo(r)
	id := chi.URLParam(r, "webhookId")
	if err := s.webhookSvc.Delete(r.Context(), id, auth.TenantID); err != nil {
		s.handleError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
