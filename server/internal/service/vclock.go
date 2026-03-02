package service

// ClockRelation describes the causal relationship between two vector clocks.
type ClockRelation int

const (
	ClockDominates  ClockRelation = iota // a is strictly newer than b
	ClockDominated                       // b is strictly newer than a
	ClockConcurrent                      // neither dominates; true concurrency
	ClockEqual                           // identical clocks
)

func CompareClocks(a, b map[string]uint64) ClockRelation {
	aGreater := false
	bGreater := false

	allKeys := make(map[string]struct{}, len(a)+len(b))
	for k := range a {
		allKeys[k] = struct{}{}
	}
	for k := range b {
		allKeys[k] = struct{}{}
	}

	for k := range allKeys {
		va := a[k]
		vb := b[k]
		if va > vb {
			aGreater = true
		} else if vb > va {
			bGreater = true
		}
	}

	switch {
	case aGreater && !bGreater:
		return ClockDominates
	case bGreater && !aGreater:
		return ClockDominated
	case !aGreater && !bGreater:
		return ClockEqual
	default:
		return ClockConcurrent
	}
}

func MergeVectorClocks(a, b map[string]uint64) map[string]uint64 {
	merged := make(map[string]uint64, len(a)+len(b))
	for k, v := range a {
		merged[k] = v
	}
	for k, v := range b {
		if v > merged[k] {
			merged[k] = v
		}
	}
	return merged
}

func TieBreak(a, b *WriteCandidate) *WriteCandidate {
	if a.OriginAgent < b.OriginAgent {
		return a
	}
	if b.OriginAgent < a.OriginAgent {
		return b
	}
	if a.ID < b.ID {
		return a
	}
	return b
}

type WriteCandidate struct {
	ID          string
	OriginAgent string
}
