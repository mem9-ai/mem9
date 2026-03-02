package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

type createSpaceRequest struct {
	Name      string `json:"name"`
	AgentName string `json:"agent_name"`
	AgentType string `json:"agent_type,omitempty"`
}

type createSpaceResponse struct {
	OK       bool   `json:"ok"`
	SpaceID  string `json:"space_id"`
	APIToken string `json:"api_token"`
}

func (s *Server) createSpace(w http.ResponseWriter, r *http.Request) {
	var req createSpaceRequest
	if err := decode(r, &req); err != nil {
		s.handleError(w, err)
		return
	}

	spaceID, token, err := s.space.CreateSpace(r.Context(), req.Name, req.AgentName, req.AgentType)
	if err != nil {
		s.handleError(w, err)
		return
	}

	respond(w, http.StatusCreated, createSpaceResponse{
		OK:       true,
		SpaceID:  spaceID,
		APIToken: token,
	})
}

type addTokenRequest struct {
	AgentName string `json:"agent_name"`
	AgentType string `json:"agent_type,omitempty"`
}

type addTokenResponse struct {
	OK       bool   `json:"ok"`
	APIToken string `json:"api_token"`
}

func (s *Server) addToken(w http.ResponseWriter, r *http.Request) {
	var req addTokenRequest
	if err := decode(r, &req); err != nil {
		s.handleError(w, err)
		return
	}

	auth := authInfo(r)
	spaceID := chi.URLParam(r, "spaceID")

	token, err := s.space.AddToken(r.Context(), auth.SpaceID, spaceID, req.AgentName, req.AgentType)
	if err != nil {
		s.handleError(w, err)
		return
	}

	respond(w, http.StatusCreated, addTokenResponse{OK: true, APIToken: token})
}

func (s *Server) getSpaceInfo(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	spaceID := chi.URLParam(r, "spaceID")

	info, err := s.space.GetSpaceInfo(r.Context(), auth.SpaceID, spaceID)
	if err != nil {
		s.handleError(w, err)
		return
	}

	respond(w, http.StatusOK, info)
}

type createUserRequest struct {
	Name string `json:"name"`
}

type createUserResponse struct {
	OK       bool   `json:"ok"`
	UserID   string `json:"user_id"`
	APIToken string `json:"api_token"`
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if err := decode(r, &req); err != nil {
		s.handleError(w, err)
		return
	}

	userID, token, err := s.space.CreateUser(r.Context(), req.Name)
	if err != nil {
		s.handleError(w, err)
		return
	}

	respond(w, http.StatusCreated, createUserResponse{
		OK:       true,
		UserID:   userID,
		APIToken: token,
	})
}

type provisionRequest struct {
	WorkspaceKey string `json:"workspace_key"`
	AgentID      string `json:"agent_id"`
}

type provisionResponse struct {
	OK         bool   `json:"ok"`
	SpaceToken string `json:"space_token"`
}

func (s *Server) provisionSpace(w http.ResponseWriter, r *http.Request) {
	var req provisionRequest
	if err := decode(r, &req); err != nil {
		s.handleError(w, err)
		return
	}

	auth := authInfo(r)
	if auth.UserID == "" {
		respondError(w, http.StatusForbidden, "provision requires a user token")
		return
	}

	spaceToken, err := s.space.Provision(r.Context(), auth.UserID, req.WorkspaceKey, req.AgentID)
	if err != nil {
		s.handleError(w, err)
		return
	}

	respond(w, http.StatusOK, provisionResponse{
		OK:         true,
		SpaceToken: spaceToken,
	})
}
