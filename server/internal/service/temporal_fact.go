package service

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	temporalAnchorBracketRunRe = regexp.MustCompile(`^(?:\[[^\]\n]{0,160}\]\s*)+`)
	temporalAnchorDateOnRe     = regexp.MustCompile(`(?i)\bon\s+(\d{1,2}\s+[A-Za-z]+,\s+\d{4})`)
	temporalAnchorDateTagRe    = regexp.MustCompile(`(?i)\bdate:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})`)

	temporalRelativeCueRe = regexp.MustCompile(`(?i)\b(?:yesterday|today|tomorrow|last\s+(?:night|week|weekend|month|year|summer|winter|spring|fall|friday|saturday|sunday|monday|tuesday|wednesday|thursday)|next\s+(?:week|weekend|month|year|summer|winter|spring|fall|friday|saturday|sunday|monday|tuesday|wednesday|thursday)|this\s+(?:week|weekend|month|year|summer|winter|spring|fall)|\d+\s+(?:day|days|week|weeks|month|months|year|years)\s+ago|in\s+\d+\s+(?:day|days|week|weeks|month|months|year|years)|the\s+(?:past\s+)?(?:week|weekend)\b)`)
	temporalWordTokenRe   = regexp.MustCompile(`[A-Za-z]+(?:'[A-Za-z]+)?|\d+`)
	temporalCNRelativeRe  = regexp.MustCompile(`上周[一二三四五六日天]|下周[一二三四五六日天]|前天|昨天|今天|明天|后天|上周|本周|这周|下周|上个月|这个月|本月|下个月|去年|今年|明年`)

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

type temporalAnchorCandidate struct {
	anchor time.Time
	tokens map[string]struct{}
}

func normalizeTemporalFacts(input preparedExtractionInput, facts []ExtractedFact) []ExtractedFact {
	return normalizeTemporalFactsAt(input, facts, time.Now())
}

func normalizeTemporalFactsAt(input preparedExtractionInput, facts []ExtractedFact, now time.Time) []ExtractedFact {
	anchors := buildTemporalAnchorCandidates(input.messages)

	out := make([]ExtractedFact, 0, len(facts))
	for _, fact := range facts {
		if strings.EqualFold(fact.FactType, factTypeQueryIntent) || strings.EqualFold(fact.FactType, factTypeRawFallback) {
			out = append(out, fact)
			continue
		}
		if normalized, ok := normalizeTemporalFactText(fact.Text, anchors, now); ok {
			fact.Text = normalized
		}
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
		if !strings.EqualFold(fact.FactType, factTypeRawFallback) {
			out = append(out, fact)
			continue
		}
		if anchor, ok := selectTemporalAnchor(fact.Text, anchors); ok {
			if normalized, normalizedOK := NormalizeChineseRelativeTemporalText(fact.Text, anchor); normalizedOK {
				fact.Text = normalized
			}
		} else if len(anchors) == 0 {
			if normalized, normalizedOK := NormalizeChineseRelativeTemporalText(fact.Text, now); normalizedOK {
				fact.Text = normalized
			}
		}
		out = append(out, fact)
	}
	return out
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

func normalizeTemporalFactText(text string, anchors []temporalAnchorCandidate, now time.Time) (string, bool) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return text, false
	}

	replaced := trimmed
	changed := false

	if temporalRelativeCueRe.MatchString(replaced) {
		if anchor, ok := selectTemporalAnchor(replaced, anchors); ok {
			if normalized, normalizedOK := resolveRelativeTemporalText(replaced, anchor); normalizedOK {
				replaced = normalized
				changed = true
			}
		}
	}

	if temporalCNRelativeRe.MatchString(replaced) {
		if anchor, ok := selectTemporalAnchor(replaced, anchors); ok {
			if normalized, normalizedOK := NormalizeChineseRelativeTemporalText(replaced, anchor); normalizedOK {
				replaced = normalized
				changed = true
			}
		} else if len(anchors) == 0 {
			if normalized, normalizedOK := NormalizeChineseRelativeTemporalText(replaced, now); normalizedOK {
				replaced = normalized
				changed = true
			}
		}
	}

	return replaced, changed
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

func formatLongDate(value time.Time) string {
	return value.Format("2 January 2006")
}

func formatMonthYear(value time.Time) string {
	return value.Format("January 2006")
}

func NormalizeChineseRelativeTemporalText(text string, anchor time.Time) (string, bool) {
	if strings.TrimSpace(text) == "" || !temporalCNRelativeRe.MatchString(text) {
		return text, false
	}

	anchor = startOfDay(anchor)
	matches := temporalCNRelativeRe.FindAllStringIndex(text, -1)
	if len(matches) == 0 {
		return text, false
	}

	var b strings.Builder
	last := 0
	changed := false
	for _, match := range matches {
		start, end := match[0], match[1]
		if start < last {
			continue
		}

		b.WriteString(text[last:end])
		if end >= len(text) || text[end] != '(' {
			if annotation, ok := chineseRelativeTemporalAnnotation(text[start:end], anchor); ok {
				b.WriteString(annotation)
				changed = true
			}
		}
		last = end
	}
	b.WriteString(text[last:])

	if !changed {
		return text, false
	}
	return b.String(), true
}

func chineseRelativeTemporalAnnotation(token string, anchor time.Time) (string, bool) {
	switch token {
	case "前天":
		return formatChineseDayAnnotation(anchor.AddDate(0, 0, -2)), true
	case "昨天":
		return formatChineseDayAnnotation(anchor.AddDate(0, 0, -1)), true
	case "今天":
		return formatChineseDayAnnotation(anchor), true
	case "明天":
		return formatChineseDayAnnotation(anchor.AddDate(0, 0, 1)), true
	case "后天":
		return formatChineseDayAnnotation(anchor.AddDate(0, 0, 2)), true
	case "上周", "本周", "这周", "下周":
		start := startOfChineseWeek(anchor)
		switch token {
		case "上周":
			start = start.AddDate(0, 0, -7)
		case "下周":
			start = start.AddDate(0, 0, 7)
		}
		return formatChineseWeekAnnotation(start, start.AddDate(0, 0, 6)), true
	case "上个月", "这个月", "本月", "下个月":
		month := startOfMonth(anchor)
		switch token {
		case "上个月":
			month = month.AddDate(0, -1, 0)
		case "下个月":
			month = month.AddDate(0, 1, 0)
		}
		return formatChineseMonthAnnotation(month), true
	case "去年":
		return formatChineseYearAnnotation(anchor.Year() - 1), true
	case "今年":
		return formatChineseYearAnnotation(anchor.Year()), true
	case "明年":
		return formatChineseYearAnnotation(anchor.Year() + 1), true
	}

	if strings.HasPrefix(token, "上周") || strings.HasPrefix(token, "下周") {
		weekday, ok := chineseWeekdayFromSuffix(token)
		if !ok {
			return "", false
		}
		start := startOfChineseWeek(anchor)
		if strings.HasPrefix(token, "上周") {
			start = start.AddDate(0, 0, -7)
		} else {
			start = start.AddDate(0, 0, 7)
		}
		return formatChineseDayAnnotation(start.AddDate(0, 0, weekday)), true
	}

	return "", false
}

func chineseWeekdayFromSuffix(token string) (int, bool) {
	runes := []rune(token)
	if len(runes) == 0 {
		return 0, false
	}

	switch runes[len(runes)-1] {
	case '一':
		return 0, true
	case '二':
		return 1, true
	case '三':
		return 2, true
	case '四':
		return 3, true
	case '五':
		return 4, true
	case '六':
		return 5, true
	case '日', '天':
		return 6, true
	default:
		return 0, false
	}
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

func formatChineseDayAnnotation(value time.Time) string {
	return fmt.Sprintf("(%s|%s)", value.Format("2006-01-02"), formatChineseDate(value))
}

func formatChineseWeekAnnotation(start, end time.Time) string {
	return fmt.Sprintf("(%s~%s|%s~%s)", start.Format("2006-01-02"), end.Format("2006-01-02"), formatChineseDate(start), formatChineseDate(end))
}

func formatChineseMonthAnnotation(value time.Time) string {
	return fmt.Sprintf("(%s|%s)", value.Format("2006-01"), formatChineseMonth(value))
}

func formatChineseYearAnnotation(year int) string {
	return fmt.Sprintf("(%d|%d年)", year, year)
}

func formatChineseDate(value time.Time) string {
	return fmt.Sprintf("%d年%d月%d日", value.Year(), value.Month(), value.Day())
}

func formatChineseMonth(value time.Time) string {
	return fmt.Sprintf("%d年%d月", value.Year(), value.Month())
}
