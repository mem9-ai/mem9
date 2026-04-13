package service

import (
	"context"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestResolveStep1_HighConfidence_SingleStrategy(t *testing.T) {
	s1 := step1Result{
		Aggregations: []classAggregation{
			{Class: domain.StrategyExactEventTemporal, ClassScore: 0.82, BestScore: 0.88, BestVecScore: 0.88, SupportCount: 3, VecSupportCount: 3, FTSSupportCount: 1, DualLegSupport: true, TopIDs: []int64{1, 2, 3}},
			{Class: domain.StrategyDefaultMixed, ClassScore: 0.55, BestScore: 0.58, BestVecScore: 0.58, SupportCount: 1, VecSupportCount: 1, TopIDs: []int64{5}},
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

func TestResolveStep1_WeakSimilarity_Unresolved(t *testing.T) {
	s1 := step1Result{
		Aggregations: []classAggregation{
			{Class: domain.StrategyExactEventTemporal, ClassScore: 0.45, BestScore: 0.50, BestVecScore: 0.50, SupportCount: 3, VecSupportCount: 3, FTSSupportCount: 1, DualLegSupport: true, TopIDs: []int64{1, 2}},
		},
	}
	decision, resolved := resolveStep1(s1)
	if resolved {
		t.Fatal("expected resolved=false when BestScore < strategyMinAbsoluteScore")
	}
	if decision.FallbackCause != "weak_similarity" {
		t.Errorf("expected cause=weak_similarity, got %s", decision.FallbackCause)
	}
}

func TestResolveStep1_FTSOnly_Unresolved(t *testing.T) {
	s1 := step1Result{
		Aggregations: []classAggregation{
			{Class: domain.StrategyExactEventTemporal, ClassScore: 1.0, BestScore: 1.0, BestFTSScore: 4.0, SupportCount: 1, FTSSupportCount: 1, TopIDs: []int64{1}},
		},
	}
	decision, resolved := resolveStep1(s1)
	if resolved {
		t.Fatal("expected resolved=false when top class has only FTS support")
	}
	if decision.FallbackCause != "fts_only_match" {
		t.Errorf("expected cause=fts_only_match, got %s", decision.FallbackCause)
	}
}

func TestResolveStep1_AttributeInference_UnresolvedForLLMEntityExtraction(t *testing.T) {
	s1 := step1Result{
		Aggregations: []classAggregation{
			{Class: domain.StrategyAttributeInference, ClassScore: 0.86, BestScore: 0.88, SupportCount: 1, FTSSupportCount: 1, TopIDs: []int64{1}},
		},
	}
	decision, resolved := resolveStep1(s1)
	if resolved {
		t.Fatal("expected attribute_inference to remain unresolved in step1")
	}
	if decision.FallbackCause != "needs_llm_entity" {
		t.Errorf("expected cause=needs_llm_entity, got %s", decision.FallbackCause)
	}
}

func TestResolveStep1_LowConfidence_Unresolved(t *testing.T) {
	s1 := step1Result{
		Aggregations: []classAggregation{
			{Class: domain.StrategySetAggregation, ClassScore: 0.70, BestScore: 0.72, BestVecScore: 0.72, SupportCount: 1, VecSupportCount: 1, TopIDs: []int64{1}},
			{Class: domain.StrategyCountQuery, ClassScore: 0.70, BestScore: 0.71, BestVecScore: 0.71, SupportCount: 1, VecSupportCount: 1, TopIDs: []int64{2}},
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
			{Class: domain.StrategySetAggregation, ClassScore: 0.80, BestScore: 0.85, BestVecScore: 0.85, SupportCount: 2, VecSupportCount: 2, TopIDs: []int64{1, 2}},
			{Class: domain.StrategyCountQuery, ClassScore: 0.65, BestScore: 0.68, BestVecScore: 0.68, SupportCount: 1, VecSupportCount: 1, TopIDs: []int64{3}},
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
			{Class: domain.StrategyExactEventTemporal, ClassScore: 0.82, BestScore: 0.88, BestVecScore: 0.88, SupportCount: 2, VecSupportCount: 2, TopIDs: []int64{1, 2}},
			{Class: domain.StrategySetAggregation, ClassScore: 0.65, BestScore: 0.68, BestVecScore: 0.68, SupportCount: 1, VecSupportCount: 1, TopIDs: []int64{3}},
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

func TestSanitizeLLMStrategyOutput_TableDriven(t *testing.T) {
	tests := []struct {
		name           string
		in             llmStrategyOutput
		wantStrategies []string
		wantFamily     string
	}{
		{
			name: "empty family downgrades",
			in: llmStrategyOutput{
				Strategies:   []domain.RoutedStrategy{{Name: domain.StrategyAttributeInference, Confidence: 0.90}},
				Entity:       "nate",
				AnswerFamily: "",
			},
			wantStrategies: []string{domain.StrategyDefaultMixed},
			wantFamily:     "",
		},
		{
			name: "broad location downgrades to default mixed",
			in: llmStrategyOutput{
				Strategies:   []domain.RoutedStrategy{{Name: domain.StrategyAttributeInference, Confidence: 0.90}},
				Entity:       "nate",
				AnswerFamily: "location",
			},
			wantStrategies: []string{domain.StrategyDefaultMixed},
			wantFamily:     "location",
		},
		{
			name: "country upgrades to exact entity lookup",
			in: llmStrategyOutput{
				Strategies:   []domain.RoutedStrategy{{Name: domain.StrategyAttributeInference, Confidence: 0.90}},
				Entity:       "jolene",
				AnswerFamily: "country",
			},
			wantStrategies: []string{domain.StrategyExactEntityLookup},
			wantFamily:     "country",
		},
		{
			name: "singular title downgrades",
			in: llmStrategyOutput{
				Strategies:   []domain.RoutedStrategy{{Name: domain.StrategyAttributeInference, Confidence: 0.90}},
				Entity:       "deb",
				AnswerFamily: "title",
			},
			wantStrategies: []string{domain.StrategyExactEntityLookup},
			wantFamily:     "title",
		},
		{
			name: "plural names downgrade",
			in: llmStrategyOutput{
				Strategies:   []domain.RoutedStrategy{{Name: domain.StrategyAttributeInference, Confidence: 0.90}},
				Entity:       "melanie",
				AnswerFamily: "names",
			},
			wantStrategies: []string{domain.StrategyExactEntityLookup},
			wantFamily:     "names",
		},
		{
			name: "singular item downgrades",
			in: llmStrategyOutput{
				Strategies:   []domain.RoutedStrategy{{Name: domain.StrategyAttributeInference, Confidence: 0.90}},
				Entity:       "caroline",
				AnswerFamily: "item",
			},
			wantStrategies: []string{domain.StrategyDefaultMixed},
			wantFamily:     "item",
		},
		{
			name: "event downgrades",
			in: llmStrategyOutput{
				Strategies:   []domain.RoutedStrategy{{Name: domain.StrategyAttributeInference, Confidence: 0.90}},
				Entity:       "caroline",
				AnswerFamily: "event",
			},
			wantStrategies: []string{domain.StrategyDefaultMixed},
			wantFamily:     "event",
		},
		{
			name: "dedupe after downgrade",
			in: llmStrategyOutput{
				Strategies: []domain.RoutedStrategy{
					{Name: domain.StrategyAttributeInference, Confidence: 0.90},
					{Name: domain.StrategyDefaultMixed, Confidence: 0.85},
				},
				Entity:       "nate",
				AnswerFamily: "location",
			},
			wantStrategies: []string{domain.StrategyDefaultMixed},
			wantFamily:     "location",
		},
		{
			name: "default mixed exact family upgrades",
			in: llmStrategyOutput{
				Strategies:   []domain.RoutedStrategy{{Name: domain.StrategyDefaultMixed, Confidence: 0.88}},
				Entity:       "jolene",
				AnswerFamily: "country",
			},
			wantStrategies: []string{domain.StrategyExactEntityLookup},
			wantFamily:     "country",
		},
		{
			name: "direct exact entity lookup broad family downgrades",
			in: llmStrategyOutput{
				Strategies:   []domain.RoutedStrategy{{Name: domain.StrategyExactEntityLookup, Confidence: 0.88}},
				Entity:       "jolene",
				AnswerFamily: "age",
			},
			wantStrategies: []string{domain.StrategyDefaultMixed},
			wantFamily:     "age",
		},
		{
			name: "direct exact entity lookup exact family stays",
			in: llmStrategyOutput{
				Strategies:   []domain.RoutedStrategy{{Name: domain.StrategyExactEntityLookup, Confidence: 0.88}},
				Entity:       "deb",
				AnswerFamily: "game",
			},
			wantStrategies: []string{domain.StrategyExactEntityLookup},
			wantFamily:     "game",
		},
		{
			name: "traits stay inference",
			in: llmStrategyOutput{
				Strategies:   []domain.RoutedStrategy{{Name: domain.StrategyAttributeInference, Confidence: 0.90}},
				Entity:       "caroline",
				AnswerFamily: "personality traits",
			},
			wantStrategies: []string{domain.StrategyAttributeInference},
			wantFamily:     "personality_traits",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sanitizeLLMStrategyOutput(tt.in)
			if got.AnswerFamily != tt.wantFamily {
				t.Fatalf("expected normalized answer family %q, got %q", tt.wantFamily, got.AnswerFamily)
			}
			if len(got.Strategies) != len(tt.wantStrategies) {
				t.Fatalf("expected %d strategies, got %d (%v)", len(tt.wantStrategies), len(got.Strategies), got.Strategies)
			}
			for i, want := range tt.wantStrategies {
				if got.Strategies[i].Name != want {
					t.Fatalf("expected strategy[%d]=%s, got %s", i, want, got.Strategies[i].Name)
				}
			}
		})
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

func TestDetect_WeakPrototypeMatch_FallsToLLMOrDefault(t *testing.T) {
	repo := &stubProtoRepo{
		vecResults: []domain.RecallStrategyPrototypeMatch{
			{ID: 1, StrategyClass: domain.StrategyExactEventTemporal, Score: 0.45},
			{ID: 2, StrategyClass: domain.StrategySetAggregation, Score: 0.42},
		},
		ftsResults: nil,
	}
	router := NewRecallStrategyRouterService(repo, nil, "auto-model")
	decision, err := router.Detect(context.Background(), StrategyRouterInput{Query: "What is Caroline's job?"})
	if err != nil {
		t.Fatal(err)
	}
	if decision.ResolutionSource == domain.ResolutionSourcePrototype {
		t.Errorf("expected NOT prototype resolution for weak scores, got prototype with %v", decision.Strategies)
	}
}

func TestDetect_FTSOnlyPrototypeMatch_DoesNotResolveInStep1(t *testing.T) {
	repo := &stubProtoRepo{
		ftsResults: []domain.RecallStrategyPrototypeMatch{
			{ID: 1, StrategyClass: domain.StrategyExactEventTemporal, Score: 4.0},
		},
	}
	router := NewRecallStrategyRouterService(repo, nil, "auto-model")
	decision, err := router.Detect(context.Background(), StrategyRouterInput{Query: "When did Caroline join the group?"})
	if err != nil {
		t.Fatal(err)
	}
	if decision.ResolutionSource == domain.ResolutionSourcePrototype {
		t.Fatalf("expected FTS-only match to avoid prototype resolution, got %v", decision.Strategies)
	}
	if !decision.IsDefault() {
		t.Errorf("expected fallback/default decision without LLM configured, got %v", decision.Strategies)
	}
	if decision.ResolutionMode != domain.ResolutionModeFallback {
		t.Errorf("expected fallback mode, got %s", decision.ResolutionMode)
	}
	if len(decision.Strategies) != 1 || decision.Strategies[0].Name != domain.StrategyDefaultMixed {
		t.Errorf("expected default_mixed fallback strategy, got %v", decision.Strategies)
	}
}

func TestWeightedSimilarityMerge_DualLegBoost(t *testing.T) {
	vec := []domain.RecallStrategyPrototypeMatch{
		{ID: 1, StrategyClass: "a", Score: 0.90},
		{ID: 2, StrategyClass: "b", Score: 0.70},
	}
	fts := []domain.RecallStrategyPrototypeMatch{
		{ID: 1, StrategyClass: "a", Score: 5.0},
		{ID: 3, StrategyClass: "c", Score: 3.0},
	}
	merged := weightedSimilarityMerge(vec, fts)
	if len(merged) != 3 {
		t.Fatalf("expected 3 merged, got %d", len(merged))
	}
	if merged[0].ID != 1 {
		t.Errorf("expected ID=1 first (dual-leg), got ID=%d", merged[0].ID)
	}
	expectedScore := 0.6*0.90 + 0.4*1.0
	if diff := merged[0].Score - expectedScore; diff > 0.01 || diff < -0.01 {
		t.Errorf("expected score ~%.2f for dual-leg item, got %.2f", expectedScore, merged[0].Score)
	}
}

func TestWeightedSimilarityMerge_FTSOnlyNormalized(t *testing.T) {
	fts := []domain.RecallStrategyPrototypeMatch{
		{ID: 1, StrategyClass: "a", Score: 10.0},
		{ID: 2, StrategyClass: "b", Score: 5.0},
	}
	merged := weightedSimilarityMerge(nil, fts)
	if len(merged) != 2 {
		t.Fatalf("expected 2, got %d", len(merged))
	}
	if merged[0].Score != 1.0 {
		t.Errorf("expected FTS-max to normalize to 1.0, got %.2f", merged[0].Score)
	}
	if merged[1].Score != 0.5 {
		t.Errorf("expected second FTS to normalize to 0.5, got %.2f", merged[1].Score)
	}
}

func TestAggregateByClass_AveragesTopN(t *testing.T) {
	merged := []domain.RecallStrategyPrototypeMatch{
		{ID: 1, StrategyClass: "a", Score: 0.90},
		{ID: 2, StrategyClass: "a", Score: 0.80},
		{ID: 3, StrategyClass: "b", Score: 0.75},
		{ID: 4, StrategyClass: "a", Score: 0.70},
		{ID: 5, StrategyClass: "b", Score: 0.65},
	}
	vec := []domain.RecallStrategyPrototypeMatch{
		{ID: 1, Score: 0.90},
		{ID: 3, Score: 0.75},
	}
	fts := []domain.RecallStrategyPrototypeMatch{
		{ID: 1, Score: 10.0},
		{ID: 5, Score: 5.0},
	}

	aggs := aggregateByClass(merged, vec, fts)
	if len(aggs) != 2 {
		t.Fatalf("expected 2 classes, got %d", len(aggs))
	}
	if aggs[0].Class != "a" {
		t.Errorf("expected class 'a' first, got %s", aggs[0].Class)
	}
	expectedAvg := (0.90 + 0.80 + 0.70) / 3.0
	if diff := aggs[0].ClassScore - expectedAvg; diff > 0.01 || diff < -0.01 {
		t.Errorf("expected ClassScore ~%.3f (avg of top-3), got %.3f", expectedAvg, aggs[0].ClassScore)
	}
	if aggs[0].BestScore != 0.90 {
		t.Errorf("expected BestScore=0.90, got %.2f", aggs[0].BestScore)
	}
	if aggs[0].BestVecScore != 0.90 {
		t.Errorf("expected BestVecScore=0.90, got %.2f", aggs[0].BestVecScore)
	}
	if aggs[0].BestFTSScore != 10.0 {
		t.Errorf("expected BestFTSScore=10.0, got %.2f", aggs[0].BestFTSScore)
	}
	if aggs[0].VecSupportCount != 1 {
		t.Errorf("expected VecSupportCount=1 for class 'a', got %d", aggs[0].VecSupportCount)
	}
	if aggs[0].FTSSupportCount != 1 {
		t.Errorf("expected FTSSupportCount=1 for class 'a', got %d", aggs[0].FTSSupportCount)
	}
	if !aggs[0].DualLegSupport {
		t.Error("expected DualLegSupport=true for class 'a' (ID=1 in both legs)")
	}
}
