package service

import (
	"regexp"
	"strings"
	"time"
)

func sourceTemporalMessages(turns []sourceTurnMetadata) []IngestMessage {
	messages := make([]IngestMessage, 0, len(turns))
	for _, turn := range turns {
		role := turn.Role
		if role == "" {
			role = "user"
		}
		messages = append(messages, IngestMessage{Role: role, Content: turn.Content})
	}
	return messages
}

func temporalAnchorsAgree(anchors []temporalAnchorCandidate) bool {
	if len(anchors) == 0 {
		return false
	}
	for _, other := range anchors[1:] {
		if !startOfDay(other.anchor).Equal(startOfDay(anchors[0].anchor)) {
			return false
		}
	}
	return true
}

func hasSourceTimeHeader(messages []IngestMessage) bool {
	for _, message := range messages {
		header := temporalAnchorBracketRunRe.FindString(strings.TrimSpace(message.Content))
		if temporalISOHeaderRe.MatchString(header) {
			return true
		}
	}
	return false
}

func normalizeReconciledTemporalContentAt(content string, facts []ExtractedFact, now time.Time) (string, *TemporalMetadata) {
	content = StripTemporalProjection(content)
	// An unchanged fact already has an anchored interpretation; do not re-anchor it.
	var exact *TemporalMetadata
	for _, fact := range facts {
		if content == StripTemporalProjection(fact.Text) && fact.Temporal != nil {
			if exact != nil && *exact != *fact.Temporal {
				return content, nil
			}
			copy := *fact.Temporal
			exact = &copy
		}
	}
	if exact != nil {
		return content, exact
	}
	turns := sourceTurnsForReconcileText(content, facts)
	anchors := buildTemporalAnchorCandidates(sourceTemporalMessages(turns), true)
	if len(anchors) > 0 {
		return normalizeTemporalFactContent(content, anchors, now)
	}
	// A paraphrase can lose lexical overlap with historical facts. In that case
	// retain the relative wording rather than assigning a new ingest-time date.
	for _, fact := range facts {
		if fact.Temporal != nil || hasSourceTimeHeader(sourceTemporalMessages(fact.SourceTurns)) || len(buildTemporalAnchorCandidates(sourceTemporalMessages(fact.SourceTurns), true)) > 0 {
			cleaned, _ := sanitizeLegacyTemporalContent(content)
			return cleaned, nil
		}
	}
	return NormalizeStandaloneTemporalContent(content, now)
}

var spanishRelativeWeekdayRe = regexp.MustCompile(`(?i)\b(?:el\s+)?(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(pasado|próximo|proximo)\b`)
var spanishTemporalWeekdays = map[string]time.Weekday{"lunes": time.Monday, "martes": time.Tuesday,
	"miércoles": time.Wednesday, "miercoles": time.Wednesday, "jueves": time.Thursday,
	"viernes": time.Friday, "sábado": time.Saturday, "sabado": time.Saturday, "domingo": time.Sunday}

// Additive Spanish handling keeps the original wording and stores the resolved
// calendar date in metadata, just as unrewritten English/Chinese deictic facts do.
func spanishRelativeTemporalMetadata(text string, anchor time.Time, source string) *TemporalMetadata {
	lower := strings.ToLower(text)
	words := temporalWordTokenRe.FindAllString(lower, -1)
	var offsets []int
	for i, word := range words {
		switch word {
		case "anteayer":
			offsets = append(offsets, -2)
		case "ayer":
			offsets = append(offsets, -1)
		case "hoy":
			offsets = append(offsets, 0)
		case "mañana":
			if i > 0 && words[i-1] == "la" {
				continue // the morning is not an unambiguous tomorrow
			}
			if i > 0 && words[i-1] == "esta" {
				offsets = append(offsets, 0)
			} else {
				offsets = append(offsets, 1)
			}
		}
	}
	if len(offsets) == 1 {
		day := anchor.AddDate(0, 0, offsets[0])
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, source, temporalGranularityDay, day, day)
	}
	if len(offsets) > 1 {
		return nil
	}
	if found := spanishRelativeWeekdayRe.FindAllStringSubmatch(lower, -1); len(found) == 1 {
		day := previousWeekday(anchor, spanishTemporalWeekdays[found[0][1]])
		if found[0][2] != "pasado" {
			day = nextWeekday(anchor, spanishTemporalWeekdays[found[0][1]])
		}
		return buildRangeTemporalMetadata(temporalKindDeicticRelative, source, temporalGranularityDay, day, day)
	}
	return nil
}
