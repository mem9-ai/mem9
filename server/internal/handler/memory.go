package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metrics"
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
	Sync      bool                    `json:"sync,omitempty"`
}

func (s *Server) createMemory(w http.ResponseWriter, r *http.Request) {
	var req createMemoryRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
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
		s.handleError(r.Context(), w, &domain.ValidationError{Field: "body", Message: "provide either content or messages, not both"})
		return
	}

	if hasMessages {
		messages := append([]service.IngestMessage(nil), req.Messages...)
		ingestReq := service.IngestRequest{
			Messages:  messages,
			SessionID: req.SessionID,
			AgentID:   agentID,
			Mode:      req.Mode,
		}

		if req.Sync {
			result, err := s.ingestMessages(r.Context(), auth, svc, ingestReq)
			if err != nil {
				s.handleError(r.Context(), w, err)
				return
			}
			if result != nil && result.Status == "failed" {
				respondError(w, http.StatusInternalServerError, "ingest reconciliation failed")
				return
			}
			var written int64
			if result != nil {
				written = int64(result.MemoriesChanged)
			}
			go s.refreshWriteMetrics(auth, svc, written)
			respond(w, http.StatusOK, map[string]string{"status": "ok"})
		} else {
			go func() {
				result, err := s.ingestMessages(context.Background(), auth, svc, ingestReq)
				if err != nil {
					slog.Error("async ingest failed", "session", ingestReq.SessionID, "err", err)
					return
				}
				var written int64
				if result != nil {
					written = int64(result.MemoriesChanged)
				}
				s.refreshWriteMetrics(auth, svc, written)
			}()
			respond(w, http.StatusAccepted, map[string]string{"status": "accepted"})
		}
		return
	}

	if !hasContent {
		s.handleError(r.Context(), w, &domain.ValidationError{Field: "content", Message: "content or messages required"})
		return
	}
	if req.Mode != "" {
		s.handleError(r.Context(), w, &domain.ValidationError{Field: "body", Message: "content mode does not accept mode"})
		return
	}

	tags := append([]string(nil), req.Tags...)
	metadata := append(json.RawMessage(nil), req.Metadata...)
	content := req.Content

	if req.Sync {
		mem, written, err := svc.memory.Create(r.Context(), agentID, content, tags, metadata)
		if err != nil {
			slog.Error("sync memory create failed", "agent", agentID, "actor", auth.AgentName, "err", err)
			s.handleError(r.Context(), w, err)
			return
		}
		_ = mem
		go s.refreshWriteMetrics(auth, svc, int64(written))
		respond(w, http.StatusOK, map[string]string{"status": "ok"})
	} else {
		go func(auth *domain.AuthInfo, agentName, actorAgentID, content string, tags []string, metadata json.RawMessage) {
			mem, written, err := svc.memory.Create(context.Background(), actorAgentID, content, tags, metadata)
			if err != nil {
				slog.Error("async memory create failed", "agent", actorAgentID, "actor", agentName, "err", err)
				return
			}
			if mem != nil {
				slog.Info("async memory create complete", "agent", actorAgentID, "actor", agentName, "memory_id", mem.ID)
			} else {
				slog.Info("async memory create complete", "agent", actorAgentID, "actor", agentName, "memory_id", "")
			}
			s.refreshWriteMetrics(auth, svc, int64(written))
		}(auth, auth.AgentName, agentID, content, tags, metadata)

		respond(w, http.StatusAccepted, map[string]string{"status": "accepted"})
	}
}

// ingestMessages runs the full ingest pipeline: BulkCreate → ExtractPhase1 → PatchTags + ReconcilePhase2.
// TODO: wrap all database writes (BulkCreate, PatchTags, ReconcilePhase2) in a single transaction to guarantee atomicity.
func (s *Server) ingestMessages(ctx context.Context, auth *domain.AuthInfo, svc resolvedSvc, req service.IngestRequest) (*service.IngestResult, error) {
	// Strip plugin-injected context (e.g. <relevant-memories>) before any storage or LLM path.
	// This is the single sanitization point for the handler-driven pipeline (BulkCreate, ExtractPhase1, etc.).
	req.Messages = service.StripInjectedContext(req.Messages)

	// Session persistence is best-effort for both sync and async paths.
	// sync=true guarantees only that reconcile (memory extraction) completed —
	// raw session rows in /session-messages may be absent if BulkCreate fails.
	if err := svc.session.BulkCreate(ctx, auth.AgentName, req); err != nil {
		slog.Error("session raw save failed",
			"cluster_id", auth.ClusterID, "session", req.SessionID, "err", err)
	}

	phase1, err := svc.ingest.ExtractPhase1(ctx, req.Messages)
	if err != nil {
		slog.Error("phase1 extraction failed", "session", req.SessionID, "err", err)
		return nil, fmt.Errorf("phase1 extraction: %w", err)
	}

	var wg sync.WaitGroup
	var reconcileResult *service.IngestResult
	var reconcileErr error

	wg.Add(2)
	go func() {
		defer wg.Done()
		for i, msg := range req.Messages {
			tags := tagsAtIndex(phase1.MessageTags, i)
			if len(tags) == 0 {
				continue
			}
			hash := service.SessionContentHash(req.SessionID, msg.Role, msg.Content)
			if err := svc.session.PatchTags(ctx, req.SessionID, hash, tags); err != nil {
				slog.Warn("session tag patch failed",
					"cluster_id", auth.ClusterID, "session", req.SessionID, "err", err)
			}
		}
	}()

	go func() {
		defer wg.Done()
		reconcileResult, reconcileErr = svc.ingest.ReconcilePhase2(
			ctx, auth.AgentName, req.AgentID, req.SessionID, phase1.Facts)
	}()

	wg.Wait()

	if reconcileErr != nil {
		slog.Error("memories reconcile failed", "session", req.SessionID, "err", reconcileErr)
		return nil, fmt.Errorf("reconcile: %w", reconcileErr)
	}

	return reconcileResult, nil
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
		limit = service.DefaultSessionLimit
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

	onlySession := filter.MemoryType == string(domain.TypeSession)

	var memories []domain.Memory
	var total int
	var err error

	if !onlySession {
		memories, total, err = svc.memory.Search(r.Context(), filter)
		if err != nil {
			s.handleError(r.Context(), w, err)
			return
		}
	}

	if filter.Query != "" && onlySession {
		// SessionService.Search preserves SessionID/Source filters from the caller — intentional:
		// session-scoped filtering is meaningful for the sessions table. MemoryService.Search
		// resets these fields to broaden memory recall; the asymmetry is by design.
		// session.Search is all-or-nothing: returns (results, nil) or (nil, err), never partial results + err.
		// total is only incremented on success, so the response total stays consistent with the slice length.
		sessionMems, sessErr := svc.session.Search(r.Context(), filter)
		if sessErr != nil {
			slog.Warn("session search failed", "cluster_id", auth.ClusterID, "err", sessErr)
		} else {
			memories = append(memories, sessionMems...)
			total += len(sessionMems)
		}
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
		s.handleError(r.Context(), w, err)
		return
	}

	// RelativeAge is intentionally absent here — it is query-time only (search endpoint).
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
		s.handleError(r.Context(), w, err)
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
		s.handleError(r.Context(), w, err)
		return
	}

	go s.refreshWriteMetrics(auth, svc, 1)
	w.Header().Set("ETag", strconv.Itoa(mem.Version))
	respond(w, http.StatusOK, mem)
}

func (s *Server) deleteMemory(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	svc := s.resolveServices(auth)
	id := chi.URLParam(r, "id")

	if err := svc.memory.Delete(r.Context(), id, auth.AgentName); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}

	go s.refreshWriteMetrics(auth, svc, 0)
	w.WriteHeader(http.StatusNoContent)
}

type bulkCreateRequest struct {
	Memories []service.BulkMemoryInput `json:"memories"`
}

func (s *Server) bulkCreateMemories(w http.ResponseWriter, r *http.Request) {
	var req bulkCreateRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}

	auth := authInfo(r)
	svc := s.resolveServices(auth)
	memories, err := svc.memory.BulkCreate(r.Context(), auth.AgentName, req.Memories)
	if err != nil {
		s.handleError(r.Context(), w, err)
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
		s.handleError(r.Context(), w, err)
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

func tagsAtIndex(tags [][]string, i int) []string {
	if i < len(tags) && tags[i] != nil {
		return tags[i]
	}
	return []string{}
}

const (
	maxLimitPerSession = 500
	maxSessionIDs      = 100
)

type sessionMessageResponse struct {
	ID          string             `json:"id"`
	SessionID   string             `json:"session_id,omitempty"`
	AgentID     string             `json:"agent_id,omitempty"`
	Source      string             `json:"source,omitempty"`
	Seq         int                `json:"seq"`
	Role        string             `json:"role"`
	Content     string             `json:"content"`
	ContentType string             `json:"content_type"`
	Tags        []string           `json:"tags"`
	State       domain.MemoryState `json:"state"`
	CreatedAt   time.Time          `json:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"`
}

func (s *Server) handleListSessionMessages(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	svc := s.resolveServices(auth)

	rawIDs := r.URL.Query()["session_id"]
	if len(rawIDs) == 0 {
		s.handleError(r.Context(), w, &domain.ValidationError{
			Field: "session_id", Message: "at least one session_id required",
		})
		return
	}
	sessionIDs := dedupStrings(rawIDs)
	if len(sessionIDs) > maxSessionIDs {
		s.handleError(r.Context(), w, &domain.ValidationError{
			Field: "session_id", Message: "too many session_ids: maximum is 100",
		})
		return
	}

	limitPerSession := maxLimitPerSession
	if raw := r.URL.Query().Get("limit_per_session"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			s.handleError(r.Context(), w, &domain.ValidationError{
				Field: "limit_per_session", Message: "must be a positive integer",
			})
			return
		}
		if n < limitPerSession {
			limitPerSession = n
		}
	}

	sessions, err := svc.session.ListBySessionIDs(r.Context(), sessionIDs, limitPerSession)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	if sessions == nil {
		sessions = []*domain.Session{}
	}
	messages := make([]sessionMessageResponse, len(sessions))
	for i, sess := range sessions {
		messages[i] = sessionMessageResponse{
			ID:          sess.ID,
			SessionID:   sess.SessionID,
			AgentID:     sess.AgentID,
			Source:      sess.Source,
			Seq:         sess.Seq,
			Role:        sess.Role,
			Content:     sess.Content,
			ContentType: sess.ContentType,
			Tags:        sess.Tags,
			State:       sess.State,
			CreatedAt:   sess.CreatedAt,
			UpdatedAt:   sess.UpdatedAt,
		}
	}
	respond(w, http.StatusOK, map[string]any{
		"messages":          messages,
		"limit_per_session": limitPerSession,
	})
}

func dedupStrings(ss []string) []string {
	seen := make(map[string]struct{}, len(ss))
	out := make([]string, 0, len(ss))
	for _, s := range ss {
		if _, ok := seen[s]; !ok {
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	return out
}

func (s *Server) refreshWriteMetrics(auth *domain.AuthInfo, svc resolvedSvc, written int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	clusterID := auth.ClusterID
	if clusterID == "" {
		clusterID = "default"
	}

	if written > 0 {
		metrics.MemoryChangesTotal.WithLabelValues(clusterID).Add(float64(written))
	}

	const gaugeTTL = 30 * time.Second
	now := time.Now()
	if last, ok := s.gaugeDebounce.Load(clusterID); ok && now.Sub(last.(time.Time)) < gaugeTTL {
		return
	}
	s.gaugeDebounce.Store(clusterID, now)

	total, last7d, err := svc.memory.CountStats(ctx)
	if err != nil {
		slog.Warn("refreshWriteMetrics: count stats failed", "err", err)
		return
	}
	metrics.ActiveMemoryTotal.WithLabelValues(clusterID).Set(float64(total))
	metrics.ActiveMemory7dTotal.WithLabelValues(clusterID).Set(float64(last7d))
}
