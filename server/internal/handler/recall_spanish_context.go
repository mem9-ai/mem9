package handler

import (
	"strings"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

func finalizeRecallContext(memories []domain.Memory, candidates []service.RecallCandidate, query string) []domain.Memory {
	if !isSpanishRecallQuestion(query) {
		return service.FinalizeSearchResults(memories, query)
	}
	return service.FinalizeSearchResultsWithSessionContext(memories, candidates, query)
}

// An overview stays on the general-query budget and confidence threshold.
// This deliberately does not enable the larger enumeration candidate budget.
func isSpanishOverviewQuestion(query string) bool {
	if !isSpanishRecallQuestion(query) {
		return false
	}
	lower := strings.ToLower(query)
	for _, cue := range []string{"suele consultar", "suelen consultar", "suele contactar", "suelen contactar", "con mayor frecuencia", "habitualmente", "a lo largo de", "experiencias previas", "situaciones anteriores", "principales temas"} {
		if strings.Contains(lower, cue) {
			return true
		}
	}
	return false
}

func selectSpanishOverviewCandidates(profile recallQueryProfile, budget int, candidates []service.RecallCandidate, seen map[string]struct{}) ([]domain.Memory, string, recallSelectionStats) {
	stats := recallSelectionStats{mode: "overview"}
	if budget <= 0 {
		return []domain.Memory{}, "budget_exhausted", stats
	}
	ranked := dedupeRecallCandidates(profile.shape, candidates)
	if seen == nil {
		seen = make(map[string]struct{}, budget)
	}
	selected := make([]domain.Memory, 0, minInt(budget, len(ranked)))
	type sessionKey struct{ app, agent, session string }
	covered := make(map[sessionKey]bool)
	cutoff := "budget_exhausted"
	lastConfidence := -1
	for len(selected) < budget {
		best := -1
		for i, c := range ranked {
			if _, ok := seen[recallMemoryKey(c.Memory)]; !ok {
				best = i
				break
			}
		}
		if best < 0 {
			break
		}
		bestConfidence := recallConfidenceValue(ranked[best].Memory)
		if bestConfidence < defaultMixedMinConfidence {
			cutoff = "min_confidence"
			break
		}
		if lastConfidence >= 0 && lastConfidence-bestConfidence > defaultConfidenceGapStop {
			cutoff = "confidence_gap"
			break
		}
		chosen := best
		first := ranked[best].Memory
		if len(selected) > 0 && first.SessionID != "" && covered[sessionKey{first.AppID, first.AgentID, first.SessionID}] {
			for i := best + 1; i < len(ranked); i++ {
				c := ranked[i]
				confidence := recallConfidenceValue(c.Memory)
				// Diversify only near-tied, already eligible evidence; never rescue a
				// low-confidence session merely to increase coverage.
				if confidence < defaultMixedMinConfidence || bestConfidence-confidence > 6 {
					break
				}
				if _, used := seen[recallMemoryKey(c.Memory)]; used {
					continue
				}
				key := sessionKey{c.Memory.AppID, c.Memory.AgentID, c.Memory.SessionID}
				if key.session != "" && !covered[key] {
					chosen = i
					break
				}
			}
		}
		c := ranked[chosen]
		rememberRecallCandidate(c, seen, &selected)
		if c.Memory.SessionID != "" {
			covered[sessionKey{c.Memory.AppID, c.Memory.AgentID, c.Memory.SessionID}] = true
		}
		recordRecallSourceSelection(&stats, c.SourcePool)
		lastConfidence = recallConfidenceValue(c.Memory)
	}
	return selected, cutoff, stats
}
