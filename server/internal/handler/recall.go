package handler

import (
	"context"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

const (
	defaultPinnedCandidateLimit  = 5
	defaultInsightCandidateLimit = 10
	defaultSessionCandidateLimit = 10
	defaultPinnedKeepMax         = 2
	defaultPinnedMinConfidence   = 70
	defaultMixedMinConfidence    = 65
	enumerationMinConfidence     = 55
	enumerationMaxBudget         = 20
	enumerationBudgetMultiplier  = 2
	enumerationCandidateLimit    = 24
	enumerationFetchMultiplier   = 4
	enumerationSecondHopTopN     = 5
	enumerationPinnedKeepMax     = 1
	defaultConfidenceGapStop     = 18
	recallRRFMaxScore            = 2.0 / 61.0
)

var (
	answerAcronymRe              = regexp.MustCompile(`\b[A-Z]{2,}(?:[+-][A-Z0-9]+)*\b`)
	answerNumberRe               = regexp.MustCompile(`\b\d+\b`)
	answerYearRe                 = regexp.MustCompile(`\b(?:19|20)\d{2}\b`)
	answerMonthNameRe            = regexp.MustCompile(`\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b`)
	answerWeekdayNameRe          = regexp.MustCompile(`\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b`)
	answerSeasonNameRe           = regexp.MustCompile(`\b(?:spring|summer|fall|autumn|winter)\b`)
	answerTitleCaseRe            = regexp.MustCompile(`\b[A-Z][a-z]+(?:['-][A-Za-z]+)*(?:\s+[A-Z][a-z]+(?:['-][A-Za-z]+)*)*\b`)
	answerLocationCueRe          = regexp.MustCompile(`\b(?:in|at|from|to|near|around|outside|inside)\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}\b`)
	answerCountWordRe            = regexp.MustCompile(`\b(?:one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several)\b`)
	answerQuotedOrCJKQuotedRe    = regexp.MustCompile(`"[^"]+"|“[^”]+”|「[^」]+」|『[^』]+』|《[^》]+》`)
	answerCNCountRe              = regexp.MustCompile(`[零一二三四五六七八九十百千万两\d]+`)
	answerCNTimeRe               = regexp.MustCompile(`\d{4}年|\d{1,2}月|\d{1,2}[日号]|\d{1,2}点`)
	answerCNLocationSuffixRe     = regexp.MustCompile(`(?:在|位于|来自|住在)[^，。；,.!?]{1,24}(?:市|省|区|县|州|国|路|街|镇|村|湾|岛)`)
	answerCNLocationVerbRe       = regexp.MustCompile(`(?:在|位于|来自|住在)[^，。；,.!?]{1,12}(?:办公|工作|居住|生活|定居|出生|上班|读书|学习)`)
	answerCNLocationDirectRe     = regexp.MustCompile(`^(?:位于|来自|住在|在)[\p{Han}A-Za-z0-9·]{1,12}$`)
	answerCNCountWordRe          = regexp.MustCompile(`(?:一次|两次|三次|四次|五次|几次|多少次|多个|几个|若干)`)
	answerCNListCueRe            = regexp.MustCompile(`[\p{Han}\dA-Za-z](?:和|及|以及)[\p{Han}\dA-Za-z]`)
	answerStandaloneCJKNameRe    = regexp.MustCompile(`^[\p{Han}·]{2,12}$`)
	answerRelativeTimeRe         = regexp.MustCompile(`(?i)\b(?:yesterday|today|tomorrow|last\s+(?:night|week|weekend|month|year|summer|winter|spring|fall|autumn|friday|saturday|sunday|monday|tuesday|wednesday|thursday)|next\s+(?:week|weekend|month|year|summer|winter|spring|fall|autumn|friday|saturday|sunday|monday|tuesday|wednesday|thursday)|this\s+(?:week|weekend|month|year|summer|winter|spring|fall|autumn)|\d+\s+(?:day|days|week|weeks|month|months|year|years)\s+ago|in\s+\d+\s+(?:day|days|week|weeks|month|months|year|years)|the\s+(?:past\s+)?(?:week|weekend))\b`)
	answerCNRelativeTimeRe       = regexp.MustCompile(`(?:昨天|今天|明天|前天|后天|上周|下周|本周|这周|上个月|下个月|这个月|本月|去年|今年|明年|上周[一二三四五六日天]|下周[一二三四五六日天]|周末|上个周末|下个周末|春天|夏天|秋天|冬天)`)
	answerAnchoredPeriodRe       = regexp.MustCompile(`(?i)\b(?:the\s+)?(?:week|weekend|month|year|summer|winter|spring|fall|autumn)\s+(?:before|after)\b`)
	answerFutureCueRe            = regexp.MustCompile(`(?i)\b(?:will|planning|plan|plans|planned|thinking about|going to|gonna|scheduled|upcoming|next\s+(?:week|weekend|month|year|summer|winter|spring|fall|autumn))\b|(?:计划|打算|准备|将要|将会|下周|下个月|明年)`)
	answerPastCueRe              = regexp.MustCompile(`(?i)\b(?:went|had|did|got|was|were|happened|previously|earlier|ago|last\s+(?:week|weekend|month|year|summer|winter|spring|fall|autumn|friday|saturday|sunday|monday|tuesday|wednesday|thursday))\b|(?:之前|以前|当时|去了|发生了|上周|上个月|去年|昨天|前天)`)
	answerNegationRe             = regexp.MustCompile(`(?i)\b(?:did not|didn't|never|no longer|not\b)\b|(?:没有|没|未)`)
	recallLeadingBracketRunRe    = regexp.MustCompile(`^(?:\[[^\]\n]{0,160}\]\s*)+`)
	recallTemporalTokenRe        = regexp.MustCompile(`\b(?:19|20)\d{2}\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|spring|summer|fall|autumn|winter)\b|(?:\d{4}年|\d{1,2}月|昨天|今天|明天|上周|下周|去年|今年|明年|春天|夏天|秋天|冬天)`)
	recallEnumerationPluralRe    = regexp.MustCompile(`\b(?:activities|books|events|items|pets|names|artists|bands|places|countries|movies|songs|games|restaurants|authors|albums|hobbies|shows|concerts)\b`)
	recallEnumerationTypeCueRe   = regexp.MustCompile(`\bwhat\s+(?:type|types|kind|kinds)\s+of\b`)
	recallEnumerationBothCueRe   = regexp.MustCompile(`\b(?:what|which)\b.*\bboth\b`)
	recallEnumerationDoneCueRe   = regexp.MustCompile(`\bwhat\s+(?:has|have)\s+.+\s+done\b`)
	recallCoverageEnglishTokenRe = regexp.MustCompile(`\b[a-z][a-z0-9'-]{3,}\b`)
	recallCoverageCJKTokenRe     = regexp.MustCompile(`[\p{Han}]{2,6}`)
	recallCoverageSpaceRe        = regexp.MustCompile(`\s+`)
)

type recallTemporalIntent int

const (
	recallTemporalIntentAny recallTemporalIntent = iota
	recallTemporalIntentPast
	recallTemporalIntentFuture
)

type recallQueryProfile struct {
	shape          recallQueryShape
	lower          string
	temporalIntent recallTemporalIntent
	temporalTokens []string
}

type recallQueryShape int

const (
	recallQueryShapeGeneral recallQueryShape = iota
	recallQueryShapeEntity
	recallQueryShapeCount
	recallQueryShapeTime
	recallQueryShapeLocation
	recallQueryShapeEnumeration
	recallQueryShapeExact
)

type recallSelectionStats struct {
	mode                   string
	insightSelected        int
	sessionSelected        int
	coverageTokenCount     int
	coverageFirstPassCount int
	backfillCount          int
}

func (s *Server) defaultConfidenceRecallSearch(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
) ([]domain.Memory, int, error) {
	start := time.Now()
	profile := buildRecallQueryProfile(filter.Query)
	budget := effectiveRecallBudget(profile.shape, filter.Limit)
	if budget <= 0 {
		return []domain.Memory{}, 0, nil
	}

	pinnedFilter := filter
	pinnedFilter.MemoryType = string(domain.TypePinned)
	pinnedFilter.Limit = recallCandidateLimit(profile.shape, service.RecallSourcePinned)

	insightFilter := filter
	insightFilter.MemoryType = string(domain.TypeInsight)
	insightFilter.Limit = recallCandidateLimit(profile.shape, service.RecallSourceInsight)

	sessionFilter := filter
	sessionFilter.Limit = recallCandidateLimit(profile.shape, service.RecallSourceSession)

	pinnedStart := time.Now()
	pinnedCandidates, err := svc.memory.SearchCandidates(ctx, pinnedFilter, service.RecallSourcePinned, recallCandidateOptions(profile.shape, false))
	pinnedDuration := time.Since(pinnedStart)
	if err != nil {
		return nil, 0, err
	}
	insightStart := time.Now()
	insightCandidates, err := svc.memory.SearchCandidates(ctx, insightFilter, service.RecallSourceInsight, recallCandidateOptions(profile.shape, true))
	insightDuration := time.Since(insightStart)
	if err != nil {
		return nil, 0, err
	}
	sessionStart := time.Now()
	sessionCandidates, err := svc.session.SearchCandidates(ctx, sessionFilter, service.RecallSourceSession, recallCandidateOptions(profile.shape, false))
	sessionDuration := time.Since(sessionStart)
	if err != nil {
		return nil, 0, err
	}

	pinnedCandidates = applyRecallConfidence(profile, pinnedCandidates)
	insightCandidates = applyRecallConfidence(profile, insightCandidates)
	sessionCandidates = applyRecallConfidence(profile, sessionCandidates)

	selectionStart := time.Now()
	pinned, seen := selectPinnedRecallCandidates(profile.shape, budget, pinnedCandidates)
	mixed, cutoffReason, stats := selectMixedRecallCandidates(profile, budget-len(pinned), append(insightCandidates, sessionCandidates...), seen)
	selectionDuration := time.Since(selectionStart)

	memories := append(pinned, mixed...)
	slog.InfoContext(ctx, "confidence recall search",
		"cluster_id", auth.ClusterID,
		"query_len", len(filter.Query),
		"shape", recallQueryShapeLabel(profile.shape),
		"selection_mode", stats.mode,
		"requested_limit", filter.Limit,
		"effective_budget", budget,
		"pinned_candidates", len(pinnedCandidates),
		"insight_candidates", len(insightCandidates),
		"session_candidates", len(sessionCandidates),
		"pinned_selected", len(pinned),
		"insight_selected", stats.insightSelected,
		"session_selected", stats.sessionSelected,
		"coverage_token_count", stats.coverageTokenCount,
		"coverage_first_pass_selected", stats.coverageFirstPassCount,
		"backfill_selected", stats.backfillCount,
		"returned", len(memories),
		"cutoff_reason", cutoffReason,
		"pinned_ms", pinnedDuration.Milliseconds(),
		"insight_ms", insightDuration.Milliseconds(),
		"session_ms", sessionDuration.Milliseconds(),
		"selection_ms", selectionDuration.Milliseconds(),
		"total_ms", time.Since(start).Milliseconds(),
	)
	return memories, len(memories), nil
}

func (s *Server) singlePoolConfidenceRecallSearch(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
) ([]domain.Memory, int, error) {
	start := time.Now()
	if filter.Query == "" || filter.Limit <= 0 {
		return []domain.Memory{}, 0, nil
	}

	var (
		candidates     []service.RecallCandidate
		err            error
		minConfidence  = defaultMixedMinConfidence
		applyGapCutoff = true
	)

	profile := buildRecallQueryProfile(filter.Query)
	effectiveFilter := filter
	effectiveFilter.Limit = effectiveRecallBudget(profile.shape, filter.Limit)

	candidateStart := time.Now()
	switch filter.MemoryType {
	case string(domain.TypeSession):
		candidates, err = svc.session.SearchCandidates(ctx, effectiveFilter, service.RecallSourceSession, recallCandidateOptions(profile.shape, false))
	case string(domain.TypePinned):
		candidates, err = svc.memory.SearchCandidates(ctx, effectiveFilter, service.RecallSourcePinned, recallCandidateOptions(profile.shape, false))
		minConfidence = defaultPinnedMinConfidence
		applyGapCutoff = false
	case string(domain.TypeInsight):
		candidates, err = svc.memory.SearchCandidates(ctx, effectiveFilter, service.RecallSourceInsight, recallCandidateOptions(profile.shape, true))
	default:
		return []domain.Memory{}, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	candidateDuration := time.Since(candidateStart)

	candidates = applyRecallConfidence(profile, candidates)
	var (
		memories     []domain.Memory
		cutoffReason string
		stats        recallSelectionStats
	)
	selectionStart := time.Now()
	if profile.shape == recallQueryShapeEnumeration {
		memories, cutoffReason, stats = selectEnumerationRecallCandidates(profile, effectiveFilter.Limit, candidates, nil)
	} else {
		memories, cutoffReason = selectTopRecallCandidates(profile.shape, effectiveFilter.Limit, minConfidence, applyGapCutoff, candidates, nil)
		stats.mode = "top"
	}
	selectionDuration := time.Since(selectionStart)

	pinnedSelected := 0
	if filter.MemoryType == string(domain.TypePinned) {
		pinnedSelected = len(memories)
	}
	slog.InfoContext(ctx, "single-pool confidence recall",
		"cluster_id", auth.ClusterID,
		"query_len", len(filter.Query),
		"shape", recallQueryShapeLabel(profile.shape),
		"selection_mode", stats.mode,
		"memory_type", filter.MemoryType,
		"requested_limit", filter.Limit,
		"effective_budget", effectiveFilter.Limit,
		"candidates", len(candidates),
		"pinned_selected", pinnedSelected,
		"insight_selected", stats.insightSelected,
		"session_selected", stats.sessionSelected,
		"coverage_token_count", stats.coverageTokenCount,
		"coverage_first_pass_selected", stats.coverageFirstPassCount,
		"backfill_selected", stats.backfillCount,
		"returned", len(memories),
		"cutoff_reason", cutoffReason,
		"candidate_ms", candidateDuration.Milliseconds(),
		"selection_ms", selectionDuration.Milliseconds(),
		"total_ms", time.Since(start).Milliseconds(),
	)
	return memories, len(memories), nil
}

func applyRecallConfidence(profile recallQueryProfile, candidates []service.RecallCandidate) []service.RecallCandidate {
	out := make([]service.RecallCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		confidence := buildRecallConfidence(profile, candidate)
		candidate.Memory.Confidence = &confidence
		out = append(out, candidate)
	}
	return out
}

func buildRecallConfidence(profile recallQueryProfile, candidate service.RecallCandidate) int {
	rrfNorm := clampFloat64(candidate.RRFScore/recallRRFMaxScore, 0, 1)
	vecNorm := 0.0
	if candidate.InVector {
		vecNorm = clampFloat64((candidate.VectorSimilarity-0.30)/0.70, 0, 1)
	}

	agreementBonus := 0.0
	if candidate.InVector && candidate.InKeyword {
		agreementBonus = 0.10
	}

	confidenceRaw := 0.55*rrfNorm +
		0.20*vecNorm +
		agreementBonus +
		recencyBonus(candidate.Memory.UpdatedAt) +
		answerEvidenceBonus(profile, candidate.Memory) +
		sourcePrior(profile.shape, candidate.SourcePool)

	return int(clampFloat64(confidenceRaw, 0, 1)*100 + 0.5)
}

func selectPinnedRecallCandidates(
	shape recallQueryShape,
	budget int,
	candidates []service.RecallCandidate,
) ([]domain.Memory, map[string]struct{}) {
	if budget <= 0 {
		return []domain.Memory{}, map[string]struct{}{}
	}

	selected, _ := selectTopRecallCandidates(shape, minInt(pinnedKeepMax(shape), budget), defaultPinnedMinConfidence, false, candidates, nil)
	seen := make(map[string]struct{}, len(selected))
	for _, mem := range selected {
		seen[recallMemoryKey(mem)] = struct{}{}
	}
	return selected, seen
}

func selectMixedRecallCandidates(
	profile recallQueryProfile,
	budget int,
	candidates []service.RecallCandidate,
	seen map[string]struct{},
) ([]domain.Memory, string, recallSelectionStats) {
	if profile.shape == recallQueryShapeEnumeration {
		return selectEnumerationRecallCandidates(profile, budget, candidates, seen)
	}
	memories, cutoffReason := selectTopRecallCandidates(profile.shape, budget, defaultMixedMinConfidence, true, candidates, seen)
	return memories, cutoffReason, recallSelectionStats{mode: "top"}
}

func effectiveRecallBudget(shape recallQueryShape, requested int) int {
	if requested <= 0 {
		return 0
	}
	if shape != recallQueryShapeEnumeration {
		return requested
	}
	return minInt(requested*enumerationBudgetMultiplier, enumerationMaxBudget)
}

func recallCandidateLimit(shape recallQueryShape, pool service.RecallSourcePool) int {
	if shape == recallQueryShapeEnumeration {
		switch pool {
		case service.RecallSourcePinned:
			return defaultPinnedCandidateLimit
		case service.RecallSourceInsight, service.RecallSourceSession:
			return enumerationCandidateLimit
		}
	}

	switch pool {
	case service.RecallSourcePinned:
		return defaultPinnedCandidateLimit
	case service.RecallSourceInsight:
		return defaultInsightCandidateLimit
	case service.RecallSourceSession:
		return defaultSessionCandidateLimit
	default:
		return defaultSessionCandidateLimit
	}
}

func pinnedKeepMax(shape recallQueryShape) int {
	if shape == recallQueryShapeEnumeration {
		return enumerationPinnedKeepMax
	}
	return defaultPinnedKeepMax
}

func recallCandidateOptions(shape recallQueryShape, enableSecondHop bool) service.RecallCandidateOptions {
	opts := service.RecallCandidateOptions{
		EnableSecondHop: enableSecondHop,
	}
	if shape == recallQueryShapeEnumeration {
		opts.FetchMultiplier = enumerationFetchMultiplier
		if enableSecondHop {
			opts.SecondHopTopN = enumerationSecondHopTopN
		}
	}
	return opts
}

func selectEnumerationRecallCandidates(
	profile recallQueryProfile,
	budget int,
	candidates []service.RecallCandidate,
	seen map[string]struct{},
) ([]domain.Memory, string, recallSelectionStats) {
	stats := recallSelectionStats{mode: "enumeration"}
	if budget <= 0 {
		return []domain.Memory{}, "budget_exhausted", stats
	}

	deduped := dedupeRecallCandidates(profile.shape, candidates)
	if len(deduped) == 0 {
		return []domain.Memory{}, "no_candidates", stats
	}

	if seen == nil {
		seen = make(map[string]struct{}, budget)
	}

	queryTokens := extractRecallQueryTokens(profile.lower)
	coverageSeen := make(map[string]struct{}, budget*2)
	selected := make([]domain.Memory, 0, minInt(budget, len(deduped)))
	cutoffReason := "budget_exhausted"

	buckets := splitEnumerationBuckets(deduped)
	progress := true
	for len(selected) < budget && progress {
		progress = false
		for i := range buckets {
			candidate, tokens, ok := nextEnumerationCandidate(&buckets[i].index, buckets[i].candidates, seen, enumerationMinConfidence, queryTokens, coverageSeen, true)
			if !ok {
				continue
			}
			rememberRecallCoverage(tokens, coverageSeen)
			rememberRecallCandidate(candidate, seen, &selected)
			recordRecallSourceSelection(&stats, candidate.SourcePool)
			stats.coverageFirstPassCount++
			progress = true
			if len(selected) >= budget {
				break
			}
		}
	}

	for _, candidate := range deduped {
		if len(selected) >= budget {
			break
		}
		key := recallMemoryKey(candidate.Memory)
		if _, exists := seen[key]; exists {
			continue
		}
		confidence := recallConfidenceValue(candidate.Memory)
		if confidence < enumerationMinConfidence {
			cutoffReason = "min_confidence"
			break
		}
		tokens := extractRecallCoverageTokens(candidate.Memory, queryTokens)
		rememberRecallCoverage(tokens, coverageSeen)
		rememberRecallCandidate(candidate, seen, &selected)
		recordRecallSourceSelection(&stats, candidate.SourcePool)
		stats.backfillCount++
	}

	if len(selected) == 0 && cutoffReason == "budget_exhausted" {
		cutoffReason = "no_selected"
	}
	stats.coverageTokenCount = len(coverageSeen)
	return selected, cutoffReason, stats
}

type enumerationBucket struct {
	candidates []service.RecallCandidate
	index      int
}

func splitEnumerationBuckets(candidates []service.RecallCandidate) []enumerationBucket {
	var insight []service.RecallCandidate
	var session []service.RecallCandidate
	var pinned []service.RecallCandidate
	var other []service.RecallCandidate

	for _, candidate := range candidates {
		switch candidate.SourcePool {
		case service.RecallSourceInsight:
			insight = append(insight, candidate)
		case service.RecallSourceSession:
			session = append(session, candidate)
		case service.RecallSourcePinned:
			pinned = append(pinned, candidate)
		default:
			other = append(other, candidate)
		}
	}

	return []enumerationBucket{
		{candidates: insight},
		{candidates: session},
		{candidates: pinned},
		{candidates: other},
	}
}

func nextEnumerationCandidate(
	index *int,
	candidates []service.RecallCandidate,
	seen map[string]struct{},
	minConfidence int,
	queryTokens map[string]struct{},
	coverageSeen map[string]struct{},
	requireNewCoverage bool,
) (service.RecallCandidate, []string, bool) {
	for *index < len(candidates) {
		candidate := candidates[*index]
		*index++

		key := recallMemoryKey(candidate.Memory)
		if _, exists := seen[key]; exists {
			continue
		}
		if recallConfidenceValue(candidate.Memory) < minConfidence {
			continue
		}

		tokens := extractRecallCoverageTokens(candidate.Memory, queryTokens)
		if requireNewCoverage && !introducesNewCoverage(tokens, coverageSeen) {
			continue
		}
		return candidate, tokens, true
	}
	return service.RecallCandidate{}, nil, false
}

func rememberRecallCandidate(candidate service.RecallCandidate, seen map[string]struct{}, selected *[]domain.Memory) {
	key := recallMemoryKey(candidate.Memory)
	seen[key] = struct{}{}
	*selected = append(*selected, candidate.Memory)
}

func recordRecallSourceSelection(stats *recallSelectionStats, pool service.RecallSourcePool) {
	switch pool {
	case service.RecallSourceInsight:
		stats.insightSelected++
	case service.RecallSourceSession:
		stats.sessionSelected++
	}
}

func introducesNewCoverage(tokens []string, coverageSeen map[string]struct{}) bool {
	for _, token := range tokens {
		if _, exists := coverageSeen[token]; !exists {
			return true
		}
	}
	return false
}

func rememberRecallCoverage(tokens []string, coverageSeen map[string]struct{}) {
	for _, token := range tokens {
		coverageSeen[token] = struct{}{}
	}
}

func selectTopRecallCandidates(
	shape recallQueryShape,
	budget int,
	minConfidence int,
	applyGapCutoff bool,
	candidates []service.RecallCandidate,
	seen map[string]struct{},
) ([]domain.Memory, string) {
	if budget <= 0 {
		return []domain.Memory{}, "budget_exhausted"
	}

	deduped := dedupeRecallCandidates(shape, candidates)
	if len(deduped) == 0 {
		return []domain.Memory{}, "no_candidates"
	}

	if seen == nil {
		seen = make(map[string]struct{}, budget)
	}

	selected := make([]domain.Memory, 0, minInt(budget, len(deduped)))
	cutoffReason := "budget_exhausted"
	lastConfidence := -1

	for _, candidate := range deduped {
		if len(selected) >= budget {
			break
		}
		key := recallMemoryKey(candidate.Memory)
		if _, exists := seen[key]; exists {
			continue
		}

		confidence := recallConfidenceValue(candidate.Memory)
		if confidence < minConfidence {
			cutoffReason = "min_confidence"
			break
		}
		if applyGapCutoff && lastConfidence >= 0 && lastConfidence-confidence > defaultConfidenceGapStop {
			cutoffReason = "confidence_gap"
			break
		}

		seen[key] = struct{}{}
		selected = append(selected, candidate.Memory)
		lastConfidence = confidence
	}

	if len(selected) == 0 && cutoffReason == "budget_exhausted" {
		cutoffReason = "no_selected"
	}
	return selected, cutoffReason
}

func dedupeRecallCandidates(shape recallQueryShape, candidates []service.RecallCandidate) []service.RecallCandidate {
	bestByKey := make(map[string]service.RecallCandidate, len(candidates))
	for _, candidate := range candidates {
		key := recallMemoryKey(candidate.Memory)
		if existing, ok := bestByKey[key]; !ok || recallCandidateLess(shape, existing, candidate) {
			bestByKey[key] = candidate
		}
	}

	out := make([]service.RecallCandidate, 0, len(bestByKey))
	for _, candidate := range bestByKey {
		out = append(out, candidate)
	}
	sort.Slice(out, func(i, j int) bool {
		return recallCandidateLess(shape, out[j], out[i])
	})
	return out
}

func recallCandidateLess(shape recallQueryShape, left, right service.RecallCandidate) bool {
	leftConfidence := recallConfidenceValue(left.Memory)
	rightConfidence := recallConfidenceValue(right.Memory)
	if leftConfidence != rightConfidence {
		return leftConfidence < rightConfidence
	}

	leftPref := sourcePreference(shape, left.SourcePool)
	rightPref := sourcePreference(shape, right.SourcePool)
	if leftPref != rightPref {
		return leftPref < rightPref
	}

	if !left.Memory.UpdatedAt.Equal(right.Memory.UpdatedAt) {
		return left.Memory.UpdatedAt.Before(right.Memory.UpdatedAt)
	}
	return left.Memory.ID > right.Memory.ID
}

func sourcePreference(shape recallQueryShape, pool service.RecallSourcePool) int {
	if isExactRecallShape(shape) {
		switch pool {
		case service.RecallSourceSession:
			return 2
		case service.RecallSourceInsight:
			return 1
		default:
			return 0
		}
	}
	if shape == recallQueryShapeTime {
		switch pool {
		case service.RecallSourceSession:
			return 2
		case service.RecallSourceInsight:
			return 1
		default:
			return 0
		}
	}

	switch pool {
	case service.RecallSourceInsight:
		return 2
	case service.RecallSourceSession:
		return 1
	default:
		return 0
	}
}

func sourcePrior(shape recallQueryShape, pool service.RecallSourcePool) float64 {
	switch pool {
	case service.RecallSourceSession:
		if isExactRecallShape(shape) {
			return 0.15
		}
		if shape == recallQueryShapeTime {
			return 0.08
		}
	case service.RecallSourceInsight:
		if shape == recallQueryShapeGeneral {
			return 0.10
		}
	}
	return 0
}

func answerEvidenceBonus(profile recallQueryProfile, memory domain.Memory) float64 {
	content, temporalDisplay, temporalKind := recallContentForScoring(memory)
	shape := profile.shape
	lower := strings.ToLower(content)
	unitCount := recallAnswerUnitCount(content)
	entitySignals := recallEntitySignalCount(content)
	namedCJKAnswer := hasStandaloneCJKNamedAnswer(content)

	bonus := 0.0
	if unitCount > 0 && unitCount <= 18 {
		bonus += 0.05
	}

	switch shape {
	case recallQueryShapeCount:
		if answerNumberRe.MatchString(content) || answerCNCountRe.MatchString(content) {
			bonus += 0.20
		}
		if answerCountWordRe.MatchString(lower) || answerCNCountWordRe.MatchString(content) {
			bonus += 0.10
		}
		if containsRecallListCue(lower, content) {
			bonus += 0.05
		}
	case recallQueryShapeEntity, recallQueryShapeExact:
		if answerQuotedOrCJKQuotedRe.MatchString(content) || answerAcronymRe.MatchString(content) {
			bonus += 0.20
		}
		if entitySignals > 1 {
			bonus += 0.20
		}
		if namedCJKAnswer {
			bonus += 0.12
		}
		if shape == recallQueryShapeExact && unitCount > 0 && unitCount <= 12 {
			bonus += 0.12
		}
	case recallQueryShapeTime:
		bonus += timeAnswerEvidenceBonus(profile, content, temporalDisplay, temporalKind)
	case recallQueryShapeLocation:
		if containsRecallLocationCue(content) {
			bonus += 0.20
		}
		if entitySignals > 1 {
			bonus += 0.20
		}
		if namedCJKAnswer {
			bonus += 0.10
		}
	case recallQueryShapeEnumeration:
		queryTokens := extractRecallQueryTokens(profile.lower)
		coverageTokens := extractRecallCoverageTokens(memory, queryTokens)
		if containsRecallEnumerationCue(lower, content) {
			bonus += 0.12
		}
		if answerQuotedOrCJKQuotedRe.MatchString(content) || entitySignals > 0 {
			bonus += 0.10
		}
		if unitCount >= 2 && unitCount <= 24 {
			bonus += 0.08
		}
		switch {
		case len(coverageTokens) >= 2:
			bonus += 0.18
		case len(coverageTokens) == 1:
			bonus += 0.12
		}
	}

	return bonus
}

func containsRecallEnumerationCue(lower, content string) bool {
	switch {
	case containsRecallListCue(lower, content):
		return true
	case strings.Contains(lower, " including "), strings.Contains(lower, " such as "), strings.Contains(lower, " both "), strings.Contains(lower, " together with "):
		return true
	case strings.Contains(content, "包括"), strings.Contains(content, "例如"), strings.Contains(content, "以及"):
		return true
	default:
		return false
	}
}

func extractRecallQueryTokens(lower string) map[string]struct{} {
	if strings.TrimSpace(lower) == "" {
		return nil
	}

	tokens := make(map[string]struct{})
	for _, match := range recallCoverageEnglishTokenRe.FindAllString(lower, -1) {
		addRecallCoverageToken(tokens, match, nil)
	}
	for _, match := range recallCoverageCJKTokenRe.FindAllString(lower, -1) {
		addRecallCoverageToken(tokens, match, nil)
	}
	return tokens
}

func extractRecallCoverageTokens(memory domain.Memory, queryTokens map[string]struct{}) []string {
	content, _, _ := recallContentForScoring(memory)
	tokens := make(map[string]struct{}, len(memory.Tags)+4)

	for _, tag := range memory.Tags {
		addRecallCoverageToken(tokens, tag, queryTokens)
	}
	for _, match := range answerQuotedOrCJKQuotedRe.FindAllString(content, -1) {
		addRecallCoverageToken(tokens, match, queryTokens)
	}
	for _, match := range answerTitleCaseRe.FindAllString(content, -1) {
		addRecallCoverageToken(tokens, match, queryTokens)
	}

	lower := strings.ToLower(content)
	for _, match := range recallCoverageEnglishTokenRe.FindAllString(lower, -1) {
		addRecallCoverageToken(tokens, match, queryTokens)
	}
	for _, match := range recallCoverageCJKTokenRe.FindAllString(content, -1) {
		addRecallCoverageToken(tokens, match, queryTokens)
	}

	out := make([]string, 0, len(tokens))
	for token := range tokens {
		out = append(out, token)
	}
	sort.Strings(out)
	return out
}

func addRecallCoverageToken(tokens map[string]struct{}, raw string, queryTokens map[string]struct{}) {
	token := normalizeRecallCoverageToken(raw)
	if token == "" || isRecallCoverageStopword(token) {
		return
	}
	if queryTokens != nil {
		if _, exists := queryTokens[token]; exists {
			return
		}
	}
	tokens[token] = struct{}{}
}

func normalizeRecallCoverageToken(raw string) string {
	token := trimRecallAnswer(strings.ToLower(strings.TrimSpace(raw)))
	token = recallCoverageSpaceRe.ReplaceAllString(token, " ")
	if len([]rune(token)) < 2 {
		return ""
	}
	return token
}

func isRecallCoverageStopword(token string) bool {
	switch token {
	case "what", "which", "with", "does", "have", "has", "done", "did", "they", "them", "their", "this", "that", "those", "these":
		return true
	case "activity", "activities", "books", "book", "events", "event", "items", "item", "pets", "pet", "names", "name", "types", "type", "kinds", "kind":
		return true
	case "some", "many", "more", "very", "really", "often", "about", "into", "from", "over", "after", "before":
		return true
	case "哪些", "什么", "哪些活动", "活动", "做过", "参加过", "名字", "类型", "事件", "书":
		return true
	default:
		return false
	}
}

func recallContentForScoring(memory domain.Memory) (string, string, string) {
	content, legacyDisplay := service.CleanTemporalContent(memory.Content)
	content = service.StripTemporalProjection(content)
	if content == "" {
		content = strings.TrimSpace(memory.Content)
	}

	display := legacyDisplay
	kind := ""
	if meta, ok := service.ParseTemporalMetadata(memory.Metadata); ok && meta != nil {
		if meta.Display != "" {
			display = meta.Display
		}
		kind = meta.Kind
	}
	return content, display, kind
}

func buildRecallQueryProfile(query string) recallQueryProfile {
	lower := strings.ToLower(strings.TrimSpace(query))
	profile := recallQueryProfile{
		shape: classifyRecallQueryShape(query),
		lower: lower,
	}
	if profile.shape == recallQueryShapeTime {
		profile.temporalIntent = classifyRecallTemporalIntent(lower)
		profile.temporalTokens = extractRecallTemporalTokens(lower)
	}
	return profile
}

func classifyRecallTemporalIntent(lower string) recallTemporalIntent {
	switch {
	case strings.HasPrefix(lower, "when did "), strings.Contains(lower, " happen"), strings.Contains(lower, " happened"), strings.Contains(lower, " last "), strings.Contains(lower, " ago "):
		return recallTemporalIntentPast
	case strings.HasPrefix(lower, "when will "), strings.Contains(lower, " plan"), strings.Contains(lower, "planning"), strings.Contains(lower, " going to "), strings.Contains(lower, " scheduled"), strings.Contains(lower, " upcoming"):
		return recallTemporalIntentFuture
	case strings.Contains(lower, "什么时候会"), strings.Contains(lower, "什么时候准备"), strings.Contains(lower, "什么时候计划"), strings.Contains(lower, "什么时候去"):
		return recallTemporalIntentFuture
	case strings.Contains(lower, "什么时候"), strings.Contains(lower, "何时"), strings.Contains(lower, "几号"), strings.Contains(lower, "哪天"):
		return recallTemporalIntentPast
	default:
		return recallTemporalIntentAny
	}
}

func extractRecallTemporalTokens(lower string) []string {
	matches := recallTemporalTokenRe.FindAllString(lower, -1)
	seen := make(map[string]struct{}, len(matches))
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		if _, ok := seen[match]; ok {
			continue
		}
		seen[match] = struct{}{}
		out = append(out, match)
	}
	return out
}

func timeAnswerEvidenceBonus(profile recallQueryProfile, content, temporalDisplay, temporalKind string) float64 {
	fullLower := strings.ToLower(content)
	body, hasHeaderAnchor := stripRecallTemporalHeader(content)
	bodyLower := strings.ToLower(body)

	bonus := 0.0
	bodyHasExplicitDate := answerYearRe.MatchString(body) || containsMonthName(bodyLower) || answerCNTimeRe.MatchString(body)
	bodyHasRelativeDate := answerRelativeTimeRe.MatchString(body) || answerCNRelativeTimeRe.MatchString(body)
	bodyHasAnchoredPeriod := answerAnchoredPeriodRe.MatchString(bodyLower)

	switch {
	case bodyHasExplicitDate:
		bonus += 0.20
	case bodyHasRelativeDate:
		bonus += 0.16
	}
	if bodyHasAnchoredPeriod {
		bonus += 0.08
	}
	if hasHeaderAnchor && (bodyHasRelativeDate || bodyHasAnchoredPeriod) {
		bonus += 0.08
	} else if hasHeaderAnchor && !bodyHasExplicitDate && !bodyHasRelativeDate && !bodyHasAnchoredPeriod {
		bonus += 0.03
	}
	if temporalDisplay != "" {
		switch {
		case bodyHasExplicitDate || bodyHasRelativeDate || bodyHasAnchoredPeriod:
			bonus += 0.02
		case temporalKind == "deictic_relative":
			bonus += 0.05
		default:
			bonus += 0.03
		}
	}
	if len(profile.temporalTokens) > 0 {
		bonus += temporalConstraintMatchBonus(profile.temporalTokens, fullLower)
		if temporalDisplay != "" {
			bonus += 0.5 * temporalConstraintMatchBonus(profile.temporalTokens, strings.ToLower(temporalDisplay))
		}
	}
	switch profile.temporalIntent {
	case recallTemporalIntentFuture:
		if answerFutureCueRe.MatchString(body) {
			bonus += 0.12
		}
		if answerPastCueRe.MatchString(body) {
			bonus -= 0.10
		}
	case recallTemporalIntentPast:
		if answerPastCueRe.MatchString(body) {
			bonus += 0.06
		}
		if answerFutureCueRe.MatchString(body) {
			bonus -= 0.08
		}
	}
	if answerNegationRe.MatchString(body) {
		bonus -= 0.08
	}
	return bonus
}

func stripRecallTemporalHeader(content string) (string, bool) {
	header := recallLeadingBracketRunRe.FindString(content)
	if header == "" {
		return content, false
	}
	body := strings.TrimSpace(strings.TrimPrefix(content, header))
	headerLower := strings.ToLower(header)
	hasAnchor := answerYearRe.MatchString(header) || containsMonthName(headerLower) || answerCNTimeRe.MatchString(header) || strings.Contains(headerLower, " on ")
	return body, hasAnchor
}

func temporalConstraintMatchBonus(tokens []string, lowerContent string) float64 {
	if len(tokens) == 0 {
		return 0
	}
	matches := 0
	for _, token := range tokens {
		if strings.Contains(lowerContent, token) {
			matches++
		}
	}
	switch {
	case matches >= 2:
		return 0.18
	case matches == 1:
		return 0.10
	default:
		return 0
	}
}

func recallEntitySignalCount(content string) int {
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

func classifyRecallQueryShape(query string) recallQueryShape {
	trimmed := strings.TrimSpace(query)
	lower := strings.ToLower(trimmed)

	switch {
	case hasAnyPrefix(trimmed, "什么时候", "何时", "什么时间", "哪天", "哪年", "几月", "几号", "几点"):
		return recallQueryShapeTime
	case hasAnyPrefix(trimmed, "哪里", "哪儿", "在哪", "什么地方", "哪座城市", "哪座"):
		return recallQueryShapeLocation
	case strings.HasPrefix(lower, "how many"), strings.HasPrefix(lower, "how much"):
		return recallQueryShapeCount
	case hasAnyPrefix(trimmed, "有多少", "多少个", "多少次", "多少", "几个", "几次"):
		return recallQueryShapeCount
	case isEnumerationRecallQuery(trimmed, lower):
		return recallQueryShapeEnumeration
	case strings.HasPrefix(lower, "who "), strings.HasPrefix(lower, "which "):
		return recallQueryShapeEntity
	case hasAnyPrefix(trimmed, "谁", "哪个", "哪位", "哪家", "哪一个"):
		return recallQueryShapeEntity
	case strings.HasPrefix(lower, "when "):
		return recallQueryShapeTime
	case strings.HasPrefix(lower, "where "):
		return recallQueryShapeLocation
	case strings.HasPrefix(lower, "what "):
		return recallQueryShapeExact
	case strings.HasPrefix(trimmed, "什么"):
		return recallQueryShapeExact
	default:
		return recallQueryShapeGeneral
	}
}

func isEnumerationRecallQuery(trimmed, lower string) bool {
	switch {
	case hasAnyPrefix(trimmed, "哪些", "有哪些", "都有什么", "做过哪些", "参加过哪些", "名字有哪些", "什么活动", "什么书", "什么事件", "什么名字", "什么类型"):
		return true
	case recallEnumerationTypeCueRe.MatchString(lower):
		return true
	case recallEnumerationBothCueRe.MatchString(lower):
		return true
	case strings.HasPrefix(lower, "what are ") && strings.Contains(lower, " names"):
		return true
	case strings.HasPrefix(lower, "what "), strings.HasPrefix(lower, "which "):
		return recallEnumerationPluralRe.MatchString(lower) || recallEnumerationDoneCueRe.MatchString(lower)
	default:
		return false
	}
}

func recallQueryShapeLabel(shape recallQueryShape) string {
	switch shape {
	case recallQueryShapeEntity:
		return "entity"
	case recallQueryShapeCount:
		return "count"
	case recallQueryShapeTime:
		return "time"
	case recallQueryShapeLocation:
		return "location"
	case recallQueryShapeEnumeration:
		return "enumeration"
	case recallQueryShapeExact:
		return "exact"
	default:
		return "general"
	}
}

func isExactRecallShape(shape recallQueryShape) bool {
	switch shape {
	case recallQueryShapeEntity, recallQueryShapeCount, recallQueryShapeTime, recallQueryShapeLocation, recallQueryShapeExact:
		return true
	default:
		return false
	}
}

func recencyBonus(updatedAt time.Time) float64 {
	age := time.Since(updatedAt)
	if age <= 7*24*time.Hour {
		return 0.05
	}
	if age <= 30*24*time.Hour {
		return 0.02
	}
	return 0
}

func recallAnswerUnitCount(content string) int {
	units := 0
	cjkRunes := 0
	inASCIIWord := false

	flushCJK := func() {
		if cjkRunes == 0 {
			return
		}
		units += (cjkRunes + 1) / 2
		cjkRunes = 0
	}

	for _, r := range content {
		switch {
		case unicode.In(r, unicode.Han):
			if inASCIIWord {
				inASCIIWord = false
			}
			cjkRunes++
		case r <= unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r)):
			flushCJK()
			if !inASCIIWord {
				units++
				inASCIIWord = true
			}
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			flushCJK()
			inASCIIWord = false
			units++
		default:
			flushCJK()
			inASCIIWord = false
		}
	}

	flushCJK()
	return units
}

func hasStandaloneCJKNamedAnswer(content string) bool {
	trimmed := trimRecallAnswer(content)
	if !answerStandaloneCJKNameRe.MatchString(trimmed) {
		return false
	}

	if strings.ContainsAny(trimmed, "的是了在有和及与并") {
		return false
	}
	for _, token := range []string{"很多", "喜欢", "办公", "工作", "发布", "部署", "使用", "需要", "支持", "负责", "经常"} {
		if strings.Contains(trimmed, token) {
			return false
		}
	}

	switch len([]rune(trimmed)) {
	case 2, 3, 4:
		return true
	}

	switch {
	case strings.HasSuffix(trimmed, "大学"), strings.HasSuffix(trimmed, "公司"), strings.HasSuffix(trimmed, "集团"):
		return true
	case strings.HasSuffix(trimmed, "银行"), strings.HasSuffix(trimmed, "学院"), strings.HasSuffix(trimmed, "医院"):
		return true
	case strings.HasSuffix(trimmed, "部门"), strings.HasSuffix(trimmed, "团队"):
		return true
	default:
		return false
	}
}

func containsRecallListCue(lower, content string) bool {
	switch {
	case strings.Contains(content, ","), strings.Contains(content, "，"), strings.Contains(content, "、"):
		return true
	case strings.Contains(lower, " and "):
		return true
	case answerCNListCueRe.MatchString(content):
		return true
	default:
		return false
	}
}

func containsRecallLocationCue(content string) bool {
	switch {
	case answerLocationCueRe.MatchString(content):
		return true
	case answerCNLocationSuffixRe.MatchString(content), answerCNLocationVerbRe.MatchString(content):
		return true
	case answerCNLocationDirectRe.MatchString(trimRecallAnswer(content)):
		return true
	default:
		return false
	}
}

func containsMonthName(lower string) bool {
	return answerMonthNameRe.MatchString(lower)
}

func trimRecallAnswer(content string) string {
	return strings.Trim(strings.TrimSpace(content), `"'“”「」『』《》.,!?，。；;:：()[]{}<>`)
}

func hasAnyPrefix(s string, prefixes ...string) bool {
	for _, prefix := range prefixes {
		if strings.HasPrefix(s, prefix) {
			return true
		}
	}
	return false
}

func clampFloat64(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func recallMemoryKey(mem domain.Memory) string {
	if mem.Content != "" {
		return mem.Content
	}
	return mem.ID
}

func recallConfidenceValue(mem domain.Memory) int {
	if mem.Confidence == nil {
		return 0
	}
	return *mem.Confidence
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
