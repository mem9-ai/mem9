package service

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/repository"
)

const (
	strategyRouterRRFK           = 60.0
	strategyTopNForAggregation   = 5
	strategyTopNForClassScore    = 2
	strategyPrototypeFetchLimit  = 10
	strategyLLMTimeout           = 5 * time.Second
	strategyLLMMinTopConfidence  = 0.70
	strategyLLMMinSecConfidence  = 0.55
	strategyLLMMinConfidenceGap  = 0.10
	strategyHighSupportCount     = 2
	strategyHighScoreRatio       = 1.20
	strategyMediumScoreRatio     = 1.08
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
		decision.ResolutionSource = domain.ResolutionSourceFallback
		decision.FallbackCause = "llm_error"
		return decision, nil
	}

	return resolveStep2(step2, step1), nil
}

type classAggregation struct {
	Class          string
	ClassScore     float64
	SupportCount   int
	DualLegSupport bool
	TopIDs         []int64
	AnswerFamily   string
	Entity         string
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

	merged := rrfMergePrototypes(ftsMatches, vecMatches)
	result.AllMatches = merged
	result.Aggregations = aggregateByClass(merged, vecMatches, ftsMatches)
	return result, nil
}

func rrfMergePrototypes(ftsResults, vecResults []domain.RecallStrategyPrototypeMatch) []domain.RecallStrategyPrototypeMatch {
	scores := make(map[int64]float64)
	byID := make(map[int64]domain.RecallStrategyPrototypeMatch)

	for rank, m := range ftsResults {
		scores[m.ID] += 1.0 / (strategyRouterRRFK + float64(rank+1))
		if _, ok := byID[m.ID]; !ok {
			byID[m.ID] = m
		}
	}
	for rank, m := range vecResults {
		scores[m.ID] += 1.0 / (strategyRouterRRFK + float64(rank+1))
		if _, ok := byID[m.ID]; !ok {
			byID[m.ID] = m
		}
	}

	merged := make([]domain.RecallStrategyPrototypeMatch, 0, len(byID))
	for id, m := range byID {
		m.Score = scores[id]
		merged = append(merged, m)
	}
	sort.Slice(merged, func(i, j int) bool {
		return merged[i].Score > merged[j].Score
	})
	return merged
}

func aggregateByClass(merged, vecMatches, ftsMatches []domain.RecallStrategyPrototypeMatch) []classAggregation {
	vecClasses := make(map[string]bool)
	for _, m := range vecMatches {
		vecClasses[m.StrategyClass] = true
	}
	ftsClasses := make(map[string]bool)
	for _, m := range ftsMatches {
		ftsClasses[m.StrategyClass] = true
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
				Class:          m.StrategyClass,
				DualLegSupport: vecClasses[m.StrategyClass] && ftsClasses[m.StrategyClass],
			}
			classMap[m.StrategyClass] = agg
		}
		agg.SupportCount++
		if len(agg.TopIDs) < strategyTopNForClassScore {
			agg.ClassScore += m.Score
			agg.TopIDs = append(agg.TopIDs, m.ID)
		}
		if agg.AnswerFamily == "" && m.AnswerFamily != "" {
			agg.AnswerFamily = m.AnswerFamily
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
- default_mixed

Rules:
1. Return at most 2 strategies.
2. Only return 2 strategies if both are genuinely useful together.
3. If uncertain, prefer default_mixed.
4. Extract the primary entity when obvious.
5. Extract answer_family when obvious.
6. Return ONLY valid JSON.`

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
	return parsed, nil
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
