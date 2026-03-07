package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

type createMemoryRequest struct {
	Content   string                  `json:"content,omitempty"`
	AgentID   string                  `json:"agent_id,omitempty"`
	Tags      []string                `json:"tags,omitempty"`
	Metadata  json.RawMessage         `json:"metadata,omitempty"`
	Messages  []service.IngestMessage `json:"messages,omitempty"`
	SessionID string                  `json:"session_id,omitempty"`
	Mode      service.IngestMode      `json:"mode,omitempty"`
}

func (s *Server) createMemory(w http.ResponseWriter, r *http.Request) {
	var req createMemoryRequest
	if err := decode(r, &req); err != nil {
		s.handleError(w, err)
		return
	}

	auth := authInfo(r)
	svc := s.resolveServices(auth)

	agentID := req.AgentID
	if agentID == "" {
		agentID = auth.AgentName
	}

	hasMessages := len(req.Messages) > 0
	hasContent := strings.TrimSpace(req.Content) != ""

	if hasMessages && hasContent {
		s.handleError(w, &domain.ValidationError{Field: "body", Message: "provide either content or messages, not both"})
		return
	}

	if hasMessages {
		if len(req.Tags) > 0 || len(req.Metadata) > 0 {
			s.handleError(w, &domain.ValidationError{Field: "body", Message: "tags/metadata are not supported with messages ingest"})
			return
		}

		ingestReq := service.IngestRequest{
			Messages:  req.Messages,
			SessionID: req.SessionID,
			AgentID:   agentID,
			Mode:      req.Mode,
		}

		result, err := svc.ingest.Ingest(r.Context(), auth.AgentName, ingestReq)
		if err != nil {
			s.handleError(w, err)
			return
		}

		status := http.StatusOK
		switch result.Status {
		case "complete":
			status = http.StatusOK
		case "partial":
			status = 207 // Multi-Status
		case "failed":
			status = http.StatusBadGateway
		}

		respond(w, status, result)
		return
	}

	if !hasContent {
		s.handleError(w, &domain.ValidationError{Field: "content", Message: "content or messages required"})
		return
	}
	if len(req.Tags) > 0 || len(req.Metadata) > 0 || req.Mode != "" {
		s.handleError(w, &domain.ValidationError{Field: "body", Message: "content mode does not accept tags/metadata/mode"})
		return
	}

	result, err := svc.ingest.ReconcileContent(r.Context(), auth.AgentName, agentID, req.SessionID, []string{req.Content})
	if err != nil {
		s.handleError(w, err)
		return
	}

	status := http.StatusCreated
	switch result.Status {
	case "complete":
		status = http.StatusCreated
	case "partial":
		status = 207 // Multi-Status
	case "failed":
		status = http.StatusBadGateway
	}

	respond(w, status, result)
}

type listResponse struct {
	Memories []domain.Memory `json:"memories"`
	Total    int             `json:"total"`
	Limit    int             `json:"limit"`
	Offset   int             `json:"offset"`
}

func (s *Server) listMemories(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	q := r.URL.Query()

	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	var tags []string
	if t := q.Get("tags"); t != "" {
		tags = strings.Split(t, ",")
	}

	filter := domain.MemoryFilter{
		Query:      q.Get("q"),
		Tags:       tags,
		Source:     q.Get("source"),
		State:      q.Get("state"),
		MemoryType: q.Get("memory_type"),
		AgentID:    q.Get("agent_id"),
		SessionID:  q.Get("session_id"),
		Limit:      limit,
		Offset:     offset,
	}
	svc := s.resolveServices(auth)
	memories, total, err := svc.memory.Search(r.Context(), filter)
	if err != nil {
		s.handleError(w, err)
		return
	}

	if memories == nil {
		memories = []domain.Memory{}
	}

	respond(w, http.StatusOK, listResponse{
		Memories: memories,
		Total:    total,
		Limit:    limit,
		Offset:   offset,
	})
}

func (s *Server) getMemory(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	svc := s.resolveServices(auth)
	id := chi.URLParam(r, "id")

	mem, err := svc.memory.Get(r.Context(), id)
	if err != nil {
		s.handleError(w, err)
		return
	}

	respond(w, http.StatusOK, mem)
}

type updateMemoryRequest struct {
	Content  string          `json:"content,omitempty"`
	Tags     []string        `json:"tags,omitempty"`
	Metadata json.RawMessage `json:"metadata,omitempty"`
}

func (s *Server) updateMemory(w http.ResponseWriter, r *http.Request) {
	var req updateMemoryRequest
	if err := decode(r, &req); err != nil {
		s.handleError(w, err)
		return
	}

	auth := authInfo(r)
	svc := s.resolveServices(auth)
	id := chi.URLParam(r, "id")

	var ifMatch int
	if h := r.Header.Get("If-Match"); h != "" {
		ifMatch, _ = strconv.Atoi(h)
	}

	mem, err := svc.memory.Update(r.Context(), auth.AgentName, id, req.Content, req.Tags, req.Metadata, ifMatch)
	if err != nil {
		s.handleError(w, err)
		return
	}

	w.Header().Set("ETag", strconv.Itoa(mem.Version))
	respond(w, http.StatusOK, mem)
}

func (s *Server) deleteMemory(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	svc := s.resolveServices(auth)
	id := chi.URLParam(r, "id")

	if err := svc.memory.Delete(r.Context(), id, auth.AgentName); err != nil {
		s.handleError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

type bulkCreateRequest struct {
	Memories []service.BulkMemoryInput `json:"memories"`
}

func (s *Server) bulkCreateMemories(w http.ResponseWriter, r *http.Request) {
	var req bulkCreateRequest
	if err := decode(r, &req); err != nil {
		s.handleError(w, err)
		return
	}

	auth := authInfo(r)
	svc := s.resolveServices(auth)
	memories, err := svc.memory.BulkCreate(r.Context(), auth.AgentName, req.Memories)
	if err != nil {
		s.handleError(w, err)
		return
	}

	respond(w, http.StatusCreated, map[string]any{
		"ok":       true,
		"memories": memories,
	})
}

func (s *Server) bootstrapMemories(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	svc := s.resolveServices(auth)

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 20
	}

	memories, err := svc.memory.Bootstrap(r.Context(), limit)
	if err != nil {
		s.handleError(w, err)
		return
	}

	if memories == nil {
		memories = []domain.Memory{}
	}

	respond(w, http.StatusOK, map[string]any{
		"memories": memories,
		"total":    len(memories),
	})
}
