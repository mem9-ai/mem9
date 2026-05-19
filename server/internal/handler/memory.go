package handler

import (
	"context"
	"encoding/json"
	"errors"
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
	"github.com/qiffang/mnemos/server/internal/runtimeusage"
	"github.com/qiffang/mnemos/server/internal/service"
)

var (
	// Keep the application timeout below the benchmark client's 10m request timeout
	// so slow sync ingest returns a structured JSON 504 instead of a socket-level abort.
	syncIngestTimeout = 9 * time.Minute
)

type createMemoryRequest struct {
	Content    string                  `json:"content,omitempty"`
	MemoryType string                  `json:"memory_type,omitempty"`
	AgentID    string                  `json:"agent_id,omitempty"`
	Tags       []string                `json:"tags,omitempty"`
	Metadata   json.RawMessage         `json:"metadata,omitempty"`
	Messages   []service.IngestMessage `json:"messages,omitempty"`
	SessionID  string                  `json:"session_id,omitempty"`
	Mode       service.IngestMode      `json:"mode,omitempty"`
	Sync       bool                    `json:"sync,omitempty"`
}

func isSyncIngestTimeout(ctx context.Context, err error) bool {
	return err != nil && errors.Is(err, context.DeadlineExceeded) && errors.Is(ctx.Err(), context.DeadlineExceeded)
}

func (s *Server) createMemory(w http.ResponseWriter, r *http.Request) {
	var req createMemoryRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}

	auth := authInfo(r)
	var writeChainSource *domain.ChainSource
	if auth.IsChain() {
		var err error
		if len(auth.Chain.Nodes) > 0 {
			writeChainSource = chainSource(auth, auth.Chain.Nodes[0])
		}
		auth, err = s.firstChainNodeAuth(auth)
		if err != nil {
			s.handleError(r.Context(), w, err)
			return
		}
	}
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

	if hasMessages && strings.TrimSpace(req.MemoryType) != "" {
		s.handleError(r.Context(), w, &domain.ValidationError{Field: "memory_type", Message: "memory_type is only allowed with content, not messages"})
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
			syncCtx, cancel := context.WithTimeout(r.Context(), syncIngestTimeout)
			defer cancel()

			var lease *runtimeusage.OperationLease
			finalized := false
			if s.runtimeUsageEnabled() {
				var err error
				lease, err = s.runtimeUsage.BeforeMemoryCreate(syncCtx, subjectFromAuth(auth), 1)
				if err != nil {
					s.handleRuntimeUsageError(w, err)
					return
				}
				defer func() {
					if !finalized {
						s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, context.Canceled)
					}
				}()
			}

			result, err := s.ingestMessages(syncCtx, auth, svc, ingestReq)
			if err != nil {
				if s.runtimeUsageEnabled() {
					s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, err)
					finalized = true
				}
				if isSyncIngestTimeout(syncCtx, err) {
					s.logger.Warn("sync ingest timed out", "session", ingestReq.SessionID, "timeout", syncIngestTimeout)
					respondError(w, http.StatusGatewayTimeout, fmt.Sprintf("sync ingest timed out after %s", syncIngestTimeout))
					return
				}
				s.handleError(syncCtx, w, err)
				return
			}
			if result != nil && result.Status == "failed" {
				if s.runtimeUsageEnabled() {
					err := errors.New("ingest reconciliation failed")
					s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, err)
					finalized = true
				}
				respondError(w, http.StatusInternalServerError, "ingest reconciliation failed")
				return
			}
			var written int64
			if result != nil {
				written = int64(result.MemoriesChanged)
			}
			if s.runtimeUsageEnabled() {
				var ids []string
				if result != nil {
					ids = result.InsightIDs
				}
				if err := withRuntimeUsagePostSuccessContext(func(ctx context.Context) error {
					return s.runtimeUsage.AfterMemoryCreateSuccess(ctx, lease, runtimeusage.MemoryCreateResult{
						MemoryIDs:       ids,
						AgentName:       auth.AgentName,
						ObjectsAffected: written,
					})
				}); err != nil {
					s.logger.Error("runtime usage sync ingest finalization failed",
						"operation_id", lease.OperationID,
						"tenant_id", auth.TenantID,
						"cluster_id", auth.ClusterID,
						"err", err)
					finalized = true
					s.handleRuntimeUsageError(w, err)
					return
				}
				finalized = true
			}
			s.recordIngestMetering(auth, svc)
			go s.afterSuccessfulWrite(auth, svc, written)
			respond(w, http.StatusOK, map[string]string{"status": "ok"})
		} else {
			var lease *runtimeusage.OperationLease
			if s.runtimeUsageEnabled() {
				var err error
				lease, err = s.runtimeUsage.BeforeMemoryCreate(r.Context(), subjectFromAuth(auth), 1)
				if err != nil {
					s.handleRuntimeUsageError(w, err)
					return
				}
			}
			go func(lease *runtimeusage.OperationLease) {
				result, err := s.ingestMessages(context.Background(), auth, svc, ingestReq)
				if err != nil {
					if s.runtimeUsageEnabled() {
						s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, err)
					}
					slog.Error("async ingest failed", "session", ingestReq.SessionID, "err", err)
					return
				}
				if result != nil && result.Status == "failed" {
					if s.runtimeUsageEnabled() {
						s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, errors.New("ingest reconciliation failed"))
					}
					slog.Error("async ingest reconcile failed", "session", ingestReq.SessionID)
					return
				}
				var written int64
				if result != nil {
					written = int64(result.MemoriesChanged)
				}
				if s.runtimeUsageEnabled() {
					var ids []string
					if result != nil {
						ids = result.InsightIDs
					}
					if err := s.runtimeUsage.AfterMemoryCreateSuccess(context.Background(), lease, runtimeusage.MemoryCreateResult{
						MemoryIDs:       ids,
						AgentName:       auth.AgentName,
						ObjectsAffected: written,
					}); err != nil {
						s.logger.Error("runtime usage async ingest finalization failed",
							"operation_id", lease.OperationID,
							"tenant_id", auth.TenantID,
							"cluster_id", auth.ClusterID,
							"err", err)
						return
					}
				}
				s.afterSuccessfulIngest(auth, svc, written)
			}(lease)
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
	explicitMemoryType := strings.TrimSpace(req.MemoryType)

	if explicitMemoryType != "" {
		if explicitMemoryType != string(domain.TypePinned) {
			s.handleError(r.Context(), w, &domain.ValidationError{
				Field:   "memory_type",
				Message: fmt.Sprintf("unsupported value %q; only %q is supported on the explicit content path", explicitMemoryType, domain.TypePinned),
			})
			return
		}

		var lease *runtimeusage.OperationLease
		finalized := false
		if s.runtimeUsageEnabled() {
			var err error
			lease, err = s.runtimeUsage.BeforeMemoryCreate(r.Context(), subjectFromAuth(auth), 1)
			if err != nil {
				s.handleRuntimeUsageError(w, err)
				return
			}
			defer func() {
				if !finalized {
					s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, context.Canceled)
				}
			}()
		}

		mem, written, err := svc.memory.CreatePinned(r.Context(), agentID, content, tags, metadata)
		if err != nil {
			if s.runtimeUsageEnabled() {
				s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, err)
				finalized = true
			}
			slog.Error("pinned memory create failed", "agent", agentID, "actor", auth.AgentName, "err", err)
			s.handleError(r.Context(), w, err)
			return
		}
		if mem != nil {
			mem.ChainSource = writeChainSource
		}
		if s.runtimeUsageEnabled() {
			memoryID := ""
			if mem != nil {
				memoryID = mem.ID
			}
			var ids []string
			if memoryID != "" {
				ids = []string{memoryID}
			}
			if err := withRuntimeUsagePostSuccessContext(func(ctx context.Context) error {
				return s.runtimeUsage.AfterMemoryCreateSuccess(ctx, lease, runtimeusage.MemoryCreateResult{
					MemoryIDs:       ids,
					AgentName:       auth.AgentName,
					ObjectsAffected: int64(written),
				})
			}); err != nil {
				s.logger.Error("runtime usage memory create finalization failed",
					"operation_id", lease.OperationID,
					"tenant_id", auth.TenantID,
					"cluster_id", auth.ClusterID,
					"err", err)
				finalized = true
				s.handleRuntimeUsageError(w, err)
				return
			}
			finalized = true
		}
		go s.afterSuccessfulWrite(auth, svc, int64(written))
		respond(w, http.StatusCreated, mem)
		return
	}

	if req.Sync {
		var lease *runtimeusage.OperationLease
		finalized := false
		if s.runtimeUsageEnabled() {
			var err error
			lease, err = s.runtimeUsage.BeforeMemoryCreate(r.Context(), subjectFromAuth(auth), 1)
			if err != nil {
				s.handleRuntimeUsageError(w, err)
				return
			}
			defer func() {
				if !finalized {
					s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, context.Canceled)
				}
			}()
		}
		// s.persistContentSession(r.Context(), auth, svc, req.SessionID, agentID, content, metadata)
		mem, written, err := svc.memory.Create(r.Context(), agentID, content, tags, metadata)
		if err != nil {
			if s.runtimeUsageEnabled() {
				s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, err)
				finalized = true
			}
			slog.Error("sync memory create failed", "agent", agentID, "actor", auth.AgentName, "err", err)
			s.handleError(r.Context(), w, err)
			return
		}
		if s.runtimeUsageEnabled() {
			var ids []string
			if mem != nil && mem.ID != "" {
				ids = []string{mem.ID}
			}
			if err := withRuntimeUsagePostSuccessContext(func(ctx context.Context) error {
				return s.runtimeUsage.AfterMemoryCreateSuccess(ctx, lease, runtimeusage.MemoryCreateResult{
					MemoryIDs:       ids,
					AgentName:       auth.AgentName,
					ObjectsAffected: int64(written),
				})
			}); err != nil {
				s.logger.Error("runtime usage sync memory create finalization failed",
					"operation_id", lease.OperationID,
					"tenant_id", auth.TenantID,
					"cluster_id", auth.ClusterID,
					"err", err)
				finalized = true
				s.handleRuntimeUsageError(w, err)
				return
			}
			finalized = true
		}
		go s.afterSuccessfulWrite(auth, svc, int64(written))
		respond(w, http.StatusOK, map[string]string{"status": "ok"})
	} else {
		var lease *runtimeusage.OperationLease
		if s.runtimeUsageEnabled() {
			var err error
			lease, err = s.runtimeUsage.BeforeMemoryCreate(r.Context(), subjectFromAuth(auth), 1)
			if err != nil {
				s.handleRuntimeUsageError(w, err)
				return
			}
		}
		go func(auth *domain.AuthInfo, lease *runtimeusage.OperationLease, agentName, actorAgentID, sessionID, content string, tags []string, metadata json.RawMessage) {
			// s.persistContentSession(context.Background(), auth, svc, sessionID, actorAgentID, content, metadata)
			mem, written, err := svc.memory.Create(context.Background(), actorAgentID, content, tags, metadata)
			if err != nil {
				if s.runtimeUsageEnabled() {
					s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, err)
				}
				slog.Error("async memory create failed", "agent", actorAgentID, "actor", agentName, "err", err)
				return
			}
			if mem != nil {
				slog.Info("async memory create complete", "agent", actorAgentID, "actor", agentName, "memory_id", mem.ID)
			} else {
				slog.Info("async memory create complete", "agent", actorAgentID, "actor", agentName, "memory_id", "")
			}
			if s.runtimeUsageEnabled() {
				var ids []string
				if mem != nil && mem.ID != "" {
					ids = []string{mem.ID}
				}
				if err := s.runtimeUsage.AfterMemoryCreateSuccess(context.Background(), lease, runtimeusage.MemoryCreateResult{
					MemoryIDs:       ids,
					AgentName:       auth.AgentName,
					ObjectsAffected: int64(written),
				}); err != nil {
					s.logger.Error("runtime usage async memory create finalization failed",
						"operation_id", lease.OperationID,
						"tenant_id", auth.TenantID,
						"cluster_id", auth.ClusterID,
						"err", err)
					return
				}
			}
			s.afterSuccessfulWrite(auth, svc, int64(written))
		}(auth, lease, auth.AgentName, agentID, req.SessionID, content, tags, metadata)

		respond(w, http.StatusAccepted, map[string]string{"status": "accepted"})
	}
}

// ingestMessages runs the full ingest pipeline: BulkCreate → ExtractPhase1 → PatchTags + ReconcilePhase2.
// TODO: wrap all database writes (BulkCreate, PatchTags, ReconcilePhase2) in a single transaction to guarantee atomicity.
func (s *Server) ingestMessages(ctx context.Context, auth *domain.AuthInfo, svc resolvedSvc, req service.IngestRequest) (*service.IngestResult, error) {
	start := time.Now()
	var (
		bulkCreateDuration    time.Duration
		extractPhase1Duration time.Duration
		patchTagsDuration     time.Duration
		reconcileDuration     time.Duration
		factsCount            int
		status                = "ok"
	)
	defer func() {
		s.logger.Info("messages ingest timings",
			"session", req.SessionID,
			"messages", len(req.Messages),
			"facts", factsCount,
			"status", status,
			"bulk_create_ms", bulkCreateDuration.Milliseconds(),
			"extract_phase1_ms", extractPhase1Duration.Milliseconds(),
			"patch_tags_ms", patchTagsDuration.Milliseconds(),
			"reconcile_phase2_ms", reconcileDuration.Milliseconds(),
			"total_ms", time.Since(start).Milliseconds(),
		)
	}()

	// Strip plugin-injected context (e.g. <relevant-memories>) before any storage or LLM path.
	// This is the single sanitization point for the handler-driven pipeline (BulkCreate, ExtractPhase1, etc.).
	req.Messages = service.StripInjectedContext(req.Messages)

	// Session persistence is best-effort for both sync and async paths.
	// sync=true guarantees only that reconcile (memory extraction) completed —
	// raw session rows in /session-messages may be absent if BulkCreate fails.
	bulkCreateStart := time.Now()
	if err := svc.session.BulkCreate(ctx, auth.AgentName, req); err != nil {
		slog.Error("session raw save failed",
			"cluster_id", auth.ClusterID, "session", req.SessionID, "err", err)
	}
	bulkCreateDuration = time.Since(bulkCreateStart)

	extractPhase1Start := time.Now()
	phase1, err := svc.ingest.ExtractPhase1(ctx, req.Messages)
	extractPhase1Duration = time.Since(extractPhase1Start)
	if err != nil {
		status = "phase1_error"
		slog.Error("phase1 extraction failed", "session", req.SessionID, "err", err)
		return nil, fmt.Errorf("phase1 extraction: %w", err)
	}
	factsCount = len(phase1.Facts)

	var wg sync.WaitGroup
	var reconcileResult *service.IngestResult
	var reconcileErr error

	wg.Add(2)
	go func() {
		defer wg.Done()
		patchTagsStart := time.Now()
		defer func() {
			patchTagsDuration = time.Since(patchTagsStart)
		}()
		for i, msg := range req.Messages {
			tags := tagsAtIndex(phase1.MessageTags, i)
			if len(tags) == 0 {
				continue
			}
			hash := service.SessionContentHash(req.SessionID, msg.Role, msg.Content, msg.Seq)
			if err := svc.session.PatchTags(ctx, req.SessionID, hash, tags); err != nil {
				slog.Warn("session tag patch failed",
					"cluster_id", auth.ClusterID, "session", req.SessionID, "err", err)
			}
		}
	}()

	go func() {
		defer wg.Done()
		reconcileStart := time.Now()
		defer func() {
			reconcileDuration = time.Since(reconcileStart)
		}()
		reconcileResult, reconcileErr = svc.ingest.ReconcilePhase2(
			ctx, auth.AgentName, req.AgentID, req.SessionID, phase1.Facts)
	}()

	wg.Wait()

	if reconcileErr != nil {
		status = "reconcile_error"
		slog.Error("memories reconcile failed", "session", req.SessionID, "err", reconcileErr)
		return nil, fmt.Errorf("reconcile: %w", reconcileErr)
	}
	if reconcileResult != nil {
		status = reconcileResult.Status
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
	rawQuery := q.Get("q")
	query := normalizeRecallQuery(rawQuery, time.Now())

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
		Query:      query,
		Tags:       tags,
		Source:     q.Get("source"),
		State:      q.Get("state"),
		MemoryType: q.Get("memory_type"),
		AgentID:    q.Get("agent_id"),
		SessionID:  q.Get("session_id"),
		Limit:      limit,
		Offset:     offset,
	}
	onlySession := filter.MemoryType == string(domain.TypeSession)

	var memories []domain.Memory
	var total int
	var err error
	var recallLease *runtimeusage.OperationLease
	recallFinalized := false

	if s.runtimeUsageEnabled() && filter.Query != "" {
		recallLease, err = s.runtimeUsage.BeforeRecall(r.Context(), subjectFromAuth(auth))
		if err != nil {
			s.handleRuntimeUsageError(w, err)
			return
		}
		defer func() {
			if !recallFinalized {
				s.runtimeUsage.AfterRecallFailure(context.Background(), recallLease, context.Canceled)
			}
		}()
	}

	if auth.IsChain() {
		memories, total, err = s.listChainMemories(r.Context(), auth, filter)
	} else {
		svc := s.resolveServices(auth)
		switch {
		case filter.Query != "" && filter.MemoryType == "":
			memories, total, err = s.defaultConfidenceRecallSearch(r.Context(), auth, svc, filter)
		case filter.Query != "" && (filter.MemoryType == string(domain.TypeSession) ||
			filter.MemoryType == string(domain.TypePinned) ||
			filter.MemoryType == string(domain.TypeInsight)):
			memories, total, err = s.singlePoolConfidenceRecallSearch(r.Context(), auth, svc, filter)
		case !onlySession:
			memories, total, err = svc.memory.Search(r.Context(), filter)
		}
	}

	if err != nil {
		if s.runtimeUsageEnabled() && recallLease != nil {
			s.runtimeUsage.AfterRecallFailure(context.Background(), recallLease, err)
			recallFinalized = true
		}
		s.handleError(r.Context(), w, err)
		return
	}

	if memories == nil {
		memories = []domain.Memory{}
	}
	if rawQuery != "" && classifyRecallQueryShape(rawQuery) == recallQueryShapeTime {
		for i := range memories {
			memories[i].Content = service.TemporalRecallProjection(memories[i].Content, memories[i].Metadata)
		}
	}
	if filter.Query != "" {
		if s.runtimeUsageEnabled() && recallLease != nil {
			if err := withRuntimeUsagePostSuccessContext(func(ctx context.Context) error {
				return s.runtimeUsage.AfterRecallSuccess(ctx, recallLease, runtimeusage.RecallResult{
					MemoryIDs: memoryIDs(memories),
					AgentName: auth.AgentName,
				})
			}); err != nil {
				s.logger.Error("runtime usage recall finalization failed",
					"operation_id", recallLease.OperationID,
					"tenant_id", auth.TenantID,
					"cluster_id", auth.ClusterID,
					"err", err)
				recallFinalized = true
				s.handleRuntimeUsageError(w, err)
				return
			}
			recallFinalized = true
		}
		s.recordRecallMetering(auth)
	}

	respond(w, http.StatusOK, listResponse{
		Memories: memories,
		Total:    total,
		Limit:    limit,
		Offset:   offset,
	})
}

func normalizeRecallQuery(query string, now time.Time) string {
	return service.NormalizeTemporalRecallQuery(query, now)
}

type contentSessionMeta struct {
	Speaker   string `json:"speaker"`
	TurnIndex int    `json:"turn_index"`
}

// func (s *Server) persistContentSession(ctx context.Context, auth *domain.AuthInfo, svc resolvedSvc, sessionID, agentID, content string, metadata json.RawMessage) {
// 	if sessionID == "" || svc.session == nil {
// 		return
// 	}
//
// 	seq, role := contentSessionFields(content, metadata)
// 	if err := svc.session.CreateRawTurn(ctx, sessionID, agentID, auth.AgentName, seq, role, content); err != nil {
// 		slog.Error("content session raw save failed", "cluster_id", auth.ClusterID, "session", sessionID, "err", err)
// 	}
// }

// func contentSessionFields(content string, metadata json.RawMessage) (int, string) {
// 	meta := contentSessionMeta{TurnIndex: -1}
// 	if len(metadata) > 0 {
// 		_ = json.Unmarshal(metadata, &meta)
// 	}
//
// 	role := roleFromSpeaker(meta.Speaker)
// 	if role == "" {
// 		role = roleFromSpeaker(content)
// 	}
// 	if role == "" {
// 		role = "user"
// 	}
//
// 	if meta.TurnIndex >= 0 {
// 		return meta.TurnIndex, role
// 	}
// 	return 0, role
// }

// func roleFromSpeaker(raw string) string {
// 	lower := strings.ToLower(raw)
// 	switch {
// 	case strings.Contains(lower, "speaker 1"), lower == "user":
// 		return "user"
// 	case strings.Contains(lower, "speaker 2"), lower == "assistant", strings.Contains(lower, "assistant"):
// 		return "assistant"
// 	default:
// 		return ""
// 	}
// }

func trimUniqueMemories(mems []domain.Memory, limit int) []domain.Memory {
	if limit <= 0 {
		return []domain.Memory{}
	}

	out := make([]domain.Memory, 0, limit)
	seen := make(map[string]struct{}, limit)
	for _, mem := range mems {
		if len(out) >= limit {
			break
		}
		key := mem.Content
		if key == "" {
			key = mem.ID
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, mem)
	}
	return out
}

func (s *Server) getMemory(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	id := chi.URLParam(r, "id")

	if auth.IsChain() {
		mem, err := s.getChainMemory(r.Context(), auth, id)
		if err != nil {
			s.handleError(r.Context(), w, err)
			return
		}
		respond(w, http.StatusOK, mem)
		return
	}

	svc := s.resolveServices(auth)
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
	id := chi.URLParam(r, "id")

	var ifMatch int
	if h := r.Header.Get("If-Match"); h != "" {
		ifMatch, _ = strconv.Atoi(h)
	}

	if auth.IsChain() {
		target, err := s.findChainMemoryTarget(r.Context(), auth, id)
		if err != nil {
			s.handleError(r.Context(), w, err)
			return
		}
		var lease *runtimeusage.OperationLease
		finalized := false
		if s.runtimeUsageEnabled() {
			lease, err = s.runtimeUsage.BeforeMemoryUpdate(r.Context(), subjectFromAuth(target.nodeAuth))
			if err != nil {
				s.handleRuntimeUsageError(w, err)
				return
			}
			defer func() {
				if !finalized {
					s.runtimeUsage.AfterMemoryUpdateFailure(context.Background(), lease, context.Canceled)
				}
			}()
		}
		mem, err := target.svc.memory.Update(r.Context(), auth.AgentName, id, req.Content, req.Tags, req.Metadata, ifMatch)
		if err != nil {
			if s.runtimeUsageEnabled() {
				s.runtimeUsage.AfterMemoryUpdateFailure(context.Background(), lease, err)
				finalized = true
			}
			s.handleError(r.Context(), w, err)
			return
		}
		mem.ChainSource = target.source
		if s.runtimeUsageEnabled() {
			if err := withRuntimeUsagePostSuccessContext(func(ctx context.Context) error {
				return s.runtimeUsage.AfterMemoryUpdateSuccess(ctx, lease, runtimeusage.MemoryUpdateResult{
					MemoryIDs:       []string{mem.ID},
					AgentName:       target.nodeAuth.AgentName,
					ObjectsAffected: 1,
				})
			}); err != nil {
				s.logger.Error("runtime usage chain memory update finalization failed",
					"operation_id", lease.OperationID,
					"tenant_id", target.nodeAuth.TenantID,
					"cluster_id", target.nodeAuth.ClusterID,
					"err", err)
				finalized = true
				s.handleRuntimeUsageError(w, err)
				return
			}
			finalized = true
		}
		go s.afterSuccessfulWrite(target.nodeAuth, target.svc, 1)
		w.Header().Set("ETag", strconv.Itoa(mem.Version))
		respond(w, http.StatusOK, mem)
		return
	}

	svc := s.resolveServices(auth)
	var lease *runtimeusage.OperationLease
	finalized := false
	if s.runtimeUsageEnabled() {
		var err error
		lease, err = s.runtimeUsage.BeforeMemoryUpdate(r.Context(), subjectFromAuth(auth))
		if err != nil {
			s.handleRuntimeUsageError(w, err)
			return
		}
		defer func() {
			if !finalized {
				s.runtimeUsage.AfterMemoryUpdateFailure(context.Background(), lease, context.Canceled)
			}
		}()
	}
	mem, err := svc.memory.Update(r.Context(), auth.AgentName, id, req.Content, req.Tags, req.Metadata, ifMatch)
	if err != nil {
		if s.runtimeUsageEnabled() {
			s.runtimeUsage.AfterMemoryUpdateFailure(context.Background(), lease, err)
			finalized = true
		}
		s.handleError(r.Context(), w, err)
		return
	}
	if s.runtimeUsageEnabled() {
		if err := withRuntimeUsagePostSuccessContext(func(ctx context.Context) error {
			return s.runtimeUsage.AfterMemoryUpdateSuccess(ctx, lease, runtimeusage.MemoryUpdateResult{
				MemoryIDs:       []string{mem.ID},
				AgentName:       auth.AgentName,
				ObjectsAffected: 1,
			})
		}); err != nil {
			s.logger.Error("runtime usage memory update finalization failed",
				"operation_id", lease.OperationID,
				"tenant_id", auth.TenantID,
				"cluster_id", auth.ClusterID,
				"err", err)
			finalized = true
			s.handleRuntimeUsageError(w, err)
			return
		}
		finalized = true
	}

	go s.afterSuccessfulWrite(auth, svc, 1)
	w.Header().Set("ETag", strconv.Itoa(mem.Version))
	respond(w, http.StatusOK, mem)
}

func (s *Server) deleteMemory(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	id := chi.URLParam(r, "id")

	if auth.IsChain() {
		target, err := s.findChainMemoryTarget(r.Context(), auth, id)
		if err != nil {
			s.handleError(r.Context(), w, err)
			return
		}
		var lease *runtimeusage.OperationLease
		finalized := false
		if s.runtimeUsageEnabled() {
			lease, err = s.runtimeUsage.BeforeMemoryDelete(r.Context(), subjectFromAuth(target.nodeAuth))
			if err != nil {
				s.handleRuntimeUsageError(w, err)
				return
			}
			defer func() {
				if !finalized {
					s.runtimeUsage.AfterMemoryDeleteFailure(context.Background(), lease, context.Canceled)
				}
			}()
		}
		deleted, err := target.svc.memory.Delete(r.Context(), id, auth.AgentName)
		if err != nil {
			if s.runtimeUsageEnabled() {
				s.runtimeUsage.AfterMemoryDeleteFailure(context.Background(), lease, err)
				finalized = true
			}
			s.handleError(r.Context(), w, err)
			return
		}
		if s.runtimeUsageEnabled() {
			if err := withRuntimeUsagePostSuccessContext(func(ctx context.Context) error {
				return s.runtimeUsage.AfterMemoryDeleteSuccess(ctx, lease, runtimeusage.MemoryDeleteResult{
					MemoryIDs:       []string{id},
					AgentName:       target.nodeAuth.AgentName,
					ObjectsAffected: deleted,
				})
			}); err != nil {
				s.logger.Error("runtime usage chain memory delete finalization failed",
					"operation_id", lease.OperationID,
					"tenant_id", target.nodeAuth.TenantID,
					"cluster_id", target.nodeAuth.ClusterID,
					"err", err)
				finalized = true
				s.handleRuntimeUsageError(w, err)
				return
			}
			finalized = true
		}
		go s.afterSuccessfulWrite(target.nodeAuth, target.svc, 0)
		w.WriteHeader(http.StatusNoContent)
		return
	}

	svc := s.resolveServices(auth)
	var lease *runtimeusage.OperationLease
	finalized := false
	if s.runtimeUsageEnabled() {
		var err error
		lease, err = s.runtimeUsage.BeforeMemoryDelete(r.Context(), subjectFromAuth(auth))
		if err != nil {
			s.handleRuntimeUsageError(w, err)
			return
		}
		defer func() {
			if !finalized {
				s.runtimeUsage.AfterMemoryDeleteFailure(context.Background(), lease, context.Canceled)
			}
		}()
	}

	deleted, err := svc.memory.Delete(r.Context(), id, auth.AgentName)
	if err != nil {
		if s.runtimeUsageEnabled() {
			s.runtimeUsage.AfterMemoryDeleteFailure(context.Background(), lease, err)
			finalized = true
		}
		s.handleError(r.Context(), w, err)
		return
	}
	if s.runtimeUsageEnabled() {
		if err := withRuntimeUsagePostSuccessContext(func(ctx context.Context) error {
			return s.runtimeUsage.AfterMemoryDeleteSuccess(ctx, lease, runtimeusage.MemoryDeleteResult{
				MemoryIDs:       []string{id},
				AgentName:       auth.AgentName,
				ObjectsAffected: deleted,
			})
		}); err != nil {
			s.logger.Error("runtime usage memory delete finalization failed",
				"operation_id", lease.OperationID,
				"tenant_id", auth.TenantID,
				"cluster_id", auth.ClusterID,
				"err", err)
			finalized = true
			s.handleRuntimeUsageError(w, err)
			return
		}
		finalized = true
	}

	go s.afterSuccessfulWrite(auth, svc, 0)
	w.WriteHeader(http.StatusNoContent)
}

type batchDeleteRequest struct {
	IDs []string `json:"ids"`
}

func (s *Server) batchDeleteMemories(w http.ResponseWriter, r *http.Request) {
	var req batchDeleteRequest
	if err := decode(r, &req); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}

	auth := authInfo(r)
	if auth.IsChain() {
		groups, err := s.chainDeleteGroups(r.Context(), auth, req.IDs)
		if err != nil {
			if isRuntimeUsageError(err) {
				s.handleRuntimeUsageError(w, err)
			} else {
				s.handleError(r.Context(), w, err)
			}
			return
		}
		var deleted int64
		for _, group := range groups {
			var lease *runtimeusage.OperationLease
			finalized := false
			if s.runtimeUsageEnabled() {
				lease, err = s.runtimeUsage.BeforeMemoryDelete(r.Context(), subjectFromAuth(group.target.nodeAuth))
				if err != nil {
					s.handleRuntimeUsageError(w, err)
					return
				}
			}
			groupDeleted, err := group.target.svc.memory.BulkDelete(r.Context(), group.ids, auth.AgentName)
			if err != nil {
				if s.runtimeUsageEnabled() {
					s.runtimeUsage.AfterMemoryDeleteFailure(context.Background(), lease, err)
					finalized = true
				}
				s.handleError(r.Context(), w, err)
				return
			}
			if s.runtimeUsageEnabled() {
				if err := withRuntimeUsagePostSuccessContext(func(ctx context.Context) error {
					return s.runtimeUsage.AfterMemoryDeleteSuccess(ctx, lease, runtimeusage.MemoryDeleteResult{
						MemoryIDs:       append([]string(nil), group.ids...),
						AgentName:       group.target.nodeAuth.AgentName,
						ObjectsAffected: groupDeleted,
					})
				}); err != nil {
					s.logger.Error("runtime usage chain batch delete finalization failed",
						"operation_id", lease.OperationID,
						"tenant_id", group.target.nodeAuth.TenantID,
						"cluster_id", group.target.nodeAuth.ClusterID,
						"err", err)
					finalized = true
					s.handleRuntimeUsageError(w, err)
					return
				}
				finalized = true
			}
			if s.runtimeUsageEnabled() && !finalized {
				s.runtimeUsage.AfterMemoryDeleteFailure(context.Background(), lease, context.Canceled)
			}
			if groupDeleted > 0 {
				go s.afterSuccessfulWrite(group.target.nodeAuth, group.target.svc, 0)
			}
			deleted += groupDeleted
		}
		respond(w, http.StatusOK, map[string]any{
			"deleted": deleted,
		})
		return
	}

	svc := s.resolveServices(auth)
	deleteIDs, err := service.ValidateBulkDeleteIDs(req.IDs)
	if err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	var lease *runtimeusage.OperationLease
	finalized := false
	if s.runtimeUsageEnabled() {
		var err error
		lease, err = s.runtimeUsage.BeforeMemoryDelete(r.Context(), subjectFromAuth(auth))
		if err != nil {
			s.handleRuntimeUsageError(w, err)
			return
		}
		defer func() {
			if !finalized {
				s.runtimeUsage.AfterMemoryDeleteFailure(context.Background(), lease, context.Canceled)
			}
		}()
	}
	deleted, err := svc.memory.BulkDelete(r.Context(), deleteIDs, auth.AgentName)
	if err != nil {
		if s.runtimeUsageEnabled() {
			s.runtimeUsage.AfterMemoryDeleteFailure(context.Background(), lease, err)
			finalized = true
		}
		s.handleError(r.Context(), w, err)
		return
	}
	if s.runtimeUsageEnabled() {
		if err := withRuntimeUsagePostSuccessContext(func(ctx context.Context) error {
			return s.runtimeUsage.AfterMemoryDeleteSuccess(ctx, lease, runtimeusage.MemoryDeleteResult{
				MemoryIDs:       append([]string(nil), deleteIDs...),
				AgentName:       auth.AgentName,
				ObjectsAffected: deleted,
			})
		}); err != nil {
			s.logger.Error("runtime usage batch delete finalization failed",
				"operation_id", lease.OperationID,
				"tenant_id", auth.TenantID,
				"cluster_id", auth.ClusterID,
				"err", err)
			finalized = true
			s.handleRuntimeUsageError(w, err)
			return
		}
		finalized = true
	}

	go s.afterSuccessfulWrite(auth, svc, 0)
	respond(w, http.StatusOK, map[string]any{
		"deleted": deleted,
	})
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
	var writeChainSource *domain.ChainSource
	if auth.IsChain() {
		var err error
		if len(auth.Chain.Nodes) > 0 {
			writeChainSource = chainSource(auth, auth.Chain.Nodes[0])
		}
		auth, err = s.firstChainNodeAuth(auth)
		if err != nil {
			s.handleError(r.Context(), w, err)
			return
		}
	}
	svc := s.resolveServices(auth)
	if err := service.ValidateBulkMemoryInputs(req.Memories); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}
	var lease *runtimeusage.OperationLease
	finalized := false
	if s.runtimeUsageEnabled() {
		var err error
		lease, err = s.runtimeUsage.BeforeMemoryCreate(r.Context(), subjectFromAuth(auth), 1)
		if err != nil {
			s.handleRuntimeUsageError(w, err)
			return
		}
		defer func() {
			if !finalized {
				s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, context.Canceled)
			}
		}()
	}
	memories, err := svc.memory.BulkCreate(r.Context(), auth.AgentName, req.Memories)
	if err != nil {
		if s.runtimeUsageEnabled() {
			s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, err)
			finalized = true
		}
		s.handleError(r.Context(), w, err)
		return
	}
	applyChainSource(memories, writeChainSource)
	if s.runtimeUsageEnabled() {
		if err := withRuntimeUsagePostSuccessContext(func(ctx context.Context) error {
			return s.runtimeUsage.AfterMemoryCreateSuccess(ctx, lease, runtimeusage.MemoryCreateResult{
				MemoryIDs:       memoryIDs(memories),
				AgentName:       auth.AgentName,
				ObjectsAffected: int64(len(memories)),
			})
		}); err != nil {
			s.logger.Error("runtime usage bulk create finalization failed",
				"operation_id", lease.OperationID,
				"tenant_id", auth.TenantID,
				"cluster_id", auth.ClusterID,
				"err", err)
			finalized = true
			s.handleRuntimeUsageError(w, err)
			return
		}
		finalized = true
	}

	go s.afterSuccessfulIngest(auth, svc, int64(len(memories)))
	respond(w, http.StatusCreated, map[string]any{
		"ok":       true,
		"memories": memories,
	})
}

func (s *Server) bootstrapMemories(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	if auth.IsChain() {
		var err error
		auth, err = s.firstChainNodeAuth(auth)
		if err != nil {
			s.handleError(r.Context(), w, err)
			return
		}
	}

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
	ID          string              `json:"id"`
	SessionID   string              `json:"session_id,omitempty"`
	AgentID     string              `json:"agent_id,omitempty"`
	Source      string              `json:"source,omitempty"`
	Seq         int                 `json:"seq"`
	Role        string              `json:"role"`
	Content     string              `json:"content"`
	ContentType string              `json:"content_type"`
	Tags        []string            `json:"tags"`
	State       domain.MemoryState  `json:"state"`
	CreatedAt   time.Time           `json:"created_at"`
	UpdatedAt   time.Time           `json:"updated_at"`
	ChainSource *domain.ChainSource `json:"chain_source,omitempty"`
}

func (s *Server) handleListSessionMessages(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)

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

	if auth.IsChain() {
		messages, err := s.listChainSessionMessages(r.Context(), auth, sessionIDs, limitPerSession)
		if err != nil {
			s.handleError(r.Context(), w, err)
			return
		}
		respond(w, http.StatusOK, map[string]any{
			"messages":          messages,
			"limit_per_session": limitPerSession,
		})
		return
	}

	svc := s.resolveServices(auth)
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
	if auth == nil || svc.memory == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	clusterID := auth.ClusterID
	if clusterID == "" {
		clusterID = "default"
	}

	if written > 0 {
		metrics.MemoryChangesTotal.WithLabelValues(clusterID).Add(float64(written))
	}

	if s.activity == nil || auth.TenantID == "" {
		logger := s.logger
		if logger == nil {
			logger = slog.Default()
		}
		logger.Warn("refreshWriteMetrics: activity tracker unavailable", "tenant_id", auth.TenantID, "cluster_id", clusterID)
		return
	}

	observedAt := time.Now().UTC()
	total, last7d, err := svc.memory.CountStats(ctx)
	if err != nil {
		logger := s.logger
		if logger == nil {
			logger = slog.Default()
		}
		logger.Warn("refreshWriteMetrics: count stats failed", "tenant_id", auth.TenantID, "cluster_id", clusterID, "err", err)
		s.activity.RecordMemoryActivity(auth.TenantID, observedAt)
		return
	}
	s.activity.RecordMemoryStats(ctx, auth.TenantID, observedAt, total, last7d, observedAt)
}
