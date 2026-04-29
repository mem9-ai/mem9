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
)

var targetSpeakerQuestionRe = regexp.MustCompile(`(?i)\bhow\s+(?:does|did)\s+([a-z][a-z'-]*)\s+(?:describe|feel|respond|react|view|think|say)\b`)

type searchSourceTurnCandidate struct {
	memoryIndex int
	score       int
	sourceOrder int
	turn        sourceTurnMetadata
}

func finalizeSearchResults(memories []domain.Memory, query string) []domain.Memory {
	return populateRelativeAge(decorateSearchResultsWithSourceTurns(memories, query))
}

func decorateSearchResultsWithSourceTurns(memories []domain.Memory, query string) []domain.Memory {
	if len(memories) == 0 || strings.TrimSpace(query) == "" {
		return memories
	}

	selectedByMemory := selectSearchSourceTurns(memories, query)
	out := make([]domain.Memory, len(memories))
	copy(out, memories)
	for i := range out {
		if !shouldDecorateSearchMemory(out[i]) {
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
	minScore := readPositiveEnvInt("MEM9_SOURCE_TURN_MIN_SCORE", defaultSearchSourceTurnMinScore)
	perMemoryCap := readPositiveEnvInt("MEM9_SOURCE_TURN_PER_MEMORY_LIMIT", defaultSearchSourceTurnPerMemoryCap)
	totalCap := readPositiveEnvInt("MEM9_SOURCE_TURN_TOTAL_LIMIT", defaultSearchSourceTurnTotalCap)

	candidates := make([]searchSourceTurnCandidate, 0)
	for memoryIndex, memory := range memories {
		if !shouldDecorateSearchMemory(memory) {
			continue
		}
		turns := parseSourceTurnsFromMetadata(memory.Metadata)
		for sourceOrder, turn := range turns {
			score := scoreSearchSourceTurn(query, memory.Content, turn.Content)
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
	selectedOrders := make(map[int][]int, len(memories))
	selectedTotal := 0
	for _, candidate := range candidates {
		if selectedTotal >= totalCap {
			break
		}
		if perMemoryCounts[candidate.memoryIndex] >= perMemoryCap {
			continue
		}
		perMemoryCounts[candidate.memoryIndex]++
		selectedTotal++
		selectedByMemory[candidate.memoryIndex] = append(selectedByMemory[candidate.memoryIndex], candidate.turn)
		selectedOrders[candidate.memoryIndex] = append(selectedOrders[candidate.memoryIndex], candidate.sourceOrder)
	}

	for memoryIndex, turns := range selectedByMemory {
		orders := selectedOrders[memoryIndex]
		sort.SliceStable(turns, func(i, j int) bool {
			return orders[i] < orders[j]
		})
		selectedByMemory[memoryIndex] = turns
	}
	return selectedByMemory
}

func shouldDecorateSearchMemory(memory domain.Memory) bool {
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
		parts = append(parts, turn.Content)
	}
	return content + "\n[source-turns]\n" + strings.Join(parts, "\n")
}

func scoreSearchSourceTurn(question, memoryContent, sourceContent string) int {
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
