package service

import (
	"encoding/json"
	"os"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/qiffang/mnemos/server/internal/domain"
)

const (
	factSchemaVersionMetadataKey = "fact_schema_version"
	factKindMetadataKey          = "fact_kind"
	factEntitiesMetadataKey      = "entities"
	answerShapesMetadataKey      = "answer_shapes"
	sourcePacketHintMetadataKey  = "source_packet_hint"
)

const factProfileSchemaVersion = 2
const factProfileRRFMaxScore = 2.0 / 61.0

type FactEntity struct {
	Text string `json:"text"`
	Type string `json:"type,omitempty"`
}

type FactEntityList []FactEntity

func (l *FactEntityList) UnmarshalJSON(data []byte) error {
	var objects []FactEntity
	if err := json.Unmarshal(data, &objects); err == nil {
		*l = normalizeFactEntities(objects)
		return nil
	}
	var stringsOnly []string
	if err := json.Unmarshal(data, &stringsOnly); err != nil {
		return err
	}
	entities := make([]FactEntity, 0, len(stringsOnly))
	for _, value := range stringsOnly {
		entities = append(entities, FactEntity{Text: value})
	}
	*l = normalizeFactEntities(entities)
	return nil
}

type factProfile struct {
	SchemaVersion   int          `json:"fact_schema_version,omitempty"`
	Kind            string       `json:"fact_kind,omitempty"`
	Entities        []FactEntity `json:"entities,omitempty"`
	AnswerShapes    []string     `json:"answer_shapes,omitempty"`
	SourcePacket    bool         `json:"source_packet_hint,omitempty"`
	AttributedTo    string       `json:"attributed_to,omitempty"`
	TemporalDisplay string       `json:"temporal_display,omitempty"`
}

var (
	factProfileDateRe     = regexp.MustCompile(`(?i)\b(?:when|date|time|day|month|year|birthday|anniversary|yesterday|today|tomorrow|last|next)\b|(?:什么时候|日期|时间|哪天|去年|今年|明年|昨天|今天|明天)`)
	factProfileCountRe    = regexp.MustCompile(`(?i)\b(?:how many|number|count|times|twice|once|\d+)\b|(?:多少|几次|一次|两次|三次|\d+)`)
	factProfilePlaceRe    = regexp.MustCompile(`(?i)\b(?:where|place|location|city|country|restaurant|school|hospital|studio|store)\b|(?:哪里|地点|城市|国家|餐厅|学校|医院)`)
	factProfileReasonRe   = regexp.MustCompile(`(?i)\b(?:why|because|reason|inspired|motivated|so that|due to|as a result|helped|advice|recommend|suggest)\b|(?:为什么|因为|原因|建议|推荐|帮助|启发)`)
	factProfileQuoteRe    = regexp.MustCompile(`(?i)\b(?:what did .+ say|said|quote|told|mentioned)\b|(?:说了什么|表示|提到)`)
	factProfileListRe     = regexp.MustCompile(`(?i)\b(?:what (?:are|were|has|have)|which|list|books|movies|songs|places|activities|hobbies|names)\b|(?:哪些|列表|书|电影|歌曲|地方|活动|爱好)`)
	factProfilePlanRe     = regexp.MustCompile(`(?i)\b(?:plan|planning|will|going to|scheduled|upcoming|intend|hope to|want to)\b|(?:计划|打算|准备|将要|想要)`)
	factProfilePrefRe     = regexp.MustCompile(`(?i)\b(?:like|likes|love|loves|prefer|prefers|favorite|enjoy|enjoys|interested in)\b|(?:喜欢|偏好|最爱|感兴趣)`)
	factProfileRelationRe = regexp.MustCompile(`(?i)\b(?:friend|partner|wife|husband|daughter|son|mother|father|sister|brother|coworker|relationship)\b|(?:朋友|伴侣|妻子|丈夫|女儿|儿子|母亲|父亲|姐妹|兄弟|关系)`)
	factProfileArtifactRe = regexp.MustCompile(`(?i)\b(?:book|movie|song|photo|picture|painting|poster|sign|letter|message|title|album|game)\b|(?:书|电影|歌曲|照片|画|海报|信|消息|标题)`)
	factProfileEventRe    = regexp.MustCompile(`(?i)\b(?:went|visited|met|attended|celebrated|started|finished|injured|happened|opened|lost|won|bought|made)\b|(?:去了|参加|庆祝|开始|完成|受伤|发生|开了|失去|赢得|买了|做了)`)
)

func featureEnabled(name string) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	return value != "0" && value != "false" && value != "off" && value != "no"
}

func factProfileV2Enabled() bool {
	return featureEnabled("MEM9_FACT_PROFILE_V2")
}

func sourcePacketV2Enabled() bool {
	return featureEnabled("MEM9_SOURCE_PACKET_V2")
}

func normalizeFactEntities(entities []FactEntity) []FactEntity {
	seen := map[string]struct{}{}
	out := make([]FactEntity, 0, len(entities))
	for _, entity := range entities {
		text := normalizeEntityText(entity.Text)
		if !isUsefulEntity(text) {
			continue
		}
		key := strings.ToLower(text)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		typ := strings.ToLower(strings.TrimSpace(entity.Type))
		out = append(out, FactEntity{
			Text: truncateRunes(text, 255),
			Type: typ,
		})
		if len(out) >= maxMemoryEntities {
			break
		}
	}
	return out
}

func normalizeStringSet(values []string, allowed map[string]struct{}, limit int) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		if allowed != nil {
			if _, ok := allowed[value]; !ok {
				continue
			}
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	sort.Strings(out)
	return out
}

func normalizeFactKind(kind string, text string, tags []string, temporal *TemporalMetadata) string {
	kind = strings.ToLower(strings.TrimSpace(kind))
	allowed := map[string]struct{}{
		"preference": {}, "event": {}, "relationship": {}, "plan": {}, "recommendation": {},
		"count": {}, "temporal": {}, "location": {}, "artifact": {}, "quote": {},
		"reason": {}, "generic": {},
	}
	if _, ok := allowed[kind]; ok {
		return kind
	}
	lower := strings.ToLower(text + " " + strings.Join(tags, " "))
	switch {
	case temporal != nil || factProfileDateRe.MatchString(lower):
		return "temporal"
	case factProfileCountRe.MatchString(lower):
		return "count"
	case factProfileReasonRe.MatchString(lower):
		return "reason"
	case factProfileQuoteRe.MatchString(lower):
		return "quote"
	case factProfilePlaceRe.MatchString(lower):
		return "location"
	case factProfilePlanRe.MatchString(lower):
		return "plan"
	case factProfilePrefRe.MatchString(lower):
		return "preference"
	case factProfileRelationRe.MatchString(lower):
		return "relationship"
	case factProfileArtifactRe.MatchString(lower):
		return "artifact"
	case factProfileEventRe.MatchString(lower):
		return "event"
	default:
		return "generic"
	}
}

func inferAnswerShapes(text string, tags []string, temporal *TemporalMetadata) []string {
	lower := strings.ToLower(text + " " + strings.Join(tags, " "))
	var shapes []string
	if temporal != nil || factProfileDateRe.MatchString(lower) {
		shapes = append(shapes, "date")
	}
	if factProfileCountRe.MatchString(lower) {
		shapes = append(shapes, "count")
	}
	if factProfilePlaceRe.MatchString(lower) {
		shapes = append(shapes, "place")
	}
	if factProfileReasonRe.MatchString(lower) {
		shapes = append(shapes, "reason")
	}
	if factProfileQuoteRe.MatchString(lower) {
		shapes = append(shapes, "quote")
	}
	if factProfileListRe.MatchString(lower) {
		shapes = append(shapes, "list")
	}
	if factProfileArtifactRe.MatchString(lower) {
		shapes = append(shapes, "title")
	}
	if len(shapes) == 0 {
		shapes = append(shapes, "generic")
	}
	return normalizeAnswerShapes(shapes)
}

func normalizeAnswerShapes(shapes []string) []string {
	allowed := map[string]struct{}{
		"date": {}, "count": {}, "title": {}, "person": {}, "place": {},
		"list": {}, "reason": {}, "quote": {}, "yes_no": {}, "generic": {},
	}
	return normalizeStringSet(shapes, allowed, 6)
}

func shouldHintSourcePacket(fact ExtractedFact) bool {
	if fact.SourcePacketHint {
		return true
	}
	if len(fact.SourceTurns) == 0 {
		return false
	}
	kind := normalizeFactKind(fact.FactKind, fact.Text, fact.Tags, fact.Temporal)
	switch kind {
	case "event", "recommendation", "count", "temporal", "artifact", "quote", "reason", "relationship":
		return true
	default:
		return len(fact.SourceSeqs) > 1
	}
}

func metadataFactProfile(metadata json.RawMessage) factProfile {
	var payload map[string]json.RawMessage
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &payload)
	}
	profile := factProfile{}
	if len(payload) == 0 {
		return profile
	}
	_ = json.Unmarshal(payload[factSchemaVersionMetadataKey], &profile.SchemaVersion)
	_ = json.Unmarshal(payload[factKindMetadataKey], &profile.Kind)
	_ = json.Unmarshal(payload[factEntitiesMetadataKey], &profile.Entities)
	_ = json.Unmarshal(payload[answerShapesMetadataKey], &profile.AnswerShapes)
	_ = json.Unmarshal(payload[sourcePacketHintMetadataKey], &profile.SourcePacket)
	_ = json.Unmarshal(payload[attributedToMetadataKey], &profile.AttributedTo)
	if temporal, ok := ParseTemporalMetadata(metadata); ok {
		profile.TemporalDisplay = temporal.Display
	}
	profile.Kind = normalizeFactKind(profile.Kind, "", nil, nil)
	profile.Entities = normalizeFactEntities(profile.Entities)
	profile.AnswerShapes = normalizeAnswerShapes(profile.AnswerShapes)
	return profile
}

func metadataFactEntities(metadata json.RawMessage) []domain.MemoryEntity {
	profile := metadataFactProfile(metadata)
	entities := make([]domain.MemoryEntity, 0, len(profile.Entities))
	for _, entity := range profile.Entities {
		text := normalizeEntityText(entity.Text)
		if !isUsefulEntity(text) {
			continue
		}
		typ := entity.Type
		if typ == "" {
			typ = "metadata"
		}
		entities = append(entities, domain.MemoryEntity{
			Key:          memoryEntityKey(text),
			CanonicalKey: memoryEntityKey(text),
			Text:         truncateRunes(text, 255),
			Type:         typ,
		})
	}
	return entities
}

func queryAnswerShapes(query string) []string {
	lower := strings.ToLower(query)
	var shapes []string
	if factProfileDateRe.MatchString(lower) {
		shapes = append(shapes, "date")
	}
	if factProfileCountRe.MatchString(lower) {
		shapes = append(shapes, "count")
	}
	if factProfilePlaceRe.MatchString(lower) {
		shapes = append(shapes, "place")
	}
	if factProfileReasonRe.MatchString(lower) {
		shapes = append(shapes, "reason")
	}
	if factProfileQuoteRe.MatchString(lower) {
		shapes = append(shapes, "quote")
	}
	if factProfileListRe.MatchString(lower) {
		shapes = append(shapes, "list")
	}
	if factProfileArtifactRe.MatchString(lower) {
		shapes = append(shapes, "title")
	}
	if len(shapes) == 0 {
		shapes = append(shapes, "generic")
	}
	return normalizeAnswerShapes(shapes)
}

func stringSetOverlapCount(left, right []string) int {
	if len(left) == 0 || len(right) == 0 {
		return 0
	}
	set := make(map[string]struct{}, len(left))
	for _, value := range left {
		set[value] = struct{}{}
	}
	count := 0
	for _, value := range right {
		if _, ok := set[value]; ok {
			count++
		}
	}
	return count
}

func queryEntityTextSet(query string) map[string]struct{} {
	entities := extractMemoryEntities(query)
	set := make(map[string]struct{}, len(entities))
	for _, entity := range entities {
		if entity.Text != "" {
			set[strings.ToLower(entity.Text)] = struct{}{}
		}
	}
	return set
}

func metadataEntityOverlap(queryEntities map[string]struct{}, profile factProfile) float64 {
	if len(queryEntities) == 0 || len(profile.Entities) == 0 {
		return 0
	}
	matches := 0
	for _, entity := range profile.Entities {
		if _, ok := queryEntities[strings.ToLower(entity.Text)]; ok {
			matches++
		}
	}
	if matches == 0 {
		return 0
	}
	return float64(matches) / float64(maxInt(1, len(queryEntities)))
}

func applyFactProfileScoring(filter domain.MemoryFilter, candidates []RecallCandidate) []RecallCandidate {
	if len(candidates) == 0 || strings.TrimSpace(filter.Query) == "" || !factProfileV2Enabled() {
		return candidates
	}
	queryShapes := queryAnswerShapes(filter.Query)
	queryEntities := queryEntityTextSet(filter.Query)
	out := make([]RecallCandidate, len(candidates))
	copy(out, candidates)

	for i := range out {
		profile := metadataFactProfile(out[i].Memory.Metadata)
		rrfNorm := clampFloat(out[i].RRFScore/factProfileRRFMaxScore, 0, 1)
		semantic := rrfNorm
		if out[i].InVector {
			semantic = maxFloat(semantic, clampFloat((out[i].VectorSimilarity-0.30)/0.70, 0, 1))
		}
		if semantic < 0.05 && !out[i].InKeyword {
			continue
		}
		keyword := 0.0
		if out[i].InKeyword {
			keyword = 1
		}
		entity := maxFloat(out[i].EntityBoost, metadataEntityOverlap(queryEntities, profile))
		shape := 0.0
		if stringSetOverlapCount(queryShapes, profile.AnswerShapes) > 0 {
			shape = 1
		}
		source := 0.0
		if profile.SourcePacket {
			source = 0.35
		}
		risk := factProfileRiskPenalty(filter.Query, profile, out[i].Memory)

		combined := (semantic + 0.75*keyword + 0.50*entity + 0.35*shape + source - risk) / 2.95
		combined = clampFloat(combined, 0, 1)
		out[i].ProfileBoost = combined
		out[i].RiskPenalty = risk
		out[i].RRFScore += combined / (rrfK + 1)
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

func factProfileRiskPenalty(query string, profile factProfile, memory domain.Memory) float64 {
	lower := strings.ToLower(memory.Content)
	penalty := 0.0
	if strings.Contains(lower, "usually") || strings.Contains(lower, "often") || strings.Contains(lower, "generally") {
		if factProfileCountRe.MatchString(strings.ToLower(query)) {
			penalty += 0.25
		}
	}
	if profile.Kind == "generic" && stringSetOverlapCount(queryAnswerShapes(query), []string{"date", "count", "reason", "quote"}) > 0 {
		penalty += 0.15
	}
	if utf8.RuneCountInString(memory.Content) > 900 && len(profile.AnswerShapes) == 0 {
		penalty += 0.10
	}
	return penalty
}

func clampFloat(value, lo, hi float64) float64 {
	if value < lo {
		return lo
	}
	if value > hi {
		return hi
	}
	return value
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
