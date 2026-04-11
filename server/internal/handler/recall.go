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
	defaultSessionCandidateLimit = 5
	defaultPinnedKeepMax         = 2
	defaultPinnedMinConfidence   = 70
	defaultMixedMinConfidence    = 65
	defaultConfidenceGapStop     = 18
	recallRRFMaxScore            = 2.0 / 61.0
)

var (
	answerAcronymRe           = regexp.MustCompile(`\b[A-Z]{2,}(?:[+-][A-Z0-9]+)*\b`)
	answerNumberRe            = regexp.MustCompile(`\b\d+\b`)
	answerYearRe              = regexp.MustCompile(`\b(?:19|20)\d{2}\b`)
	answerMonthNameRe         = regexp.MustCompile(`\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b`)
	answerWeekdayNameRe       = regexp.MustCompile(`\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b`)
	answerSeasonNameRe        = regexp.MustCompile(`\b(?:spring|summer|fall|autumn|winter)\b`)
	answerTitleCaseRe         = regexp.MustCompile(`\b[A-Z][a-z]+(?:['-][A-Za-z]+)*(?:\s+[A-Z][a-z]+(?:['-][A-Za-z]+)*)*\b`)
	answerLocationCueRe       = regexp.MustCompile(`\b(?:in|at|from|to|near|around|outside|inside)\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}\b`)
	answerCountWordRe         = regexp.MustCompile(`\b(?:one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several)\b`)
	answerQuotedOrCJKQuotedRe = regexp.MustCompile(`"[^"]+"|“[^”]+”|「[^」]+」|『[^』]+』|《[^》]+》`)
	answerCNCountRe           = regexp.MustCompile(`[零一二三四五六七八九十百千万两\d]+`)
	answerCNTimeRe            = regexp.MustCompile(`\d{4}年|\d{1,2}月|\d{1,2}[日号]|\d{1,2}点`)
	answerCNLocationSuffixRe  = regexp.MustCompile(`(?:在|位于|来自|住在)[^，。；,.!?]{1,24}(?:市|省|区|县|州|国|路|街|镇|村|湾|岛)`)
	answerCNLocationVerbRe    = regexp.MustCompile(`(?:在|位于|来自|住在)[^，。；,.!?]{1,12}(?:办公|工作|居住|生活|定居|出生|上班|读书|学习)`)
	answerCNLocationDirectRe  = regexp.MustCompile(`^(?:位于|来自|住在|在)[\p{Han}A-Za-z0-9·]{1,12}$`)
	answerCNCountWordRe       = regexp.MustCompile(`(?:一次|两次|三次|四次|五次|几次|多少次|多个|几个|若干)`)
	answerCNListCueRe         = regexp.MustCompile(`[\p{Han}\dA-Za-z](?:和|及|以及)[\p{Han}\dA-Za-z]`)
	answerStandaloneCJKNameRe = regexp.MustCompile(`^[\p{Han}·]{2,12}$`)
	answerRelativeTimeRe      = regexp.MustCompile(`(?i)\b(?:yesterday|today|tomorrow|last\s+(?:night|week|weekend|month|year|summer|winter|spring|fall|autumn|friday|saturday|sunday|monday|tuesday|wednesday|thursday)|next\s+(?:week|weekend|month|year|summer|winter|spring|fall|autumn|friday|saturday|sunday|monday|tuesday|wednesday|thursday)|this\s+(?:week|weekend|month|year|summer|winter|spring|fall|autumn)|\d+\s+(?:day|days|week|weeks|month|months|year|years)\s+ago|in\s+\d+\s+(?:day|days|week|weeks|month|months|year|years)|the\s+(?:past\s+)?(?:week|weekend))\b`)
	answerCNRelativeTimeRe    = regexp.MustCompile(`(?:昨天|今天|明天|前天|后天|上周|下周|本周|这周|上个月|下个月|这个月|本月|去年|今年|明年|上周[一二三四五六日天]|下周[一二三四五六日天]|周末|上个周末|下个周末|春天|夏天|秋天|冬天)`)
	answerAnchoredPeriodRe    = regexp.MustCompile(`(?i)\b(?:the\s+)?(?:week|weekend|month|year|summer|winter|spring|fall|autumn)\s+(?:before|after)\b`)
	answerFutureCueRe         = regexp.MustCompile(`(?i)\b(?:will|planning|plan|plans|planned|thinking about|going to|gonna|scheduled|upcoming|next\s+(?:week|weekend|month|year|summer|winter|spring|fall|autumn))\b|(?:计划|打算|准备|将要|将会|下周|下个月|明年)`)
	answerPastCueRe           = regexp.MustCompile(`(?i)\b(?:went|had|did|got|was|were|happened|previously|earlier|ago|last\s+(?:week|weekend|month|year|summer|winter|spring|fall|autumn|friday|saturday|sunday|monday|tuesday|wednesday|thursday))\b|(?:之前|以前|当时|去了|发生了|上周|上个月|去年|昨天|前天)`)
	answerNegationRe          = regexp.MustCompile(`(?i)\b(?:did not|didn't|never|no longer|not\b)\b|(?:没有|没|未)`)
	recallLeadingBracketRunRe = regexp.MustCompile(`^(?:\[[^\]\n]{0,160}\]\s*)+`)
	recallTemporalTokenRe     = regexp.MustCompile(`\b(?:19|20)\d{2}\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|spring|summer|fall|autumn|winter)\b|(?:\d{4}年|\d{1,2}月|昨天|今天|明天|上周|下周|去年|今年|明年|春天|夏天|秋天|冬天)`)
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
	recallQueryShapeExact
)

func (s *Server) defaultConfidenceRecallSearch(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
) ([]domain.Memory, int, error) {
	budget := filter.Limit
	if budget <= 0 {
		return []domain.Memory{}, 0, nil
	}

	pinnedFilter := filter
	pinnedFilter.MemoryType = string(domain.TypePinned)
	pinnedFilter.Limit = defaultPinnedCandidateLimit

	insightFilter := filter
	insightFilter.MemoryType = string(domain.TypeInsight)
	insightFilter.Limit = defaultInsightCandidateLimit

	sessionFilter := filter
	sessionFilter.Limit = defaultSessionCandidateLimit

	pinnedCandidates, err := svc.memory.SearchCandidates(ctx, pinnedFilter, service.RecallSourcePinned, false)
	if err != nil {
		return nil, 0, err
	}
	insightCandidates, err := svc.memory.SearchCandidates(ctx, insightFilter, service.RecallSourceInsight, true)
	if err != nil {
		return nil, 0, err
	}
	sessionCandidates, err := svc.session.SearchCandidates(ctx, sessionFilter, service.RecallSourceSession)
	if err != nil {
		return nil, 0, err
	}

	profile := buildRecallQueryProfile(filter.Query)
	pinnedCandidates = applyRecallConfidence(profile, pinnedCandidates)
	insightCandidates = applyRecallConfidence(profile, insightCandidates)
	sessionCandidates = applyRecallConfidence(profile, sessionCandidates)

	pinned, seen := selectPinnedRecallCandidates(profile.shape, budget, pinnedCandidates)
	mixed, cutoffReason := selectMixedRecallCandidates(profile.shape, budget-len(pinned), append(insightCandidates, sessionCandidates...), seen)

	memories := append(pinned, mixed...)
	slog.Info("confidence recall search",
		"cluster_id", auth.ClusterID,
		"query_len", len(filter.Query),
		"shape", recallQueryShapeLabel(profile.shape),
		"pinned_candidates", len(pinnedCandidates),
		"insight_candidates", len(insightCandidates),
		"session_candidates", len(sessionCandidates),
		"returned", len(memories),
		"cutoff_reason", cutoffReason,
	)
	return memories, len(memories), nil
}

func (s *Server) singlePoolConfidenceRecallSearch(
	ctx context.Context,
	auth *domain.AuthInfo,
	svc resolvedSvc,
	filter domain.MemoryFilter,
) ([]domain.Memory, int, error) {
	if filter.Query == "" || filter.Limit <= 0 {
		return []domain.Memory{}, 0, nil
	}

	var (
		candidates     []service.RecallCandidate
		err            error
		minConfidence  = defaultMixedMinConfidence
		applyGapCutoff = true
	)

	switch filter.MemoryType {
	case string(domain.TypeSession):
		candidates, err = svc.session.SearchCandidates(ctx, filter, service.RecallSourceSession)
	case string(domain.TypePinned):
		candidates, err = svc.memory.SearchCandidates(ctx, filter, service.RecallSourcePinned, false)
		minConfidence = defaultPinnedMinConfidence
		applyGapCutoff = false
	case string(domain.TypeInsight):
		candidates, err = svc.memory.SearchCandidates(ctx, filter, service.RecallSourceInsight, true)
	default:
		return []domain.Memory{}, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}

	profile := buildRecallQueryProfile(filter.Query)
	candidates = applyRecallConfidence(profile, candidates)
	memories, cutoffReason := selectTopRecallCandidates(profile.shape, filter.Limit, minConfidence, applyGapCutoff, candidates, nil)
	slog.Info("single-pool confidence recall",
		"cluster_id", auth.ClusterID,
		"query_len", len(filter.Query),
		"shape", recallQueryShapeLabel(profile.shape),
		"memory_type", filter.MemoryType,
		"candidates", len(candidates),
		"returned", len(memories),
		"cutoff_reason", cutoffReason,
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
		answerEvidenceBonus(profile, candidate.Memory.Content) +
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

	selected, _ := selectTopRecallCandidates(shape, minInt(defaultPinnedKeepMax, budget), defaultPinnedMinConfidence, false, candidates, nil)
	seen := make(map[string]struct{}, len(selected))
	for _, mem := range selected {
		seen[recallMemoryKey(mem)] = struct{}{}
	}
	return selected, seen
}

func selectMixedRecallCandidates(
	shape recallQueryShape,
	budget int,
	candidates []service.RecallCandidate,
	seen map[string]struct{},
) ([]domain.Memory, string) {
	return selectTopRecallCandidates(shape, budget, defaultMixedMinConfidence, true, candidates, seen)
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
	case service.RecallSourceInsight:
		if shape == recallQueryShapeGeneral {
			return 0.10
		}
	}
	return 0
}

func answerEvidenceBonus(profile recallQueryProfile, content string) float64 {
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
		bonus += timeAnswerEvidenceBonus(profile, content)
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
	}

	return bonus
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

func timeAnswerEvidenceBonus(profile recallQueryProfile, content string) float64 {
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
	if len(profile.temporalTokens) > 0 {
		bonus += temporalConstraintMatchBonus(profile.temporalTokens, fullLower)
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
