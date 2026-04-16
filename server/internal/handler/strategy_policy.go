package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/service"
)

var (
	strategyCountNumericRe     = regexp.MustCompile(`\b\d+\b`)
	strategyCountWordRe        = regexp.MustCompile(`(?i)\b(?:twice|three|four|five|six|seven|eight|nine|ten|several|couple|few|once)\b`)
	strategyCountBoundedListRe = regexp.MustCompile(`(?i)\b(?:and|,)\b`)
)

const (
	explicitSessionPrimaryCap = 12
	maxRoutingInsights        = 3
	maxSessionsPerInsight     = 3
	maxRoutedSessions         = 6
	maxNeighborSeedCount      = 2
	maxThreadChaseCandidates  = 6
	maxThreadChaseResults     = 2
	neighborSeedMinScore      = 0.35
	neighborBeforeWindow      = 1
	neighborAfterWindow       = 1
)

func (s *Server) detectRecallStrategies(
	ctx context.Context,
	auth *domain.AuthInfo,
	filter domain.MemoryFilter,
) (domain.RecallRouteDecision, error) {
	if s.strategyRouter == nil {
		return defaultFallback("router_not_configured"), nil
	}

	start := time.Now()
	decision, err := s.strategyRouter.Detect(ctx, service.StrategyRouterInput{
		Query:     filter.Query,
		SessionID: filter.SessionID,
		AgentID:   filter.AgentID,
	})
	duration := time.Since(start)
	metrics.StrategyRouterDuration.Observe(duration.Seconds())

	if err != nil {
		slog.Warn("strategy detection failed",
			"cluster_id", auth.ClusterID, "err", err, "duration_ms", duration.Milliseconds())
		return defaultFallback("detection_error"), nil
	}

	for _, st := range decision.Strategies {
		metrics.StrategyRouterChosenTotal.WithLabelValues(st.Name).Inc()
	}
	metrics.StrategyRouterSourceTotal.WithLabelValues(decision.ResolutionSource).Inc()
	metrics.StrategyRouterModeTotal.WithLabelValues(decision.ResolutionMode).Inc()
	if decision.FallbackCause != "" {
		metrics.StrategyRouterFallbackTotal.WithLabelValues(decision.FallbackCause).Inc()
	}

	slog.Info("strategy router decision",
		"cluster_id", auth.ClusterID,
		"strategies", formatStrategies(decision.Strategies),
		"resolution_source", decision.ResolutionSource,
		"resolution_mode", decision.ResolutionMode,
		"fallback_cause", decision.FallbackCause,
		"entity", decision.Entity,
		"answer_family", decision.AnswerFamily,
		"top_prototype_ids", decision.TopPrototypeIDs,
		"query_len", len(filter.Query),
		"session_id_present", filter.SessionID != "",
		"duration_ms", duration.Milliseconds(),
	)

	return decision, nil
}

func (s *Server) strategyConfidenceRecallSearch(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	decision domain.RecallRouteDecision,
) ([]domain.Memory, int, error) {
	if decision.IsFanout() {
		memories, total, err := s.strategyConfidenceRecallFanoutSearch(ctx, auth, svc, filter, decision)
		if err != nil {
			slog.Warn("routed fanout failed, falling back to default",
				"cluster_id", auth.ClusterID,
				"strategies", formatStrategies(decision.Strategies),
				"err", err)
			return s.strategyConfidenceFallbackSearch(ctx, auth, svc, filter)
		}
		if len(memories) == 0 {
			slog.Info("routed fanout returned zero rows, falling back to default",
				"cluster_id", auth.ClusterID,
				"strategies", formatStrategies(decision.Strategies))
			return s.strategyConfidenceFallbackSearch(ctx, auth, svc, filter)
		}
		return memories, total, nil
	}

	memories, _, err := s.strategyConfidenceRecallCandidates(ctx, auth, svc, filter, decision.PrimaryStrategy(), decision.Entity, decision.AnswerFamily)
	if err != nil {
		slog.Warn("routed strategy failed, falling back to default",
			"cluster_id", auth.ClusterID,
			"strategy", decision.PrimaryStrategy(),
			"err", err)
		return s.strategyConfidenceFallbackSearch(ctx, auth, svc, filter)
	}
	if len(memories) == 0 {
		slog.Info("routed strategy returned zero rows, falling back to default",
			"cluster_id", auth.ClusterID,
			"strategy", decision.PrimaryStrategy())
		return s.strategyConfidenceFallbackSearch(ctx, auth, svc, filter)
	}
	if filter.Offset == 0 && len(memories) <= filter.Limit {
		return memories, len(memories), nil
	}

	page, total, err := paginateFanout(memories, filter.Offset, filter.Limit)
	if err != nil {
		return nil, 0, err
	}
	return page, total, nil
}

func (s *Server) strategyConfidenceFallbackSearch(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
) ([]domain.Memory, int, error) {
	if filter.SessionID != "" && filter.MemoryType == "" {
		return s.explicitSessionSearch(ctx, auth, svc, filter, domain.StrategyDefaultMixed, "")
	}
	return s.executeDefaultMixedBase(ctx, auth, svc, filter)
}

func (s *Server) strategyConfidenceRecallCandidates(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	strategyName string,
	entity string,
	answerFamily string,
) ([]domain.Memory, int, error) {
	retrievalFilter := strategyRetrievalFilter(filter, strategyName, entity)
	memories, total, err := s.entityAwareSearchWindow(ctx, auth, svc, retrievalFilter, entity, strategyName, answerFamily)
	if err != nil {
		return nil, 0, err
	}
	memories = rerankByStrategy(strategyName, filter.RerankerQuery(), memories, entity, answerFamily)
	return memories, total, nil
}

func strategyRetrievalFilter(filter domain.MemoryFilter, strategyName, entity string) domain.MemoryFilter {
	entity = strings.TrimSpace(entity)
	if entity == "" || filter.Query == "" {
		return filter
	}

	switch strategyName {
	case domain.StrategyExactEventTemporal, domain.StrategySetAggregation, domain.StrategyCountQuery:
	default:
		return filter
	}

	raw := filter.RerankerQuery()
	if raw == "" {
		return filter
	}

	filter.RawQuery = raw
	filter.Query = strings.TrimSpace(entity + " " + raw)
	return filter
}

func (s *Server) strategyConfidenceRecallFanoutSearch(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	decision domain.RecallRouteDecision,
) ([]domain.Memory, int, error) {
	primary := decision.Strategies[0]
	secondary := decision.Strategies[1]

	branchFilter := filter
	branchFilter.Offset = 0
	branchLimit := filter.Limit + filter.Offset
	if branchLimit < filter.Limit {
		branchLimit = filter.Limit
	}
	branchFilter.Limit = branchLimit

	primaryMems, _, primaryErr := s.strategyConfidenceRecallCandidates(ctx, auth, svc, branchFilter, primary.Name, decision.Entity, decision.AnswerFamily)
	secondaryMems, _, secondaryErr := s.strategyConfidenceRecallCandidates(ctx, auth, svc, branchFilter, secondary.Name, decision.Entity, decision.AnswerFamily)
	if primaryErr != nil && secondaryErr != nil {
		return nil, 0, primaryErr
	}
	if primaryErr != nil {
		return paginateFanout(secondaryMems, filter.Offset, filter.Limit)
	}
	if secondaryErr != nil {
		return paginateFanout(primaryMems, filter.Offset, filter.Limit)
	}

	mergeLimit := branchLimit
	if mergeLimit < len(primaryMems)+len(secondaryMems) {
		mergeLimit = len(primaryMems) + len(secondaryMems)
	}
	merged := mergeFanoutResults(primaryMems, secondaryMems, primary.Name, secondary.Name, mergeLimit)
	if len(merged) == 0 {
		return nil, 0, nil
	}

	page, total, err := paginateFanout(merged, filter.Offset, filter.Limit)
	if err != nil {
		return nil, 0, err
	}
	return page, total, nil
}

func supportedStrategyOnMain(strategy string) bool {
	switch strategy {
	case domain.StrategyExactEventTemporal,
		domain.StrategySetAggregation,
		domain.StrategyCountQuery,
		domain.StrategyAttributeInference,
		domain.StrategyExactEntityLookup:
		return true
	default:
		return false
	}
}

func formatStrategies(strategies []domain.RoutedStrategy) string {
	if len(strategies) == 0 {
		return "[]"
	}
	parts := make([]string, 0, len(strategies))
	for _, s := range strategies {
		parts = append(parts, s.Name)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func paginateFanout(mems []domain.Memory, offset, limit int) ([]domain.Memory, int, error) {
	total := len(mems)
	if offset >= total {
		return []domain.Memory{}, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return mems[offset:end], total, nil
}

func strategyRecallBudget(limit int, strategy string) int {
	switch strategy {
	case domain.StrategyAttributeInference:
		if limit <= 0 {
			return limit
		}
		if limit < 20 {
			return limit + 2
		}
		return limit
	case domain.StrategySetAggregation:
		if limit <= 0 {
			return limit
		}
		return minInt(limit+4, 20)
	case domain.StrategyCountQuery:
		if limit <= 0 {
			return limit
		}
		return minInt(limit+2, 16)
	default:
		return limit
	}
}

func entityContextLimit(limit int, strategyName, answerFamily string) int {
	switch strategyName {
	case domain.StrategyAttributeInference:
		switch {
		case limit <= 2:
			return 2
		case limit <= 10:
			return 5
		default:
			return 8
		}
	case domain.StrategyExactEntityLookup:
		switch {
		case limit <= 2:
			return 2
		case limit <= 10:
			return 4
		default:
			return 6
		}
	case domain.StrategySetAggregation:
		switch {
		case limit <= 2:
			return 1
		case limit <= 10:
			return 3
		default:
			return 4
		}
	case domain.StrategyCountQuery:
		switch {
		case limit <= 2:
			return 1
		case limit <= 10:
			return 2
		default:
			return 3
		}
	default:
		return 0
	}
}

func entityInsightLimit(limit int, strategyName, answerFamily string) int {
	switch strategyName {
	case domain.StrategyAttributeInference:
		switch {
		case limit <= 2:
			return 1
		case limit <= 10:
			return 2
		default:
			return 4
		}
	case domain.StrategyExactEntityLookup:
		switch {
		case limit <= 2:
			return 1
		case limit <= 10:
			return 2
		default:
			return 3
		}
	case domain.StrategyExactEventTemporal, domain.StrategySetAggregation, domain.StrategyCountQuery:
		switch {
		case limit <= 2:
			return 1
		case limit <= 10:
			return 2
		default:
			return 3
		}
	default:
		return 0
	}
}

func buildEntityContextQuery(entity, answerFamily string) string {
	parts := []string{strings.TrimSpace(entity)}
	seen := map[string]struct{}{strings.TrimSpace(entity): {}}
	for _, term := range entityContextQueryTerms(answerFamily) {
		term = strings.TrimSpace(term)
		if term == "" {
			continue
		}
		if _, ok := seen[term]; ok {
			continue
		}
		seen[term] = struct{}{}
		parts = append(parts, term)
		if len(parts) >= 4 {
			break
		}
	}
	return strings.Join(parts, " ")
}

func buildExactEntityLookupQuery(entity, answerFamily string) string {
	parts := []string{strings.TrimSpace(entity)}
	seen := map[string]struct{}{strings.TrimSpace(entity): {}}
	for _, term := range exactEntityLookupQueryTerms(answerFamily) {
		term = strings.TrimSpace(term)
		if term == "" {
			continue
		}
		if _, ok := seen[term]; ok {
			continue
		}
		seen[term] = struct{}{}
		parts = append(parts, term)
		if len(parts) >= 5 {
			break
		}
	}
	return strings.Join(parts, " ")
}

func (s *Server) strategyEntityContextSearch(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	entity string,
	strategyName string,
	answerFamily string,
) ([]domain.Memory, error) {
	limit := entityContextLimit(filter.Limit, strategyName, answerFamily)
	if limit == 0 {
		return nil, nil
	}

	entityFilter := filter
	if strategyName == domain.StrategyExactEntityLookup {
		entityFilter.Query = buildExactEntityLookupQuery(entity, answerFamily)
	} else {
		entityFilter.Query = buildEntityContextQuery(entity, answerFamily)
	}
	entityFilter.Offset = 0
	entityFilter.Limit = limit

	if filter.SessionID != "" && filter.MemoryType == "" && svc.session != nil {
		results, err := svc.session.Search(ctx, entityFilter)
		if err != nil {
			return nil, err
		}
		return results, nil
	}
	results, _, err := svc.memory.Search(ctx, entityFilter)
	if err != nil {
		return nil, err
	}
	return results, nil
}

func (s *Server) strategyEntityInsightSearch(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	entity string,
	strategyName string,
	answerFamily string,
) ([]domain.Memory, error) {
	limit := entityInsightLimit(filter.Limit, strategyName, answerFamily)
	if limit == 0 {
		return nil, nil
	}

	insightFilter := filter
	insightFilter.Query = buildEntityContextQuery(entity, answerFamily)
	insightFilter.Offset = 0
	insightFilter.Limit = limit
	insightFilter.MemoryType = string(domain.TypeInsight)

	results, _, err := svc.memory.Search(ctx, insightFilter)
	if err != nil {
		return nil, err
	}
	return results, nil
}

func (s *Server) strategyLinkedSessionContext(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	primary []domain.Memory,
	filter domain.MemoryFilter,
	strategyName string,
) ([]domain.Memory, error) {
	if filter.SessionID != "" || svc.memory == nil || svc.session == nil {
		return nil, nil
	}
	routedSessionIDs, err := svc.memory.RoutedSessionIDs(ctx, primary, maxRoutingInsights, maxSessionsPerInsight, maxRoutedSessions)
	if err != nil || len(routedSessionIDs) == 0 {
		return nil, err
	}
	totalLimit := supplementalSessionLimit(filter.Limit) + 1
	if totalLimit < 2 {
		totalLimit = 2
	}
	return searchSessionGroundingInSet(ctx, svc, filter, routedSessionIDs, totalLimit)
}

func (s *Server) executeDefaultMixedBase(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
) ([]domain.Memory, int, error) {
	memories, total, err := svc.memory.Search(ctx, filter)
	if err != nil {
		return nil, 0, err
	}

	if filter.Query != "" && filter.MemoryType == "" {
		var (
			sessionMems  []domain.Memory
			useFallback  bool
			routedErr    error
			sessionBlend bool
		)

		sessionMems, useFallback, routedErr = s.provenanceSessionGroundingSearch(ctx, auth, svc, memories, filter)
		switch {
		case routedErr != nil && useFallback:
			useFallback = true
		case routedErr != nil:
			slog.Warn("routed session grounding failed in default_mixed", "cluster_id", auth.ClusterID, "err", routedErr)
		case len(sessionMems) > 0:
			sessionBlend = true
		}

		if useFallback {
			if fallbackMems, sessErr := s.sessionGroundingSearch(ctx, auth, svc, filter); sessErr == nil && len(fallbackMems) > 0 {
				sessionMems = fallbackMems
				sessionBlend = true
			}
		}

		if sessionBlend {
			memories = blendMemoriesWithSessionGrounding(memories, sessionMems, filter.Limit)
			memories = rerankGroundedMemories(filter.RerankerQuery(), memories)
			total = len(memories)
		}
	}

	return memories, total, nil
}

func (s *Server) entityAwareSearchWindow(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	entity string,
	strategyName string,
	answerFamily string,
) ([]domain.Memory, int, error) {
	var (
		memories []domain.Memory
		total    int
		err      error
	)

	workingFilter := filter
	if entity != "" && filter.Query != "" && filter.MemoryType == "" && filter.Offset > 0 {
		workingFilter.Offset = 0
		workingFilter.Limit = filter.Offset + filter.Limit
		if workingFilter.Limit < filter.Limit {
			workingFilter.Limit = filter.Limit
		}
	}

	if workingFilter.SessionID != "" && workingFilter.MemoryType == "" {
		memories, total, err = s.explicitSessionSearch(ctx, auth, svc, workingFilter, strategyName, answerFamily)
	} else {
		memories, total, err = s.executeDefaultMixedBase(ctx, auth, svc, workingFilter)
	}
	if err != nil {
		return nil, 0, err
	}

	if entity == "" || filter.Query == "" || filter.MemoryType != "" {
		return memories, total, nil
	}

	entityMems, err := s.strategyEntityContextSearch(ctx, auth, svc, workingFilter, entity, strategyName, answerFamily)
	if err != nil {
		slog.Warn("entity context search failed", "cluster_id", auth.ClusterID, "entity", entity, "err", err)
		return memories, total, nil
	}

	insightMems, err := s.strategyEntityInsightSearch(ctx, auth, svc, workingFilter, entity, strategyName, answerFamily)
	if err != nil {
		slog.Warn("entity insight search failed", "cluster_id", auth.ClusterID, "entity", entity, "err", err)
	}
	if len(entityMems) == 0 {
		if len(insightMems) == 0 {
			return memories, total, nil
		}
		return blendMemoriesWithEntityContext(memories, insightMems, workingFilter.Limit, strategyName, answerFamily), len(memories), nil
	}

	memories = blendMemoriesWithEntityContext(memories, entityMems, workingFilter.Limit, strategyName, answerFamily)
	if len(insightMems) > 0 {
		memories = blendMemoriesWithEntityContext(memories, insightMems, workingFilter.Limit, strategyName, answerFamily)
	}
	return memories, len(memories), nil
}

func (s *Server) explicitSessionSearch(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	strategyName string,
	answerFamily string,
) ([]domain.Memory, int, error) {
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
			sessionMems = rerankExplicitSessionMemories(filter.RerankerQuery(), sessionMems)
			if explicitSessionThreadChaseEnabled(strategyName, answerFamily) {
				chased, err := s.chaseQuestionAnswerTurns(ctx, auth, svc, sessionMems, strategyName, maxThreadChaseCandidates, maxThreadChaseResults)
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

func blendMemoriesWithEntityContext(primary, supplemental []domain.Memory, limit int, strategyName, answerFamily string) []domain.Memory {
	if limit <= 0 {
		return []domain.Memory{}
	}
	if len(primary) == 0 {
		return trimUniqueMemories(supplemental, limit)
	}
	if len(supplemental) == 0 {
		return trimUniqueMemories(primary, limit)
	}

	entitySlots := entityContextLimit(limit, strategyName, answerFamily)
	if entitySlots == 0 {
		entitySlots = minInt(len(supplemental), 2)
	}
	if entitySlots > len(supplemental) {
		entitySlots = len(supplemental)
	}
	primaryBudget := limit - entitySlots
	if primaryBudget < 0 {
		primaryBudget = 0
	}

	blended := make([]domain.Memory, 0, limit)
	seen := make(map[string]struct{}, limit)

	appendUnique := func(mem domain.Memory) {
		key := mem.Content
		if key == "" {
			key = mem.ID
		}
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

type sessionSeed struct {
	mem domain.Memory
	seq int
}

func searchSessionGroundingInSet(
	ctx context.Context,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	sessionIDs []string,
	totalLimit int,
) ([]domain.Memory, error) {
	if svc.session == nil || totalLimit <= 0 || len(sessionIDs) == 0 {
		return nil, nil
	}

	sessionFilter := filter
	sessionFilter.Offset = 0
	sessionFilter.Limit = totalLimit
	rows, err := svc.session.SearchInSessionSet(ctx, sessionFilter, sessionIDs)
	if err != nil {
		return nil, err
	}
	return trimUniqueMemories(rows, totalLimit), nil
}

func (s *Server) sessionGroundingSearch(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
) ([]domain.Memory, error) {
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

func (s *Server) provenanceSessionGroundingSearch(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	primary []domain.Memory,
	filter domain.MemoryFilter,
) ([]domain.Memory, bool, error) {
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
	if filter.SessionID != "" {
		filtered := make([]string, 0, 1)
		for _, sessionID := range routedSessionIDs {
			if sessionID == filter.SessionID {
				filtered = append(filtered, sessionID)
				break
			}
		}
		routedSessionIDs = filtered
	}
	if len(routedSessionIDs) == 0 {
		return nil, true, nil
	}

	sessionMems, err := searchSessionGroundingInSet(ctx, svc, filter, routedSessionIDs, sessionBudget)
	if err != nil {
		return nil, false, err
	}
	if len(sessionMems) == 0 {
		return nil, false, nil
	}

	neighbors, err := s.expandSessionNeighbors(ctx, auth, svc, sessionMems, sessionBudget, neighborBeforeWindow, neighborAfterWindow)
	if err != nil {
		slog.Warn("session neighbor expansion failed; keeping routed seeds only", "cluster_id", auth.ClusterID, "err", err)
	} else if len(neighbors) > 0 {
		sessionMems = selectSessionContextResults(sessionMems, neighbors, sessionBudget)
	}

	slog.Info("routed session grounding search",
		"cluster_id", auth.ClusterID,
		"query_len", len(filter.Query),
		"sessions", len(routedSessionIDs),
		"results", len(sessionMems),
	)
	return sessionMems, false, nil
}

func (s *Server) expandSessionNeighbors(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	sessionMems []domain.Memory,
	sessionBudget int,
	beforeWindow int,
	afterWindow int,
) ([]domain.Memory, error) {
	seeds := selectSessionSeeds(sessionMems, maxNeighborSeedCount, neighborSeedMinScore)
	if len(seeds) == 0 || sessionBudget < 2 || svc.session == nil {
		return nil, nil
	}

	neighbors := make([]domain.Memory, 0, len(seeds)*2)
	seen := make(map[string]struct{}, len(sessionMems))
	for _, mem := range sessionMems {
		seen[responseDedupKey(mem)] = struct{}{}
	}

	for _, seed := range seeds {
		rows, err := svc.session.ListNeighbors(ctx, seed.mem.SessionID, seed.seq, beforeWindow, afterWindow)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			if _, ok := seen[responseDedupKey(row)]; ok {
				continue
			}
			seq, ok := sessionMemorySeq(row)
			if !ok {
				continue
			}
			seen[responseDedupKey(row)] = struct{}{}
			neighbors = append(neighbors, annotateNeighborMemory(row, seq, seed))
		}
	}

	if len(neighbors) > 0 {
		slog.Info("session neighbor expansion", "cluster_id", auth.ClusterID, "seeds", len(seeds), "neighbors", len(neighbors))
	}
	return neighbors, nil
}

func explicitSessionNeighborWindow(strategyName string, answerFamily string) (int, int, bool) {
	switch strategyName {
	case domain.StrategyExactEventTemporal:
		return neighborBeforeWindow, neighborAfterWindow, true
	case domain.StrategyAttributeInference:
		return 2, 2, true
	case domain.StrategyExactEntityLookup:
		return 1, 1, true
	default:
		return 0, 0, false
	}
}

func explicitSessionThreadChaseEnabled(strategyName string, answerFamily string) bool {
	switch strategyName {
	case domain.StrategyAttributeInference, domain.StrategyExactEntityLookup:
		return true
	default:
		return false
	}
}

func (s *Server) chaseQuestionAnswerTurns(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	sessionMems []domain.Memory,
	strategyName string,
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
		slog.Info("explicit-session thread chase", "cluster_id", auth.ClusterID, "strategy", strategyName, "candidates", len(candidates), "chased", len(chased))
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
	if len(chased) == 0 {
		return mergeExplicitSessionResults(sessionPrimary, insightSupport, limit)
	}
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
			break
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

	return selected
}

type sessionMemoryMeta struct {
	Role        string `json:"role,omitempty"`
	Seq         int    `json:"seq"`
	ContentType string `json:"content_type,omitempty"`
	Neighbor    bool   `json:"neighbor,omitempty"`
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

func rerankExplicitSessionMemories(query string, mems []domain.Memory) []domain.Memory {
	if len(mems) < 2 {
		return mems
	}

	primaryEntity := primaryQuestionEntity(query)
	eventTerm := primaryQuestionEventTerm(query, primaryEntity)
	shape := classifyRecallQueryShape(query)
	temporalQuery := shape == recallQueryShapeTime
	eventStyleQuery := temporalQuery || shape == recallQueryShapeExact || shape == recallQueryShapeEntity

	type scoredMemory struct {
		mem   domain.Memory
		index int
		score float64
	}

	scored := make([]scoredMemory, 0, len(mems))
	for i, mem := range mems {
		content, _, _ := recallContentForScoring(mem)
		lower := strings.ToLower(content)
		score := -float64(i) * 0.01
		if mem.Score != nil {
			score += *mem.Score
		}

		absoluteTime := containsAbsoluteTimeSignal(content)
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

		scored = append(scored, scoredMemory{mem: mem, index: i, score: score})
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

type groundingAnswerShape int

const (
	groundingAnswerShapeNone groundingAnswerShape = iota
	groundingAnswerShapeCount
	groundingAnswerShapeEntity
	groundingAnswerShapeLocation
	groundingAnswerShapeTime
	groundingAnswerShapeExact
)

func classifyGroundingAnswerShape(query string) groundingAnswerShape {
	switch classifyRecallQueryShape(query) {
	case recallQueryShapeCount:
		return groundingAnswerShapeCount
	case recallQueryShapeEntity:
		return groundingAnswerShapeEntity
	case recallQueryShapeLocation:
		return groundingAnswerShapeLocation
	case recallQueryShapeTime:
		return groundingAnswerShapeTime
	case recallQueryShapeExact:
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
	content, _, _ := recallContentForScoring(mem)
	score += groundedAnswerSignalBonus(shape, content)
	return score
}

func rerankByStrategy(strategyName, query string, mems []domain.Memory, entity, answerFamily string) []domain.Memory {
	switch strategyName {
	case domain.StrategySetAggregation:
		return rerankForSetAggregation(query, mems, entity, answerFamily)
	case domain.StrategyCountQuery:
		return rerankForCountQuery(query, mems, entity)
	case domain.StrategyExactEventTemporal:
		return rerankForExactEventTemporal(query, mems, entity)
	case domain.StrategyAttributeInference:
		return rerankForAttributeInference(query, mems, entity, answerFamily)
	case domain.StrategyExactEntityLookup:
		return rerankForExactAnswerFamily(query, mems, entity, answerFamily)
	default:
		return mems
	}
}

func rerankForSetAggregation(query string, mems []domain.Memory, entity, answerFamily string) []domain.Memory {
	if len(mems) < 2 {
		return mems
	}

	entityLower := strings.ToLower(entity)
	familyTerms := answerFamilyKeywords(answerFamily)

	type scored struct {
		mem   domain.Memory
		index int
		score float64
	}

	items := make([]scored, 0, len(mems))
	for i, mem := range mems {
		score := -float64(i) * 0.01
		if mem.Score != nil {
			score += *mem.Score
		}

		content, _, _ := recallContentForScoring(mem)
		lower := strings.ToLower(content)

		if entityLower != "" && strings.Contains(lower, entityLower) {
			score += 0.35
		}
		for _, term := range familyTerms {
			if strings.Contains(lower, term) {
				score += 0.30
				break
			}
		}
		if looksConcreteItem(lower) {
			score += 0.20
		}
		if entityLower != "" && strings.Contains(lower, entityLower) && looksGenericFact(lower) {
			score -= 0.25
		}
		items = append(items, scored{mem: mem, index: i, score: score})
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].score == items[j].score {
			return items[i].index < items[j].index
		}
		return items[i].score > items[j].score
	})

	out := make([]domain.Memory, 0, len(mems))
	for _, item := range items {
		out = append(out, item.mem)
	}
	return out
}

func rerankForCountQuery(query string, mems []domain.Memory, entity string) []domain.Memory {
	if len(mems) < 2 {
		return mems
	}

	entityLower := strings.ToLower(entity)
	queryLower := strings.ToLower(query)
	hasTimeBound := containsTimeBound(queryLower)

	type scored struct {
		mem   domain.Memory
		index int
		score float64
	}

	items := make([]scored, 0, len(mems))
	for i, mem := range mems {
		score := -float64(i) * 0.01
		if mem.Score != nil {
			score += *mem.Score
		}

		content, _, _ := recallContentForScoring(mem)
		lower := strings.ToLower(content)

		if strategyCountNumericRe.MatchString(content) || answerCNCountRe.MatchString(content) {
			score += 0.35
		}
		if strategyCountWordRe.MatchString(lower) || answerCountWordRe.MatchString(lower) || answerCNCountWordRe.MatchString(content) {
			score += 0.20
		}
		if strategyCountBoundedListRe.MatchString(lower) || answerCNListCueRe.MatchString(content) {
			score += 0.10
		}
		if hasTimeBound && (containsAbsoluteTimeSignal(content) || containsRelativeTimeSignal(lower)) {
			score += 0.15
		}
		if entityLower != "" && strings.Contains(lower, entityLower) && looksGenericFact(lower) {
			score -= 0.20
		}
		items = append(items, scored{mem: mem, index: i, score: score})
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].score == items[j].score {
			return items[i].index < items[j].index
		}
		return items[i].score > items[j].score
	})

	out := make([]domain.Memory, 0, len(mems))
	for _, item := range items {
		out = append(out, item.mem)
	}
	return out
}

func rerankForExactEventTemporal(query string, mems []domain.Memory, entity string) []domain.Memory {
	if len(mems) < 2 {
		return mems
	}

	entityLower := strings.ToLower(entity)
	profile := buildRecallQueryProfile(query)
	eventTerm := primaryQuestionEventTerm(query, entityLower)

	type scored struct {
		mem   domain.Memory
		index int
		score float64
	}

	items := make([]scored, 0, len(mems))
	for i, mem := range mems {
		score := -float64(i) * 0.01
		if mem.Score != nil {
			score += *mem.Score
		}
		content, temporalDisplay, temporalKind := recallContentForScoring(mem)
		lower := strings.ToLower(content)

		if entityLower != "" {
			if strings.Contains(lower, entityLower) {
				score += 0.20
			} else {
				score -= 0.10
			}
		}
		if eventTerm != "" && strings.Contains(lower, eventTerm) {
			score += 0.15
		}
		score += timeAnswerEvidenceBonus(profile, content, temporalDisplay, temporalKind)
		if strings.Contains(content, "?") {
			score -= 0.12
		}
		items = append(items, scored{mem: mem, index: i, score: score})
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].score == items[j].score {
			return items[i].index < items[j].index
		}
		return items[i].score > items[j].score
	})

	out := make([]domain.Memory, 0, len(mems))
	for _, item := range items {
		out = append(out, item.mem)
	}
	return out
}

func rerankForAttributeInference(query string, mems []domain.Memory, entity, answerFamily string) []domain.Memory {
	if len(mems) < 2 {
		return mems
	}

	entityLower := strings.ToLower(entity)
	queryLower := strings.ToLower(query)
	hasTimeBound := containsTimeBound(queryLower) || classifyRecallQueryShape(query) == recallQueryShapeTime
	familyTerms := answerFamilyKeywords(answerFamily)

	type scored struct {
		mem   domain.Memory
		index int
		score float64
	}

	items := make([]scored, 0, len(mems))
	for i, mem := range mems {
		score := -float64(i) * 0.01
		if mem.Score != nil {
			score += *mem.Score
		}

		content, _, _ := recallContentForScoring(mem)
		lower := strings.ToLower(content)
		wordCount := len(strings.Fields(content))
		entitySignals := recallEntitySignalCount(content)

		if entityLower != "" {
			if strings.Contains(lower, entityLower) {
				score += 0.30
			} else {
				score -= 0.12
			}
		}
		if wordCount >= 8 && wordCount <= 28 {
			score += 0.12
		} else if wordCount < 8 {
			score -= 0.08
		}
		if entitySignals > 1 {
			score += 0.16
		}
		if hasTimeBound && (containsAbsoluteTimeSignal(content) || containsRelativeTimeSignal(lower)) {
			score += 0.08
		}
		if strings.Contains(content, "?") {
			score -= 0.15
		}
		if !looksGenericFact(lower) && entitySignals <= 1 {
			score -= 0.12
		}
		if looksGenericFact(lower) {
			score += 0.05
		}
		for _, term := range familyTerms {
			if strings.Contains(lower, term) {
				score += 0.10
				break
			}
		}

		items = append(items, scored{mem: mem, index: i, score: score})
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].score == items[j].score {
			return items[i].index < items[j].index
		}
		return items[i].score > items[j].score
	})

	out := make([]domain.Memory, 0, len(mems))
	for _, item := range items {
		out = append(out, item.mem)
	}
	return out
}

func rerankForExactAnswerFamily(query string, mems []domain.Memory, entity, answerFamily string) []domain.Memory {
	if len(mems) < 2 {
		return mems
	}

	entityLower := strings.ToLower(entity)
	shape := exactAnswerFamilyShape(answerFamily)

	type scored struct {
		mem   domain.Memory
		index int
		score float64
	}

	items := make([]scored, 0, len(mems))
	for i, mem := range mems {
		score := -float64(i) * 0.01
		if mem.Score != nil {
			score += *mem.Score
		}

		content, _, _ := recallContentForScoring(mem)
		lower := strings.ToLower(content)
		wordCount := len(strings.Fields(content))
		entitySignals := answerEntitySignalCount(content)

		if entityLower != "" {
			if strings.Contains(lower, entityLower) {
				score += 0.25
			} else {
				score -= 0.10
			}
		}
		if wordCount > 0 && wordCount <= 12 {
			score += 0.12
		}
		if strings.Contains(content, "?") {
			score -= 0.15
		}
		if looksGenericFact(lower) && entitySignals == 0 {
			score -= 0.10
		}
		score += groundedAnswerSignalBonus(shape, content)

		items = append(items, scored{mem: mem, index: i, score: score})
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].score == items[j].score {
			return items[i].index < items[j].index
		}
		return items[i].score > items[j].score
	})

	out := make([]domain.Memory, 0, len(mems))
	for _, item := range items {
		out = append(out, item.mem)
	}
	return out
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

func containsAbsoluteTimeSignal(content string) bool {
	lower := strings.ToLower(content)
	return answerISODateRe.MatchString(content) ||
		answerYearRe.MatchString(content) ||
		containsMonthName(lower) ||
		answerCNTimeRe.MatchString(content)
}

func containsRelativeTimeSignal(lower string) bool {
	return answerRelativeTimeRe.MatchString(lower) || answerCNRelativeTimeRe.MatchString(lower)
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

func answerFamilyKeywords(family string) []string {
	switch strings.ToLower(strings.TrimSpace(family)) {
	case "events":
		return []string{"attended", "joined", "participated", "event", "parade", "group", "conference"}
	case "books":
		return []string{"book", "read", "novel", "title"}
	case "game", "games":
		return []string{"game", "gaming", "played", "tournament", "console"}
	case "pets":
		return []string{"dog", "cat", "pet", "guinea pig", "named"}
	case "activities":
		return []string{"painting", "camping", "swimming", "cooking", "hiking"}
	case "people":
		return []string{"helped", "met", "worked with", "friend", "child"}
	case "types":
		return []string{"type", "kind", "variety"}
	case "places":
		return []string{"city", "town", "country", "visited", "traveled"}
	case "items":
		return []string{"symbol", "item", "object"}
	case "counts":
		return []string{"times", "many", "count"}
	case "education":
		return []string{"degree", "college", "school", "study", "major"}
	case "career":
		return []string{"job", "career", "work", "profession", "counseling", "counselor"}
	case "traits", "personality_traits":
		return []string{"kind", "thoughtful", "driven", "authentic", "passionate", "personality"}
	case "boolean":
		return []string{"yes", "no", "likely", "would", "might"}
	case "preferences":
		return []string{"likes", "preferences", "favorite"}
	case "political_leaning":
		return []string{"politics", "policy", "rights"}
	case "religion":
		return []string{"faith", "religion", "belief"}
	case "ally_status":
		return []string{"support", "ally", "community"}
	default:
		return nil
	}
}

func entityContextQueryTerms(answerFamily string) []string {
	switch strings.ToLower(strings.TrimSpace(answerFamily)) {
	case "events":
		return []string{"attended", "joined", "participated", "event"}
	case "books":
		return []string{"book", "read", "novel"}
	case "pets":
		return []string{"pet", "dog", "cat", "named"}
	case "activities":
		return []string{"activities", "hiking", "camping", "swimming"}
	case "people":
		return []string{"helped", "met", "worked with", "friend"}
	case "types":
		return []string{"type", "kind", "variety"}
	case "places":
		return []string{"city", "town", "country", "visited"}
	case "items":
		return []string{"item", "object", "symbol"}
	case "counts":
		return []string{"times", "many", "count"}
	case "education":
		return []string{"degree", "school", "study"}
	case "career":
		return []string{"career", "job", "work"}
	case "traits", "personality_traits":
		return []string{"personality", "character", "traits"}
	case "preferences":
		return []string{"likes", "preferences", "favorite"}
	case "political_leaning":
		return []string{"politics", "policy", "rights"}
	case "religion":
		return []string{"faith", "religion", "belief"}
	case "ally_status":
		return []string{"support", "ally", "community"}
	case "country", "countries", "state", "states", "city", "cities", "location", "locations":
		return []string{"travel", "visited", "trip"}
	case "game", "games", "card_game", "card_games":
		return []string{"game", "gaming", "played", "tournament"}
	case "title", "titles", "name", "names", "object", "objects":
		return []string{"favorite", "called", "named"}
	case "console", "consoles":
		return []string{"console", "gaming", "system"}
	case "nickname", "nicknames":
		return []string{"nickname", "called", "name"}
	case "national_park", "national_parks":
		return []string{"park", "national", "outdoors"}
	case "technique", "techniques":
		return []string{"technique", "method", "practice"}
	case "composer", "composers":
		return []string{"music", "composer", "theme"}
	default:
		return nil
	}
}

func exactEntityLookupQueryTerms(answerFamily string) []string {
	switch strings.ToLower(strings.TrimSpace(answerFamily)) {
	case "country", "countries", "state", "states", "city", "cities", "location", "locations":
		return []string{"visited", "trip", "travel", "from"}
	case "game", "games", "card_game", "card_games":
		return []string{"called", "named", "favorite", "played"}
	case "title", "titles", "name", "names", "object", "objects", "item", "items":
		return []string{"called", "named", "favorite"}
	case "company", "companies":
		return []string{"works", "employer", "brand", "likes"}
	case "book", "books":
		return []string{"read", "reading", "book"}
	case "instrument", "instruments":
		return []string{"plays", "playing", "instrument"}
	case "composer", "composers":
		return []string{"music", "composer", "theme", "played"}
	case "console", "consoles":
		return []string{"console", "gaming", "system", "played"}
	case "nickname", "nicknames":
		return []string{"nickname", "called", "calls", "named"}
	case "national_park", "national_parks":
		return []string{"park", "national", "visited", "outdoors"}
	case "technique", "techniques":
		return []string{"technique", "method", "practice", "routine"}
	case "pet", "pets":
		return []string{"pet", "dog", "cat", "named"}
	default:
		return entityContextQueryTerms(answerFamily)
	}
}

func containsTimeBound(queryLower string) bool {
	return strings.Contains(queryLower, " in 20") ||
		strings.Contains(queryLower, " during ") ||
		strings.Contains(queryLower, " between ") ||
		strings.Contains(queryLower, " since ") ||
		strings.Contains(queryLower, " last ")
}

func looksConcreteItem(lower string) bool {
	concreteSignals := []string{
		"attended ", "joined ", "went to ", "participated in ",
		"visited ", "signed up ", "read ", "made ", "created ",
		"named ", "called ",
	}
	for _, sig := range concreteSignals {
		if strings.Contains(lower, sig) {
			return true
		}
	}
	return false
}

func defaultFallback(cause string) domain.RecallRouteDecision {
	return domain.RecallRouteDecision{
		Strategies: []domain.RoutedStrategy{
			{Name: domain.StrategyDefaultMixed, Confidence: 1.0},
		},
		ResolutionSource: domain.ResolutionSourceFallback,
		ResolutionMode:   domain.ResolutionModeFallback,
		FallbackCause:    cause,
	}
}

func mergeFanoutResults(
	primary []domain.Memory,
	secondary []domain.Memory,
	primaryStrategy string,
	secondaryStrategy string,
	limit int,
) []domain.Memory {
	if limit <= 0 {
		return nil
	}

	primaryBudget := int(math.Ceil(float64(limit) * 0.6))
	secondaryBudget := limit - primaryBudget

	merged := make([]domain.Memory, 0, limit)
	seen := make(map[string]struct{}, limit)

	appendUnique := func(mem domain.Memory) bool {
		key := mem.Content
		if key == "" {
			key = mem.ID
		}
		if _, ok := seen[key]; ok {
			return false
		}
		seen[key] = struct{}{}
		merged = append(merged, mem)
		return true
	}

	primaryUsed := 0
	for _, mem := range primary {
		if primaryUsed >= primaryBudget || len(merged) >= limit {
			break
		}
		if appendUnique(mem) {
			primaryUsed++
		}
	}

	secondaryUsed := 0
	for _, mem := range secondary {
		if secondaryUsed >= secondaryBudget || len(merged) >= limit {
			break
		}
		if appendUnique(mem) {
			secondaryUsed++
		}
	}

	for _, mem := range secondary {
		if len(merged) >= limit {
			break
		}
		appendUnique(mem)
	}
	for _, mem := range primary {
		if len(merged) >= limit {
			break
		}
		appendUnique(mem)
	}

	return merged
}

func exactAnswerFamilyShape(answerFamily string) groundingAnswerShape {
	switch strings.ToLower(strings.TrimSpace(answerFamily)) {
	case "location", "locations", "country", "countries", "state", "states", "city", "cities":
		return groundingAnswerShapeLocation
	case "date", "dates", "time", "timestamp", "start_date", "birthday":
		return groundingAnswerShapeTime
	default:
		return groundingAnswerShapeExact
	}
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
		if strategyCountNumericRe.MatchString(content) || answerCNCountRe.MatchString(content) {
			bonus += 0.40
		}
		if strategyCountWordRe.MatchString(lower) || answerCountWordRe.MatchString(lower) || answerCNCountWordRe.MatchString(content) {
			bonus += 0.18
		}
		if strategyCountBoundedListRe.MatchString(lower) || answerCNListCueRe.MatchString(content) {
			bonus += 0.08
		}
	case groundingAnswerShapeEntity:
		if entitySignals > 1 {
			bonus += 0.30
		}
		if answerQuotedOrCJKQuotedRe.MatchString(content) || answerAcronymRe.MatchString(content) {
			bonus += 0.15
		}
	case groundingAnswerShapeLocation:
		if answerLocationCueRe.MatchString(content) || answerCNLocationSuffixRe.MatchString(content) || answerCNLocationVerbRe.MatchString(content) || answerCNLocationDirectRe.MatchString(content) {
			bonus += 0.25
		}
		if entitySignals > 1 {
			bonus += 0.20
		}
		if answerVaguePlaceRe.MatchString(lower) {
			bonus -= 0.20
		}
	case groundingAnswerShapeTime:
		if containsAbsoluteTimeSignal(content) {
			bonus += 0.25
		}
		if answerNumberRe.MatchString(content) {
			bonus += 0.10
		}
		if containsRelativeTimeSignal(lower) {
			bonus += 0.15
		}
	case groundingAnswerShapeExact:
		if entitySignals > 1 {
			bonus += 0.25
		}
		if answerQuotedOrCJKQuotedRe.MatchString(content) || answerAcronymRe.MatchString(content) {
			bonus += 0.20
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
	for _, match := range answerQuotedOrCJKQuotedRe.FindAllString(content, -1) {
		signals[match] = struct{}{}
	}
	for _, match := range answerAcronymRe.FindAllString(content, -1) {
		signals[match] = struct{}{}
	}
	return len(signals)
}
