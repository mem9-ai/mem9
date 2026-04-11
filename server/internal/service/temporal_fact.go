package service

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	temporalKindExplicitAbsolute    = "explicit_absolute"
	temporalKindLocalAnchorRelative = "local_anchor_relative"
	temporalKindHeaderAnchorRelative = "header_anchor_relative"
	temporalKindDeicticRelative     = "deictic_relative"
)

const (
	temporalAnchorSourceLocal  = "local"
	temporalAnchorSourceHeader = "header"
	temporalAnchorSourceNow    = "now"
)

const (
	temporalGranularityDay    = "day"
	temporalGranularityWeek   = "week"
	temporalGranularityMonth  = "month"
	temporalGranularityYear   = "year"
	temporalGranularitySeason = "season"
)

type TemporalMetadata struct {
	Kind          string `json:"kind"`
	AnchorSource  string `json:"anchor_source,omitempty"`
	Granularity   string `json:"granularity,omitempty"`
	ResolvedStart string `json:"resolved_start,omitempty"`
	ResolvedEnd   string `json:"resolved_end,omitempty"`
	Display       string `json:"display,omitempty"`
}

type temporalMetadataEnvelope struct {
	Temporal *TemporalMetadata `json:"temporal,omitempty"`
}

type temporalAnchorCandidate struct {
	anchor time.Time
	tokens map[string]struct{}
}

type temporalAnchorDate struct {
	value   time.Time
	hasYear bool
}

var (
	temporalAnchorBracketRunRe = regexp.MustCompile(`^(?:\[[^\]\n]{0,160}\]\s*)+`)
	temporalAnchorDateOnRe     = regexp.MustCompile(`(?i)\bon\s+(\d{1,2}\s+[A-Za-z]+,\s+\d{4})`)
	temporalAnchorDateTagRe    = regexp.MustCompile(`(?i)\bdate:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})`)

	temporalLegacyAnnotationRe = regexp.MustCompile(`\(([^()|]*?(?:19|20)\d{2}[^()|]*)\|[^()]+\)`)
	temporalProjectionSuffixRe = regexp.MustCompile(`\s*\[time:\s*[^\]]+\]\s*$`)
	temporalISODateRe          = regexp.MustCompile(`\b\d{4}-\d{2}-\d{2}\b`)
	temporalISOMonthRe         = regexp.MustCompile(`\b\d{4}-\d{2}\b`)
	temporalLongDateRe         = regexp.MustCompile(`(?i)\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b|\b[A-Za-z]+\s+\d{1,2},\s+\d{4}\b`)
	temporalMonthYearRe        = regexp.MustCompile(`(?i)\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b`)
	temporalCNFullDateRe       = regexp.MustCompile(`\b\d{4}年\d{1,2}月\d{1,2}[日号]?\b`)
	temporalCNMonthDayRe       = regexp.MustCompile(`\b\d{1,2}月\d{1,2}[日号]?\b`)
	temporalCNMonthRe          = regexp.MustCompile(`\b\d{4}年\d{1,2}月\b`)
	temporalYearOnlyRe         = regexp.MustCompile(`\b(?:19|20)\d{2}\b`)
	temporalAnchoredPeriodRe   = regexp.MustCompile(`(?i)\b(?:the\s+)?(?:week|weekend|month|year|summer|winter|spring|fall|autumn)\s+(?:before|after)\s+(?:\d{1,2}\s+[A-Za-z]+,\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{4})\b`)

	temporalRelativeCueRe = regexp.MustCompile(`(?i)\b(?:yesterday|today|tomorrow|last\s+(?:night|week|weekend|month|year|summer|winter|spring|fall|autumn|friday|saturday|sunday|monday|tuesday|wednesday|thursday)|next\s+(?:week|weekend|month|year|summer|winter|spring|fall|autumn|friday|saturday|sunday|monday|tuesday|wednesday|thursday)|this\s+(?:week|weekend|month|year|summer|winter|spring|fall|autumn)|the\s+(?:past\s+)?(?:week|weekend))\b`)
	temporalCNRelativeRe  = regexp.MustCompile(`上周[一二三四五六日天]|下周[一二三四五六日天]|前天|昨天|今天|明天|后天|上周|本周|这周|下周|上个月|这个月|本月|下个月|去年|今年|明年`)
	temporalWordTokenRe   = regexp.MustCompile(`[A-Za-z]+(?:'[A-Za-z]+)?|\d+`)

	temporalLastYearRe    = regexp.MustCompile(`(?i)\blast year\b`)
	temporalThisYearRe    = regexp.MustCompile(`(?i)\bthis year\b`)
	temporalNextYearRe    = regexp.MustCompile(`(?i)\bnext year\b`)
	temporalLastMonthRe   = regexp.MustCompile(`(?i)\blast month\b`)
	temporalThisMonthRe   = regexp.MustCompile(`(?i)\bthis month\b`)
	temporalNextMonthRe   = regexp.MustCompile(`(?i)\bnext month\b`)
	temporalYesterdayRe   = regexp.MustCompile(`(?i)\byesterday\b`)
	temporalTodayRe       = regexp.MustCompile(`(?i)\btoday\b`)
	temporalTomorrowRe    = regexp.MustCompile(`(?i)\btomorrow\b`)
	temporalLastWeekRe    = regexp.MustCompile(`(?i)\blast week\b`)
	temporalThisWeekRe    = regexp.MustCompile(`(?i)\bthis week\b`)
	temporalNextWeekRe    = regexp.MustCompile(`(?i)\bnext week\b`)
	temporalPastWeekendRe = regexp.MustCompile(`(?i)\bthe past weekend\b`)
	temporalLastWeekendRe = regexp.MustCompile(`(?i)\blast weekend\b`)
	temporalThisWeekendRe = regexp.MustCompile(`(?i)\bthis weekend\b`)
	temporalNextWeekendRe = regexp.MustCompile(`(?i)\bnext weekend\b`)
	temporalLastSummerRe  = regexp.MustCompile(`(?i)\blast summer\b`)
	temporalThisSummerRe  = regexp.MustCompile(`(?i)\bthis summer\b`)
	temporalNextSummerRe  = regexp.MustCompile(`(?i)\bnext summer\b`)
	temporalLastWinterRe  = regexp.MustCompile(`(?i)\blast winter\b`)
	temporalThisWinterRe  = regexp.MustCompile(`(?i)\bthis winter\b`)
	temporalNextWinterRe  = regexp.MustCompile(`(?i)\bnext winter\b`)
	temporalLastSpringRe  = regexp.MustCompile(`(?i)\blast spring\b`)
	temporalThisSpringRe  = regexp.MustCompile(`(?i)\bthis spring\b`)
	temporalNextSpringRe  = regexp.MustCompile(`(?i)\bnext spring\b`)
	temporalLastFallRe    = regexp.MustCompile(`(?i)\blast fall\b|\blast autumn\b`)
	temporalThisFallRe    = regexp.MustCompile(`(?i)\bthis fall\b|\bthis autumn\b`)
	temporalNextFallRe    = regexp.MustCompile(`(?i)\bnext fall\b|\bnext autumn\b`)

	temporalCNLocalDayRelativeRe = regexp.MustCompile(`((?:\d{4}年)?\d{1,2}月\d{1,2}[日号]?)(?:的)?(前一天|后一天)`)
)

var temporalStopwords = map[string]struct{}{
	"a": {}, "an": {}, "and": {}, "are": {}, "as": {}, "at": {}, "be": {}, "by": {},
	"did": {}, "for": {}, "from": {}, "had": {}, "has": {}, "have": {}, "her": {}, "his": {},
	"in": {}, "is": {}, "it": {}, "its": {}, "my": {}, "of": {}, "on": {}, "our": {},
	"she": {}, "that": {}, "the": {}, "their": {}, "they": {}, "this": {}, "to": {}, "was": {},
	"we": {}, "were": {}, "with": {}, "would": {}, "you": {}, "your": {},
	"last": {}, "next": {}, "today": {}, "tomorrow": {}, "yesterday": {},
	"week": {}, "weekend": {}, "month": {}, "year": {}, "summer": {}, "winter": {}, "spring": {}, "fall": {}, "autumn": {},
	"今天": {}, "昨天": {}, "明天": {}, "前天": {}, "后天": {},
	"上周": {}, "下周": {}, "本周": {}, "这周": {}, "上个月": {}, "这个月": {}, "本月": {}, "下个月": {},
	"去年": {}, "今年": {}, "明年": {},
}

func MergeTemporalMetadata(existing json.RawMessage, temporal *TemporalMetadata) json.RawMessage {
	var payload map[string]json.RawMessage
	if len(existing) > 0 {
		if err := json.Unmarshal(existing, &payload); err != nil || payload == nil {
			if temporal == nil {
				return existing
			}
			payload = map[string]json.RawMessage{}
		}
	}
	if payload == nil {
		payload = map[string]json.RawMessage{}
	}

	if temporal == nil {
		delete(payload, "temporal")
		if len(payload) == 0 {
			return nil
		}
	} else {
		rawTemporal, err := json.Marshal(temporal)
		if err != nil {
			return existing
		}
		payload["temporal"] = rawTemporal
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return existing
	}
	return raw
}

func ParseTemporalMetadata(raw json.RawMessage) (*TemporalMetadata, bool) {
	if len(raw) == 0 {
		return nil, false
	}

	var envelope temporalMetadataEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil || envelope.Temporal == nil {
		return nil, false
	}
	return envelope.Temporal, true
}

func TemporalRecallProjection(content string, metadata json.RawMessage) string {
	cleaned, legacyDisplay := sanitizeLegacyTemporalContent(content)
	if cleaned == "" {
		cleaned = strings.TrimSpace(content)
	}

	if meta, ok := ParseTemporalMetadata(metadata); ok && shouldProjectTemporalDisplay(cleaned, meta.Display) {
		return cleaned + " [time: " + meta.Display + "]"
	}
	if shouldProjectTemporalDisplay(cleaned, legacyDisplay) {
		return cleaned + " [time: " + legacyDisplay + "]"
	}
	return cleaned
}

func ProjectTemporalFactText(content string, temporal *TemporalMetadata) string {
	return TemporalRecallProjection(content, MergeTemporalMetadata(nil, temporal))
}

func CleanTemporalContent(content string) (string, string) {
	return sanitizeLegacyTemporalContent(content)
}

func StripTemporalProjection(content string) string {
	cleaned, _ := sanitizeLegacyTemporalContent(content)
	if cleaned == "" {
		cleaned = strings.TrimSpace(content)
	}
	return strings.TrimSpace(temporalProjectionSuffixRe.ReplaceAllString(cleaned, ""))
}

func NormalizeTemporalRecallQuery(query string, now time.Time) string {
	query = strings.TrimSpace(query)
	if query == "" {
		return ""
	}

	if _, ok := resolveLocalAnchorDisplay(query); ok {
		return query
	}
	if hasExplicitAbsoluteTime(query) {
		return query
	}

	meta := buildDeicticTemporalMetadata(query, now, temporalAnchorSourceNow)
	if meta == nil {
		return query
	}
	return appendTemporalQueryTokens(query, meta.Display, temporalDisplayAliases(meta.Display))
}

func normalizeTemporalFacts(input preparedExtractionInput, facts []ExtractedFact) []ExtractedFact {
	return normalizeTemporalFactsAt(input, facts, time.Now())
}

func normalizeTemporalFactsAt(input preparedExtractionInput, facts []ExtractedFact, now time.Time) []ExtractedFact {
	anchors := buildTemporalAnchorCandidates(input.messages)
	out := make([]ExtractedFact, 0, len(facts))
	for _, fact := range facts {
		if strings.EqualFold(fact.FactType, factTypeQueryIntent) {
			out = append(out, fact)
			continue
		}
		if strings.EqualFold(fact.FactType, factTypeRawFallback) {
			out = append(out, normalizeRawFallbackFact(fact, anchors, now))
			continue
		}
		fact.Text, fact.Temporal = normalizeTemporalFactContent(fact.Text, anchors, now)
		out = append(out, fact)
	}
	return out
}

func normalizeRawFallbackFacts(input preparedExtractionInput, facts []ExtractedFact) []ExtractedFact {
	return normalizeRawFallbackFactsAt(input, facts, time.Now())
}

func normalizeRawFallbackFactsAt(input preparedExtractionInput, facts []ExtractedFact, now time.Time) []ExtractedFact {
	anchors := buildTemporalAnchorCandidates(input.messages)
	out := make([]ExtractedFact, 0, len(facts))
	for _, fact := range facts {
		out = append(out, normalizeRawFallbackFact(fact, anchors, now))
	}
	return out
}

func NormalizeStandaloneTemporalContent(content string, now time.Time) (string, *TemporalMetadata) {
	return normalizeTemporalFactContent(content, nil, now)
}

func normalizeRawFallbackFact(fact ExtractedFact, anchors []temporalAnchorCandidate, now time.Time) ExtractedFact {
	cleaned, _ := sanitizeLegacyTemporalContent(fact.Text)
	fact.Text = cleaned
	if display, ok := resolveLocalAnchorDisplay(cleaned); ok {
		fact.Temporal = buildDisplayTemporalMetadata(temporalKindLocalAnchorRelative, temporalAnchorSourceLocal, inferDisplayGranularity(display), display)
		return fact
	}
	if anchor, ok := selectTemporalAnchor(cleaned, anchors); ok {
		fact.Temporal = buildDeicticTemporalMetadata(cleaned, anchor, temporalAnchorSourceHeader)
		return fact
	}
	fact.Temporal = buildDeicticTemporalMetadata(cleaned, now, temporalAnchorSourceNow)
	return fact
}

func normalizeTemporalFactContent(text string, anchors []temporalAnchorCandidate, now time.Time) (string, *TemporalMetadata) {
	cleaned, _ := sanitizeLegacyTemporalContent(text)
	if cleaned == "" {
		return cleaned, nil
	}

	if rewritten, meta, ok := resolveLocalAnchorRelative(cleaned); ok {
		return rewritten, meta
	}
	if hasExplicitAbsoluteTime(cleaned) {
		return cleaned, nil
	}

	if anchor, ok := selectTemporalAnchor(cleaned, anchors); ok {
		if rewritten, meta, changed := resolveHeaderAnchoredRelative(cleaned, anchor); changed {
			return rewritten, meta
		}
		if meta := buildDeicticTemporalMetadata(cleaned, anchor, temporalAnchorSourceHeader); meta != nil {
			return cleaned, meta
		}
	}

	if meta := buildDeicticTemporalMetadata(cleaned, now, temporalAnchorSourceNow); meta != nil {
		return cleaned, meta
	}
	return cleaned, nil
}

func buildTemporalAnchorCandidates(messages []IngestMessage) []temporalAnchorCandidate {
	anchors := make([]temporalAnchorCandidate, 0, len(messages))
	for _, msg := range messages {
		if !strings.EqualFold(strings.TrimSpace(msg.Role), "user") {
			continue
		}
		anchor, body, ok := extractTemporalAnchor(msg.Content)
		if !ok {
			continue
		}
		anchors = append(anchors, temporalAnchorCandidate{
			anchor: anchor,
			tokens: temporalMatchTokens(body),
		})
	}
	return anchors
}

func extractTemporalAnchor(content string) (time.Time, string, bool) {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return time.Time{}, "", false
	}

	header := temporalAnchorBracketRunRe.FindString(trimmed)
	body := strings.TrimSpace(strings.TrimPrefix(trimmed, header))
	if header == "" {
		return time.Time{}, body, false
	}

	if match := temporalAnchorDateOnRe.FindStringSubmatch(header); len(match) == 2 {
		if anchor, ok := parseTemporalAnchorDate(match[1]); ok {
			return anchor, body, true
		}
	}
	if match := temporalAnchorDateTagRe.FindStringSubmatch(header); len(match) == 2 {
		if anchor, ok := parseTemporalAnchorDate(match[1]); ok {
			return anchor, body, true
		}
	}
	return time.Time{}, body, false
}

func parseTemporalAnchorDate(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	for _, layout := range []string{"2 January, 2006", "02 January, 2006", "2 January 2006", "02 January 2006"} {
		if parsed, err := time.ParseInLocation(layout, value, time.UTC); err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

func sanitizeLegacyTemporalContent(content string) (string, string) {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return "", ""
	}

	matches := temporalLegacyAnnotationRe.FindAllStringSubmatch(trimmed, -1)
	if len(matches) == 0 {
		return trimmed, ""
	}

	base := strings.TrimSpace(temporalLegacyAnnotationRe.ReplaceAllString(trimmed, ""))
	base = strings.Join(strings.Fields(base), " ")
	display := strings.TrimSpace(matches[0][1])

	if hasExplicitAbsoluteTime(base) {
		return base, ""
	}
	return base, display
}

func hasExplicitAbsoluteTime(text string) bool {
	switch {
	case text == "":
		return false
	case temporalAnchoredPeriodRe.MatchString(text):
		return true
	case temporalISODateRe.MatchString(text), temporalISOMonthRe.MatchString(text):
		return true
	case temporalLongDateRe.MatchString(text), temporalMonthYearRe.MatchString(strings.ToLower(text)):
		return true
	case temporalCNFullDateRe.MatchString(text), temporalCNMonthRe.MatchString(text):
		return true
	case temporalCNMonthDayRe.MatchString(text):
		return true
	case temporalYearOnlyRe.MatchString(text):
		return true
	default:
		return false
	}
}

func resolveLocalAnchorRelative(text string) (string, *TemporalMetadata, bool) {
	match := temporalCNLocalDayRelativeRe.FindStringSubmatchIndex(text)
	if len(match) == 0 {
		return text, nil, false
	}

	anchorRaw := text[match[2]:match[3]]
	dirRaw := text[match[4]:match[5]]
	anchor, ok := parseChineseAnchorDate(anchorRaw)
	if !ok {
		return text, nil, false
	}

	offset := -1
	if dirRaw == "后一天" {
		offset = 1
	}
	resolved := anchor.value.AddDate(0, 0, offset)
	display := formatAnchorDisplay(anchor.hasYear, resolved)
	resolvedDisplay := display
	if anchor.hasYear {
		resolvedDisplay = formatISODate(resolved)
	}

	var b strings.Builder
	b.WriteString(text[:match[0]])
	b.WriteString(display)
	b.WriteString(text[match[1]:])

	meta := buildDisplayTemporalMetadata(
		temporalKindLocalAnchorRelative,
		temporalAnchorSourceLocal,
		temporalGranularityDay,
		resolvedDisplay,
	)
	return strings.TrimSpace(b.String()), meta, true
}

func resolveLocalAnchorDisplay(text string) (string, bool) {
	match := temporalCNLocalDayRelativeRe.FindStringSubmatch(text)
	if len(match) != 3 {
		return "", false
	}
	anchor, ok := parseChineseAnchorDate(match[1])
	if !ok {
		return "", false
	}
	offset := -1
	if match[2] == "后一天" {
		offset = 1
	}
	return formatAnchorDisplay(anchor.hasYear, anchor.value.AddDate(0, 0, offset)), true
}

func parseChineseAnchorDate(raw string) (temporalAnchorDate, bool) {
	raw = strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(raw, "日"), "号"))

	var year, month, day int
	if strings.Contains(raw, "年") {
		if _, err := fmt.Sscanf(raw, "%d年%d月%d", &year, &month, &day); err == nil {
			return temporalAnchorDate{
				value:   time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC),
				hasYear: true,
			}, true
		}
	}
	if _, err := fmt.Sscanf(raw, "%d月%d", &month, &day); err == nil {
		return temporalAnchorDate{
			value:   time.Date(2000, time.Month(month), day, 0, 0, 0, 0, time.UTC),
			hasYear: false,
		}, true
	}
	return temporalAnchorDate{}, false
}

func formatAnchorDisplay(hasYear bool, value time.Time) string {
	if hasYear {
		return formatChineseDate(value)
	}
	return fmt.Sprintf("%d月%d日", value.Month(), value.Day())
}

func resolveHeaderAnchoredRelative(text string, anchor time.Time) (string, *TemporalMetadata, bool) {
	if rewritten, display, granularity, changed := resolveChineseHeaderAnchoredRelative(text, anchor); changed {
		return rewritten, buildDisplayTemporalMetadata(
			temporalKindHeaderAnchorRelative,
			temporalAnchorSourceHeader,
			granularity,
			display,
		), true
	}
	if rewritten, changed := resolveRelativeTemporalText(text, anchor); changed {
		meta := buildDisplayTemporalMetadata(
			temporalKindHeaderAnchorRelative,
			temporalAnchorSourceHeader,
			inferResolvedGranularity(text),
			inferDisplayFromRewrittenText(rewritten),
		)
		return rewritten, meta, true
	}
	return text, nil, false
}

func resolveChineseHeaderAnchoredRelative(text string, anchor time.Time) (string, string, string, bool) {
	replaced := text
	changed := false
	display := ""
	granularity := ""

	replaceAll := func(target, replacement, newDisplay, newGranularity string) {
		if strings.Contains(replaced, target) {
			replaced = strings.ReplaceAll(replaced, target, replacement)
			changed = true
			display = newDisplay
			granularity = newGranularity
		}
	}

	for _, weekday := range chineseRelativeWeekdayTokens() {
		if !strings.Contains(replaced, weekday.token) {
			continue
		}
		value := anchoredChineseWeekday(anchor, weekday.weekOffset, weekday.weekday)
		dateDisplay := formatChineseDate(value)
		replaced = strings.ReplaceAll(replaced, weekday.token, dateDisplay)
		changed = true
		display = formatISODate(value)
		granularity = temporalGranularityDay
	}

	replaceAll("前天", formatChineseDate(anchor.AddDate(0, 0, -2)), formatISODate(anchor.AddDate(0, 0, -2)), temporalGranularityDay)
	replaceAll("昨天", formatChineseDate(anchor.AddDate(0, 0, -1)), formatISODate(anchor.AddDate(0, 0, -1)), temporalGranularityDay)
	replaceAll("今天", formatChineseDate(anchor), formatISODate(anchor), temporalGranularityDay)
	replaceAll("明天", formatChineseDate(anchor.AddDate(0, 0, 1)), formatISODate(anchor.AddDate(0, 0, 1)), temporalGranularityDay)
	replaceAll("后天", formatChineseDate(anchor.AddDate(0, 0, 2)), formatISODate(anchor.AddDate(0, 0, 2)), temporalGranularityDay)

	lastWeekStart := startOfChineseWeek(anchor).AddDate(0, 0, -7)
	thisWeekStart := startOfChineseWeek(anchor)
	nextWeekStart := startOfChineseWeek(anchor).AddDate(0, 0, 7)
	replaceAll("上周", formatChineseWeekRange(lastWeekStart, lastWeekStart.AddDate(0, 0, 6))+"那一周", formatISODate(lastWeekStart)+"~"+formatISODate(lastWeekStart.AddDate(0, 0, 6)), temporalGranularityWeek)
	replaceAll("本周", formatChineseWeekRange(thisWeekStart, thisWeekStart.AddDate(0, 0, 6))+"那一周", formatISODate(thisWeekStart)+"~"+formatISODate(thisWeekStart.AddDate(0, 0, 6)), temporalGranularityWeek)
	replaceAll("这周", formatChineseWeekRange(thisWeekStart, thisWeekStart.AddDate(0, 0, 6))+"那一周", formatISODate(thisWeekStart)+"~"+formatISODate(thisWeekStart.AddDate(0, 0, 6)), temporalGranularityWeek)
	replaceAll("下周", formatChineseWeekRange(nextWeekStart, nextWeekStart.AddDate(0, 0, 6))+"那一周", formatISODate(nextWeekStart)+"~"+formatISODate(nextWeekStart.AddDate(0, 0, 6)), temporalGranularityWeek)

	lastMonth := startOfMonth(anchor).AddDate(0, -1, 0)
	thisMonth := startOfMonth(anchor)
	nextMonth := startOfMonth(anchor).AddDate(0, 1, 0)
	replaceAll("上个月", formatChineseMonth(lastMonth), lastMonth.Format("2006-01"), temporalGranularityMonth)
	replaceAll("这个月", formatChineseMonth(thisMonth), thisMonth.Format("2006-01"), temporalGranularityMonth)
	replaceAll("本月", formatChineseMonth(thisMonth), thisMonth.Format("2006-01"), temporalGranularityMonth)
	replaceAll("下个月", formatChineseMonth(nextMonth), nextMonth.Format("2006-01"), temporalGranularityMonth)

	replaceAll("去年", formatChineseYear(anchor.Year()-1), strconv.Itoa(anchor.Year()-1), temporalGranularityYear)
	replaceAll("今年", formatChineseYear(anchor.Year()), strconv.Itoa(anchor.Year()), temporalGranularityYear)
	replaceAll("明年", formatChineseYear(anchor.Year()+1), strconv.Itoa(anchor.Year()+1), temporalGranularityYear)

	return replaced, display, granularity, changed
}

func selectTemporalAnchor(text string, anchors []temporalAnchorCandidate) (time.Time, bool) {
	if len(anchors) == 0 {
		return time.Time{}, false
	}

	factTokens := temporalMatchTokens(text)
	bestIdx := -1
	bestScore := 0
	ambiguous := false
	for i, anchor := range anchors {
		score := overlapTemporalTokens(factTokens, anchor.tokens)
		if score > bestScore {
			bestIdx = i
			bestScore = score
			ambiguous = false
			continue
		}
		if score > 0 && score == bestScore {
			ambiguous = true
		}
	}

	if bestScore == 0 {
		if len(anchors) == 1 {
			return anchors[0].anchor, true
		}
		return time.Time{}, false
	}
	if ambiguous {
		return time.Time{}, false
	}
	return anchors[bestIdx].anchor, true
}

func temporalMatchTokens(text string) map[string]struct{} {
	out := make(map[string]struct{})
	for _, match := range temporalWordTokenRe.FindAllString(strings.ToLower(text), -1) {
		if len(match) <= 2 {
			continue
		}
		if _, skip := temporalStopwords[match]; skip {
			continue
		}
		out[match] = struct{}{}
	}
	for _, bigram := range temporalHanBigrams(text) {
		if _, skip := temporalStopwords[bigram]; skip {
			continue
		}
		out[bigram] = struct{}{}
	}
	return out
}

func overlapTemporalTokens(left, right map[string]struct{}) int {
	if len(left) == 0 || len(right) == 0 {
		return 0
	}
	score := 0
	for token := range left {
		if _, ok := right[token]; ok {
			score++
		}
	}
	return score
}

func buildDeicticTemporalMetadata(text string, anchor time.Time, anchorSource string) *TemporalMetadata {
	anchor = startOfDay(anchor)
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}

	switch {
	case hasRelativeEnglishWeekday(trimmed):
		if value, ok := resolveRelativeEnglishWeekday(anchor, trimmed); ok {
			return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityDay, value, value)
		}
	case hasRelativeChineseWeekday(trimmed):
		if value, ok := resolveRelativeChineseWeekday(anchor, trimmed); ok {
			return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityDay, value, value)
		}
	case temporalYesterdayRe.MatchString(trimmed) || strings.Contains(trimmed, "昨天"):
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityDay, anchor.AddDate(0, 0, -1), anchor.AddDate(0, 0, -1))
	case temporalTodayRe.MatchString(trimmed) || strings.Contains(trimmed, "今天"):
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityDay, anchor, anchor)
	case temporalTomorrowRe.MatchString(trimmed) || strings.Contains(trimmed, "明天"):
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityDay, anchor.AddDate(0, 0, 1), anchor.AddDate(0, 0, 1))
	case strings.Contains(trimmed, "前天"):
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityDay, anchor.AddDate(0, 0, -2), anchor.AddDate(0, 0, -2))
	case strings.Contains(trimmed, "后天"):
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityDay, anchor.AddDate(0, 0, 2), anchor.AddDate(0, 0, 2))
	case temporalLastWeekRe.MatchString(trimmed) || strings.Contains(trimmed, "上周"):
		start := startOfChineseWeek(anchor).AddDate(0, 0, -7)
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityWeek, start, start.AddDate(0, 0, 6))
	case temporalThisWeekRe.MatchString(trimmed) || strings.Contains(trimmed, "本周") || strings.Contains(trimmed, "这周"):
		start := startOfChineseWeek(anchor)
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityWeek, start, start.AddDate(0, 0, 6))
	case temporalNextWeekRe.MatchString(trimmed) || strings.Contains(trimmed, "下周"):
		start := startOfChineseWeek(anchor).AddDate(0, 0, 7)
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityWeek, start, start.AddDate(0, 0, 6))
	case temporalPastWeekendRe.MatchString(trimmed), temporalLastWeekendRe.MatchString(trimmed):
		start := startOfChineseWeek(anchor).AddDate(0, 0, -2)
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityWeek, start, start.AddDate(0, 0, 1))
	case temporalThisWeekendRe.MatchString(trimmed):
		start := startOfChineseWeek(anchor).AddDate(0, 0, 5)
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityWeek, start, start.AddDate(0, 0, 1))
	case temporalNextWeekendRe.MatchString(trimmed):
		start := startOfChineseWeek(anchor).AddDate(0, 0, 12)
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, anchorSource, temporalGranularityWeek, start, start.AddDate(0, 0, 1))
	case temporalLastMonthRe.MatchString(trimmed) || strings.Contains(trimmed, "上个月"):
		month := startOfMonth(anchor).AddDate(0, -1, 0)
		return buildMonthTemporalMetadata(temporalKindDeicticRelative, anchorSource, month)
	case temporalThisMonthRe.MatchString(trimmed) || strings.Contains(trimmed, "这个月") || strings.Contains(trimmed, "本月"):
		month := startOfMonth(anchor)
		return buildMonthTemporalMetadata(temporalKindDeicticRelative, anchorSource, month)
	case temporalNextMonthRe.MatchString(trimmed) || strings.Contains(trimmed, "下个月"):
		month := startOfMonth(anchor).AddDate(0, 1, 0)
		return buildMonthTemporalMetadata(temporalKindDeicticRelative, anchorSource, month)
	case temporalLastYearRe.MatchString(trimmed) || strings.Contains(trimmed, "去年"):
		return buildYearTemporalMetadata(temporalKindDeicticRelative, anchorSource, anchor.Year()-1)
	case temporalThisYearRe.MatchString(trimmed) || strings.Contains(trimmed, "今年"):
		return buildYearTemporalMetadata(temporalKindDeicticRelative, anchorSource, anchor.Year())
	case temporalNextYearRe.MatchString(trimmed) || strings.Contains(trimmed, "明年"):
		return buildYearTemporalMetadata(temporalKindDeicticRelative, anchorSource, anchor.Year()+1)
	case temporalLastSummerRe.MatchString(trimmed):
		return buildSeasonTemporalMetadata(temporalKindDeicticRelative, anchorSource, "summer", anchor.Year()-1)
	case temporalThisSummerRe.MatchString(trimmed):
		return buildSeasonTemporalMetadata(temporalKindDeicticRelative, anchorSource, "summer", anchor.Year())
	case temporalNextSummerRe.MatchString(trimmed):
		return buildSeasonTemporalMetadata(temporalKindDeicticRelative, anchorSource, "summer", anchor.Year()+1)
	case temporalLastWinterRe.MatchString(trimmed):
		return buildSeasonTemporalMetadata(temporalKindDeicticRelative, anchorSource, "winter", anchor.Year()-1)
	case temporalThisWinterRe.MatchString(trimmed):
		return buildSeasonTemporalMetadata(temporalKindDeicticRelative, anchorSource, "winter", anchor.Year())
	case temporalNextWinterRe.MatchString(trimmed):
		return buildSeasonTemporalMetadata(temporalKindDeicticRelative, anchorSource, "winter", anchor.Year()+1)
	case temporalLastSpringRe.MatchString(trimmed):
		return buildSeasonTemporalMetadata(temporalKindDeicticRelative, anchorSource, "spring", anchor.Year()-1)
	case temporalThisSpringRe.MatchString(trimmed):
		return buildSeasonTemporalMetadata(temporalKindDeicticRelative, anchorSource, "spring", anchor.Year())
	case temporalNextSpringRe.MatchString(trimmed):
		return buildSeasonTemporalMetadata(temporalKindDeicticRelative, anchorSource, "spring", anchor.Year()+1)
	case temporalLastFallRe.MatchString(trimmed):
		return buildSeasonTemporalMetadata(temporalKindDeicticRelative, anchorSource, "fall", anchor.Year()-1)
	case temporalThisFallRe.MatchString(trimmed):
		return buildSeasonTemporalMetadata(temporalKindDeicticRelative, anchorSource, "fall", anchor.Year())
	case temporalNextFallRe.MatchString(trimmed):
		return buildSeasonTemporalMetadata(temporalKindDeicticRelative, anchorSource, "fall", anchor.Year()+1)
	default:
		return nil
	}
	return nil
}

func buildRangeTemporalMetadata(kind, anchorSource, granularity string, start, end time.Time) *TemporalMetadata {
	start = startOfDay(start)
	end = startOfDay(end)
	meta := &TemporalMetadata{
		Kind:         kind,
		AnchorSource: anchorSource,
		Granularity:  granularity,
		ResolvedStart: formatISODate(start),
		ResolvedEnd:   formatISODate(end),
	}
	if start.Equal(end) {
		meta.Display = meta.ResolvedStart
	} else {
		meta.Display = meta.ResolvedStart + "~" + meta.ResolvedEnd
	}
	return meta
}

func buildMonthTemporalMetadata(kind, anchorSource string, month time.Time) *TemporalMetadata {
	month = startOfMonth(month)
	return &TemporalMetadata{
		Kind:         kind,
		AnchorSource: anchorSource,
		Granularity:  temporalGranularityMonth,
		ResolvedStart: month.Format("2006-01"),
		Display:      month.Format("2006-01"),
	}
}

func buildYearTemporalMetadata(kind, anchorSource string, year int) *TemporalMetadata {
	display := strconv.Itoa(year)
	return &TemporalMetadata{
		Kind:         kind,
		AnchorSource: anchorSource,
		Granularity:  temporalGranularityYear,
		ResolvedStart: display,
		Display:      display,
	}
}

func buildSeasonTemporalMetadata(kind, anchorSource, season string, year int) *TemporalMetadata {
	display := season + " " + strconv.Itoa(year)
	return &TemporalMetadata{
		Kind:         kind,
		AnchorSource: anchorSource,
		Granularity:  temporalGranularitySeason,
		ResolvedStart: display,
		Display:      display,
	}
}

func buildDisplayTemporalMetadata(kind, anchorSource, granularity, display string) *TemporalMetadata {
	if display == "" {
		return nil
	}
	meta := &TemporalMetadata{
		Kind:         kind,
		AnchorSource: anchorSource,
		Granularity:  granularity,
		Display:      display,
	}
	switch granularity {
	case temporalGranularityDay:
		meta.ResolvedStart = display
		meta.ResolvedEnd = display
	case temporalGranularityMonth, temporalGranularityYear, temporalGranularitySeason:
		meta.ResolvedStart = display
	case temporalGranularityWeek:
		parts := strings.SplitN(display, "~", 2)
		if len(parts) == 2 {
			meta.ResolvedStart = parts[0]
			meta.ResolvedEnd = parts[1]
		}
	}
	return meta
}

func shouldProjectTemporalDisplay(content, display string) bool {
	return display != "" && !hasExplicitAbsoluteTime(content) && (temporalRelativeCueRe.MatchString(strings.ToLower(content)) || temporalCNRelativeRe.MatchString(content))
}

func appendTemporalQueryTokens(query, display string, aliases []string) string {
	seen := map[string]struct{}{
		query: {},
	}
	parts := []string{query}
	for _, token := range append([]string{display}, aliases...) {
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}
		if _, ok := seen[token]; ok {
			continue
		}
		seen[token] = struct{}{}
		parts = append(parts, token)
	}
	return strings.Join(parts, " ")
}

func temporalDisplayAliases(display string) []string {
	switch {
	case temporalISODateRe.MatchString(display):
		value, err := time.Parse("2006-01-02", display)
		if err != nil {
			return nil
		}
		return []string{formatChineseDate(value), value.Format("2 January 2006")}
	case temporalISOMonthRe.MatchString(display):
		value, err := time.Parse("2006-01", display)
		if err != nil {
			return nil
		}
		return []string{formatChineseMonth(value), value.Format("January 2006")}
	case regexp.MustCompile(`^\d{4}$`).MatchString(display):
		return []string{display + "年"}
	default:
		return nil
	}
}

func inferDisplayGranularity(display string) string {
	switch {
	case temporalISODateRe.MatchString(display):
		return temporalGranularityDay
	case temporalISOMonthRe.MatchString(display):
		return temporalGranularityMonth
	case temporalCNMonthDayRe.MatchString(display):
		return temporalGranularityDay
	case regexp.MustCompile(`^\d{4}$`).MatchString(display):
		return temporalGranularityYear
	case strings.Contains(display, "~"):
		return temporalGranularityWeek
	default:
		return temporalGranularityDay
	}
}

func inferResolvedGranularity(text string) string {
	switch {
	case temporalLastWeekRe.MatchString(text), temporalThisWeekRe.MatchString(text), temporalNextWeekRe.MatchString(text):
		return temporalGranularityWeek
	case temporalPastWeekendRe.MatchString(text), temporalLastWeekendRe.MatchString(text), temporalThisWeekendRe.MatchString(text), temporalNextWeekendRe.MatchString(text):
		return temporalGranularityWeek
	case temporalLastMonthRe.MatchString(text), temporalThisMonthRe.MatchString(text), temporalNextMonthRe.MatchString(text):
		return temporalGranularityMonth
	case temporalLastYearRe.MatchString(text), temporalThisYearRe.MatchString(text), temporalNextYearRe.MatchString(text):
		return temporalGranularityYear
	case temporalLastSummerRe.MatchString(text), temporalThisSummerRe.MatchString(text), temporalNextSummerRe.MatchString(text):
		return temporalGranularitySeason
	case temporalLastWinterRe.MatchString(text), temporalThisWinterRe.MatchString(text), temporalNextWinterRe.MatchString(text):
		return temporalGranularitySeason
	case temporalLastSpringRe.MatchString(text), temporalThisSpringRe.MatchString(text), temporalNextSpringRe.MatchString(text):
		return temporalGranularitySeason
	case temporalLastFallRe.MatchString(text), temporalThisFallRe.MatchString(text), temporalNextFallRe.MatchString(text):
		return temporalGranularitySeason
	default:
		return temporalGranularityDay
	}
}

func inferDisplayFromRewrittenText(text string) string {
	switch {
	case temporalISODateRe.MatchString(text):
		return temporalISODateRe.FindString(text)
	case temporalISOMonthRe.MatchString(text):
		return temporalISOMonthRe.FindString(text)
	case temporalCNFullDateRe.MatchString(text):
		if value, ok := parseChineseFullDate(temporalCNFullDateRe.FindString(text)); ok {
			return formatISODate(value)
		}
	case temporalLongDateRe.MatchString(text):
		if value, ok := parseFlexibleLongDate(temporalLongDateRe.FindString(text)); ok {
			return formatISODate(value)
		}
	case temporalAnchoredPeriodRe.MatchString(text):
		return ""
	}
	return ""
}

func parseFlexibleLongDate(raw string) (time.Time, bool) {
	for _, layout := range []string{"2 January 2006", "02 January 2006", "January 2, 2006"} {
		if value, err := time.ParseInLocation(layout, raw, time.UTC); err == nil {
			return value, true
		}
	}
	return time.Time{}, false
}

func parseChineseFullDate(raw string) (time.Time, bool) {
	var year, month, day int
	if _, err := fmt.Sscanf(strings.TrimSuffix(strings.TrimSuffix(raw, "日"), "号"), "%d年%d月%d", &year, &month, &day); err != nil {
		return time.Time{}, false
	}
	return time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC), true
}

func resolveRelativeTemporalText(text string, anchor time.Time) (string, bool) {
	replaced := text
	changed := false

	replaceAll := func(re *regexp.Regexp, replacement string) {
		if re.MatchString(replaced) {
			replaced = re.ReplaceAllString(replaced, replacement)
			changed = true
		}
	}

	replaceAll(temporalLastYearRe, fmt.Sprintf("in %d", anchor.Year()-1))
	replaceAll(temporalThisYearRe, fmt.Sprintf("in %d", anchor.Year()))
	replaceAll(temporalNextYearRe, fmt.Sprintf("in %d", anchor.Year()+1))
	replaceAll(temporalLastMonthRe, "in "+formatMonthYear(anchor.AddDate(0, -1, 0)))
	replaceAll(temporalThisMonthRe, "in "+formatMonthYear(anchor))
	replaceAll(temporalNextMonthRe, "in "+formatMonthYear(anchor.AddDate(0, 1, 0)))
	replaceAll(temporalYesterdayRe, "on "+formatLongDate(anchor.AddDate(0, 0, -1)))
	replaceAll(temporalTodayRe, "on "+formatLongDate(anchor))
	replaceAll(temporalTomorrowRe, "on "+formatLongDate(anchor.AddDate(0, 0, 1)))
	replaceAll(temporalLastWeekRe, "the week before "+formatLongDate(anchor))
	replaceAll(temporalThisWeekRe, "the week of "+formatLongDate(anchor))
	replaceAll(temporalNextWeekRe, "the week after "+formatLongDate(anchor))
	replaceAll(temporalPastWeekendRe, "the weekend before "+formatLongDate(anchor))
	replaceAll(temporalLastWeekendRe, "the weekend before "+formatLongDate(anchor))
	replaceAll(temporalThisWeekendRe, "the weekend of "+formatLongDate(anchor))
	replaceAll(temporalNextWeekendRe, "the weekend after "+formatLongDate(anchor))
	replaceAll(temporalLastSummerRe, "in summer "+strconv.Itoa(anchor.Year()-1))
	replaceAll(temporalThisSummerRe, "in summer "+strconv.Itoa(anchor.Year()))
	replaceAll(temporalNextSummerRe, "in summer "+strconv.Itoa(anchor.Year()+1))
	replaceAll(temporalLastWinterRe, "in winter "+strconv.Itoa(anchor.Year()-1))
	replaceAll(temporalThisWinterRe, "in winter "+strconv.Itoa(anchor.Year()))
	replaceAll(temporalNextWinterRe, "in winter "+strconv.Itoa(anchor.Year()+1))
	replaceAll(temporalLastSpringRe, "in spring "+strconv.Itoa(anchor.Year()-1))
	replaceAll(temporalThisSpringRe, "in spring "+strconv.Itoa(anchor.Year()))
	replaceAll(temporalNextSpringRe, "in spring "+strconv.Itoa(anchor.Year()+1))
	replaceAll(temporalLastFallRe, "in fall "+strconv.Itoa(anchor.Year()-1))
	replaceAll(temporalThisFallRe, "in fall "+strconv.Itoa(anchor.Year()))
	replaceAll(temporalNextFallRe, "in fall "+strconv.Itoa(anchor.Year()+1))

	for weekday, re := range temporalWeekdayPatterns() {
		if re.MatchString(replaced) {
			replaced = re.ReplaceAllString(replaced, "on "+formatLongDate(previousWeekday(anchor, weekday)))
			changed = true
		}
	}
	for weekday, re := range temporalNextWeekdayPatterns() {
		if re.MatchString(replaced) {
			replaced = re.ReplaceAllString(replaced, "on "+formatLongDate(nextWeekday(anchor, weekday)))
			changed = true
		}
	}

	return replaced, changed
}

func temporalWeekdayPatterns() map[time.Weekday]*regexp.Regexp {
	return map[time.Weekday]*regexp.Regexp{
		time.Monday:    regexp.MustCompile(`(?i)\blast monday\b`),
		time.Tuesday:   regexp.MustCompile(`(?i)\blast tuesday\b`),
		time.Wednesday: regexp.MustCompile(`(?i)\blast wednesday\b`),
		time.Thursday:  regexp.MustCompile(`(?i)\blast thursday\b`),
		time.Friday:    regexp.MustCompile(`(?i)\blast friday\b`),
		time.Saturday:  regexp.MustCompile(`(?i)\blast saturday\b`),
		time.Sunday:    regexp.MustCompile(`(?i)\blast sunday\b`),
	}
}

func temporalNextWeekdayPatterns() map[time.Weekday]*regexp.Regexp {
	return map[time.Weekday]*regexp.Regexp{
		time.Monday:    regexp.MustCompile(`(?i)\bnext monday\b`),
		time.Tuesday:   regexp.MustCompile(`(?i)\bnext tuesday\b`),
		time.Wednesday: regexp.MustCompile(`(?i)\bnext wednesday\b`),
		time.Thursday:  regexp.MustCompile(`(?i)\bnext thursday\b`),
		time.Friday:    regexp.MustCompile(`(?i)\bnext friday\b`),
		time.Saturday:  regexp.MustCompile(`(?i)\bnext saturday\b`),
		time.Sunday:    regexp.MustCompile(`(?i)\bnext sunday\b`),
	}
}

func previousWeekday(anchor time.Time, weekday time.Weekday) time.Time {
	delta := (int(anchor.Weekday()) - int(weekday) + 7) % 7
	if delta == 0 {
		delta = 7
	}
	return anchor.AddDate(0, 0, -delta)
}

func nextWeekday(anchor time.Time, weekday time.Weekday) time.Time {
	delta := (int(weekday) - int(anchor.Weekday()) + 7) % 7
	if delta == 0 {
		delta = 7
	}
	return anchor.AddDate(0, 0, delta)
}

func temporalHanBigrams(text string) []string {
	var out []string
	var run []rune

	flush := func() {
		if len(run) < 2 {
			run = run[:0]
			return
		}
		for i := 0; i+1 < len(run); i++ {
			out = append(out, string(run[i:i+2]))
		}
		run = run[:0]
	}

	for _, r := range text {
		if r >= '\u4e00' && r <= '\u9fff' {
			run = append(run, r)
			continue
		}
		flush()
	}
	flush()
	return out
}

func startOfDay(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, value.Location())
}

func startOfMonth(value time.Time) time.Time {
	value = startOfDay(value)
	return time.Date(value.Year(), value.Month(), 1, 0, 0, 0, 0, value.Location())
}

func startOfChineseWeek(value time.Time) time.Time {
	value = startOfDay(value)
	weekday := int(value.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	return value.AddDate(0, 0, 1-weekday)
}

func formatISODate(value time.Time) string {
	return value.Format("2006-01-02")
}

func formatLongDate(value time.Time) string {
	return value.Format("2 January 2006")
}

func formatMonthYear(value time.Time) string {
	return value.Format("January 2006")
}

func formatChineseDate(value time.Time) string {
	return fmt.Sprintf("%d年%d月%d日", value.Year(), value.Month(), value.Day())
}

func formatChineseMonth(value time.Time) string {
	return fmt.Sprintf("%d年%d月", value.Year(), value.Month())
}

func formatChineseWeekRange(start, end time.Time) string {
	return fmt.Sprintf("%s至%s", formatChineseDate(start), formatChineseDate(end))
}

func formatChineseYear(year int) string {
	return strconv.Itoa(year) + "年"
}

type chineseRelativeWeekdayToken struct {
	token      string
	weekOffset int
	weekday    time.Weekday
}

func chineseRelativeWeekdayTokens() []chineseRelativeWeekdayToken {
	return []chineseRelativeWeekdayToken{
		{token: "上周一", weekOffset: -1, weekday: time.Monday},
		{token: "上周二", weekOffset: -1, weekday: time.Tuesday},
		{token: "上周三", weekOffset: -1, weekday: time.Wednesday},
		{token: "上周四", weekOffset: -1, weekday: time.Thursday},
		{token: "上周五", weekOffset: -1, weekday: time.Friday},
		{token: "上周六", weekOffset: -1, weekday: time.Saturday},
		{token: "上周日", weekOffset: -1, weekday: time.Sunday},
		{token: "上周天", weekOffset: -1, weekday: time.Sunday},
		{token: "这周一", weekOffset: 0, weekday: time.Monday},
		{token: "这周二", weekOffset: 0, weekday: time.Tuesday},
		{token: "这周三", weekOffset: 0, weekday: time.Wednesday},
		{token: "这周四", weekOffset: 0, weekday: time.Thursday},
		{token: "这周五", weekOffset: 0, weekday: time.Friday},
		{token: "这周六", weekOffset: 0, weekday: time.Saturday},
		{token: "这周日", weekOffset: 0, weekday: time.Sunday},
		{token: "这周天", weekOffset: 0, weekday: time.Sunday},
		{token: "本周一", weekOffset: 0, weekday: time.Monday},
		{token: "本周二", weekOffset: 0, weekday: time.Tuesday},
		{token: "本周三", weekOffset: 0, weekday: time.Wednesday},
		{token: "本周四", weekOffset: 0, weekday: time.Thursday},
		{token: "本周五", weekOffset: 0, weekday: time.Friday},
		{token: "本周六", weekOffset: 0, weekday: time.Saturday},
		{token: "本周日", weekOffset: 0, weekday: time.Sunday},
		{token: "本周天", weekOffset: 0, weekday: time.Sunday},
		{token: "下周一", weekOffset: 1, weekday: time.Monday},
		{token: "下周二", weekOffset: 1, weekday: time.Tuesday},
		{token: "下周三", weekOffset: 1, weekday: time.Wednesday},
		{token: "下周四", weekOffset: 1, weekday: time.Thursday},
		{token: "下周五", weekOffset: 1, weekday: time.Friday},
		{token: "下周六", weekOffset: 1, weekday: time.Saturday},
		{token: "下周日", weekOffset: 1, weekday: time.Sunday},
		{token: "下周天", weekOffset: 1, weekday: time.Sunday},
	}
}

func anchoredChineseWeekday(anchor time.Time, weekOffset int, weekday time.Weekday) time.Time {
	weekStart := startOfChineseWeek(anchor).AddDate(0, 0, weekOffset*7)
	dayOffset := int(weekday) - 1
	if weekday == time.Sunday {
		dayOffset = 6
	}
	return weekStart.AddDate(0, 0, dayOffset)
}

func hasRelativeChineseWeekday(text string) bool {
	for _, token := range chineseRelativeWeekdayTokens() {
		if strings.Contains(text, token.token) {
			return true
		}
	}
	return false
}

func resolveRelativeChineseWeekday(anchor time.Time, text string) (time.Time, bool) {
	for _, token := range chineseRelativeWeekdayTokens() {
		if strings.Contains(text, token.token) {
			return anchoredChineseWeekday(anchor, token.weekOffset, token.weekday), true
		}
	}
	return time.Time{}, false
}

func hasRelativeEnglishWeekday(text string) bool {
	for _, re := range temporalWeekdayPatterns() {
		if re.MatchString(text) {
			return true
		}
	}
	for _, re := range temporalNextWeekdayPatterns() {
		if re.MatchString(text) {
			return true
		}
	}
	return false
}

func resolveRelativeEnglishWeekday(anchor time.Time, text string) (time.Time, bool) {
	for weekday, re := range temporalWeekdayPatterns() {
		if re.MatchString(text) {
			return previousWeekday(anchor, weekday), true
		}
	}
	for weekday, re := range temporalNextWeekdayPatterns() {
		if re.MatchString(text) {
			return nextWeekday(anchor, weekday), true
		}
	}
	return time.Time{}, false
}
