package domain

// StrategyClass constants define the recognized recall strategy classes.
const (
	StrategyExactEventTemporal = "exact_event_temporal"
	StrategySetAggregation     = "set_aggregation"
	StrategyCountQuery         = "count_query"
	StrategyDefaultMixed       = "default_mixed"
)

// ResolutionSource constants describe how the route decision was made.
const (
	ResolutionSourcePrototype = "prototype"
	ResolutionSourceLLM       = "llm"
	ResolutionSourceFallback  = "fallback"
)

// ResolutionMode constants describe the execution shape.
const (
	ResolutionModeSingle   = "single"
	ResolutionModeFanout   = "fanout"
	ResolutionModeFallback = "fallback"
)

// RoutedStrategy is one strategy in the router output.
type RoutedStrategy struct {
	Name       string  `json:"name"`
	Confidence float64 `json:"confidence"`
}

// RecallRouteDecision is the final output of the strategy router.
type RecallRouteDecision struct {
	Strategies       []RoutedStrategy `json:"strategies"`
	Entity           string           `json:"entity,omitempty"`
	AnswerFamily     string           `json:"answer_family,omitempty"`
	ResolutionSource string           `json:"resolution_source"` // "prototype" | "llm" | "fallback"
	ResolutionMode   string           `json:"resolution_mode"`   // "single" | "fanout" | "fallback"

	// Observability fields (not part of the external contract).
	TopPrototypeIDs []int64 `json:"-"`
	FallbackCause   string  `json:"-"`
}

// IsDefault returns true when the decision fell back to default_mixed.
func (d RecallRouteDecision) IsDefault() bool {
	if len(d.Strategies) == 0 {
		return true
	}
	return len(d.Strategies) == 1 && d.Strategies[0].Name == StrategyDefaultMixed
}

// PrimaryStrategy returns the first strategy name, or default_mixed if empty.
func (d RecallRouteDecision) PrimaryStrategy() string {
	if len(d.Strategies) == 0 {
		return StrategyDefaultMixed
	}
	return d.Strategies[0].Name
}

// IsFanout returns true when two strategies are selected for parallel execution.
func (d RecallRouteDecision) IsFanout() bool {
	return d.ResolutionMode == ResolutionModeFanout && len(d.Strategies) == 2
}

// RecallStrategyPrototypeMatch is one row returned by a prototype search leg.
type RecallStrategyPrototypeMatch struct {
	ID            int64   `json:"id"`
	PatternText   string  `json:"pattern_text"`
	StrategyClass string  `json:"strategy_class"`
	AnswerFamily  string  `json:"answer_family,omitempty"`
	Language      string  `json:"language"`
	Score         float64 `json:"score"`
	Source        string  `json:"source"` // "vector" | "fts"
}

// ValidStrategyClasses returns the set of v1 strategy classes.
func ValidStrategyClasses() map[string]bool {
	return map[string]bool{
		StrategyExactEventTemporal: true,
		StrategySetAggregation:     true,
		StrategyCountQuery:         true,
		StrategyDefaultMixed:       true,
	}
}
