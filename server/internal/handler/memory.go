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
	Content  string            `json:"content"`
	Key      string            `json:"key,omitempty"`
	Tags     []string          `json:"tags,omitempty"`
	Metadata json.RawMessage   `json:"metadata,omitempty"`
	Clock    map[string]uint64 `json:"clock,omitempty"`
	WriteID  string            `json:"write_id,omitempty"`
}

func (s *Server) createMemory(w http.ResponseWriter, r *http.Request) {
	var req createMemoryRequest
	if err := decode(r, &req); err != nil {
		s.handleError(w, err)
		return
	}

	if req.Clock != nil {
		if err := validateClock(req.Clock); err != nil {
			respondError(w, http.StatusBadRequest, "invalid clock: "+err.Error())
			return
		}
	}

	auth := authInfo(r)
	result, err := s.memory.Create(r.Context(), auth.SpaceID, auth.AgentName, req.Content, req.Key, req.Tags, req.Metadata, req.Clock, req.WriteID)
	if err != nil {
		s.handleError(w, err)
		return
	}

	status := http.StatusCreated
	if result.Dominated {
		status = http.StatusOK
		w.Header().Set("X-Mnemo-Dominated", "true")
	}
	if result.Merged {
		w.Header().Set("X-Mnemo-Merged", "true")
	}
	if result.Winner != "" {
		w.Header().Set("X-Mnemo-Winner", result.Winner)
	}

	respond(w, status, result.Memory)
}

func validateClock(clock map[string]uint64) error {
	for k := range clock {
		if k == "" {
			return &domain.ValidationError{Message: "clock keys must be non-empty strings"}
		}
	}
	return nil
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
		Query:  q.Get("q"),
		Tags:   tags,
		Source: q.Get("source"),
		Key:    q.Get("key"),
		Limit:  limit,
		Offset: offset,
	}

	memories, total, err := s.memory.Search(r.Context(), auth.SpaceID, filter)
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
	id := chi.URLParam(r, "id")

	mem, err := s.memory.Get(r.Context(), auth.SpaceID, id)
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
	id := chi.URLParam(r, "id")

	var ifMatch int
	if h := r.Header.Get("If-Match"); h != "" {
		ifMatch, _ = strconv.Atoi(h)
	}

	mem, err := s.memory.Update(r.Context(), auth.SpaceID, auth.AgentName, id, req.Content, req.Tags, req.Metadata, ifMatch)
	if err != nil {
		s.handleError(w, err)
		return
	}

	w.Header().Set("ETag", strconv.Itoa(mem.Version))
	respond(w, http.StatusOK, mem)
}

func (s *Server) deleteMemory(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	id := chi.URLParam(r, "id")

	if err := s.memory.Delete(r.Context(), auth.SpaceID, id, auth.AgentName); err != nil {
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
	memories, err := s.memory.BulkCreate(r.Context(), auth.SpaceID, auth.AgentName, req.Memories)
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

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 20
	}

	memories, err := s.memory.Bootstrap(r.Context(), auth.SpaceID, limit)
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
