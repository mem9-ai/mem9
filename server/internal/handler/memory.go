package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/service"
)

var (
	answerQuotedRe      = regexp.MustCompile(`"[^"]+"`)
	answerAcronymRe     = regexp.MustCompile(`\b[A-Z]{2,}(?:[+-][A-Z0-9]+)*\b`)
	answerISODateRe     = regexp.MustCompile(`\b\d{4}-\d{2}-\d{2}\b`)
	answerNumberRe      = regexp.MustCompile(`\b\d+\b`)
	answerYearRe        = regexp.MustCompile(`\b(?:19|20)\d{2}\b`)
	answerTitleCaseRe   = regexp.MustCompile(`\b[A-Z][a-z]+(?:['-][A-Za-z]+)*(?:\s+[A-Z][a-z]+(?:['-][A-Za-z]+)*)*\b`)
	answerLocationCueRe = regexp.MustCompile(`\b(?:in|at|from|to|near|around|outside|inside)\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}\b`)
	answerCountWordRe   = regexp.MustCompile(`\b(?:one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several)\b`)
	answerVaguePlaceRe  = regexp.MustCompile(`\b(?:home country|the area|the region|somewhere|another city)\b`)
)

const (
	maxRoutingInsights        = 3
	maxSessionsPerInsight     = 3
	maxRoutedSessions         = 6
	maxNeighborSeedCount      = 2
	maxThreadChaseCandidates  = 6
	maxThreadChaseResults     = 2
	neighborSeedMinScore      = 0.35
	neighborBeforeWindow      = 1
	neighborAfterWindow       = 1
	explicitSessionPrimaryCap = 8
)

type groundingAnswerShape int

const (
	groundingAnswerShapeNone groundingAnswerShape = iota
	groundingAnswerShapeCount
	groundingAnswerShapeEntity
	groundingAnswerShapeLocation
	groundingAnswerShapeTime
	groundingAnswerShapeExact
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
		if err := s.ensureSessionSchemaForWrite(r.Context(), auth); err != nil {
			s.handleError(r.Context(), w, err)
			return
		}
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

	if strings.TrimSpace(req.SessionID) != "" {
		if err := s.ensureSessionSchemaForWrite(r.Context(), auth); err != nil {
			s.handleError(r.Context(), w, err)
			return
		}
	}

	tags := append([]string(nil), req.Tags...)
	metadata := append(json.RawMessage(nil), req.Metadata...)
	content := req.Content
	if err := service.ValidateMemoryInput(content, tags); err != nil {
		s.handleError(r.Context(), w, err)
		return
	}

	if req.Sync {
		mem, written, err := svc.memory.CreateWithSession(r.Context(), agentID, req.SessionID, content, tags, metadata)
		if err != nil {
			slog.Error("sync memory create failed", "agent", agentID, "actor", auth.AgentName, "err", err)
			s.handleError(r.Context(), w, err)
			return
		}
		s.persistContentSession(r.Context(), auth, svc, req.SessionID, agentID, content, metadata)
		_ = mem
		go s.refreshWriteMetrics(auth, svc, int64(written))
		respond(w, http.StatusOK, map[string]string{"status": "ok"})
	} else {
		go func(auth *domain.AuthInfo, agentName, actorAgentID, sessionID, content string, tags []string, metadata json.RawMessage) {
			mem, written, err := svc.memory.CreateWithSession(context.Background(), actorAgentID, sessionID, content, tags, metadata)
			if err != nil {
				slog.Error("async memory create failed", "agent", actorAgentID, "actor", agentName, "err", err)
				return
			}
			s.persistContentSession(context.Background(), auth, svc, sessionID, actorAgentID, content, metadata)
			if mem != nil {
				slog.Info("async memory create complete", "agent", actorAgentID, "actor", agentName, "memory_id", mem.ID)
			} else {
				slog.Info("async memory create complete", "agent", actorAgentID, "actor", agentName, "memory_id", "")
			}
			s.refreshWriteMetrics(auth, svc, int64(written))
		}(auth, auth.AgentName, agentID, req.SessionID, content, tags, metadata)

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
	explicitSessionMixed := filter.Query != "" && filter.SessionID != "" && filter.MemoryType == ""

	var memories []domain.Memory
	var total int
	var err error

	if filter.Query != "" && !onlySession && s.strategyRouter != nil {
		decision, detectErr := s.detectRecallStrategies(r.Context(), auth, filter)
		if detectErr != nil {
			slog.Warn("strategy detection error, proceeding with default path",
				"cluster_id", auth.ClusterID, "err", detectErr)
		}

		if detectErr == nil && shouldExecuteStrategyDecision(decision) {
			memories, total, err = s.executeWithFallback(r.Context(), auth, svc, filter, decision)
			if err != nil {
				s.handleError(r.Context(), w, err)
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
			return
		}
	}

	if explicitSessionMixed {
		memories, total, err = s.explicitSessionSearch(r.Context(), auth, svc, filter, domain.StrategyDefaultMixed, "")
		if err != nil {
			s.handleError(r.Context(), w, err)
			return
		}
	} else if !onlySession {
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
		// session grounding uses supplementalSessionLimit regardless of SessionID — session memories
		// are always treated as supplemental context, blended and reranked against primary results.
		if sessionMems, sessErr := s.sessionGroundingSearch(r.Context(), auth, svc, filter); sessErr != nil {
			slog.Warn("session grounding search failed", "cluster_id", auth.ClusterID, "err", sessErr)
		} else {
			memories = blendMemoriesWithSessionGrounding(memories, sessionMems, limit)
			memories = rerankGroundedMemories(filter.Query, memories)
			total = len(memories)
		}
	} else if filter.Query != "" && filter.MemoryType == "" && !explicitSessionMixed {
		var (
			sessionMems  []domain.Memory
			useFallback  bool
			routedErr    error
			sessionBlend bool
		)

		sessionMems, useFallback, routedErr = s.provenanceSessionGroundingSearch(r.Context(), auth, svc, memories, filter)
		switch {
		case routedErr != nil && useFallback:
			slog.Warn("provenance routing failed; falling back to generic session grounding", "cluster_id", auth.ClusterID, "err", routedErr)
			useFallback = true
		case routedErr != nil:
			slog.Warn("routed session grounding failed", "cluster_id", auth.ClusterID, "err", routedErr)
		case len(sessionMems) > 0:
			sessionBlend = true
		}

		if useFallback {
			if fallbackMems, sessErr := s.sessionGroundingSearch(r.Context(), auth, svc, filter); sessErr != nil {
				slog.Warn("session grounding search failed", "cluster_id", auth.ClusterID, "err", sessErr)
			} else if len(fallbackMems) > 0 {
				sessionMems = fallbackMems
				sessionBlend = true
			}
		}

		if sessionBlend {
			memories = blendMemoriesWithSessionGrounding(memories, sessionMems, limit)
			memories = rerankGroundedMemories(filter.Query, memories)
			total = len(memories)
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

func (s *Server) explicitSessionSearch(ctx context.Context, auth *domain.AuthInfo, svc resolvedSvc, filter domain.MemoryFilter, strategyName string, answerFamily string) ([]domain.Memory, int, error) {
	sessionPrimaryLimit := explicitSessionPrimaryLimit(filter.Limit)
	if sessionPrimaryLimit == 0 {
		return []domain.Memory{}, 0, nil
	}

	var (
		sessionMems []domain.Memory
		chasedMems  []domain.Memory
		insightMems []domain.Memory
		sessionErr  error
		insightErr  error
	)

	if svc.session != nil {
		sessionFilter := filter
		sessionFilter.Offset = 0
		sessionFilter.Limit = sessionPrimaryLimit
		sessionMems, sessionErr = svc.session.Search(ctx, sessionFilter)
		if sessionErr != nil {
			slog.Warn("explicit-session search: session search failed", "cluster_id", auth.ClusterID, "err", sessionErr)
			sessionMems = nil
		} else {
			sessionMems = rerankExplicitSessionMemories(filter.Query, sessionMems)
			if explicitSessionThreadChaseEnabled(strategyName, answerFamily) {
				chased, err := s.chaseQuestionAnswerTurns(ctx, auth, svc, sessionMems, maxThreadChaseCandidates, maxThreadChaseResults)
				if err != nil {
					slog.Warn("explicit-session thread chase failed", "cluster_id", auth.ClusterID, "err", err)
				} else if len(chased) > 0 {
					chasedMems = chased
				}
			}
			before, after, ok := explicitSessionNeighborWindow(strategyName, answerFamily)
			if ok && len(sessionMems) > 0 {
				neighbors, err := s.expandSessionNeighbors(ctx, auth, svc, sessionMems, sessionPrimaryLimit, before, after)
				if err != nil {
					slog.Warn("explicit-session neighbor expansion failed", "cluster_id", auth.ClusterID, "err", err)
				} else if len(neighbors) > 0 {
					sessionMems = selectSessionContextResults(sessionMems, neighbors, sessionPrimaryLimit)
				}
			}
		}
	}

	if svc.memory != nil {
		insightMems, _, insightErr = svc.memory.Search(ctx, filter)
		if insightErr != nil {
			slog.Warn("explicit-session search: insight search failed", "cluster_id", auth.ClusterID, "err", insightErr)
			insightMems = nil
		}
	}

	if sessionErr != nil && insightErr != nil {
		return nil, 0, fmt.Errorf("explicit-session search: session: %w; insight: %v", sessionErr, insightErr)
	}
	if sessionErr != nil && len(insightMems) == 0 {
		return nil, 0, sessionErr
	}
	if insightErr != nil && len(sessionMems) == 0 {
		return nil, 0, insightErr
	}

	merged := mergeExplicitSessionResultsWithChased(chasedMems, sessionMems, insightMems, filter.Limit)
	return merged, len(merged), nil
}

type contentSessionMeta struct {
	Speaker   string `json:"speaker"`
	TurnIndex int    `json:"turn_index"`
}

func (s *Server) persistContentSession(ctx context.Context, auth *domain.AuthInfo, svc resolvedSvc, sessionID, agentID, content string, metadata json.RawMessage) {
	if sessionID == "" || svc.session == nil {
		return
	}

	seq, role := contentSessionFields(content, metadata)
	if err := svc.session.CreateRawTurn(ctx, sessionID, agentID, auth.AgentName, seq, role, content); err != nil {
		slog.Error("content session raw save failed", "cluster_id", auth.ClusterID, "session", sessionID, "err", err)
	}
}

func contentSessionFields(content string, metadata json.RawMessage) (int, string) {
	meta := contentSessionMeta{TurnIndex: -1}
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &meta)
	}

	role := roleFromSpeaker(meta.Speaker)
	if role == "" {
		role = roleFromSpeaker(content)
	}
	if role == "" {
		role = "user"
	}

	if meta.TurnIndex >= 0 {
		return meta.TurnIndex, role
	}
	return -1, role
}

func roleFromSpeaker(raw string) string {
	lower := strings.TrimSpace(strings.ToLower(raw))
	switch {
	case lower == "user",
		lower == "speaker 1",
		strings.HasPrefix(lower, "user:"),
		strings.HasPrefix(lower, "speaker 1:"),
		strings.HasPrefix(lower, "[speaker:speaker 1]"),
		strings.HasPrefix(lower, "[speaker:user]"):
		return "user"
	case lower == "assistant",
		lower == "speaker 2",
		strings.HasPrefix(lower, "assistant:"),
		strings.HasPrefix(lower, "speaker 2:"),
		strings.HasPrefix(lower, "[speaker:speaker 2]"),
		strings.HasPrefix(lower, "[speaker:assistant]"):
		return "assistant"
	default:
		return ""
	}
}

func (s *Server) sessionGroundingSearch(ctx context.Context, auth *domain.AuthInfo, svc resolvedSvc, filter domain.MemoryFilter) ([]domain.Memory, error) {
	if svc.session == nil {
		return nil, nil
	}

	sessionFilter := filter
	sessionFilter.Offset = 0
	sessionFilter.Limit = supplementalSessionLimit(filter.Limit)
	if sessionFilter.Limit == 0 {
		return nil, nil
	}

	sessionMems, err := svc.session.Search(ctx, sessionFilter)
	if err != nil {
		return nil, err
	}
	slog.Info("session grounding search", "cluster_id", auth.ClusterID, "query_len", len(filter.Query), "results", len(sessionMems))
	return sessionMems, nil
}

func (s *Server) provenanceSessionGroundingSearch(ctx context.Context, auth *domain.AuthInfo, svc resolvedSvc, primary []domain.Memory, filter domain.MemoryFilter) ([]domain.Memory, bool, error) {
	if svc.memory == nil || svc.session == nil {
		return nil, true, nil
	}

	sessionBudget := supplementalSessionLimit(filter.Limit)
	if sessionBudget == 0 {
		return nil, false, nil
	}

	routedSessionIDs, err := svc.memory.RoutedSessionIDs(ctx, primary, maxRoutingInsights, maxSessionsPerInsight, maxRoutedSessions)
	if err != nil {
		return nil, true, err
	}
	routedSessionIDs = intersectSessionIDs(routedSessionIDs, filter.SessionID)
	if len(routedSessionIDs) == 0 {
		return nil, true, nil
	}

	sessionFilter := filter
	sessionFilter.Offset = 0
	sessionFilter.Limit = sessionBudget

	sessionMems, err := svc.session.SearchInSessionSet(ctx, sessionFilter, routedSessionIDs)
	if err != nil {
		return nil, false, err
	}
	if len(sessionMems) == 0 {
		return nil, false, nil
	}

	if filter.SessionID != "" || !queryNeedsNeighborExpansion(filter.Query) || sessionBudget < 2 {
		slog.Info("routed session grounding search", "cluster_id", auth.ClusterID, "query_len", len(filter.Query), "sessions", len(routedSessionIDs), "results", len(sessionMems), "expanded", 0)
		return sessionMems, false, nil
	}

	neighbors, err := s.expandSessionNeighbors(ctx, auth, svc, sessionMems, sessionBudget, neighborBeforeWindow, neighborAfterWindow)
	if err != nil {
		slog.Warn("session neighbor expansion failed; keeping routed seeds only", "cluster_id", auth.ClusterID, "err", err)
		return sessionMems, false, nil
	}

	merged := selectSessionContextResults(sessionMems, neighbors, sessionBudget)
	slog.Info("routed session grounding search", "cluster_id", auth.ClusterID, "query_len", len(filter.Query), "sessions", len(routedSessionIDs), "results", len(sessionMems), "expanded", len(neighbors))
	return merged, false, nil
}

type sessionMemoryMeta struct {
	Role        string `json:"role,omitempty"`
	Seq         int    `json:"seq"`
	ContentType string `json:"content_type,omitempty"`
	Neighbor    bool   `json:"neighbor,omitempty"`
}

type sessionSeed struct {
	mem domain.Memory
	seq int
}

func queryNeedsNeighborExpansion(query string) bool {
	lower := strings.ToLower(strings.TrimSpace(query))
	if lower == "" {
		return false
	}

	temporalTerms := []string{
		"when", "before", "after", "earlier", "later", "first", "last",
		"next", "previous", "during", "then", "date", "day", "month", "year",
	}
	for _, term := range temporalTerms {
		if strings.Contains(lower, term) {
			return true
		}
	}

	relationalTerms := []string{
		"because", "with", "who told", "who invited", "what happened when",
		"where did", "go after", "after meeting",
	}
	for _, term := range relationalTerms {
		if strings.Contains(lower, term) {
			return true
		}
	}

	return false
}

func intersectSessionIDs(sessionIDs []string, explicitSessionID string) []string {
	if explicitSessionID == "" {
		return sessionIDs
	}

	for _, sessionID := range sessionIDs {
		if sessionID == explicitSessionID {
			return []string{explicitSessionID}
		}
	}
	return nil
}

func (s *Server) expandSessionNeighbors(ctx context.Context, auth *domain.AuthInfo, svc resolvedSvc, sessionMems []domain.Memory, sessionBudget int, beforeWindow int, afterWindow int) ([]domain.Memory, error) {
	seeds := selectSessionSeeds(sessionMems, maxNeighborSeedCount, neighborSeedMinScore)
	if len(seeds) == 0 || sessionBudget < 2 {
		return nil, nil
	}

	neighbors := make([]domain.Memory, 0, len(seeds)*2)
	seen := make(map[string]struct{}, len(sessionMems))
	for _, mem := range sessionMems {
		seen[mem.ID] = struct{}{}
	}

	for _, seed := range seeds {
		rows, err := svc.session.ListNeighbors(ctx, seed.mem.SessionID, seed.seq, beforeWindow, afterWindow)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			if _, ok := seen[row.ID]; ok {
				continue
			}
			seq, ok := sessionMemorySeq(row)
			if !ok {
				continue
			}
			seen[row.ID] = struct{}{}
			neighbors = append(neighbors, annotateNeighborMemory(row, seq, seed))
		}
	}

	slog.Info("session neighbor expansion", "cluster_id", auth.ClusterID, "seeds", len(seeds), "neighbors", len(neighbors))
	return neighbors, nil
}

func explicitSessionNeighborWindow(strategyName string, answerFamily string) (int, int, bool) {
	switch strategyName {
	case domain.StrategyAttributeInference:
		return 2, 2, true
	case domain.StrategyExactEntityLookup:
		return 1, 1, true
	case domain.StrategyDefaultMixed:
		if isInferenceStyleAnswerFamily(answerFamily) || isExactAnswerFamily(answerFamily) {
			return 2, 2, true
		}
	case domain.StrategyExactEventTemporal:
		return neighborBeforeWindow, neighborAfterWindow, true
	}
	return 0, 0, false
}

func explicitSessionThreadChaseEnabled(strategyName string, answerFamily string) bool {
	switch strategyName {
	case domain.StrategyAttributeInference:
		return true
	case domain.StrategyExactEntityLookup:
		return true
	case domain.StrategyDefaultMixed:
		return isInferenceStyleAnswerFamily(answerFamily) || isExactAnswerFamily(answerFamily)
	default:
		return false
	}
}

func (s *Server) chaseQuestionAnswerTurns(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	sessionMems []domain.Memory,
	maxCandidates int,
	maxResults int,
) ([]domain.Memory, error) {
	if svc.session == nil || maxCandidates <= 0 || maxResults <= 0 {
		return nil, nil
	}

	chased := make([]domain.Memory, 0, maxResults)
	seen := make(map[string]struct{}, maxResults)

	candidates := sessionMems
	if maxCandidates < len(candidates) {
		candidates = candidates[:maxCandidates]
	}

	for _, mem := range candidates {
		if len(chased) >= maxResults {
			break
		}
		if !strings.Contains(mem.Content, "?") {
			continue
		}
		seq, ok := sessionMemorySeq(mem)
		if !ok || mem.SessionID == "" {
			continue
		}
		rows, err := svc.session.ListNeighbors(ctx, mem.SessionID, seq, 0, 1)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			rowSeq, ok := sessionMemorySeq(row)
			if !ok || rowSeq != seq+1 {
				continue
			}
			key := responseDedupKey(row)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			chased = append(chased, annotateThreadChaseMemory(row, seq+1, mem))
			break
		}
	}

	if len(chased) > 0 {
		slog.Info("explicit-session thread chase", "cluster_id", auth.ClusterID, "candidates", len(candidates), "chased", len(chased))
	}
	return chased, nil
}

func chasedAnswerSlots(limit int) int {
	switch {
	case limit <= 2:
		return 1
	case limit <= 10:
		return 2
	default:
		return 3
	}
}

func mergeExplicitSessionResultsWithChased(chased, sessionPrimary, insightSupport []domain.Memory, limit int) []domain.Memory {
	if limit <= 0 {
		return []domain.Memory{}
	}

	chasedBudget := chasedAnswerSlots(limit)
	if chasedBudget > len(chased) {
		chasedBudget = len(chased)
	}
	remaining := limit - chasedBudget
	if remaining < 0 {
		remaining = 0
	}

	base := mergeExplicitSessionResults(sessionPrimary, insightSupport, remaining)
	merged := make([]domain.Memory, 0, limit)
	seen := make(map[string]struct{}, limit)

	appendUnique := func(mem domain.Memory) {
		key := responseDedupKey(mem)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		merged = append(merged, mem)
	}

	for _, mem := range chased {
		if len(merged) >= chasedBudget {
			break
		}
		appendUnique(mem)
	}
	for _, mem := range base {
		if len(merged) >= limit {
			break
		}
		appendUnique(mem)
	}
	for _, mem := range chased {
		if len(merged) >= limit {
			break
		}
		appendUnique(mem)
	}

	return merged
}

func selectSessionSeeds(sessionMems []domain.Memory, maxSeeds int, minScore float64) []sessionSeed {
	if maxSeeds <= 0 {
		return nil
	}

	seeds := make([]sessionSeed, 0, maxSeeds)
	seen := make(map[string]struct{}, maxSeeds)

	for _, mem := range sessionMems {
		if mem.SessionID == "" || mem.Score == nil || *mem.Score < minScore {
			continue
		}
		seq, ok := sessionMemorySeq(mem)
		if !ok {
			continue
		}
		key := mem.SessionID + ":" + strconv.Itoa(seq)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		seeds = append(seeds, sessionSeed{mem: mem, seq: seq})
		if len(seeds) >= maxSeeds {
			return seeds
		}
	}

	return seeds
}

func selectSessionContextResults(seeds, neighbors []domain.Memory, budget int) []domain.Memory {
	if budget <= 0 {
		return nil
	}
	if len(neighbors) == 0 {
		return trimUniqueMemories(seeds, budget)
	}

	seedBudget := budget - 1
	if seedBudget < 1 {
		seedBudget = 1
	}

	selected := make([]domain.Memory, 0, budget)
	seen := make(map[string]struct{}, budget)

	appendUnique := func(mem domain.Memory) {
		key := responseDedupKey(mem)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		selected = append(selected, mem)
	}

	seedsUsed := 0
	for _, mem := range seeds {
		if seedsUsed >= seedBudget || len(selected) >= budget {
			break
		}
		before := len(selected)
		appendUnique(mem)
		if len(selected) > before {
			seedsUsed++
		}
	}
	for _, mem := range neighbors {
		if len(selected) >= budget {
			break
		}
		appendUnique(mem)
	}
	for _, mem := range seeds {
		if len(selected) >= budget {
			break
		}
		appendUnique(mem)
	}
	for _, mem := range neighbors {
		if len(selected) >= budget {
			break
		}
		appendUnique(mem)
	}

	return selected
}

func sessionMemorySeq(mem domain.Memory) (int, bool) {
	meta := sessionMemoryMeta{Seq: -1}
	if len(mem.Metadata) == 0 {
		return 0, false
	}
	if err := json.Unmarshal(mem.Metadata, &meta); err != nil {
		return 0, false
	}
	if meta.Seq < 0 {
		return 0, false
	}
	return meta.Seq, true
}

func annotateNeighborMemory(mem domain.Memory, seq int, seed sessionSeed) domain.Memory {
	meta := sessionMemoryMeta{Seq: seq, Neighbor: true}
	if len(mem.Metadata) > 0 {
		_ = json.Unmarshal(mem.Metadata, &meta)
		meta.Seq = seq
		meta.Neighbor = true
	}
	if metaBytes, err := json.Marshal(meta); err == nil {
		mem.Metadata = metaBytes
	}

	if seed.mem.Score != nil {
		score := *seed.mem.Score - 0.05
		if score < 0 {
			score = 0
		}
		mem.Score = &score
	}

	return mem
}

func annotateThreadChaseMemory(mem domain.Memory, seq int, question domain.Memory) domain.Memory {
	meta := sessionMemoryMeta{Seq: seq, Neighbor: true}
	if len(mem.Metadata) > 0 {
		_ = json.Unmarshal(mem.Metadata, &meta)
		meta.Seq = seq
		meta.Neighbor = true
	}
	if metaBytes, err := json.Marshal(meta); err == nil {
		mem.Metadata = metaBytes
	}

	if question.Score != nil {
		score := *question.Score + 0.02
		mem.Score = &score
	}

	return mem
}

func explicitSessionPrimaryLimit(limit int) int {
	if limit <= 0 {
		return 0
	}
	if limit < explicitSessionPrimaryCap {
		return limit
	}
	return explicitSessionPrimaryCap
}

func mergeExplicitSessionResults(sessionPrimary, insightSupport []domain.Memory, limit int) []domain.Memory {
	if limit <= 0 {
		return []domain.Memory{}
	}

	sessionBudget := explicitSessionPrimaryLimit(limit)
	insightBudget := limit - sessionBudget
	if insightBudget < 0 {
		insightBudget = 0
	}

	merged := make([]domain.Memory, 0, limit)
	seen := make(map[string]struct{}, limit)

	appendUnique := func(mem domain.Memory) {
		key := responseDedupKey(mem)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		merged = append(merged, mem)
	}

	sessionUsed := 0
	for _, mem := range sessionPrimary {
		if sessionUsed >= sessionBudget || len(merged) >= limit {
			break
		}
		before := len(merged)
		appendUnique(mem)
		if len(merged) > before {
			sessionUsed++
		}
	}

	insightUsed := 0
	for _, mem := range insightSupport {
		if insightUsed >= insightBudget || len(merged) >= limit {
			break
		}
		before := len(merged)
		appendUnique(mem)
		if len(merged) > before {
			insightUsed++
		}
	}

	for _, mem := range insightSupport {
		if len(merged) >= limit {
			break
		}
		appendUnique(mem)
	}

	for _, mem := range sessionPrimary {
		if len(merged) >= limit {
			break
		}
		appendUnique(mem)
	}

	return merged
}

func supplementalSessionLimit(limit int) int {
	switch {
	case limit <= 1:
		return 0
	case limit <= 5:
		return 1
	case limit <= 10:
		return 2
	default:
		return 3
	}
}

func blendMemoriesWithSessionGrounding(primary, supplemental []domain.Memory, limit int) []domain.Memory {
	if limit <= 0 {
		return []domain.Memory{}
	}
	if len(primary) == 0 {
		return trimUniqueMemories(supplemental, limit)
	}
	if len(supplemental) == 0 {
		return trimUniqueMemories(primary, limit)
	}

	sessionSlots := supplementalSessionLimit(limit)
	if sessionSlots == 0 {
		return trimUniqueMemories(primary, limit)
	}
	if sessionSlots > len(supplemental) {
		sessionSlots = len(supplemental)
	}
	primaryBudget := limit - sessionSlots
	if primaryBudget < 0 {
		primaryBudget = 0
	}

	blended := make([]domain.Memory, 0, limit)
	seen := make(map[string]struct{}, limit)

	appendUnique := func(mem domain.Memory) {
		key := responseDedupKey(mem)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		blended = append(blended, mem)
	}

	for _, mem := range primary {
		if len(blended) >= primaryBudget {
			break
		}
		appendUnique(mem)
	}
	for _, mem := range supplemental {
		if len(blended) >= limit {
			break
		}
		appendUnique(mem)
	}
	for _, mem := range primary {
		if len(blended) >= limit {
			break
		}
		appendUnique(mem)
	}

	return blended
}

func rerankExplicitSessionMemories(query string, mems []domain.Memory) []domain.Memory {
	if len(mems) < 2 {
		return mems
	}

	primaryEntity := primaryQuestionEntity(query)
	eventTerm := primaryQuestionEventTerm(query, primaryEntity)
	shape := classifyGroundingAnswerShape(query)
	temporalQuery := isTemporalQuestion(query)
	eventStyleQuery := temporalQuery || shape == groundingAnswerShapeExact || shape == groundingAnswerShapeEntity

	type scoredMemory struct {
		mem   domain.Memory
		index int
		score float64
	}

	scored := make([]scoredMemory, 0, len(mems))
	for i, mem := range mems {
		score := -float64(i) * 0.01
		if mem.Score != nil {
			score += *mem.Score
		}

		lower := strings.ToLower(mem.Content)
		absoluteTime := containsAbsoluteTimeSignal(mem.Content)
		relativeTime := containsRelativeTimeSignal(lower)

		if temporalQuery {
			switch {
			case absoluteTime:
				score += 0.35
			case relativeTime:
				score += 0.20
			default:
				score -= 0.15
			}
		}

		if primaryEntity != "" && strings.Contains(lower, primaryEntity) {
			score += 0.25
		}
		if eventTerm != "" && strings.Contains(lower, eventTerm) {
			score += 0.15
		}

		if eventStyleQuery && !absoluteTime && !relativeTime && looksGenericFact(lower) {
			score -= 0.20
		}

		scored = append(scored, scoredMemory{
			mem:   mem,
			index: i,
			score: score,
		})
	}

	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score == scored[j].score {
			return scored[i].index < scored[j].index
		}
		return scored[i].score > scored[j].score
	})

	out := make([]domain.Memory, 0, len(mems))
	for _, item := range scored {
		out = append(out, item.mem)
	}
	return out
}

func rerankGroundedMemories(query string, mems []domain.Memory) []domain.Memory {
	shape := classifyGroundingAnswerShape(query)
	if shape == groundingAnswerShapeNone || len(mems) < 2 {
		return mems
	}

	window := len(mems)
	if window > 8 {
		window = 8
	}

	type scoredMemory struct {
		mem   domain.Memory
		index int
		score float64
	}

	scored := make([]scoredMemory, 0, window)
	for i, mem := range mems[:window] {
		scored = append(scored, scoredMemory{
			mem:   mem,
			index: i,
			score: groundedMemoryScore(shape, mem, i),
		})
	}

	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score == scored[j].score {
			return scored[i].index < scored[j].index
		}
		return scored[i].score > scored[j].score
	})

	out := make([]domain.Memory, 0, len(mems))
	for _, item := range scored {
		out = append(out, item.mem)
	}
	out = append(out, mems[window:]...)
	return out
}

func isTemporalQuestion(query string) bool {
	lower := strings.ToLower(strings.TrimSpace(query))
	return strings.HasPrefix(lower, "when ") ||
		strings.Contains(lower, "what date") ||
		strings.Contains(lower, "which year") ||
		strings.Contains(lower, "how long ago")
}

func containsAbsoluteTimeSignal(content string) bool {
	lower := strings.ToLower(content)
	return answerISODateRe.MatchString(content) ||
		answerYearRe.MatchString(content) ||
		containsMonthName(lower)
}

func containsRelativeTimeSignal(lower string) bool {
	relativeTerms := []string{
		"last week", "last weekend", "last month", "last year", "yesterday",
		"today", "tomorrow", "next month", "next week", "a few weeks ago",
		"the week before", "the month before", "prior to", "before ", "after ",
	}
	for _, term := range relativeTerms {
		if strings.Contains(lower, term) {
			return true
		}
	}
	return false
}

func primaryQuestionEntity(query string) string {
	for _, match := range answerTitleCaseRe.FindAllString(query, -1) {
		lower := strings.ToLower(match)
		switch lower {
		case "when", "what", "who", "where", "which", "how":
			continue
		}
		if containsMonthName(lower) {
			continue
		}
		return lower
	}
	for _, match := range answerAcronymRe.FindAllString(query, -1) {
		return strings.ToLower(match)
	}
	return ""
}

func primaryQuestionEventTerm(query string, entity string) string {
	stopwords := map[string]struct{}{
		"a": {}, "an": {}, "the": {}, "and": {}, "or": {}, "to": {}, "with": {}, "of": {}, "in": {}, "on": {},
		"for": {}, "from": {}, "at": {}, "by": {}, "did": {}, "does": {}, "do": {}, "is": {}, "was": {}, "were": {},
		"has": {}, "have": {}, "had": {}, "when": {}, "what": {}, "who": {}, "where": {}, "which": {}, "how": {},
		"long": {}, "ago": {}, "date": {}, "year": {}, "time": {}, "session": {},
	}
	entityWords := make(map[string]struct{})
	for _, word := range strings.Fields(entity) {
		entityWords[word] = struct{}{}
	}

	var best string
	for _, token := range strings.FieldsFunc(strings.ToLower(query), func(r rune) bool {
		return (r < 'a' || r > 'z') && (r < '0' || r > '9')
	}) {
		if len(token) < 3 {
			continue
		}
		if _, ok := stopwords[token]; ok {
			continue
		}
		if _, ok := entityWords[token]; ok {
			continue
		}
		if len(token) > len(best) {
			best = token
		}
	}
	return best
}

func looksGenericFact(lower string) bool {
	genericPatterns := []string{
		" is ", " is a ", " is an ", " has ", " likes ", " loves ", " enjoys ",
		" prefers ", " wants ", " plans ", " works ", " promotes ", " part of ",
		" interested in ", " passionate about ",
	}
	for _, pattern := range genericPatterns {
		if strings.Contains(lower, pattern) {
			return true
		}
	}
	return false
}

func classifyGroundingAnswerShape(query string) groundingAnswerShape {
	lower := strings.ToLower(strings.TrimSpace(query))
	switch {
	case strings.HasPrefix(lower, "how many"), strings.HasPrefix(lower, "how much"):
		return groundingAnswerShapeCount
	case strings.HasPrefix(lower, "who "), strings.HasPrefix(lower, "which "):
		return groundingAnswerShapeEntity
	case strings.HasPrefix(lower, "where "):
		return groundingAnswerShapeLocation
	case strings.HasPrefix(lower, "when "):
		return groundingAnswerShapeTime
	case strings.HasPrefix(lower, "what "):
		return groundingAnswerShapeExact
	default:
		return groundingAnswerShapeNone
	}
}

func groundedMemoryScore(shape groundingAnswerShape, mem domain.Memory, index int) float64 {
	score := -float64(index) * 0.08
	if mem.Score != nil {
		score += *mem.Score * 0.02
	}
	if mem.MemoryType == domain.TypeInsight {
		score += 0.03
	}
	score += groundedAnswerSignalBonus(shape, mem.Content)
	return score
}

func groundedAnswerSignalBonus(shape groundingAnswerShape, content string) float64 {
	lower := strings.ToLower(content)
	wordCount := len(strings.Fields(content))
	entitySignals := answerEntitySignalCount(content)

	bonus := 0.0
	if wordCount > 0 && wordCount <= 18 {
		bonus += 0.05
	}

	switch shape {
	case groundingAnswerShapeCount:
		if answerNumberRe.MatchString(content) {
			bonus += 0.45
		}
		if answerCountWordRe.MatchString(lower) {
			bonus += 0.20
		}
		if strings.Contains(content, ",") || strings.Contains(lower, " and ") {
			bonus += 0.10
		}
	case groundingAnswerShapeEntity:
		if entitySignals > 1 {
			bonus += 0.30
		}
		if answerQuotedRe.MatchString(content) || answerAcronymRe.MatchString(content) {
			bonus += 0.15
		}
	case groundingAnswerShapeLocation:
		if answerLocationCueRe.MatchString(content) {
			bonus += 0.25
		}
		if entitySignals > 1 {
			bonus += 0.20
		}
		if answerVaguePlaceRe.MatchString(lower) {
			bonus -= 0.20
		}
	case groundingAnswerShapeTime:
		if answerYearRe.MatchString(content) {
			bonus += 0.25
		}
		if containsMonthName(lower) {
			bonus += 0.20
		}
		if answerNumberRe.MatchString(content) {
			bonus += 0.10
		}
	case groundingAnswerShapeExact:
		if entitySignals > 1 {
			bonus += 0.25
		}
		if answerQuotedRe.MatchString(content) {
			bonus += 0.20
		}
		if answerAcronymRe.MatchString(content) {
			bonus += 0.15
		}
		if wordCount > 0 && wordCount <= 12 {
			bonus += 0.12
		}
	}

	return bonus
}

func answerEntitySignalCount(content string) int {
	signals := make(map[string]struct{})
	for _, match := range answerTitleCaseRe.FindAllString(content, -1) {
		signals[match] = struct{}{}
	}
	for _, match := range answerQuotedRe.FindAllString(content, -1) {
		signals[match] = struct{}{}
	}
	for _, match := range answerAcronymRe.FindAllString(content, -1) {
		signals[match] = struct{}{}
	}
	return len(signals)
}

func containsMonthName(lower string) bool {
	switch {
	case strings.Contains(lower, "january"), strings.Contains(lower, "february"), strings.Contains(lower, "march"):
		return true
	case strings.Contains(lower, "april"), strings.Contains(lower, "may "), strings.Contains(lower, "june"), strings.Contains(lower, "july"):
		return true
	case strings.Contains(lower, "august"), strings.Contains(lower, "september"), strings.Contains(lower, "october"):
		return true
	case strings.Contains(lower, "november"), strings.Contains(lower, "december"):
		return true
	default:
		return false
	}
}

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
		key := responseDedupKey(mem)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, mem)
	}
	return out
}

func responseDedupKey(mem domain.Memory) string {
	if mem.MemoryType == domain.TypeSession {
		if mem.ID != "" {
			return "session:" + mem.ID
		}
		if seq, ok := sessionMemorySeq(mem); ok && mem.SessionID != "" {
			return "session:" + mem.SessionID + ":" + strconv.Itoa(seq)
		}
		if mem.SessionID != "" && len(mem.Metadata) > 0 {
			return "session:" + mem.SessionID + "\x00" + string(mem.Metadata)
		}
	}
	if mem.Content != "" {
		return "content:" + mem.Content
	}
	return "id:" + mem.ID
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
