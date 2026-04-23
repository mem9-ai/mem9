package service

import (
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strings"
)

const (
	sourceSeqsMetadataKey = "source_seqs"
	maxSourceSeqsPerFact  = 6
)

var sourceProvenanceTokenRe = regexp.MustCompile(`[A-Za-z]+(?:'[A-Za-z]+)?|\d+|[\p{Han}]{2,}`)

var sourceProvenanceStopwords = map[string]struct{}{
	"a": {}, "an": {}, "and": {}, "are": {}, "as": {}, "at": {}, "be": {}, "by": {},
	"did": {}, "do": {}, "does": {}, "for": {}, "from": {}, "had": {}, "has": {}, "have": {},
	"he": {}, "her": {}, "his": {}, "how": {}, "i": {}, "in": {}, "is": {}, "it": {},
	"me": {}, "my": {}, "of": {}, "on": {}, "or": {}, "our": {}, "she": {}, "so": {},
	"that": {}, "the": {}, "their": {}, "them": {}, "they": {}, "this": {}, "to": {},
	"was": {}, "we": {}, "were": {}, "what": {}, "when": {}, "where": {}, "which": {},
	"who": {}, "why": {}, "with": {}, "you": {}, "your": {},
	"date": {}, "speaker": {}, "user": {}, "assistant": {},
}

func annotateFactsWithSourceSeqs(input preparedExtractionInput, facts []ExtractedFact) []ExtractedFact {
	if len(facts) == 0 {
		return facts
	}
	out := make([]ExtractedFact, len(facts))
	copy(out, facts)
	for i := range out {
		if len(out[i].SourceSeqs) > 0 {
			out[i].SourceSeqs = normalizeSourceSeqs(out[i].SourceSeqs)
			continue
		}
		if strings.EqualFold(out[i].FactType, factTypeRawFallback) {
			out[i].SourceSeqs = messageSourceSeqs(input.messages)
			continue
		}
		out[i].SourceSeqs = inferSourceSeqs(out[i].Text, input.messages)
	}
	return out
}

func metadataForExtractedFact(fact ExtractedFact) json.RawMessage {
	return SetSourceSeqMetadata(MergeTemporalMetadata(nil, fact.Temporal), fact.SourceSeqs)
}

func MergeSourceSeqMetadata(existing json.RawMessage, seqs []int) json.RawMessage {
	return sourceSeqMetadata(existing, seqs, true)
}

func SetSourceSeqMetadata(existing json.RawMessage, seqs []int) json.RawMessage {
	return setSourceSeqMetadata(existing, seqs)
}

func sourceSeqMetadata(existing json.RawMessage, seqs []int, mergeExisting bool) json.RawMessage {
	seqs = normalizeSourceSeqs(seqs)
	if len(seqs) == 0 {
		return existing
	}

	var payload map[string]json.RawMessage
	if len(existing) > 0 {
		_ = json.Unmarshal(existing, &payload)
	}
	if payload == nil {
		payload = map[string]json.RawMessage{}
	}

	if mergeExisting {
		existingRaw := payload[sourceSeqsMetadataKey]
		seqs = normalizeSourceSeqs(append(parseSourceSeqsRaw(existingRaw), seqs...))
	}
	rawSeqs, err := json.Marshal(seqs)
	if err != nil {
		return existing
	}
	payload[sourceSeqsMetadataKey] = rawSeqs

	raw, err := json.Marshal(payload)
	if err != nil {
		return existing
	}
	return raw
}

func setSourceSeqMetadata(existing json.RawMessage, seqs []int) json.RawMessage {
	var payload map[string]json.RawMessage
	if len(existing) > 0 {
		if err := json.Unmarshal(existing, &payload); err != nil {
			payload = nil
		}
	}
	if payload == nil {
		payload = map[string]json.RawMessage{}
	}

	seqs = normalizeSourceSeqs(seqs)
	if len(seqs) == 0 {
		delete(payload, sourceSeqsMetadataKey)
		if len(payload) == 0 {
			return nil
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			return existing
		}
		return raw
	}

	rawSeqs, err := json.Marshal(seqs)
	if err != nil {
		return existing
	}
	payload[sourceSeqsMetadataKey] = rawSeqs

	raw, err := json.Marshal(payload)
	if err != nil {
		return existing
	}
	return raw
}

func sourceSeqsForReconcileText(text string, facts []ExtractedFact) []int {
	if len(facts) == 0 {
		return nil
	}
	if len(facts) == 1 {
		return normalizeSourceSeqs(facts[0].SourceSeqs)
	}

	query := sourceTokenSet(text)
	if len(query) == 0 {
		return nil
	}

	type candidate struct {
		index int
		hits  int
	}
	candidates := make([]candidate, 0, len(facts))
	maxHits := 0
	for i, fact := range facts {
		hits := countTokenOverlap(query, sourceTokenSet(projectReconcileFactText(fact)))
		if hits == 0 {
			continue
		}
		if hits > maxHits {
			maxHits = hits
		}
		candidates = append(candidates, candidate{index: i, hits: hits})
	}
	if len(candidates) == 0 {
		return nil
	}

	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].hits != candidates[j].hits {
			return candidates[i].hits > candidates[j].hits
		}
		return candidates[i].index < candidates[j].index
	})

	minHits := sourceMinHits(len(query))
	var seqs []int
	for _, candidate := range candidates {
		if candidate.hits < minHits && candidate.hits < maxHits {
			continue
		}
		if float64(candidate.hits) < math.Ceil(float64(maxHits)*0.6) {
			continue
		}
		seqs = append(seqs, facts[candidate.index].SourceSeqs...)
	}
	return normalizeSourceSeqs(seqs)
}

func inferSourceSeqs(text string, messages []IngestMessage) []int {
	query := sourceTokenSet(text)
	if len(query) == 0 {
		return nil
	}

	type candidate struct {
		seq  int
		hits int
	}
	var candidates []candidate
	maxHits := 0
	for _, msg := range messages {
		if msg.Seq == nil || !strings.EqualFold(msg.Role, "user") {
			continue
		}
		hits := countTokenOverlap(query, sourceTokenSet(msg.Content))
		if hits == 0 {
			continue
		}
		if hits > maxHits {
			maxHits = hits
		}
		candidates = append(candidates, candidate{seq: *msg.Seq, hits: hits})
	}
	if len(candidates) == 0 {
		return nil
	}

	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].hits != candidates[j].hits {
			return candidates[i].hits > candidates[j].hits
		}
		return candidates[i].seq < candidates[j].seq
	})

	minHits := sourceMinHits(len(query))
	threshold := int(math.Ceil(float64(maxHits) * 0.6))
	if threshold < minHits {
		threshold = minHits
	}

	seqs := make([]int, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.hits < threshold {
			continue
		}
		seqs = append(seqs, candidate.seq)
		if len(seqs) >= maxSourceSeqsPerFact {
			break
		}
	}
	return normalizeSourceSeqs(seqs)
}

func sourceMinHits(tokenCount int) int {
	switch {
	case tokenCount <= 2:
		return 1
	case tokenCount <= 7:
		return 2
	default:
		return 3
	}
}

func sourceTokenSet(text string) map[string]struct{} {
	matches := sourceProvenanceTokenRe.FindAllString(strings.ToLower(text), -1)
	tokens := make(map[string]struct{}, len(matches))
	for _, token := range matches {
		token = strings.Trim(token, "'")
		if len([]rune(token)) < 2 {
			continue
		}
		if _, stop := sourceProvenanceStopwords[token]; stop {
			continue
		}
		tokens[token] = struct{}{}
	}
	return tokens
}

func countTokenOverlap(left, right map[string]struct{}) int {
	if len(left) > len(right) {
		left, right = right, left
	}
	hits := 0
	for token := range left {
		if _, ok := right[token]; ok {
			hits++
		}
	}
	return hits
}

func messageSourceSeqs(messages []IngestMessage) []int {
	seqs := make([]int, 0, len(messages))
	for _, msg := range messages {
		if msg.Seq == nil || !strings.EqualFold(msg.Role, "user") {
			continue
		}
		seqs = append(seqs, *msg.Seq)
		if len(seqs) >= maxSourceSeqsPerFact {
			break
		}
	}
	return normalizeSourceSeqs(seqs)
}

func parseSourceSeqsRaw(raw json.RawMessage) []int {
	var nums []int
	if err := json.Unmarshal(raw, &nums); err == nil {
		return nums
	}
	var mixed []any
	if err := json.Unmarshal(raw, &mixed); err != nil {
		return nil
	}
	out := make([]int, 0, len(mixed))
	for _, item := range mixed {
		switch value := item.(type) {
		case float64:
			if value == math.Trunc(value) {
				out = append(out, int(value))
			}
		case string:
			if parsed, ok := parsePositiveInt(value); ok {
				out = append(out, parsed)
			}
		}
	}
	return out
}

func parsePositiveInt(value string) (int, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	total := 0
	for _, r := range value {
		if r < '0' || r > '9' {
			return 0, false
		}
		total = total*10 + int(r-'0')
	}
	return total, true
}

func normalizeSourceSeqs(seqs []int) []int {
	if len(seqs) == 0 {
		return nil
	}
	seen := make(map[int]struct{}, len(seqs))
	out := make([]int, 0, len(seqs))
	for _, seq := range seqs {
		if seq < 0 {
			continue
		}
		if _, ok := seen[seq]; ok {
			continue
		}
		seen[seq] = struct{}{}
		out = append(out, seq)
	}
	sort.Ints(out)
	if len(out) == 0 {
		return nil
	}
	return out
}
