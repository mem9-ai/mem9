package handler

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/service"
)

var countNumericRe = regexp.MustCompile(`\b\d+\b`)
var countWordRe = regexp.MustCompile(`(?i)\b(?:twice|three|four|five|six|seven|eight|nine|ten|several|couple|few|once)\b`)
var countBoundedListRe = regexp.MustCompile(`(?i)\b(?:and|,)\b`)

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

func (s *Server) executeWithFallback(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	decision domain.RecallRouteDecision,
) ([]domain.Memory, int, error) {
	if decision.IsDefault() {
		return s.executeDefaultMixedWithHints(ctx, auth, svc, filter, decision.Entity, decision.AnswerFamily)
	}

	if decision.IsFanout() {
		metrics.StrategyRouterFanoutTotal.Inc()
		primary := decision.Strategies[0]
		secondary := decision.Strategies[1]

		branchFilter := filter
		branchFilter.Offset = 0
		branchLimit := filter.Limit + filter.Offset
		if branchLimit < filter.Limit {
			branchLimit = filter.Limit
		}
		branchFilter.Limit = branchLimit

		primaryMems, _, primaryErr := s.executeRoutedStrategy(ctx, auth, svc, branchFilter, primary, decision.Entity, decision.AnswerFamily)
		secondaryMems, _, secondaryErr := s.executeRoutedStrategy(ctx, auth, svc, branchFilter, secondary, decision.Entity, decision.AnswerFamily)

		if primaryErr != nil && secondaryErr != nil {
			slog.Warn("fanout both branches failed, falling back to default",
				"cluster_id", auth.ClusterID,
				"primary_err", primaryErr, "secondary_err", secondaryErr)
			return s.executeDefaultMixedWithHints(ctx, auth, svc, filter, decision.Entity, decision.AnswerFamily)
		}

		if primaryErr != nil {
			slog.Warn("fanout primary failed, using secondary only",
				"cluster_id", auth.ClusterID, "primary_err", primaryErr)
			if len(secondaryMems) == 0 {
				return s.executeDefaultMixedWithHints(ctx, auth, svc, filter, decision.Entity, decision.AnswerFamily)
			}
			return paginateFanout(secondaryMems, filter.Offset, filter.Limit)
		}
		if secondaryErr != nil {
			slog.Warn("fanout secondary failed, using primary only",
				"cluster_id", auth.ClusterID, "secondary_err", secondaryErr)
			if len(primaryMems) == 0 {
				return s.executeDefaultMixedWithHints(ctx, auth, svc, filter, decision.Entity, decision.AnswerFamily)
			}
			return paginateFanout(primaryMems, filter.Offset, filter.Limit)
		}

		mergeLimit := branchLimit
		if mergeLimit < len(primaryMems)+len(secondaryMems) {
			mergeLimit = len(primaryMems) + len(secondaryMems)
		}
		merged := mergeFanoutResults(primaryMems, secondaryMems, primary.Name, secondary.Name, mergeLimit)
		if len(merged) == 0 {
			return s.executeDefaultMixedWithHints(ctx, auth, svc, filter, decision.Entity, decision.AnswerFamily)
		}
		return paginateFanout(merged, filter.Offset, filter.Limit)
	}

	primary := decision.Strategies[0]
	mems, total, err := s.executeRoutedStrategy(ctx, auth, svc, filter, primary, decision.Entity, decision.AnswerFamily)
	if err != nil {
		slog.Warn("routed strategy failed, falling back to default",
			"cluster_id", auth.ClusterID, "strategy", primary.Name, "err", err)
		return s.executeDefaultMixedWithHints(ctx, auth, svc, filter, decision.Entity, decision.AnswerFamily)
	}
	if len(mems) == 0 {
		slog.Info("routed strategy returned zero rows, falling back to default",
			"cluster_id", auth.ClusterID, "strategy", primary.Name)
		return s.executeDefaultMixedWithHints(ctx, auth, svc, filter, decision.Entity, decision.AnswerFamily)
	}
	return mems, total, nil
}

func (s *Server) executeRoutedStrategy(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	strategy domain.RoutedStrategy,
	entity string,
	answerFamily string,
) ([]domain.Memory, int, error) {
	switch strategy.Name {
	case domain.StrategyExactEventTemporal:
		return s.executeExactEventTemporal(ctx, auth, svc, filter, entity)
	case domain.StrategySetAggregation:
		return s.executeSetAggregation(ctx, auth, svc, filter, entity, answerFamily)
	case domain.StrategyCountQuery:
		return s.executeCountQuery(ctx, auth, svc, filter, entity, answerFamily)
	case domain.StrategyAttributeInference:
		return s.executeAttributeInference(ctx, auth, svc, filter, entity, answerFamily)
	case domain.StrategyDefaultMixed:
		return s.executeDefaultMixedWithHints(ctx, auth, svc, filter, entity, answerFamily)
	default:
		return s.executeDefaultMixed(ctx, auth, svc, filter)
	}
}

func (s *Server) executeDefaultMixed(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
) ([]domain.Memory, int, error) {
	return s.executeDefaultMixedWithHints(ctx, auth, svc, filter, "", "")
}

func (s *Server) executeDefaultMixedWithHints(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	entity string,
	answerFamily string,
) ([]domain.Memory, int, error) {
	memories, total, err := s.entityAwareSearchWindow(ctx, auth, svc, filter, entity, domain.StrategyDefaultMixed, answerFamily)
	if err != nil {
		return nil, 0, err
	}
	if entity == "" || filter.Query == "" || filter.MemoryType != "" {
		return memories, total, nil
	}
	if isExactAnswerFamily(answerFamily) {
		memories = rerankForExactAnswerFamily(filter.Query, memories, entity, answerFamily)
	}
	return paginateFanout(memories, filter.Offset, filter.Limit)
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
			memories = rerankGroundedMemories(filter.Query, memories)
			total = len(memories)
		}
	}

	return memories, total, nil
}

func (s *Server) entityContextSearch(
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
	entityFilter.Query = buildEntityContextQuery(entity, answerFamily)
	entityFilter.Offset = 0
	entityFilter.Limit = limit

	if filter.SessionID != "" && filter.MemoryType == "" && svc.session != nil {
		results, err := svc.session.Search(ctx, entityFilter)
		if err != nil {
			return nil, err
		}
		return results, nil
	}

	if svc.memory == nil {
		return nil, nil
	}
	results, _, err := svc.memory.Search(ctx, entityFilter)
	if err != nil {
		return nil, err
	}
	slog.Info("entity context search", "cluster_id", auth.ClusterID, "entity", entity, "results", len(results))
	return results, nil
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

	entityMems, err := s.entityContextSearch(ctx, auth, svc, workingFilter, entity, strategyName, answerFamily)
	if err != nil {
		slog.Warn("entity context search failed in default_mixed", "cluster_id", auth.ClusterID, "entity", entity, "err", err)
		return memories, total, nil
	}
	if len(entityMems) == 0 {
		return memories, total, nil
	}

	memories = blendMemoriesWithEntityContext(memories, entityMems, workingFilter.Limit, strategyName, answerFamily)
	return memories, len(memories), nil
}

func (s *Server) executeExactEventTemporal(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	entity string,
) ([]domain.Memory, int, error) {
	if filter.SessionID != "" && filter.MemoryType == "" {
		return s.explicitSessionSearch(ctx, auth, svc, filter, domain.StrategyExactEventTemporal, "")
	}
	return s.executeDefaultMixed(ctx, auth, svc, filter)
}

func (s *Server) executeSetAggregation(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	entity string,
	answerFamily string,
) ([]domain.Memory, int, error) {
	if filter.SessionID != "" && filter.MemoryType == "" {
		mems, total, err := s.explicitSessionSearch(ctx, auth, svc, filter, domain.StrategySetAggregation, answerFamily)
		if err != nil {
			return nil, 0, err
		}
		if len(mems) > 0 {
			mems = rerankForSetAggregation(filter.Query, mems, entity, answerFamily)
		}
		return mems, total, nil
	}
	return s.executeDefaultMixed(ctx, auth, svc, filter)
}

func (s *Server) executeCountQuery(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	entity string,
	answerFamily string,
) ([]domain.Memory, int, error) {
	if filter.SessionID != "" && filter.MemoryType == "" {
		mems, total, err := s.explicitSessionSearch(ctx, auth, svc, filter, domain.StrategyCountQuery, answerFamily)
		if err != nil {
			return nil, 0, err
		}
		if len(mems) > 0 {
			mems = rerankForCountQuery(filter.Query, mems, entity)
		}
		return mems, total, nil
	}
	return s.executeDefaultMixed(ctx, auth, svc, filter)
}

func (s *Server) executeAttributeInference(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
	entity string,
	answerFamily string,
) ([]domain.Memory, int, error) {
	if entity == "" {
		return s.executeDefaultMixedWithHints(ctx, auth, svc, filter, entity, answerFamily)
	}
	mems, total, err := s.entityAwareSearchWindow(ctx, auth, svc, filter, entity, domain.StrategyAttributeInference, answerFamily)
	if err != nil {
		return nil, 0, err
	}
	if len(mems) > 0 {
		mems = rerankForAttributeInference(filter.Query, mems, entity, answerFamily)
	}
	page, pagedTotal, err := paginateFanout(mems, filter.Offset, filter.Limit)
	if err != nil {
		return nil, 0, err
	}
	if filter.Offset > 0 || len(page) != len(mems) {
		return page, pagedTotal, nil
	}
	return mems, total, nil
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

		lower := strings.ToLower(mem.Content)

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

		lower := strings.ToLower(mem.Content)

		if countNumericRe.MatchString(mem.Content) {
			score += 0.35
		}

		if countWordRe.MatchString(lower) || countBoundedListRe.MatchString(lower) {
			score += 0.20
		}

		if hasTimeBound && (containsAbsoluteTimeSignal(mem.Content) || containsRelativeTimeSignal(lower)) {
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

func rerankForAttributeInference(query string, mems []domain.Memory, entity, answerFamily string) []domain.Memory {
	if len(mems) < 2 {
		return mems
	}

	entityLower := strings.ToLower(entity)
	queryLower := strings.ToLower(query)
	hasTimeBound := containsTimeBound(queryLower) || isTemporalQuestion(query)
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

		lower := strings.ToLower(mem.Content)
		wordCount := len(strings.Fields(mem.Content))
		entitySignals := answerEntitySignalCount(mem.Content)

		if entityLower != "" {
			if strings.Contains(lower, entityLower) {
				score += 0.35
			} else {
				score -= 0.15
			}
		}

		if wordCount >= 8 && wordCount <= 28 {
			score += 0.12
		} else if wordCount < 8 {
			score -= 0.08
		}
		if entitySignals > 1 {
			score += 0.18
		}
		if hasTimeBound && (containsAbsoluteTimeSignal(mem.Content) || containsRelativeTimeSignal(lower)) {
			score += 0.10
		}
		if strings.Contains(mem.Content, "?") {
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

		lower := strings.ToLower(mem.Content)
		wordCount := len(strings.Fields(mem.Content))
		entitySignals := answerEntitySignalCount(mem.Content)

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
		if strings.Contains(mem.Content, "?") {
			score -= 0.15
		}
		if looksGenericFact(lower) && entitySignals == 0 {
			score -= 0.10
		}
		score += groundedAnswerSignalBonus(shape, mem.Content)

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

func entityContextLimit(limit int, strategyName, answerFamily string) int {
	if strategyName == domain.StrategyAttributeInference {
		switch {
		case limit <= 2:
			return 2
		case limit <= 10:
			return 5
		default:
			return 8
		}
	}

	if strategyName == domain.StrategyDefaultMixed && isInferenceStyleAnswerFamily(answerFamily) {
		switch {
		case limit <= 2:
			return 1
		case limit <= 10:
			return 4
		default:
			return 6
		}
	}

	switch {
	case limit <= 2:
		return 1
	case limit <= 10:
		return 2
	default:
		return 3
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

func entityContextQueryTerms(answerFamily string) []string {
	switch strings.ToLower(strings.TrimSpace(answerFamily)) {
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
	case "country", "state", "city", "location", "locations":
		return []string{"travel", "visited", "trip"}
	case "game", "games", "title", "titles", "name", "names", "object", "objects":
		return []string{"favorite", "called", "named"}
	default:
		return nil
	}
}

func isExactAnswerFamily(answerFamily string) bool {
	switch strings.ToLower(strings.TrimSpace(answerFamily)) {
	case "location", "locations", "country", "state", "city", "cities",
		"date", "dates", "time", "timestamp", "start_date", "birthday",
		"game", "games", "card_game", "company", "companies", "composer",
		"title", "titles", "name", "names", "object", "objects",
		"book", "books", "instrument", "instruments", "pet", "pets",
		"item", "items", "service", "services":
		return true
	default:
		return false
	}
}

func exactAnswerFamilyShape(answerFamily string) groundingAnswerShape {
	switch strings.ToLower(strings.TrimSpace(answerFamily)) {
	case "location", "locations", "country", "state", "city", "cities":
		return groundingAnswerShapeLocation
	case "date", "dates", "time", "timestamp", "start_date", "birthday":
		return groundingAnswerShapeTime
	default:
		return groundingAnswerShapeExact
	}
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

func isInferenceStyleAnswerFamily(answerFamily string) bool {
	switch strings.ToLower(strings.TrimSpace(answerFamily)) {
	case "traits", "personality_traits", "career", "education", "preferences",
		"boolean", "religion", "political_leaning", "ally_status",
		"future_plans", "career_motivation", "business_motivation",
		"coping_mechanisms", "common_attributes", "supporters":
		return true
	default:
		return false
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
		key := responseDedupKey(mem)
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

func answerFamilyKeywords(family string) []string {
	switch strings.ToLower(family) {
	case "events":
		return []string{"attended", "joined", "participated", "event", "parade", "group", "conference"}
	case "books":
		return []string{"book", "read", "novel", "title"}
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
	case "traits":
		return []string{"kind", "thoughtful", "driven", "authentic", "passionate", "personality"}
	case "boolean":
		return []string{"yes", "no", "likely", "would", "might"}
	default:
		return nil
	}
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

func containsTimeBound(queryLower string) bool {
	return strings.Contains(queryLower, " in 20") ||
		strings.Contains(queryLower, " during ") ||
		strings.Contains(queryLower, " between ") ||
		strings.Contains(queryLower, " since ") ||
		strings.Contains(queryLower, " last ")
}

func formatStrategies(strategies []domain.RoutedStrategy) string {
	if len(strategies) == 0 {
		return "[]"
	}
	parts := make([]string, 0, len(strategies))
	for _, s := range strategies {
		parts = append(parts, fmt.Sprintf("%s(%.2f)", s.Name, s.Confidence))
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func shouldExecuteStrategyDecision(decision domain.RecallRouteDecision) bool {
	if !decision.IsDefault() {
		return true
	}
	return decision.Entity != ""
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
