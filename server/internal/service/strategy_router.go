package service

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/repository"
)

const (
	strategyVecWeight            = 0.6
	strategyFTSWeight            = 0.4
	strategyFTSMinNorm           = 0.25
	strategyTopNForAggregation   = 10
	strategyTopNForClassScore    = 3
	strategyPrototypeFetchLimit  = 15
	strategyLLMTimeout           = 5 * time.Second
	strategyLLMMinTopConfidence  = 0.70
	strategyLLMMinSecConfidence  = 0.55
	strategyLLMMinConfidenceGap  = 0.10
	strategyHighSupportCount     = 2
	strategyHighScoreRatio       = 1.30
	strategyMediumScoreRatio     = 1.15
	strategyMinAbsoluteScore     = 0.55
	strategyIncompatibleGapFloor = 0.10
)

type RecallStrategyRouterService struct {
	protoRepo repository.RecallStrategyPrototypeRepo
	llmClient *llm.Client
	autoModel string
}

func NewRecallStrategyRouterService(
	protoRepo repository.RecallStrategyPrototypeRepo,
	llmClient *llm.Client,
	autoModel string,
) *RecallStrategyRouterService {
	return &RecallStrategyRouterService{
		protoRepo: protoRepo,
		llmClient: llmClient,
		autoModel: autoModel,
	}
}

type StrategyRouterInput struct {
	Query     string
	SessionID string
	AgentID   string
}

func (s *RecallStrategyRouterService) Detect(ctx context.Context, input StrategyRouterInput) (domain.RecallRouteDecision, error) {
	if input.Query == "" {
		return defaultFallbackDecision("empty_query"), nil
	}

	step1, err := s.step1PrototypeSearch(ctx, input.Query)
	if err != nil {
		slog.Warn("strategy router step1 failed, falling back",
			"err", err, "query_len", len(input.Query))
		return defaultFallbackDecision("step1_error"), nil
	}

	decision, resolved := resolveStep1(step1)
	if resolved {
		return decision, nil
	}

	step2, err := s.step2LLMFallback(ctx, input.Query)
	if err != nil {
		slog.Warn("strategy router step2 LLM failed, falling back",
			"err", err, "query_len", len(input.Query))
		fallback := defaultFallbackDecision("llm_error")
		fallback.TopPrototypeIDs = decision.TopPrototypeIDs
		return fallback, nil
	}

	return resolveStep2(step2, step1), nil
}

type classAggregation struct {
	Class           string
	ClassScore      float64
	BestScore       float64
	BestVecScore    float64
	BestFTSScore    float64
	SupportCount    int
	VecSupportCount int
	FTSSupportCount int
	DualLegSupport  bool
	TopIDs          []int64
	AnswerFamily    string
	Entity          string
}

type step1Result struct {
	Aggregations []classAggregation
	AllMatches   []domain.RecallStrategyPrototypeMatch
}

func (s *RecallStrategyRouterService) step1PrototypeSearch(ctx context.Context, query string) (step1Result, error) {
	var result step1Result

	var vecMatches, ftsMatches []domain.RecallStrategyPrototypeMatch
	var vecErr, ftsErr error

	if s.autoModel != "" && s.protoRepo != nil {
		vecMatches, vecErr = s.protoRepo.VectorSearch(ctx, query, strategyPrototypeFetchLimit)
		if vecErr != nil {
			slog.Warn("strategy prototype vector search failed", "err", vecErr)
		}
	}

	if s.protoRepo != nil {
		ftsMatches, ftsErr = s.protoRepo.FTSSearch(ctx, query, strategyPrototypeFetchLimit)
		if ftsErr != nil {
			slog.Warn("strategy prototype FTS search failed", "err", ftsErr)
		}
	}

	if vecErr != nil && ftsErr != nil {
		return result, fmt.Errorf("both search legs failed: vec=%w, fts=%v", vecErr, ftsErr)
	}

	merged := weightedSimilarityMerge(vecMatches, ftsMatches)
	result.AllMatches = merged
	result.Aggregations = aggregateByClass(merged, vecMatches, ftsMatches)

	if len(result.Aggregations) > 0 {
		top := result.Aggregations[0]
		slog.Debug("strategy step1 aggregation",
			"top_class", top.Class,
			"top_score", fmt.Sprintf("%.3f", top.ClassScore),
			"support", top.SupportCount,
			"dual_leg", top.DualLegSupport,
			"num_classes", len(result.Aggregations),
			"merged_count", len(merged),
		)
	}

	return result, nil
}

func weightedSimilarityMerge(vecResults, ftsResults []domain.RecallStrategyPrototypeMatch) []domain.RecallStrategyPrototypeMatch {
	vecScores := make(map[int64]float64)
	ftsScores := make(map[int64]float64)
	byID := make(map[int64]domain.RecallStrategyPrototypeMatch)

	for _, m := range vecResults {
		vecScores[m.ID] = m.Score
		if _, ok := byID[m.ID]; !ok {
			byID[m.ID] = m
		}
	}

	var ftsMax float64
	for _, m := range ftsResults {
		if m.Score > ftsMax {
			ftsMax = m.Score
		}
	}
	for _, m := range ftsResults {
		norm := m.Score
		if ftsMax > 0 {
			norm = m.Score / ftsMax
		}
		if norm < strategyFTSMinNorm {
			norm = 0
		}
		ftsScores[m.ID] = norm
		if _, ok := byID[m.ID]; !ok {
			byID[m.ID] = m
		}
	}

	merged := make([]domain.RecallStrategyPrototypeMatch, 0, len(byID))
	for id, m := range byID {
		vs, hasVec := vecScores[id]
		fs, hasFTS := ftsScores[id]

		switch {
		case hasVec && hasFTS:
			m.Score = strategyVecWeight*vs + strategyFTSWeight*fs
		case hasVec:
			m.Score = vs
		case hasFTS:
			m.Score = fs
		}
		merged = append(merged, m)
	}

	sort.Slice(merged, func(i, j int) bool {
		return merged[i].Score > merged[j].Score
	})
	return merged
}

func aggregateByClass(merged, vecMatches, ftsMatches []domain.RecallStrategyPrototypeMatch) []classAggregation {
	vecIDs := make(map[int64]bool)
	vecScores := make(map[int64]float64)
	for _, m := range vecMatches {
		vecIDs[m.ID] = true
		vecScores[m.ID] = m.Score
	}
	ftsIDs := make(map[int64]bool)
	ftsScores := make(map[int64]float64)
	for _, m := range ftsMatches {
		ftsIDs[m.ID] = true
		ftsScores[m.ID] = m.Score
	}

	classMap := make(map[string]*classAggregation)
	topN := strategyTopNForAggregation
	if topN > len(merged) {
		topN = len(merged)
	}

	for _, m := range merged[:topN] {
		agg, ok := classMap[m.StrategyClass]
		if !ok {
			agg = &classAggregation{
				Class: m.StrategyClass,
			}
			classMap[m.StrategyClass] = agg
		}
		agg.SupportCount++
		if vecIDs[m.ID] {
			agg.VecSupportCount++
			if agg.BestVecScore < vecScores[m.ID] {
				agg.BestVecScore = vecScores[m.ID]
			}
		}
		if ftsIDs[m.ID] {
			agg.FTSSupportCount++
			if agg.BestFTSScore < ftsScores[m.ID] {
				agg.BestFTSScore = ftsScores[m.ID]
			}
		}
		if vecIDs[m.ID] && ftsIDs[m.ID] {
			agg.DualLegSupport = true
		}
		if len(agg.TopIDs) < strategyTopNForClassScore {
			agg.ClassScore += m.Score
			agg.TopIDs = append(agg.TopIDs, m.ID)
		}
		if agg.BestScore < m.Score {
			agg.BestScore = m.Score
		}
		if agg.AnswerFamily == "" && m.AnswerFamily != "" {
			agg.AnswerFamily = m.AnswerFamily
		}
	}

	for _, agg := range classMap {
		if agg.SupportCount > 0 {
			agg.ClassScore /= float64(len(agg.TopIDs))
		}
	}

	aggs := make([]classAggregation, 0, len(classMap))
	for _, agg := range classMap {
		aggs = append(aggs, *agg)
	}
	sort.Slice(aggs, func(i, j int) bool {
		return aggs[i].ClassScore > aggs[j].ClassScore
	})
	return aggs
}

func resolveStep1(s1 step1Result) (domain.RecallRouteDecision, bool) {
	if len(s1.Aggregations) == 0 {
		return defaultFallbackDecision("no_prototype_matches"), false
	}

	top := s1.Aggregations[0]
	var second classAggregation
	if len(s1.Aggregations) > 1 {
		second = s1.Aggregations[1]
	}

	if top.Class == domain.StrategyAttributeInference {
		d := domain.RecallRouteDecision{
			TopPrototypeIDs: top.TopIDs,
			FallbackCause:   "needs_llm_entity",
		}
		return d, false
	}

	if top.VecSupportCount == 0 {
		d := domain.RecallRouteDecision{
			TopPrototypeIDs: top.TopIDs,
			FallbackCause:   "fts_only_match",
		}
		return d, false
	}

	if top.BestVecScore < strategyMinAbsoluteScore {
		d := domain.RecallRouteDecision{
			TopPrototypeIDs: top.TopIDs,
			FallbackCause:   "weak_similarity",
		}
		return d, false
	}

	highConf := (top.SupportCount >= strategyHighSupportCount || top.DualLegSupport) &&
		(second.ClassScore == 0 || top.ClassScore >= second.ClassScore*strategyHighScoreRatio)

	medConf := top.SupportCount >= 1 &&
		(second.ClassScore == 0 || top.ClassScore >= second.ClassScore*strategyMediumScoreRatio)

	if !highConf && !medConf {
		d := domain.RecallRouteDecision{
			TopPrototypeIDs: top.TopIDs,
			FallbackCause:   "low_confidence",
		}
		return d, false
	}

	decision := domain.RecallRouteDecision{
		Strategies: []domain.RoutedStrategy{
			{Name: top.Class, Confidence: top.ClassScore},
		},
		AnswerFamily:     top.AnswerFamily,
		ResolutionSource: domain.ResolutionSourcePrototype,
		ResolutionMode:   domain.ResolutionModeSingle,
		TopPrototypeIDs:  top.TopIDs,
	}

	if medConf && !highConf && len(s1.Aggregations) > 1 {
		if isCompatibleFanoutPair(top.Class, second.Class) && second.SupportCount >= 1 {
			decision.Strategies = append(decision.Strategies, domain.RoutedStrategy{
				Name:       second.Class,
				Confidence: second.ClassScore,
			})
			decision.ResolutionMode = domain.ResolutionModeFanout
		}
	}

	return decision, true
}

func isCompatibleFanoutPair(a, b string) bool {
	return (a == domain.StrategySetAggregation && b == domain.StrategyCountQuery) ||
		(a == domain.StrategyCountQuery && b == domain.StrategySetAggregation)
}

const strategyLLMSystemPrompt = `You are a recall-strategy classifier.
Classify the user's query into one or more retrieval strategy classes.

Allowed strategy classes:
- exact_event_temporal
- set_aggregation
- count_query
- attribute_inference
- exact_entity_lookup
- default_mixed

Rules:
1. Return at most 2 strategies.
2. Only return 2 strategies if both are genuinely useful together.
3. If uncertain, prefer default_mixed.
4. Extract the primary entity when obvious.
5. Extract answer_family when obvious.
6. Use attribute_inference ONLY when the answer requires inference or judgment beyond any single memory.
7. Use exact_entity_lookup for exact canonical entity answers from indirect evidence, especially location/state/country/name/title/object/game/composer/company/book/instrument questions.
8. Do NOT use attribute_inference for exact location/date/state/country/item/title/name/object questions. Those should be exact_entity_lookup unless clearly temporal/count/set.
9. For attribute_inference, prefer high-level answer_family values such as traits, career, education, preferences, boolean, religion, political_leaning, ally_status.
10. Return ONLY valid JSON.`

const strategyLLMUserTemplate = `Query: %s

Return:
{
  "strategies": [
    {"name": "...", "confidence": 0.00}
  ],
  "entity": "...",
  "answer_family": "..."
}

Examples:
{"query":"When did Melanie run a charity race?","output":{"strategies":[{"name":"exact_event_temporal","confidence":0.92}],"entity":"melanie","answer_family":""}}
{"query":"What events has Caroline participated in?","output":{"strategies":[{"name":"set_aggregation","confidence":0.90}],"entity":"caroline","answer_family":"events"}}
{"query":"How many times has Melanie gone to the beach in 2023?","output":{"strategies":[{"name":"count_query","confidence":0.88},{"name":"set_aggregation","confidence":0.61}],"entity":"melanie","answer_family":"counts"}}
{"query":"What might John's degree be in?","output":{"strategies":[{"name":"attribute_inference","confidence":0.84}],"entity":"john","answer_family":"education"}}
{"query":"What would Caroline's political leaning likely be?","output":{"strategies":[{"name":"attribute_inference","confidence":0.90}],"entity":"caroline","answer_family":"political_leaning"}}
{"query":"What personality traits might Melanie say Caroline has?","output":{"strategies":[{"name":"attribute_inference","confidence":0.90}],"entity":"caroline","answer_family":"traits"}}
{"query":"What state did Nate visit?","output":{"strategies":[{"name":"exact_entity_lookup","confidence":0.90}],"entity":"nate","answer_family":"state"}}
{"query":"In what country was Jolene during summer 2022?","output":{"strategies":[{"name":"exact_entity_lookup","confidence":0.91}],"entity":"jolene","answer_family":"country"}}
{"query":"What card game is Deborah talking about?","output":{"strategies":[{"name":"exact_entity_lookup","confidence":0.89}],"entity":"deborah","answer_family":"game"}}
{"query":"What is Caroline's job?","output":{"strategies":[{"name":"default_mixed","confidence":0.76}],"entity":"caroline","answer_family":""}}`

type llmStrategyOutput struct {
	Strategies   []domain.RoutedStrategy `json:"strategies"`
	Entity       string                  `json:"entity"`
	AnswerFamily string                  `json:"answer_family"`
}

func (s *RecallStrategyRouterService) step2LLMFallback(ctx context.Context, query string) (llmStrategyOutput, error) {
	var result llmStrategyOutput
	if s.llmClient == nil {
		return result, fmt.Errorf("no LLM client configured")
	}

	llmCtx, cancel := context.WithTimeout(ctx, strategyLLMTimeout)
	defer cancel()

	userPrompt := fmt.Sprintf(strategyLLMUserTemplate, query)
	raw, err := s.llmClient.CompleteJSON(llmCtx, strategyLLMSystemPrompt, userPrompt)
	if err != nil {
		return result, fmt.Errorf("strategy LLM call: %w", err)
	}

	parsed, err := llm.ParseJSON[llmStrategyOutput](raw)
	if err != nil {
		return result, fmt.Errorf("strategy LLM parse: %w", err)
	}

	valid := domain.ValidStrategyClasses()
	filtered := parsed.Strategies[:0]
	for _, s := range parsed.Strategies {
		if valid[s.Name] {
			filtered = append(filtered, s)
		}
	}
	parsed.Strategies = filtered

	if len(parsed.Strategies) > 2 {
		parsed.Strategies = parsed.Strategies[:2]
	}
	return sanitizeLLMStrategyOutput(parsed), nil
}

func sanitizeLLMStrategyOutput(parsed llmStrategyOutput) llmStrategyOutput {
	normalizedFamily := normalizeAnswerFamily(parsed.AnswerFamily)
	parsed.AnswerFamily = normalizedFamily

	seen := make(map[string]bool, len(parsed.Strategies))
	filtered := parsed.Strategies[:0]
	for _, st := range parsed.Strategies {
		if st.Name == domain.StrategyAttributeInference {
			if shouldRouteToExactEntityLookupFamily(normalizedFamily) {
				st.Name = domain.StrategyExactEntityLookup
			} else if shouldDowngradeAttributeInferenceFamily(normalizedFamily) {
				st.Name = domain.StrategyDefaultMixed
			}
		}
		if st.Name == domain.StrategyDefaultMixed && shouldRouteToExactEntityLookupFamily(normalizedFamily) {
			st.Name = domain.StrategyExactEntityLookup
		}
		if seen[st.Name] {
			continue
		}
		seen[st.Name] = true
		filtered = append(filtered, st)
	}
	parsed.Strategies = filtered
	return parsed
}

func normalizeAnswerFamily(family string) string {
	family = strings.TrimSpace(strings.ToLower(family))
	family = strings.ReplaceAll(family, " ", "_")
	family = strings.ReplaceAll(family, "-", "_")
	return family
}

func shouldRouteToExactEntityLookupFamily(family string) bool {
	switch family {
	case "location", "locations", "country", "state", "city", "cities",
		"game", "games", "card_game", "company", "companies", "composer",
		"book", "books", "instrument", "instruments", "pet", "pets",
		"activity", "activities", "item", "items", "service", "services",
		"title", "titles", "name", "names", "object", "objects":
		return true
	default:
		return false
	}
}

func shouldDowngradeAttributeInferenceFamily(family string) bool {
	if family == "" {
		return true
	}
	switch family {
	case "location", "locations", "country", "state", "city", "cities",
		"date", "dates", "time", "timestamp", "start_date", "birthday",
		"game", "games", "card_game", "company", "companies", "composer",
		"book", "books", "instrument", "instruments", "pet", "pets",
		"activity", "activities", "item", "items", "service", "services",
		"title", "titles", "name", "names", "object", "objects",
		"event", "events", "food", "foods", "drink", "drinks", "color", "colors",
		"number", "numbers":
		return true
	default:
		return false
	}
}

func resolveStep2(llmResult llmStrategyOutput, s1 step1Result) domain.RecallRouteDecision {
	if len(llmResult.Strategies) == 0 {
		return defaultFallbackDecision("llm_no_strategies")
	}

	topConf := llmResult.Strategies[0].Confidence
	if topConf < strategyLLMMinTopConfidence {
		d := defaultFallbackDecision("llm_low_confidence")
		d.ResolutionSource = domain.ResolutionSourceFallback
		return d
	}

	if len(llmResult.Strategies) > 1 {
		secConf := llmResult.Strategies[1].Confidence
		if secConf < strategyLLMMinSecConfidence {
			llmResult.Strategies = llmResult.Strategies[:1]
		} else if !isCompatibleFanoutPair(llmResult.Strategies[0].Name, llmResult.Strategies[1].Name) {
			gap := math.Abs(topConf - secConf)
			if gap < strategyIncompatibleGapFloor {
				return defaultFallbackDecision("llm_incompatible_no_gap")
			}
			llmResult.Strategies = llmResult.Strategies[:1]
		}
	}

	mode := domain.ResolutionModeSingle
	if len(llmResult.Strategies) == 2 {
		mode = domain.ResolutionModeFanout
	}

	var topIDs []int64
	if len(s1.Aggregations) > 0 {
		topIDs = s1.Aggregations[0].TopIDs
	}

	return domain.RecallRouteDecision{
		Strategies:       llmResult.Strategies,
		Entity:           llmResult.Entity,
		AnswerFamily:     llmResult.AnswerFamily,
		ResolutionSource: domain.ResolutionSourceLLM,
		ResolutionMode:   mode,
		TopPrototypeIDs:  topIDs,
	}
}

func defaultFallbackDecision(cause string) domain.RecallRouteDecision {
	return domain.RecallRouteDecision{
		Strategies: []domain.RoutedStrategy{
			{Name: domain.StrategyDefaultMixed, Confidence: 1.0},
		},
		ResolutionSource: domain.ResolutionSourceFallback,
		ResolutionMode:   domain.ResolutionModeFallback,
		FallbackCause:    cause,
	}
}
