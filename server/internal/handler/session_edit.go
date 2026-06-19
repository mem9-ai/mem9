package handler

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/qiffang/mnemos/server/internal/domain"
)

// Raw-session edit overlay endpoints. These write/read only the
// `session_edits` overlay table; the `sessions` table (content, embedding,
// FTS) and the memories table are never touched. The overlay only changes
// how Session Search renders an already-matched row — it does not change
// searchability, and memory/fact recall is unaffected
// (Session Search applies the overlay via svc.session.ApplySessionOverlay).

type editSessionMessageRequest struct {
	Content string `json:"content"`
	// Tags is a pointer so an omitted field (nil = leave display tags
	// unchanged) is distinguishable from an explicit [] (clear tags).
	Tags   *[]string `json:"tags,omitempty"`
	Reason string    `json:"reason,omitempty"`
}

type editSessionMessageResponse struct {
	EditID  string              `json:"edit_id"`
	Version int                 `json:"version"`
	Edit    *domain.SessionEdit `json:"edit"`
	Session *domain.Memory      `json:"session"`
}

// editSessionMessage handles PUT /session-messages/{id}: upsert the edit
// overlay for a raw session row (id == sessions.id) and return the stored
// overlay plus the effective (edited) session view.
func (s *Server) editSessionMessage(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	if auth.IsChain() {
		s.handleError(r.Context(), w, &domain.ValidationError{
			Field: "session_edit", Message: "raw session edit is not supported on chain keys",
		})
		return
	}

	id := chi.URLParam(r, "id")
	if strings.TrimSpace(id) == "" {
		s.handleError(r.Context(), w, &domain.ValidationError{Field: "id", Message: "required"})
		return
	}

	var req editSessionMessageRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		s.handleError(r.Context(), w, &domain.ValidationError{Field: "content", Message: "required"})
		return
	}

	svc := s.resolveServices(auth)
	edit, effective, err := svc.session.EditSessionOverlay(r.Context(), id, req.Content, req.Tags, auth.AgentName, req.Reason)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusOK, editSessionMessageResponse{
		EditID:  edit.ID,
		Version: edit.Version,
		Edit:    edit,
		Session: effective,
	})
}

// getSessionMessageEdit handles GET /session-messages/{id}/edit: return the
// active overlay, or 404 if the row has not been edited.
func (s *Server) getSessionMessageEdit(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	if auth.IsChain() {
		s.handleError(r.Context(), w, &domain.ValidationError{
			Field: "session_edit", Message: "raw session edit is not supported on chain keys",
		})
		return
	}
	id := chi.URLParam(r, "id")
	svc := s.resolveServices(auth)
	edit, err := svc.session.GetSessionOverlay(r.Context(), id)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusOK, edit)
}

// deleteSessionMessageEdit handles DELETE /session-messages/{id}/edit:
// remove the overlay so Session Search renders the original content again.
func (s *Server) deleteSessionMessageEdit(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	if auth.IsChain() {
		s.handleError(r.Context(), w, &domain.ValidationError{
			Field: "session_edit", Message: "raw session edit is not supported on chain keys",
		})
		return
	}
	id := chi.URLParam(r, "id")
	svc := s.resolveServices(auth)
	removed, err := svc.session.DeleteSessionOverlay(r.Context(), id)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{"id": id, "reverted": removed > 0})
}
