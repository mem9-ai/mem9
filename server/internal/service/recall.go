package service

import "github.com/qiffang/mnemos/server/internal/domain"

type RecallSourcePool string

const (
	RecallSourcePinned  RecallSourcePool = "pinned"
	RecallSourceInsight RecallSourcePool = "insight"
	RecallSourceSession RecallSourcePool = "session"
)

type RecallCandidate struct {
	Memory           domain.Memory
	SourcePool       RecallSourcePool
	RRFScore         float64
	RRFRank          int
	InVector         bool
	InKeyword        bool
	VectorSimilarity float64
}

type RecallCandidateOptions struct {
	EnableSecondHop bool
	FetchMultiplier int
	SecondHopTopN   int
}

func normalizeRecallLimit(limit, fallback int) int {
	if limit <= 0 || limit > 200 {
		return fallback
	}
	return limit
}

func normalizeRecallFetchMultiplier(multiplier, fallback int) int {
	if multiplier <= 0 {
		return fallback
	}
	return multiplier
}

func mergeRecallCandidates(
	sourcePool RecallSourcePool,
	kwResults, vecResults, secondHopResults []domain.Memory,
) []RecallCandidate {
	scores := rrfMerge(kwResults, vecResults)
	mems := collectMems(kwResults, vecResults)

	inKeyword := make(map[string]struct{}, len(kwResults))
	for _, m := range kwResults {
		inKeyword[m.ID] = struct{}{}
	}

	vectorSimilarity := make(map[string]float64, len(vecResults)+len(secondHopResults))
	for _, m := range vecResults {
		if m.Score != nil {
			vectorSimilarity[m.ID] = *m.Score
		}
	}

	for rank, m := range secondHopResults {
		scores[m.ID] += secondHopWeight / (rrfK + float64(rank+1))
		if _, exists := mems[m.ID]; !exists {
			mems[m.ID] = m
		}
		if m.Score != nil {
			if prev, ok := vectorSimilarity[m.ID]; !ok || *m.Score > prev {
				vectorSimilarity[m.ID] = *m.Score
			}
		}
	}

	merged := sortByScore(mems, scores)
	candidates := make([]RecallCandidate, 0, len(merged))
	for rank, m := range merged {
		candidate := RecallCandidate{
			Memory:     m,
			SourcePool: sourcePool,
			RRFScore:   scores[m.ID],
			RRFRank:    rank + 1,
		}
		if _, ok := inKeyword[m.ID]; ok {
			candidate.InKeyword = true
		}
		if sim, ok := vectorSimilarity[m.ID]; ok {
			candidate.InVector = true
			candidate.VectorSimilarity = sim
		}
		candidates = append(candidates, candidate)
	}
	return candidates
}

func dedupRecallCandidatesByContent(candidates []RecallCandidate) []RecallCandidate {
	seen := make(map[string]struct{}, len(candidates))
	out := make([]RecallCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		key := candidate.Memory.Content
		if key == "" {
			key = candidate.Memory.ID
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, candidate)
	}
	return out
}
