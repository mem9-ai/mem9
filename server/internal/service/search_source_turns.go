package service

import (
	"encoding/json"
	"os"
	"regexp"
	"sort"
	"strings"

	"github.com/qiffang/mnemos/server/internal/domain"
)

const (
	defaultSearchSourceTurnMinScore     = 2
	defaultSearchSourceTurnPerMemoryCap = 2
	defaultSearchSourceTurnTotalCap     = 12
	maxSearchSourceTurnRunes            = 800
	maxSearchSourceResponseRunes        = 2400
	maxSearchSourceMetadataBytes        = 64 << 10
	searchSourceTurnHeader              = "\n[source-turns]\n"
	searchSourceTruncationMarker        = "\n[truncated]"
)

var targetSpeakerQuestionRe = regexp.MustCompile(`(?i)\bhow\s+(?:does|did)\s+([a-z][a-z'-]*)\s+(?:describe|feel|respond|react|view|think|say)\b`)

type searchSourceTurnCandidate struct {
	memoryIndex int
	score       int
	sourceOrder int
	turn        sourceTurnMetadata
}

// FinalizeSearchResults adds response-only source evidence and relative ages after recall selection.
// It preserves selected memory IDs, ordering, scores, confidence, and result count.
func FinalizeSearchResults(memories []domain.Memory, query string) []domain.Memory {
	return finalizeSearchResults(memories, query)
}

func finalizeSearchResults(memories []domain.Memory, query string) []domain.Memory {
	return populateRelativeAge(decorateSearchResultsWithSourceTurns(memories, query))
}

func decorateSearchResultsWithSourceTurns(memories []domain.Memory, query string) []domain.Memory {
	return decorateSearchResultsWithEvidence(memories, query, nil)
}

func decorateSearchResultsWithEvidence(memories []domain.Memory, query string, sessionEvidence map[string]bool) []domain.Memory {
	if len(memories) == 0 || strings.TrimSpace(query) == "" {
		return memories
	}

	selectedByMemory := selectSearchSourceTurnsWithEvidence(memories, query, sessionEvidence)
	out := make([]domain.Memory, len(memories))
	copy(out, memories)
	for i := range out {
		if !shouldDecorateSearchEvidence(out[i], sessionEvidence) {
			continue
		}
		selected := selectedByMemory[i]
		out[i].Metadata = SetSourceProvenanceMetadata(out[i].Metadata, sourceTurnSeqs(selected), selected)
		if len(selected) == 0 {
			continue
		}
		out[i].Content = formatSearchMemoryWithSourceTurns(out[i].Content, selected)
	}
	return out
}

func selectSearchSourceTurns(memories []domain.Memory, query string) map[int][]sourceTurnMetadata {
	return selectSearchSourceTurnsWithEvidence(memories, query, nil)
}

func selectSearchSourceTurnsWithEvidence(memories []domain.Memory, query string, sessionEvidence map[string]bool) map[int][]sourceTurnMetadata {
	minScore := readPositiveEnvInt("MEM9_SOURCE_TURN_MIN_SCORE", defaultSearchSourceTurnMinScore)
	perMemoryCap := readPositiveEnvInt("MEM9_SOURCE_TURN_PER_MEMORY_LIMIT", defaultSearchSourceTurnPerMemoryCap)
	totalCap := readPositiveEnvInt("MEM9_SOURCE_TURN_TOTAL_LIMIT", defaultSearchSourceTurnTotalCap)

	candidates := make([]searchSourceTurnCandidate, 0)
	for memoryIndex, memory := range memories {
		if !shouldDecorateSearchEvidence(memory, sessionEvidence) {
			continue
		}
		turns := parseSourceTurnsFromMetadata(memory.Metadata)
		for sourceOrder, turn := range turns {
			// Bound both source scoring work and response context; rank only visible evidence.
			turn.Content = boundSearchSourceContent(turn, maxSearchSourceTurnRunes)
			if turn.Content == "" {
				continue
			}
			score := scoreSearchEvidence(query, memory, turn.Content, sessionEvidence)
			if score < minScore {
				continue
			}
			candidates = append(candidates, searchSourceTurnCandidate{
				memoryIndex: memoryIndex,
				score:       score,
				sourceOrder: sourceOrder,
				turn:        turn,
			})
		}
	}
	if len(candidates) == 0 {
		return map[int][]sourceTurnMetadata{}
	}

	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score > candidates[j].score
		}
		if candidates[i].memoryIndex != candidates[j].memoryIndex {
			return candidates[i].memoryIndex < candidates[j].memoryIndex
		}
		return candidates[i].sourceOrder < candidates[j].sourceOrder
	})

	perMemoryCounts := make(map[int]int, len(memories))
	selectedByMemory := make(map[int][]sourceTurnMetadata, len(memories))
	selectedTotal := 0
	selectedRunes := 0
	for _, candidate := range candidates {
		if selectedTotal >= totalCap {
			break
		}
		if perMemoryCounts[candidate.memoryIndex] >= perMemoryCap {
			continue
		}
		separatorRunes := 1
		if perMemoryCounts[candidate.memoryIndex] == 0 {
			separatorRunes = len([]rune(searchSourceTurnHeader))
		}
		remaining := maxSearchSourceResponseRunes - selectedRunes - separatorRunes
		turn := candidate.turn
		turn.Content = boundSearchSourceContent(turn, minInt(maxSearchSourceTurnRunes, remaining))
		if turn.Content == "" || scoreSearchEvidence(query, memories[candidate.memoryIndex], turn.Content, sessionEvidence) < minScore {
			continue
		}
		candidate.turn = turn
		selectedRunes += separatorRunes + len([]rune(turn.Content)) + searchSourceRoleRunes(turn)
		perMemoryCounts[candidate.memoryIndex]++
		selectedTotal++
		selectedByMemory[candidate.memoryIndex] = append(selectedByMemory[candidate.memoryIndex], candidate.turn)
	}

	for memoryIndex, turns := range selectedByMemory {
		sort.SliceStable(turns, func(i, j int) bool {
			return turns[i].Seq < turns[j].Seq
		})
		selectedByMemory[memoryIndex] = turns
	}
	return selectedByMemory
}

func shouldDecorateSearchEvidence(memory domain.Memory, sessionEvidence map[string]bool) bool {
	if sessionEvidence[memory.ID] && memory.MemoryType == domain.TypeSession {
		return len(memory.Metadata) <= maxSearchSourceMetadataBytes && len(parseSourceTurnsFromMetadata(memory.Metadata)) > 0
	}
	return shouldDecorateSearchMemory(memory)
}

func scoreSearchEvidence(query string, memory domain.Memory, content string, sessionEvidence map[string]bool) int {
	score := scoreSearchSourceTurn(query, memory.Content, content)
	if sessionEvidence[memory.ID] {
		// A short answer can lack the noun in its immediately preceding question.
		// Eligibility was established using same-session/role/sequence checks.
		if anchorScore := scoreSearchSourceTurn(query, memory.Content, memory.Content); anchorScore > score {
			score = anchorScore
		}
	}
	return score
}

func shouldDecorateSearchMemory(memory domain.Memory) bool {
	if len(memory.Metadata) > maxSearchSourceMetadataBytes {
		return false
	}
	if memory.MemoryType != domain.TypeInsight {
		return false
	}
	if strings.Contains(memory.Content, "\n[source-turns]\n") {
		return false
	}
	if hasSearchDirectSeq(memory.Metadata) {
		return false
	}
	return len(parseSourceTurnsFromMetadata(memory.Metadata)) > 0
}

func hasSearchDirectSeq(metadata json.RawMessage) bool {
	if len(metadata) == 0 {
		return false
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(metadata, &payload); err != nil {
		return false
	}
	_, ok := parseJSONInt(payload["seq"])
	return ok
}

func parseSourceTurnsFromMetadata(metadata json.RawMessage) []sourceTurnMetadata {
	if len(metadata) == 0 {
		return nil
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(metadata, &payload); err != nil {
		return nil
	}
	rawTurns, ok := payload[sourceTurnsMetadataKey]
	if !ok || len(rawTurns) == 0 {
		return nil
	}
	var turns []sourceTurnMetadata
	if err := json.Unmarshal(rawTurns, &turns); err != nil {
		return nil
	}
	return normalizeSourceTurns(nil, turns)
}

func parseJSONInt(raw json.RawMessage) (int, bool) {
	var num int
	if err := json.Unmarshal(raw, &num); err == nil {
		return num, true
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return 0, false
	}
	return parsePositiveInt(s)
}

func sourceTurnSeqs(turns []sourceTurnMetadata) []int {
	seqs := make([]int, 0, len(turns))
	for _, turn := range turns {
		seqs = append(seqs, turn.Seq)
	}
	return normalizeSourceSeqs(seqs)
}

func formatSearchMemoryWithSourceTurns(content string, turns []sourceTurnMetadata) string {
	if len(turns) == 0 {
		return content
	}
	parts := make([]string, 0, len(turns))
	for _, turn := range turns {
		content := turn.Content
		if turn.Role == "assistant" {
			content = "Assistant: " + content
		}
		parts = append(parts, content)
	}
	return content + searchSourceTurnHeader + strings.Join(parts, "\n")
}

func scoreSearchSourceTurn(question, memoryContent, sourceContent string) int {
	question = searchSourceScoringPrefix(question)
	memoryContent = searchSourceScoringPrefix(memoryContent)
	sourceContent = searchSourceScoringPrefix(sourceContent)
	questionTokens := tokenizeForSourceTurnScoring(question)
	sourceTokens := tokenSet(tokenizeForSourceTurnScoring(sourceContent))
	memoryTokens := tokenSet(tokenizeForSourceTurnScoring(memoryContent))
	speakerTokens := tokenizeForSourceTurnScoring(extractSearchSpeakerLabel(sourceContent))
	targetSpeakerTokens := tokenSet(extractSearchTargetSpeakerTokens(question))
	questionSet := tokenSet(questionTokens)

	score := 0
	for _, token := range questionTokens {
		if _, ok := sourceTokens[token]; ok {
			if len(token) >= 5 {
				score += 3
			} else {
				score += 2
			}
		}
	}
	for _, token := range speakerTokens {
		if _, ok := targetSpeakerTokens[token]; ok {
			score += 8
		} else if len(targetSpeakerTokens) == 0 {
			if _, ok := questionSet[token]; ok {
				score += 3
			}
		}
	}

	memoryOverlap := 0
	for token := range memoryTokens {
		if _, ok := questionSet[token]; ok {
			continue
		}
		if _, ok := sourceTokens[token]; ok {
			memoryOverlap++
		}
	}
	score += minInt(memoryOverlap, 6)
	return score
}

func extractSearchSpeakerLabel(content string) string {
	match := regexp.MustCompile(`(?i)\[speaker:([^\]]+)\]`).FindStringSubmatch(content)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func extractSearchTargetSpeakerTokens(question string) []string {
	match := targetSpeakerQuestionRe.FindStringSubmatch(question)
	if len(match) < 2 {
		return nil
	}
	return tokenizeForSourceTurnScoring(match[1])
}

func tokenizeForSourceTurnScoring(text string) []string {
	matches := sourceProvenanceTokenRe.FindAllString(strings.ToLower(text), -1)
	out := make([]string, 0, len(matches))
	for _, token := range matches {
		token = strings.Trim(token, "'")
		if len([]rune(token)) < 2 {
			continue
		}
		if _, stop := sourceProvenanceStopwords[token]; stop {
			continue
		}
		out = append(out, token)
	}
	return out
}

func tokenSet(tokens []string) map[string]struct{} {
	set := make(map[string]struct{}, len(tokens))
	for _, token := range tokens {
		set[token] = struct{}{}
	}
	return set
}

func readPositiveEnvInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, ok := parsePositiveInt(value)
	if !ok || parsed <= 0 {
		return fallback
	}
	return parsed
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

// boundSearchSourceContent limits only evidence appended to a search result.
// Source storage and the main insight are never modified. The marker and role
// label count toward the fragment budget. Inspecting at most maxRunes+1 runes
// also bounds lexical scoring work for an unusually large source message.
func boundSearchSourceContent(turn sourceTurnMetadata, maxRunes int) string {
	maxRunes -= searchSourceRoleRunes(turn)
	markerRunes := len([]rune(searchSourceTruncationMarker))
	if maxRunes <= markerRunes {
		return ""
	}
	prefix := make([]rune, 0, maxRunes+1)
	for _, r := range turn.Content {
		prefix = append(prefix, r)
		if len(prefix) > maxRunes {
			break
		}
	}
	if len(prefix) <= maxRunes {
		return string(prefix)
	}
	return strings.TrimSpace(string(prefix[:maxRunes-markerRunes])) + searchSourceTruncationMarker
}

func searchSourceRoleRunes(turn sourceTurnMetadata) int {
	if turn.Role == "assistant" {
		return len("Assistant: ")
	}
	return 0
}

// Search decoration must not scan arbitrarily large content to score a bounded snippet.
func searchSourceScoringPrefix(content string) string {
	runes := 0
	for index := range content {
		if runes >= maxSearchSourceTurnRunes {
			return content[:index]
		}
		runes++
	}
	return content
}
