package service

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/repository"
)

const (
	contentHashMetadataKey      = "content_hash"
	attributedToMetadataKey     = "attributed_to"
	linkedMemoryIDsMetadataKey  = "linked_memory_ids"
	maxMemoryEntities           = 20
	entityRecallBoostWeight     = 0.5
	entityRecallBoostMaxMatches = 200
)

var (
	quotedEntityRE   = regexp.MustCompile(`["“”'‘’` + "`" + `]([^"“”'‘’` + "`" + `]{2,80})["“”'‘’` + "`" + `]`)
	properEntityRE   = regexp.MustCompile(`\b(?:[A-Z][A-Za-z0-9]*|[A-Z]{2,})(?:[\s.-]+(?:[A-Z][A-Za-z0-9]*|[A-Z]{2,})){0,4}\b`)
	codeLikeEntityRE = regexp.MustCompile(`\b[A-Za-z][A-Za-z0-9]*(?:[-_./:][A-Za-z0-9]+)+\b|\b[A-Za-z]+[0-9][A-Za-z0-9]*\b|\b[A-Z]{2,}\b`)
	cjkEntityRE      = regexp.MustCompile(`[\p{Han}]{2,12}`)
	spaceEntityRE    = regexp.MustCompile(`\s+`)
)

var entityStopwords = map[string]struct{}{
	"a": {}, "about": {}, "after": {}, "agent": {}, "all": {}, "also": {}, "an": {}, "and": {},
	"api": {}, "app": {}, "assistant": {}, "before": {}, "but": {}, "can": {}, "code": {},
	"current": {}, "date": {}, "day": {}, "did": {}, "do": {}, "does": {}, "for": {}, "from": {},
	"go": {}, "has": {}, "have": {}, "how": {}, "i": {}, "if": {}, "in": {}, "is": {}, "it": {},
	"last": {}, "memory": {}, "my": {}, "new": {}, "next": {}, "not": {}, "now": {}, "of": {},
	"on": {}, "or": {}, "our": {}, "please": {}, "project": {}, "repo": {}, "server": {},
	"that": {}, "the": {}, "this": {}, "to": {}, "today": {}, "tomorrow": {}, "user": {},
	"using": {}, "was": {}, "we": {}, "what": {}, "when": {}, "where": {}, "with": {}, "you": {},
	"your": {},
}

// MemoryContentHash returns the mem0-style exact-content hash used for
// ADD-only deduplication.
func MemoryContentHash(content string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	sum := md5.Sum([]byte(content))
	return hex.EncodeToString(sum[:])
}

func memoryContentHash(content string) string {
	return MemoryContentHash(content)
}

func mergeAdditiveMemoryMetadata(base json.RawMessage, fact ExtractedFact, contentHash string, linkedIDs []string) json.RawMessage {
	payload := map[string]json.RawMessage{}
	if len(base) > 0 {
		_ = json.Unmarshal(base, &payload)
	}
	if payload == nil {
		payload = map[string]json.RawMessage{}
	}

	if contentHash != "" {
		if raw, err := json.Marshal(contentHash); err == nil {
			payload[contentHashMetadataKey] = raw
		}
	}
	if attributedTo := strings.TrimSpace(fact.AttributedTo); attributedTo != "" {
		if raw, err := json.Marshal(attributedTo); err == nil {
			payload[attributedToMetadataKey] = raw
		}
	}
	linkedIDs = normalizeLinkedMemoryIDs(linkedIDs)
	if len(linkedIDs) > 0 {
		if raw, err := json.Marshal(linkedIDs); err == nil {
			payload[linkedMemoryIDsMetadataKey] = raw
		}
	} else {
		delete(payload, linkedMemoryIDsMetadataKey)
	}

	if len(payload) == 0 {
		return nil
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return base
	}
	return raw
}

func mergeJSONMetadata(base, overlay json.RawMessage) json.RawMessage {
	if len(overlay) == 0 || string(overlay) == "null" {
		return base
	}
	payload := map[string]json.RawMessage{}
	if len(base) > 0 {
		_ = json.Unmarshal(base, &payload)
	}
	if payload == nil {
		payload = map[string]json.RawMessage{}
	}
	var extra map[string]json.RawMessage
	if err := json.Unmarshal(overlay, &extra); err != nil {
		return overlay
	}
	for key, value := range extra {
		payload[key] = value
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return overlay
	}
	return raw
}

func normalizeLinkedMemoryIDs(ids []string) []string {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func validateLinkedMemoryIDs(ctx context.Context, repo repository.MemoryRepo, agentID string, ids []string) []string {
	ids = normalizeLinkedMemoryIDs(ids)
	if len(ids) == 0 {
		return nil
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		m, err := repo.GetByID(ctx, id)
		if err != nil {
			continue
		}
		if agentID != "" && m.AgentID != "" && m.AgentID != agentID {
			continue
		}
		out = append(out, id)
	}
	return out
}

func replaceMemoryEntityLinks(ctx context.Context, repo repository.MemoryRepo, agentID, memoryID, content string) {
	entityRepo, ok := repo.(repository.MemoryEntityRepo)
	if !ok || memoryID == "" {
		return
	}
	entities := extractMemoryEntities(content)
	if err := entityRepo.ReplaceMemoryEntities(ctx, agentID, memoryID, entities); err != nil {
		slog.Warn("replace memory entity links failed", "memory_id", memoryID, "err", err)
	}
}

func deleteMemoryEntityLinks(ctx context.Context, repo repository.MemoryRepo, memoryID string) {
	entityRepo, ok := repo.(repository.MemoryEntityRepo)
	if !ok || memoryID == "" {
		return
	}
	if err := entityRepo.DeleteMemoryEntities(ctx, memoryID); err != nil {
		slog.Warn("delete memory entity links failed", "memory_id", memoryID, "err", err)
	}
}

func extractMemoryEntities(text string) []domain.MemoryEntity {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}

	type candidate struct {
		text string
		typ  string
	}
	candidates := make([]candidate, 0, 16)
	for _, match := range quotedEntityRE.FindAllStringSubmatch(text, -1) {
		if len(match) > 1 {
			candidates = append(candidates, candidate{text: match[1], typ: "quoted"})
		}
	}
	for _, match := range properEntityRE.FindAllString(text, -1) {
		candidates = append(candidates, candidate{text: match, typ: "name"})
	}
	for _, match := range codeLikeEntityRE.FindAllString(text, -1) {
		candidates = append(candidates, candidate{text: match, typ: "code"})
	}
	for _, match := range cjkEntityRE.FindAllString(text, -1) {
		candidates = append(candidates, candidate{text: match, typ: "cjk"})
	}

	seen := make(map[string]struct{}, len(candidates))
	entities := make([]domain.MemoryEntity, 0, len(candidates))
	for _, candidate := range candidates {
		entityText := normalizeEntityText(candidate.text)
		if !isUsefulEntity(entityText) {
			continue
		}
		key := memoryEntityKey(entityText)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		entities = append(entities, domain.MemoryEntity{
			Key:  key,
			Text: truncateRunes(entityText, 255),
			Type: candidate.typ,
		})
		if len(entities) >= maxMemoryEntities {
			break
		}
	}
	return entities
}

func normalizeEntityText(text string) string {
	text = strings.TrimSpace(text)
	text = strings.Trim(text, `"'`+"`“”‘’.,;:!?()[]{}<>")
	text = spaceEntityRE.ReplaceAllString(text, " ")
	return strings.TrimSpace(text)
}

func isUsefulEntity(text string) bool {
	if utf8.RuneCountInString(text) < 2 {
		return false
	}
	if utf8.RuneCountInString(text) > 80 {
		return false
	}
	lower := strings.ToLower(text)
	if _, ok := entityStopwords[lower]; ok {
		return false
	}
	first, _ := utf8.DecodeRuneInString(text)
	if unicode.IsDigit(first) {
		return false
	}
	parts := strings.Fields(lower)
	if len(parts) == 1 {
		if _, ok := entityStopwords[parts[0]]; ok {
			return false
		}
		if utf8.RuneCountInString(parts[0]) < 3 && !strings.ContainsAny(parts[0], "-_./:0123456789") {
			return false
		}
	}
	return true
}

func memoryEntityKey(text string) string {
	text = strings.ToLower(normalizeEntityText(text))
	if text == "" {
		return ""
	}
	sum := md5.Sum([]byte(text))
	return hex.EncodeToString(sum[:])
}

func entityKeys(entities []domain.MemoryEntity) []string {
	keys := make([]string, 0, len(entities))
	seen := make(map[string]struct{}, len(entities))
	for _, entity := range entities {
		if entity.Key == "" {
			continue
		}
		if _, ok := seen[entity.Key]; ok {
			continue
		}
		seen[entity.Key] = struct{}{}
		keys = append(keys, entity.Key)
	}
	return keys
}

func (s *MemoryService) applyEntityBoosts(ctx context.Context, filter domain.MemoryFilter, candidates []RecallCandidate) []RecallCandidate {
	if len(candidates) == 0 || strings.TrimSpace(filter.Query) == "" {
		return candidates
	}
	entityRepo, ok := s.memories.(repository.MemoryEntityRepo)
	if !ok {
		return candidates
	}
	keys := entityKeys(extractMemoryEntities(filter.Query))
	if len(keys) == 0 {
		return candidates
	}
	limit := len(candidates) * 3
	if limit <= 0 || limit > entityRecallBoostMaxMatches {
		limit = entityRecallBoostMaxMatches
	}
	boosts, err := entityRepo.EntityMemoryBoosts(ctx, filter.AgentID, keys, limit)
	if err != nil {
		slog.Warn("entity recall boost failed", "err", err)
		return candidates
	}
	if len(boosts) == 0 {
		return candidates
	}

	out := make([]RecallCandidate, len(candidates))
	copy(out, candidates)
	changed := false
	for i := range out {
		boost, ok := boosts[out[i].Memory.ID]
		if !ok || boost <= 0 {
			continue
		}
		out[i].EntityBoost = boost
		out[i].RRFScore += entityRecallBoostWeight * boost / (rrfK + 1)
		changed = true
	}
	if !changed {
		return candidates
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].RRFScore != out[j].RRFScore {
			return out[i].RRFScore > out[j].RRFScore
		}
		return out[i].RRFRank < out[j].RRFRank
	})
	for i := range out {
		out[i].RRFRank = i + 1
	}
	return out
}
