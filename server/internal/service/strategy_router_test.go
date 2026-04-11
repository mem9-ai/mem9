package service

import (
	"context"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestResolveStep1_HighConfidence_SingleStrategy(t *testing.T) {
	s1 := step1Result{
		Aggregations: []classAggregation{
			{Class: domain.StrategyExactEventTemporal, ClassScore: 0.030, SupportCount: 3, DualLegSupport: true, TopIDs: []int64{1, 2}},
			{Class: domain.StrategyDefaultMixed, ClassScore: 0.010, SupportCount: 1, TopIDs: []int64{5}},
		},
	}
	decision, resolved := resolveStep1(s1)
	if !resolved {
		t.Fatal("expected resolved=true for high-confidence single strategy")
	}
	if len(decision.Strategies) != 1 {
		t.Fatalf("expected 1 strategy, got %d", len(decision.Strategies))
	}
	if decision.Strategies[0].Name != domain.StrategyExactEventTemporal {
		t.Errorf("expected exact_event_temporal, got %s", decision.Strategies[0].Name)
	}
	if decision.ResolutionSource != domain.ResolutionSourcePrototype {
		t.Errorf("expected source=prototype, got %s", decision.ResolutionSource)
	}
	if decision.ResolutionMode != domain.ResolutionModeSingle {
		t.Errorf("expected mode=single, got %s", decision.ResolutionMode)
	}
}

func TestResolveStep1_NoMatches_Unresolved(t *testing.T) {
	s1 := step1Result{Aggregations: nil}
	_, resolved := resolveStep1(s1)
	if resolved {
		t.Fatal("expected resolved=false when no aggregations")
	}
}

func TestResolveStep1_LowConfidence_Unresolved(t *testing.T) {
	s1 := step1Result{
		Aggregations: []classAggregation{
			{Class: domain.StrategySetAggregation, ClassScore: 0.011, SupportCount: 1, TopIDs: []int64{1}},
			{Class: domain.StrategyCountQuery, ClassScore: 0.011, SupportCount: 1, TopIDs: []int64{2}},
		},
	}
	_, resolved := resolveStep1(s1)
	if resolved {
		t.Fatal("expected resolved=false when scores are equal without high support")
	}
}

func TestResolveStep1_MediumConfidence_FanoutPair(t *testing.T) {
	s1 := step1Result{
		Aggregations: []classAggregation{
			{Class: domain.StrategySetAggregation, ClassScore: 0.025, SupportCount: 1, TopIDs: []int64{1}},
			{Class: domain.StrategyCountQuery, ClassScore: 0.020, SupportCount: 1, TopIDs: []int64{2}},
		},
	}
	decision, resolved := resolveStep1(s1)
	if !resolved {
		t.Fatal("expected resolved=true for medium-confidence compatible pair")
	}
	if len(decision.Strategies) != 2 {
		t.Fatalf("expected 2 strategies (fanout), got %d", len(decision.Strategies))
	}
	if decision.ResolutionMode != domain.ResolutionModeFanout {
		t.Errorf("expected mode=fanout, got %s", decision.ResolutionMode)
	}
	if decision.Strategies[0].Name != domain.StrategySetAggregation {
		t.Errorf("expected primary=set_aggregation, got %s", decision.Strategies[0].Name)
	}
	if decision.Strategies[1].Name != domain.StrategyCountQuery {
		t.Errorf("expected secondary=count_query, got %s", decision.Strategies[1].Name)
	}
}

func TestResolveStep1_IncompatiblePair_NoFanout(t *testing.T) {
	s1 := step1Result{
		Aggregations: []classAggregation{
			{Class: domain.StrategyExactEventTemporal, ClassScore: 0.025, SupportCount: 1, TopIDs: []int64{1}},
			{Class: domain.StrategySetAggregation, ClassScore: 0.020, SupportCount: 1, TopIDs: []int64{2}},
		},
	}
	decision, resolved := resolveStep1(s1)
	if !resolved {
		t.Fatal("expected resolved=true")
	}
	if len(decision.Strategies) != 1 {
		t.Fatalf("expected 1 strategy (no fanout for incompatible pair), got %d", len(decision.Strategies))
	}
	if decision.ResolutionMode != domain.ResolutionModeSingle {
		t.Errorf("expected mode=single, got %s", decision.ResolutionMode)
	}
}

func TestResolveStep2_HighConfidence(t *testing.T) {
	llmResult := llmStrategyOutput{
		Strategies:   []domain.RoutedStrategy{{Name: domain.StrategyExactEventTemporal, Confidence: 0.90}},
		Entity:       "melanie",
		AnswerFamily: "",
	}
	s1 := step1Result{
		Aggregations: []classAggregation{
			{Class: domain.StrategyExactEventTemporal, TopIDs: []int64{1}},
		},
	}
	decision := resolveStep2(llmResult, s1)
	if decision.ResolutionSource != domain.ResolutionSourceLLM {
		t.Errorf("expected source=llm, got %s", decision.ResolutionSource)
	}
	if len(decision.Strategies) != 1 || decision.Strategies[0].Name != domain.StrategyExactEventTemporal {
		t.Errorf("expected exact_event_temporal from LLM, got %v", decision.Strategies)
	}
}

func TestResolveStep2_LowConfidence_Fallback(t *testing.T) {
	llmResult := llmStrategyOutput{
		Strategies: []domain.RoutedStrategy{{Name: domain.StrategySetAggregation, Confidence: 0.50}},
	}
	decision := resolveStep2(llmResult, step1Result{})
	if decision.ResolutionSource != domain.ResolutionSourceFallback {
		t.Errorf("expected source=fallback for low confidence, got %s", decision.ResolutionSource)
	}
	if !decision.IsDefault() {
		t.Error("expected default_mixed fallback")
	}
}

func TestResolveStep2_EmptyStrategies_Fallback(t *testing.T) {
	llmResult := llmStrategyOutput{Strategies: nil}
	decision := resolveStep2(llmResult, step1Result{})
	if !decision.IsDefault() {
		t.Error("expected default_mixed fallback for empty strategies")
	}
	if decision.FallbackCause != "llm_no_strategies" {
		t.Errorf("expected cause=llm_no_strategies, got %s", decision.FallbackCause)
	}
}

func TestResolveStep2_FanoutPair(t *testing.T) {
	llmResult := llmStrategyOutput{
		Strategies: []domain.RoutedStrategy{
			{Name: domain.StrategySetAggregation, Confidence: 0.85},
			{Name: domain.StrategyCountQuery, Confidence: 0.60},
		},
		Entity: "caroline",
	}
	decision := resolveStep2(llmResult, step1Result{})
	if decision.ResolutionMode != domain.ResolutionModeFanout {
		t.Errorf("expected mode=fanout, got %s", decision.ResolutionMode)
	}
	if len(decision.Strategies) != 2 {
		t.Fatalf("expected 2 strategies, got %d", len(decision.Strategies))
	}
}

func TestResolveStep2_IncompatiblePair_DropSecond(t *testing.T) {
	llmResult := llmStrategyOutput{
		Strategies: []domain.RoutedStrategy{
			{Name: domain.StrategyExactEventTemporal, Confidence: 0.88},
			{Name: domain.StrategySetAggregation, Confidence: 0.60},
		},
	}
	decision := resolveStep2(llmResult, step1Result{})
	if len(decision.Strategies) != 1 {
		t.Fatalf("expected 1 strategy (incompatible pair should drop second), got %d", len(decision.Strategies))
	}
	if decision.Strategies[0].Name != domain.StrategyExactEventTemporal {
		t.Errorf("expected exact_event_temporal, got %s", decision.Strategies[0].Name)
	}
	if decision.ResolutionMode != domain.ResolutionModeSingle {
		t.Errorf("expected mode=single, got %s", decision.ResolutionMode)
	}
}

type stubProtoRepo struct {
	vecResults []domain.RecallStrategyPrototypeMatch
	ftsResults []domain.RecallStrategyPrototypeMatch
	vecErr     error
	ftsErr     error
}

func (s *stubProtoRepo) VectorSearch(_ context.Context, _ string, _ int) ([]domain.RecallStrategyPrototypeMatch, error) {
	return s.vecResults, s.vecErr
}
func (s *stubProtoRepo) FTSSearch(_ context.Context, _ string, _ int) ([]domain.RecallStrategyPrototypeMatch, error) {
	return s.ftsResults, s.ftsErr
}

func TestDetect_NilRepo_Fallback(t *testing.T) {
	router := NewRecallStrategyRouterService(nil, nil, "")
	decision, err := router.Detect(context.Background(), StrategyRouterInput{Query: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if !decision.IsDefault() {
		t.Errorf("expected default fallback with nil repo, got %v", decision.Strategies)
	}
}

func TestDetect_EmptyQuery_Fallback(t *testing.T) {
	router := NewRecallStrategyRouterService(&stubProtoRepo{}, nil, "auto-model")
	decision, err := router.Detect(context.Background(), StrategyRouterInput{Query: ""})
	if err != nil {
		t.Fatal(err)
	}
	if !decision.IsDefault() {
		t.Error("expected default fallback for empty query")
	}
	if decision.FallbackCause != "empty_query" {
		t.Errorf("expected cause=empty_query, got %s", decision.FallbackCause)
	}
}

func TestDetect_StrongPrototypeMatch_ResolvesInStep1(t *testing.T) {
	repo := &stubProtoRepo{
		vecResults: []domain.RecallStrategyPrototypeMatch{
			{ID: 1, StrategyClass: domain.StrategyExactEventTemporal, Score: 0.90},
			{ID: 2, StrategyClass: domain.StrategyExactEventTemporal, Score: 0.85},
			{ID: 3, StrategyClass: domain.StrategyDefaultMixed, Score: 0.40},
		},
		ftsResults: []domain.RecallStrategyPrototypeMatch{
			{ID: 1, StrategyClass: domain.StrategyExactEventTemporal, Score: 5.0},
			{ID: 4, StrategyClass: domain.StrategyExactEventTemporal, Score: 3.0},
		},
	}
	router := NewRecallStrategyRouterService(repo, nil, "auto-model")
	decision, err := router.Detect(context.Background(), StrategyRouterInput{Query: "When did Melanie run a charity race?"})
	if err != nil {
		t.Fatal(err)
	}
	if decision.PrimaryStrategy() != domain.StrategyExactEventTemporal {
		t.Errorf("expected exact_event_temporal, got %s", decision.PrimaryStrategy())
	}
	if decision.ResolutionSource != domain.ResolutionSourcePrototype {
		t.Errorf("expected source=prototype, got %s", decision.ResolutionSource)
	}
}
