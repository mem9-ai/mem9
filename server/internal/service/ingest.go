package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/embed"
	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/repository"
)

// IngestMode controls which pipeline stages run.
type IngestMode string

const (
	ModeSmart IngestMode = "smart" // Extract + Reconcile
	ModeRaw   IngestMode = "raw"   // Store as-is (no LLM)
)

const (
	maxExtractionConversationRunes = 1000000
	factTypeQueryIntent            = "query_intent"
	factTypeRawFallback            = "raw_fallback"
	rawFallbackTag                 = "raw-fallback"
)

var formattedConversationMessageRE = regexp.MustCompile(`(?:^|\n\n)([A-Za-z][A-Za-z0-9_-]*): `)

// IngestRequest is the input for the ingest pipeline.
type IngestRequest struct {
	Messages  []IngestMessage `json:"messages"`
	SessionID string          `json:"session_id"`
	AgentID   string          `json:"agent_id"`
	Mode      IngestMode      `json:"mode"`
}

// IngestMessage represents a single conversation message.
type IngestMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Seq     *int   `json:"seq,omitempty"`
}

// IngestResult is the output of the ingest pipeline.
type IngestResult struct {
	Status          string   `json:"status"`           // complete | partial | failed
	MemoriesChanged int      `json:"memories_changed"` // count of ADD + UPDATE actions executed
	InsightIDs      []string `json:"insight_ids,omitempty"`
	Warnings        int      `json:"warnings,omitempty"`
	Error           string   `json:"error,omitempty"`
}

// IngestService orchestrates the two-phase smart memory pipeline.
type IngestService struct {
	memories  repository.MemoryRepo
	llm       *llm.Client
	embedder  *embed.Embedder
	autoModel string
	mode      IngestMode
}

// NewIngestService creates a new IngestService.
func NewIngestService(
	memories repository.MemoryRepo,
	llmClient *llm.Client,
	embedder *embed.Embedder,
	autoModel string,
	defaultMode IngestMode,
) *IngestService {
	if defaultMode == "" {
		defaultMode = ModeSmart
	}
	return &IngestService{
		memories:  memories,
		llm:       llmClient,
		embedder:  embedder,
		autoModel: autoModel,
		mode:      defaultMode,
	}
}

// Ingest runs the pipeline: extract facts from conversation, reconcile with existing memories.
func (s *IngestService) Ingest(ctx context.Context, agentName string, req IngestRequest) (*IngestResult, error) {
	slog.Info("ingest pipeline started", "agent", agentName, "agent_id", req.AgentID, "session_id", req.SessionID, "messages", len(req.Messages), "mode", req.Mode)
	if len(req.Messages) == 0 {
		return nil, &domain.ValidationError{Field: "messages", Message: "required"}
	}

	mode := req.Mode
	if mode == "" {
		mode = s.mode
	}

	// Validate mode.
	if mode != ModeSmart && mode != ModeRaw {
		return nil, &domain.ValidationError{Field: "mode", Message: fmt.Sprintf("unsupported mode %q", mode)}
	}
	// Strip plugin-injected context before any storage path.
	req.Messages = stripInjectedContext(req.Messages)

	// For raw mode or no LLM, skip smart pipeline and store conversation directly.
	if mode == ModeRaw || s.llm == nil {
		return s.ingestRaw(ctx, agentName, req)
	}

	// Format conversation for LLM.
	formatted := formatConversation(req.Messages)
	if formatted == "" {
		return &IngestResult{Status: "complete"}, nil
	}

	// Cap conversation size to avoid blowing LLM token limits.
	formatted = truncateRunes(formatted, maxExtractionConversationRunes)

	insightIDs, warnings, err := s.extractAndReconcile(ctx, agentName, req.AgentID, req.SessionID, formatted)
	if err != nil {
		slog.Error("insight extraction failed", "err", err)
		return &IngestResult{Status: "failed", Warnings: warnings}, nil
	}

	status := "complete"
	if warnings > 0 && len(insightIDs) == 0 {
		status = "partial"
	}

	return &IngestResult{
		Status:          status,
		MemoriesChanged: len(insightIDs),
		InsightIDs:      insightIDs,
		Warnings:        warnings,
	}, nil
}

// HasLLM returns true if an LLM client is configured for smart processing.
func (s *IngestService) HasLLM() bool {
	return s.llm != nil
}

// Phase1Result holds the output of ExtractPhase1.
type Phase1Result struct {
	Facts       []ExtractedFact // atomic facts extracted from user messages, each with LLM-assigned tags
	MessageTags [][]string      // per-message tags parallel to input messages; missing entries = []
}

// ExtractedFact holds a single atomic fact and the tags the LLM assigned to it.
type ExtractedFact struct {
	Text     string            `json:"text"`
	Tags     []string          `json:"tags,omitempty"`
	FactType string            `json:"fact_type,omitempty"` // "fact" | "query_intent" | "raw_fallback"; omitted = "fact"
	Temporal *TemporalMetadata `json:"-"`
}

// dropQueryIntentFacts removes facts classified as query_intent by the extraction
// LLM. These are search queries or lookup questions ("who is X", "how do I Y",
// "what does Z mean", "X是谁", "如何做Y", "Z是什么意思") that reflect what the
// user asked, not what the user stated about themselves.
// Facts with an omitted fact_type are kept — safe default on LLM non-compliance.
// Dropped facts are logged at Info level (length only, no raw text) for observability.
func dropQueryIntentFacts(facts []ExtractedFact) []ExtractedFact {
	out := facts[:0]
	for _, f := range facts {
		if strings.EqualFold(f.FactType, factTypeQueryIntent) {
			slog.Info("dropping query_intent fact", "len", len(f.Text))
			continue
		}
		out = append(out, f)
	}
	return out
}

type preparedExtractionInput struct {
	messages        []IngestMessage
	originalIndices []int
	formatted       string
	fallbackText    string
}

func prepareExtractionInput(messages []IngestMessage, maxConversationRunes int) preparedExtractionInput {
	input := preparedExtractionInput{}
	for idx, msg := range messages {
		content := strings.TrimSpace(msg.Content)
		if content == "" {
			continue
		}
		input.messages = append(input.messages, IngestMessage{
			Role:    strings.TrimSpace(msg.Role),
			Content: content,
			Seq:     msg.Seq,
		})
		input.originalIndices = append(input.originalIndices, idx)
	}
	if len(input.messages) == 0 {
		return input
	}
	input.formatted = truncateRunes(formatConversation(input.messages), maxConversationRunes)
	input.fallbackText = truncateRunes(buildRawFallbackSourceText(input.messages), maxConversationRunes)
	return input
}

func prepareExtractionInputFromConversation(conversation string, maxConversationRunes int) preparedExtractionInput {
	return prepareExtractionInput(parseConversationMessages(conversation), maxConversationRunes)
}

func parseConversationMessages(conversation string) []IngestMessage {
	conversation = strings.TrimSpace(conversation)
	if conversation == "" {
		return nil
	}
	matches := formattedConversationMessageRE.FindAllStringSubmatchIndex(conversation, -1)
	if len(matches) == 0 {
		return []IngestMessage{{Role: "user", Content: conversation}}
	}
	messages := make([]IngestMessage, 0, len(matches))
	for i, match := range matches {
		roleStart, roleEnd := match[2], match[3]
		contentStart := match[1]
		contentEnd := len(conversation)
		if i+1 < len(matches) {
			contentEnd = matches[i+1][0]
		}
		content := strings.TrimSpace(conversation[contentStart:contentEnd])
		if content == "" {
			continue
		}
		messages = append(messages, IngestMessage{
			Role:    strings.ToLower(conversation[roleStart:roleEnd]),
			Content: content,
		})
	}
	if len(messages) == 0 {
		return []IngestMessage{{Role: "user", Content: conversation}}
	}
	return messages
}

func buildRawFallbackSourceText(messages []IngestMessage) string {
	var userParts []string
	var allParts []string
	for _, msg := range messages {
		content := strings.TrimSpace(msg.Content)
		if content == "" {
			continue
		}
		allParts = append(allParts, content)
		if strings.EqualFold(msg.Role, "user") {
			userParts = append(userParts, content)
		}
	}
	if len(userParts) > 0 {
		return strings.Join(userParts, "\n\n")
	}
	return strings.Join(allParts, "\n\n")
}

func buildRawFallbackFact(text string) ExtractedFact {
	return ExtractedFact{
		Text:     text,
		Tags:     []string{rawFallbackTag},
		FactType: factTypeRawFallback,
	}
}

func buildRawFallbackFacts(input preparedExtractionInput, reason string) []ExtractedFact {
	text := strings.TrimSpace(input.fallbackText)
	if text == "" {
		slog.Warn("raw fallback unavailable", "reason", reason)
		return nil
	}
	slog.Warn("using raw fallback fact", "reason", reason, "len", len(text))
	return normalizeRawFallbackFacts(input, []ExtractedFact{buildRawFallbackFact(text)})
}

func finalizeExtractedFacts(input preparedExtractionInput, parsed []ExtractedFact, emptyReason string) []ExtractedFact {
	facts := dropQueryIntentFacts(parsed)
	if len(facts) > 0 {
		return normalizeTemporalFacts(input, facts)
	}
	reason := emptyReason
	if len(parsed) > 0 {
		reason = "query_intent_only"
	}
	return buildRawFallbackFacts(input, reason)
}

func normalizeMessageTags(tags [][]string, messageCount int) [][]string {
	out := make([][]string, messageCount)
	for i := range out {
		if i < len(tags) && tags[i] != nil {
			out[i] = tags[i]
		} else {
			out[i] = []string{}
		}
	}
	return out
}

func expandMessageTags(cleanedTags [][]string, input preparedExtractionInput, originalCount int) [][]string {
	out := make([][]string, originalCount)
	for i := range out {
		out[i] = []string{}
	}
	for cleanedIdx, originalIdx := range input.originalIndices {
		if originalIdx < 0 || originalIdx >= originalCount {
			continue
		}
		if cleanedIdx < len(cleanedTags) && cleanedTags[cleanedIdx] != nil {
			out[originalIdx] = cleanedTags[cleanedIdx]
		}
	}
	return out
}

func hasTag(tags []string, target string) bool {
	for _, tag := range tags {
		if strings.EqualFold(tag, target) {
			return true
		}
	}
	return false
}

func ensureRawFallbackTag(tags []string, facts []ExtractedFact) []string {
	if len(facts) != 1 {
		return tags
	}
	fact := facts[0]
	if !strings.EqualFold(fact.FactType, factTypeRawFallback) && !hasTag(fact.Tags, rawFallbackTag) {
		return tags
	}
	if hasTag(tags, rawFallbackTag) {
		return tags
	}
	out := append([]string{}, tags...)
	return append(out, rawFallbackTag)
}

func projectReconcileFactText(fact ExtractedFact) string {
	return ProjectTemporalFactText(fact.Text, fact.Temporal)
}

func normalizeReconciledTemporalContent(content string) (string, *TemporalMetadata) {
	content = StripTemporalProjection(content)
	return NormalizeStandaloneTemporalContent(content, time.Now())
}

// ExtractPhase1 runs fact extraction and per-message tagging in a single LLM call.
// Returns an empty Phase1Result (no error) when LLM is nil or messages are empty.
func (s *IngestService) ExtractPhase1(ctx context.Context, messages []IngestMessage) (*Phase1Result, error) {
	if s.llm == nil || len(messages) == 0 {
		return &Phase1Result{}, nil
	}

	input := prepareExtractionInput(messages, maxExtractionConversationRunes)
	if input.formatted == "" {
		return &Phase1Result{}, nil
	}

	facts, messageTags, err := s.extractFactsAndTags(ctx, input.formatted, len(input.messages))
	if err != nil {
		return nil, err
	}
	return &Phase1Result{
		Facts:       facts,
		MessageTags: expandMessageTags(messageTags, input, len(messages)),
	}, nil
}

// ReconcilePhase2 runs reconciliation of extracted facts against existing memories.
// Equivalent to the existing reconcile() pipeline, now exported for use by the handler.
func (s *IngestService) ReconcilePhase2(ctx context.Context, agentName, agentID, sessionID string, facts []ExtractedFact) (*IngestResult, error) {
	if len(facts) == 0 {
		return &IngestResult{Status: "complete"}, nil
	}
	const maxFacts = 50
	if len(facts) > maxFacts {
		slog.Warn("ReconcilePhase2: truncating facts", "count", len(facts), "max", maxFacts)
		facts = facts[:maxFacts]
	}
	insightIDs, warnings, err := s.reconcile(ctx, agentName, agentID, sessionID, facts)
	if err != nil {
		slog.Error("ReconcilePhase2: reconciliation failed", "err", err)
		return &IngestResult{Status: "failed", Warnings: warnings}, nil
	}
	status := "complete"
	if warnings > 0 && len(insightIDs) == 0 {
		status = "partial"
	}
	return &IngestResult{
		Status:          status,
		MemoriesChanged: len(insightIDs),
		InsightIDs:      insightIDs,
		Warnings:        warnings,
	}, nil
}

// ReconcileContent runs the full ingest pipeline (extract facts + reconcile)
// for raw content strings (as opposed to conversation messages).
// Each content string is wrapped as a single user message for fact extraction.
func (s *IngestService) ReconcileContent(ctx context.Context, agentName, agentID, sessionID string, contents []string) (*IngestResult, error) {
	if len(contents) == 0 {
		return nil, &domain.ValidationError{Field: "content", Message: "required"}
	}

	slog.Info("reconcile content pipeline started", "agent", agentName, "agent_id", agentID, "contents", len(contents))

	// Reconciliation requires LLM; do not silently degrade to raw writes.
	if s.llm == nil {
		return nil, &domain.ValidationError{Field: "llm", Message: "LLM is required for reconciliation"}
	}

	var allFacts []ExtractedFact
	var totalWarnings int
	var failures int

	for _, content := range contents {
		content = strings.TrimSpace(content)
		if content == "" {
			continue
		}

		// Cap content size to avoid blowing LLM token limits.
		const maxContentRunes = 32000
		formatted := truncateRunes(content, maxContentRunes)

		// Wrap as a single user message for fact extraction.
		conversation := "User: " + formatted

		facts, err := s.extractFacts(ctx, conversation)
		if err != nil {
			slog.Error("reconcile content: fact extraction failed", "err", err)
			totalWarnings++
			failures++
			continue
		}
		allFacts = append(allFacts, facts...)
	}

	if len(allFacts) == 0 {
		status := "complete"
		if failures > 0 {
			status = "failed"
		}
		return &IngestResult{
			Status:          status,
			MemoriesChanged: 0,
			Warnings:        totalWarnings,
		}, nil
	}

	insightIDs, warnings, err := s.reconcile(ctx, agentName, agentID, sessionID, allFacts)
	totalWarnings += warnings
	if err != nil {
		slog.Error("reconcile content: batched reconciliation failed", "err", err)
		return &IngestResult{
			Status:          "failed",
			MemoriesChanged: 0,
			Warnings:        totalWarnings + 1,
		}, nil
	}

	status := "complete"
	if failures > 0 && len(insightIDs) == 0 {
		status = "failed"
	} else if totalWarnings > 0 || failures > 0 {
		status = "partial"
	}

	return &IngestResult{
		Status:          status,
		MemoriesChanged: len(insightIDs),
		InsightIDs:      insightIDs,
		Warnings:        totalWarnings,
	}, nil
}

// ingestRaw stores messages as a single raw memory (legacy behavior).
func (s *IngestService) ingestRaw(ctx context.Context, agentName string, req IngestRequest) (*IngestResult, error) {
	content := strings.TrimSpace(formatConversation(req.Messages))
	if content == "" {
		return &IngestResult{Status: "complete"}, nil
	}

	// Cap content size to avoid exceeding DB column limits.
	const maxRawContentRunes = 200000
	content = truncateRunes(content, maxRawContentRunes)

	var embedding []float32
	if s.autoModel == "" && s.embedder != nil {
		var err error
		embedding, err = s.embedder.Embed(ctx, content)
		if err != nil {
			return nil, fmt.Errorf("embed for raw ingest: %w", err)
		}
	}

	now := time.Now()
	m := &domain.Memory{
		ID:         uuid.New().String(),
		Content:    content,
		MemoryType: domain.TypeInsight,
		Source:     agentName,
		AgentID:    req.AgentID,
		SessionID:  req.SessionID,
		Embedding:  embedding,
		State:      domain.StateActive,
		Version:    1,
		UpdatedBy:  agentName,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	writeStart := time.Now()
	err := s.memories.Create(ctx, m)
	metrics.MemoryWriteDuration.WithLabelValues("create", metricStatus(err)).Observe(time.Since(writeStart).Seconds())
	if err != nil {
		return nil, fmt.Errorf("create raw memory: %w", err)
	}
	return &IngestResult{
		Status:          "complete",
		MemoriesChanged: 1,
		InsightIDs:      []string{m.ID},
	}, nil
}

// extractAndReconcile runs Phase 1a (extraction) + Phase 2 (reconciliation).
func (s *IngestService) extractAndReconcile(ctx context.Context, agentName, agentID, sessionID, conversation string) ([]string, int, error) {
	const maxFacts = 50 // Cap extracted facts to bound reconciliation prompt size

	// Phase 1a: Extract facts only — no message_tags needed here (smart-ingest / raw-ingest path).
	// Use extractFacts instead of extractFactsAndTags to avoid wasting tokens on tag generation.
	facts, err := s.extractFacts(ctx, conversation)
	if err != nil {
		return nil, 0, fmt.Errorf("extract facts: %w", err)
	}
	if len(facts) == 0 {
		return nil, 0, nil
	}

	// Cap facts to prevent LLM context overflow.
	if len(facts) > maxFacts {
		slog.Warn("extractAndReconcile: truncating extracted facts", "count", len(facts), "max", maxFacts)
		facts = facts[:maxFacts]
	}

	// Phase 2: Reconcile each fact against existing memories.
	return s.reconcile(ctx, agentName, agentID, sessionID, facts)
}

// normalizeParsedFacts converts []ExtractedFact from a successful parse into a
// clean slice, and falls back to progressively looser formats when the primary
// parse succeeded structurally but produced no facts:
//
//  1. Legacy string-array: {"facts":["text"]} — json.Unmarshal silently
//     produces Facts:nil on a type mismatch inside a slice element.
//  2. Flattened-fact: {"facts":":[{","text":"...","tags":[...]} — a recurring
//     model glitch where the array opening bleeds into the key's string value
//     and the intended fact fields are emitted as top-level keys instead.
func normalizeParsedFacts(raw string, parsed []ExtractedFact) []ExtractedFact {
	var out []ExtractedFact
	for _, f := range parsed {
		f.Text = strings.TrimSpace(f.Text)
		if f.Text != "" {
			out = append(out, f)
		}
	}
	if len(parsed) > 0 && len(out) == 0 {
		slog.Warn("normalizeParsedFacts: all parsed facts had empty text, trying legacy fallback",
			"parsed_count", len(parsed))
	}
	if len(out) > 0 {
		return out
	}

	cleaned := llm.StripMarkdownFences(raw)

	// Fallback 1: legacy string-array {"facts":["text1","text2"]}.
	type legacyResponse struct {
		Facts []string `json:"facts"`
	}
	var legacy legacyResponse
	if err := json.Unmarshal([]byte(cleaned), &legacy); err == nil {
		for _, t := range legacy.Facts {
			t = strings.TrimSpace(t)
			if t != "" {
				out = append(out, ExtractedFact{Text: t})
			}
		}
		if len(legacy.Facts) > 0 && len(out) == 0 {
			slog.Warn("normalizeParsedFacts: legacy facts array had entries but all were empty after trim",
				"legacy_count", len(legacy.Facts))
		}
	}
	if len(out) > 0 {
		return out
	}

	// Fallback 2: flattened-fact corruption pattern.
	// The model emits {"facts":":[{","text":"...","tags":[...]} — "facts" is a
	// garbage string, but the actual fact fields are top-level keys.  Recover
	// the fact when a top-level "text" field is present.
	type flattenedFact struct {
		Facts    interface{} `json:"facts"`
		Text     string      `json:"text"`
		Tags     []string    `json:"tags"`
		FactType string      `json:"fact_type,omitempty"`
	}
	var flat flattenedFact
	if err := json.Unmarshal([]byte(cleaned), &flat); err == nil {
		if t := strings.TrimSpace(flat.Text); t != "" {
			slog.Warn("normalizeParsedFacts: recovered fact from flattened-fact corruption", "text", t)
			out = append(out, ExtractedFact{Text: t, Tags: flat.Tags, FactType: flat.FactType})
		}
	}
	return out
}

// extractFacts calls the LLM to extract atomic facts only, without per-message tag generation.
// Used by extractAndReconcile (ReconcileContent path) where message_tags are not needed.
func (s *IngestService) extractFacts(ctx context.Context, conversation string) ([]ExtractedFact, error) {
	if s.llm == nil || conversation == "" {
		return nil, nil
	}
	input := prepareExtractionInputFromConversation(conversation, maxExtractionConversationRunes)
	if input.formatted == "" {
		return nil, nil
	}

	systemPrompt := `You are an information extraction engine. Your task is to identify distinct,
atomic facts from a conversation.

## Rules

1. Extract facts ONLY from the user's messages. Ignore assistant and system messages entirely.
2. Each fact must be a single, self-contained statement (one idea per fact).
   Exception: when facts are semantically dependent (cause-effect, event-reason,
   condition-outcome, temporal dependency), keep them as ONE fact preserving the
   full relationship. Do not split dependent facts into separate entries.
   Dependency markers: because, since, so that, in order to, unless, if…then,
   因为, 所以, 为了, 由于, 导致, 如果, 虽然, 先…再…
   - Good: "Joel went to rehearsal today because he has a bar performance on Sunday"
   - Bad: "Joel went to rehearsal" + "Joel has a bar performance on Sunday"
   - Good: "小强今天去彩排，因为他周日要去酒吧表演"
   - Bad: "小强今天去彩排" + "小强周日要去酒吧表演"
3. Prefer specific details over vague summaries.
   - Good: "Uses Go 1.22 for backend services"
   - Bad: "Knows some programming languages"
4. Preserve the user's original language.
5. Omit pure greetings, filler, and debugging chatter with no lasting value.
6. Do NOT extract search queries or lookup questions as facts.
   If the user is asking the assistant to find, explain, or look something up
   ("who is X", "how do I Y", "what does Z mean", "X是谁", "如何做Y", "Z是什么意思"), classify it as query_intent.
   Only store what the user STATED about themselves, their work, or their world.
   Heuristic: if the fact can only be known because the user asked, it is query_intent.
   If it reveals something stable about the user independently, it is a fact.
   Examples to skip (query_intent):
     - "User asked about the history of the Ming dynasty"
     - "User searched for how to configure nginx"
     - "用户在问明朝历史"
     - "用户询问如何配置 nginx"
   Examples to keep (fact):
     - "Uses nginx as the production reverse proxy"
     - "Working on a project that requires SQL window functions"
     - "使用 nginx 作为生产反向代理"
     - "正在做一个需要 SQL 窗口函数的项目"
7. Keep any stable personal information, preferences, experiences, relationships, or long-term plans
   even if they arose in a task-specific context.
8. Always include temporal context when mentioned. Preserve dates, times, and temporal markers faithfully.
   If a fact already contains an explicit date, month, year, or anchored period
   ("2023年4月22日", "April 2023", "the week before 6 March 2023"), keep it natural
   and do not rewrite it.
   If a fact uses relative time language ("today", "yesterday", "next month", "明天", "下个月"),
   keep the original natural wording and relation. Do NOT append inline annotations,
   bracketed markers, or parenthetical date expansions.
   Do NOT resolve relative time expressions using today's date.
   When a relative time expression depends on another date already present in the same
   sentence or message header, preserve that relationship naturally instead of inventing
   extra detail. Post-processing will normalize those cases later.
9. Extract relationships between people explicitly.
10. Use specific names instead of pronouns when the referent is clear. Do not guess unclear references.
   Replace pronouns (he, she, they, it, 他, 她, 他们) with the actual entity name so each
   fact is self-contained and retrievable without needing context from other facts.
   - Good: "Alice moved to Tokyo last year"
   - Bad: "She moved to Tokyo last year"
   - Good: "小强今天去彩排了"
   - Bad: "他今天去彩排了"
11. Prefer returning a faithful, minimally rewritten fact over returning an empty array.
12. Short, specific statements are still facts. A single sentence about a preference, event,
   plan, job, location, relationship, or current status should usually become one fact.
13. Return an empty facts array only when the user's messages contain no retrievable
   information at all, such as pure greetings, acknowledgements, or filler.
14. Assign 1-3 short lowercase tags to each extracted fact describing its topic or
   category. Examples: "tech", "personal", "preference", "work", "location", "habit",
   "relationship", "event", "timeline".
   Use hyphens for multi-word tags: "programming-language", "work-tool".
   If no meaningful tags apply, omit the "tags" field for that fact.

## Examples to keep

- "Prefers oat milk in coffee"
- "Has a dentist appointment tomorrow afternoon"
- "Planning to visit parents next weekend"
- "Working remotely this week"

## Output Format

Return ONLY valid JSON. No markdown fences, no explanation.

{"facts": [{"text": "fact one", "tags": ["tag1", "tag2"], "fact_type": "fact"}, {"text": "User asked about X", "fact_type": "query_intent"}, ...]}`

	userPrompt := fmt.Sprintf("Extract facts.\n\n%s", input.formatted)

	type extractResponse struct {
		Facts []ExtractedFact `json:"facts"`
	}

	raw, err := s.llm.CompleteJSON(ctx, systemPrompt, userPrompt)
	if err != nil {
		slog.Warn("extraction LLM call failed, using raw fallback", "err", err)
		return buildRawFallbackFacts(input, "llm_error_fallback"), nil
	}

	parsed, err := llm.ParseJSON[extractResponse](raw)
	lastRaw := raw
	if err != nil {
		raw2, retryErr := s.llm.CompleteJSON(ctx, systemPrompt,
			"Your previous response was invalid JSON:\n"+raw+"\n\nFix it and return ONLY the corrected JSON object.\n\n"+userPrompt)
		if retryErr != nil {
			slog.Warn("extraction retry failed, using raw fallback", "err", retryErr)
			return buildRawFallbackFacts(input, "llm_error_fallback"), nil
		}
		parsed, err = llm.ParseJSON[extractResponse](raw2)
		if err != nil {
			if recovered := normalizeParsedFacts(raw2, nil); len(recovered) > 0 {
				facts := finalizeExtractedFacts(input, recovered, "empty_after_extraction")
				slog.Info("facts extracted", "facts", len(facts))
				return facts, nil
			}
			if s.llm.DebugLLM() {
				slog.Warn("json parse llm resp failed, using raw fallback", "len", len(raw2), "raw", raw2, "err", err)
			} else {
				slog.Warn("json parse llm resp failed, using raw fallback", "len", len(raw2), "err", err)
			}
			facts := buildRawFallbackFacts(input, "parse_error_fallback")
			slog.Info("facts extracted", "facts", len(facts))
			return facts, nil
		}
		lastRaw = raw2
	}

	facts := finalizeExtractedFacts(input, normalizeParsedFacts(lastRaw, parsed.Facts), "empty_after_extraction")
	slog.Info("facts extracted", "facts", len(facts))
	return facts, nil
}

// extractFactsAndTags calls the LLM to extract atomic facts and per-message tags
// from the conversation in a single call.
func (s *IngestService) extractFactsAndTags(ctx context.Context, conversation string, messageCount int) ([]ExtractedFact, [][]string, error) {
	input := prepareExtractionInputFromConversation(conversation, maxExtractionConversationRunes)
	if input.formatted == "" {
		return nil, normalizeMessageTags(nil, messageCount), nil
	}

	systemPrompt := `You are an information extraction engine. Your task is to identify distinct,
atomic facts from a conversation AND assign short descriptive tags to each message.

## Rules — facts

1. Extract facts ONLY from the user's messages. Ignore assistant and system messages entirely.
2. Each fact must be a single, self-contained statement (one idea per fact).
   Exception: when facts are semantically dependent (cause-effect, event-reason,
   condition-outcome, temporal dependency), keep them as ONE fact preserving the
   full relationship. Do not split dependent facts into separate entries.
   Dependency markers: because, since, so that, in order to, unless, if…then,
   因为, 所以, 为了, 由于, 导致, 如果, 虽然, 先…再…
   - Good: "Joel went to rehearsal today because he has a bar performance on Sunday"
   - Bad: "Joel went to rehearsal" + "Joel has a bar performance on Sunday"
   - Good: "小强今天去彩排，因为他周日要去酒吧表演"
   - Bad: "小强今天去彩排" + "小强周日要去酒吧表演"
3. Prefer specific details over vague summaries.
   - Good: "Uses Go 1.22 for backend services"
   - Bad: "Knows some programming languages"
4. Preserve the user's original language.
5. Omit pure greetings, filler, and debugging chatter with no lasting value.
6. Do NOT extract search queries or lookup questions as facts.
   If the user is asking the assistant to find, explain, or look something up
   ("who is X", "how do I Y", "what does Z mean", "X是谁", "如何做Y", "Z是什么意思"), classify it as query_intent.
   Only store what the user STATED about themselves, their work, or their world.
   Heuristic: if the fact can only be known because the user asked, it is query_intent.
   If it reveals something stable about the user independently, it is a fact.
   Examples to skip (query_intent):
     - "User asked about the history of the Ming dynasty"
     - "User searched for how to configure nginx"
     - "用户在问明朝历史"
     - "用户询问如何配置 nginx"
   Examples to keep (fact):
     - "Uses nginx as the production reverse proxy"
     - "Working on a project that requires SQL window functions"
     - "使用 nginx 作为生产反向代理"
     - "正在做一个需要 SQL 窗口函数的项目"
7. Keep any stable personal information, preferences, experiences, relationships, or long-term plans
   even if they arose in a task-specific context.
8. Always include temporal context when mentioned. Preserve dates, times, and temporal markers faithfully.
   If a fact already contains an explicit date, month, year, or anchored period
   ("2023年4月22日", "April 2023", "the week before 6 March 2023"), keep it natural
   and do not rewrite it.
   If a fact uses relative time language ("today", "yesterday", "next month", "明天", "下个月"),
   keep the original natural wording and relation. Do NOT append inline annotations,
   bracketed markers, or parenthetical date expansions.
   Do NOT resolve relative time expressions using today's date.
   When a relative time expression depends on another date already present in the same
   sentence or message header, preserve that relationship naturally instead of inventing
   extra detail. Post-processing will normalize those cases later.
9. Extract relationships between people explicitly.
10. Use specific names instead of pronouns when the referent is clear. Do not guess unclear references.
   Replace pronouns (he, she, they, it, 他, 她, 他们) with the actual entity name so each
   fact is self-contained and retrievable without needing context from other facts.
   - Good: "Alice moved to Tokyo last year"
   - Bad: "She moved to Tokyo last year"
   - Good: "小强今天去彩排了"
   - Bad: "他今天去彩排了"
11. Prefer returning a faithful, minimally rewritten fact over returning an empty array.
12. Short, specific statements are still facts. A single sentence about a preference, event,
   plan, job, location, relationship, or current status should usually become one fact.
13. Return an empty facts array only when the user's messages contain no retrievable
   information at all, such as pure greetings, acknowledgements, or filler.
14. Assign 1-3 short lowercase tags to each extracted fact describing its topic or
   category. Examples: "tech", "personal", "preference", "work", "location", "habit",
   "relationship", "event", "timeline".
   Use hyphens for multi-word tags. If no meaningful tags apply, omit the "tags" field.

## Rules — message_tags

1. Assign 1-3 short lowercase tags to EVERY message (user, assistant, tool, system).
2. Tags describe the message topic or type. Use your own judgment — there is no fixed vocabulary.
   Examples: "tech", "work", "personal", "preference", "location", "question",
   "answer", "tool-call", "tool-result", "error", "code", "debug"
3. Tags must be lowercase. Use hyphens for multi-word tags: "tool-call", "tool-result".
4. Return exactly one array entry per message, in the same order as the input conversation.
   If a message has no meaningful tags, return an empty array [] for it.

## Examples

Input:
User: Hi, how are you?
Assistant: I'm doing well, thank you! How can I help?
Output: {"facts": [], "message_tags": [[], []]}

Input:
User: My name is Ming Zhang, I am a backend engineer, mainly using Go and Python.
Assistant: Hi Ming Zhang!
Output: {"facts": [{"text": "Name is Ming Zhang", "tags": ["personal"]}, {"text": "Is a backend engineer", "tags": ["work"]}, {"text": "Mainly uses Go and Python", "tags": ["tech"]}], "message_tags": [["personal", "work", "tech"], ["answer"]]}

Input:
User: I'm debugging a memory leak in our Go service.
Assistant: Let's look at the heap profile. Can you share the pprof output?
User: Here it is: [pprof data...]
Output: {"facts": [{"text": "Debugging a memory leak in a Go service", "tags": ["tech", "debug"]}], "message_tags": [["tech", "debug", "go"], ["tech", "question", "debug"], ["tech", "tool-result", "code"]]}

Input:
User: I'm working remotely this week.
Assistant: Noted.
Output: {"facts": [{"text": "Working remotely this week", "tags": ["work", "timeline"]}], "message_tags": [["work", "timeline"], ["answer"]]}

## Output Format

Return ONLY valid JSON. No markdown fences, no explanation.

{"facts": [{"text": "fact one", "tags": ["tag1", "tag2"], "fact_type": "fact"}, {"text": "User asked about X", "fact_type": "query_intent"}], "message_tags": [["tag1", "tag2"], ["tag3"], [], ...]}`

	userPrompt := fmt.Sprintf("Extract facts and assign message tags.\n\n%s", input.formatted)

	type extractResponse struct {
		Facts       []ExtractedFact `json:"facts"`
		MessageTags [][]string      `json:"message_tags"`
	}

	raw, err := s.llm.CompleteJSON(ctx, systemPrompt, userPrompt)
	if err != nil {
		slog.Warn("extraction LLM call failed, using raw fallback", "err", err)
		return buildRawFallbackFacts(input, "llm_error_fallback"), normalizeMessageTags(nil, messageCount), nil
	}

	parsed, err := llm.ParseJSON[extractResponse](raw)
	lastRaw := raw
	if err != nil {
		raw2, retryErr := s.llm.CompleteJSON(ctx, systemPrompt,
			"Your previous response was invalid JSON:\n"+raw+"\n\nFix it and return ONLY the corrected JSON object.\n\n"+userPrompt)
		if retryErr != nil {
			slog.Warn("extraction retry failed, using raw fallback", "err", retryErr)
			return buildRawFallbackFacts(input, "llm_error_fallback"), normalizeMessageTags(nil, messageCount), nil
		}
		parsed, err = llm.ParseJSON[extractResponse](raw2)
		if err != nil {
			type legacyFull struct {
				MessageTags [][]string `json:"message_tags"`
			}
			var leg legacyFull
			if legErr := json.Unmarshal([]byte(llm.StripMarkdownFences(raw2)), &leg); legErr != nil {
				slog.Debug("extractFactsAndTags: legacy message_tags decode failed, returning empty", "err", legErr)
			}
			messageTags := normalizeMessageTags(leg.MessageTags, messageCount)
			if recovered := normalizeParsedFacts(raw2, nil); len(recovered) > 0 {
				facts := finalizeExtractedFacts(input, recovered, "empty_after_extraction")
				slog.Info("facts and tags extracted", "facts", len(facts), "tagged_messages", messageCount)
				return facts, messageTags, nil
			}
			if s.llm.DebugLLM() {
				slog.Warn("json parse llm resp failed, using raw fallback", "len", len(raw2), "raw", raw2, "err", err)
			} else {
				slog.Warn("json parse llm resp failed, using raw fallback", "len", len(raw2), "err", err)
			}
			facts := buildRawFallbackFacts(input, "parse_error_fallback")
			slog.Info("facts and tags extracted", "facts", len(facts), "tagged_messages", messageCount)
			return facts, messageTags, nil
		}
		lastRaw = raw2
	}

	facts := finalizeExtractedFacts(input, normalizeParsedFacts(lastRaw, parsed.Facts), "empty_after_extraction")

	// Normalise message_tags to exactly messageCount entries.
	messageTags := normalizeMessageTags(parsed.MessageTags, messageCount)

	slog.Info("facts and tags extracted", "facts", len(facts), "tagged_messages", messageCount)
	return facts, messageTags, nil
}

// reconcile searches relevant memories for each fact, deduplicates, then sends
// all facts and all retrieved memories to the LLM in a single call for batch
// decision-making. This gives the LLM a complete view of both the new facts and
// the existing knowledge base, enabling better ADD/UPDATE/DELETE/NOOP decisions.
func (s *IngestService) reconcile(ctx context.Context, agentName, agentID, sessionID string, facts []ExtractedFact) ([]string, int, error) {
	start := time.Now()
	var (
		applyActionsDuration   time.Duration
		existingMemoriesCount  int
		gatherExistingDuration time.Duration
		reconcileLLMDuration   time.Duration
		status                 = "ok"
		warnings               int
	)
	defer func() {
		slog.Info("reconcile timings",
			"agent_id", agentID,
			"session_id", sessionID,
			"facts", len(facts),
			"existing", existingMemoriesCount,
			"status", status,
			"warnings", warnings,
			"gather_existing_ms", gatherExistingDuration.Milliseconds(),
			"reconcile_llm_ms", reconcileLLMDuration.Milliseconds(),
			"apply_actions_ms", applyActionsDuration.Milliseconds(),
			"total_ms", time.Since(start).Milliseconds(),
		)
	}()

	// Shadow mode: record cosine similarity of the nearest existing memory to each
	// extracted fact. Facts always pass through unchanged — suppression is deferred
	// until the score distribution is analyzed from prod metrics.
	// Once a threshold is validated, add: if score >= threshold { drop or annotate }
	for i := range facts {
		if id, score, err := s.memories.NearDupSearch(ctx, projectReconcileFactText(facts[i])); err == nil && id != "" {
			metrics.NearDupCosineScore.Observe(score)
		}
	}

	texts := make([]string, len(facts))
	for i, f := range facts {
		texts[i] = projectReconcileFactText(f)
	}

	// Step 1: For each fact, search for relevant existing memories and collect them.
	gatherExistingStart := time.Now()
	existingMemories, gatherErr := s.gatherExistingMemories(ctx, agentID, texts)
	gatherExistingDuration = time.Since(gatherExistingStart)
	if gatherErr != nil {
		status = "gather_error"
		return nil, 0, fmt.Errorf("gather existing memories: %w", gatherErr)
	}
	existingMemoriesCount = len(existingMemories)
	slog.Info("gathered existing memories for reconciliation", "facts", len(facts), "existing", len(existingMemories))

	if len(existingMemories) == 0 {
		applyActionsStart := time.Now()
		resultIDs, warningCount, err := s.addAllFacts(ctx, agentName, agentID, sessionID, facts)
		applyActionsDuration = time.Since(applyActionsStart)
		warnings = warningCount
		if err != nil {
			status = "add_all_error"
			return nil, warningCount, err
		}
		status = "add_all"
		return resultIDs, warningCount, nil
	}

	// Step 2: Map real UUIDs to integer IDs to prevent LLM hallucination.
	// Include relative age so the LLM can resolve temporal conflicts
	// (e.g., "Lives in Beijing" from 1 year ago vs new fact "Lives in Shanghai").
	type memoryRef struct {
		IntID int    `json:"id"`
		Text  string `json:"text"`
		Age   string `json:"age,omitempty"`
	}
	refs := make([]memoryRef, len(existingMemories))
	idMap := make(map[int]string, len(existingMemories))
	for i, m := range existingMemories {
		ref := memoryRef{IntID: i, Text: TemporalRecallProjection(m.Content, m.Metadata)}
		if !m.UpdatedAt.IsZero() {
			ref.Age = relativeAge(m.UpdatedAt)
		}
		refs[i] = ref
		idMap[i] = m.ID
	}

	refsJSON, _ := json.Marshal(refs)
	factsJSON, _ := json.Marshal(texts)

	// Step 3: Single LLM call with all facts + all existing memories.
	systemPrompt := `You are a memory management engine. You manage a knowledge base by comparing newly extracted facts against existing memories and deciding the correct action for each fact.

## Actions

- **ADD**: New info not in any existing memory. Also use ADD for a different attribute of the same entity.
- **UPDATE**: Replaces the same attribute/slot of the same entity only. Keep the same ID.
- **DELETE**: Explicitly contradicts an existing memory. Do NOT delete just because the new fact is less specific or incomplete.
- **NOOP**: Already captured by an existing memory. No action needed.

## Rules

1. Reference existing memories by their integer ID ONLY (0, 1, 2...). Never invent IDs.
2. For UPDATE, always include the original text in "old_memory".
3. For ADD, the "id" field is ignored by the system — set it to "new" or omit it.
4. UPDATE only when the fact targets the same entity AND the same attribute slot. A new attribute of the same entity → ADD, not UPDATE.
5. When the fact covers a topic not in any existing memory, use ADD.
6. When the fact means the same thing as an existing memory (even if worded differently), use NOOP.
7. Preserve the language of the original facts. Do not translate.
8. Each existing memory has an "age" field showing when it was last updated. Use age as a tiebreaker: when a new fact conflicts with an existing memory on the same topic and there is no other signal, older memories are more likely outdated. Age alone is NOT sufficient reason to UPDATE or DELETE — the content must also conflict or supersede the existing memory.
9. Some facts or memories may include a read-only suffix like "[time: 2026-04-11]". That suffix is derived temporal context for matching only. Use it when comparing memories, but do NOT copy the suffix into ADD or UPDATE text.

## Tags

Assign 1-3 short lowercase tags to each ADD or UPDATE entry.
Tags describe the topic or category of the memory.
Examples: "tech", "personal", "preference", "work", "location", "habit"
Use hyphens for multi-word tags: "programming-language", "work-tool".
If a new fact includes the tag "raw-fallback", every ADD or UPDATE derived from it
must also include the tag "raw-fallback" to preserve provenance.
Omit the "tags" field entirely for NOOP and DELETE entries.

## Examples

Example 1 — ADD new information:
  Existing memories: [{"id": 0, "text": "Is a software engineer", "age": "2 months ago"}]
  New facts: ["Name is John"]
  Result: {"memory": [{"id": "0", "text": "Is a software engineer", "event": "NOOP"}, {"id": "new", "text": "Name is John", "event": "ADD", "tags": ["personal"]}]}

Example 2 — ADD different attribute of same entity (not UPDATE):
  Existing memories: [{"id": 0, "text": "Sarah is my sister", "age": "3 weeks ago"}, {"id": 1, "text": "Is a software engineer", "age": "2 months ago"}]
  New facts: ["Sarah lives in Osaka"]
  Result: {"memory": [{"id": "0", "text": "Sarah is my sister", "event": "NOOP"}, {"id": "1", "text": "Is a software engineer", "event": "NOOP"}, {"id": "new", "text": "Sarah lives in Osaka", "event": "ADD", "tags": ["personal", "location"]}]}

Example 3 — DELETE contradicted information:
  Existing memories: [{"id": 0, "text": "Name is John", "age": "5 months ago"}, {"id": 1, "text": "Loves cheese pizza", "age": "3 months ago"}]
  New facts: ["Dislikes cheese pizza"]
  Result: {"memory": [{"id": "0", "text": "Name is John", "event": "NOOP"}, {"id": "1", "text": "Loves cheese pizza", "event": "DELETE"}, {"id": "new", "text": "Dislikes cheese pizza", "event": "ADD", "tags": ["personal", "preference"]}]}

Example 4 — NOOP for equivalent information:
  Existing memories: [{"id": 0, "text": "Name is John", "age": "5 months ago"}, {"id": 1, "text": "Loves cheese pizza", "age": "3 months ago"}]
  New facts: ["Name is John"]
  Result: {"memory": [{"id": "0", "text": "Name is John", "event": "NOOP"}, {"id": "1", "text": "Loves cheese pizza", "event": "NOOP"}]}

Example 5 — Age as tiebreaker for ambiguous conflicts:
  Existing memories: [{"id": 0, "text": "Prefers vim", "age": "1 year ago"}, {"id": 1, "text": "Works at startup X", "age": "8 months ago"}]
  New facts: ["Prefers VS Code", "Works at company Y"]
  Result: {"memory": [{"id": "0", "text": "Prefers VS Code", "event": "UPDATE", "old_memory": "Prefers vim", "tags": ["tech", "preference"]}, {"id": "1", "text": "Works at company Y", "event": "UPDATE", "old_memory": "Works at startup X", "tags": ["work"]}]}

Example 6 — Age does NOT trigger UPDATE without content conflict:
  Existing memories: [{"id": 0, "text": "Likes coffee", "age": "2 years ago"}]
  New facts: ["Enjoys coffee"]
  Result: {"memory": [{"id": "0", "text": "Likes coffee", "event": "NOOP"}]}

## Output Format

Return ONLY valid JSON. No markdown fences.

{
  "memory": [
    {"id": "0",   "text": "...",            "event": "NOOP"},
    {"id": "1",   "text": "updated text",   "event": "UPDATE", "old_memory": "original text", "tags": ["work"]},
    {"id": "2",   "text": "...",            "event": "DELETE"},
    {"id": "new", "text": "brand new fact", "event": "ADD",    "tags": ["tech"]}
  ]
}`

	userPrompt := fmt.Sprintf(`Current memory contents:

%s

New facts extracted from recent conversation:

%s

Analyze the new facts and determine whether each should be added, updated, or deleted in memory. Return the full memory state after reconciliation.`, string(refsJSON), string(factsJSON))

	reconcileLLMStart := time.Now()
	raw, err := s.llm.CompleteJSON(ctx, systemPrompt, userPrompt)
	reconcileLLMDuration += time.Since(reconcileLLMStart)
	if err != nil {
		status = "reconcile_llm_warning"
		warnings = 1
		slog.Warn("reconciliation LLM call failed, skipping to avoid duplicates", "err", err)
		return nil, 1, nil // warnings=1 signals that facts were extracted but reconciliation was skipped
	}

	type reconcileEvent struct {
		ID        string   `json:"id"`
		Text      string   `json:"text"`
		Event     string   `json:"event"`
		OldMemory string   `json:"old_memory,omitempty"`
		Tags      []string `json:"tags,omitempty"`
	}
	type reconcileResponse struct {
		Memory []reconcileEvent `json:"memory"`
	}

	parsed, err := llm.ParseJSON[reconcileResponse](raw)
	if err != nil {
		// Retry once.
		reconcileRetryStart := time.Now()
		raw2, retryErr := s.llm.CompleteJSON(ctx, systemPrompt,
			"Your previous response was not valid JSON. Return ONLY the JSON object.\n\n"+userPrompt)
		reconcileLLMDuration += time.Since(reconcileRetryStart)
		if retryErr != nil {
			status = "reconcile_llm_retry_warning"
			warnings = 1
			slog.Warn("reconciliation retry failed, skipping to avoid duplicates", "err", retryErr)
			return nil, 1, nil // warnings=1 signals that facts were extracted but reconciliation was skipped
		}
		parsed, err = llm.ParseJSON[reconcileResponse](raw2)
		if err != nil {
			status = "reconcile_parse_warning"
			warnings = 1
			if s.llm.DebugLLM() {
				slog.Warn("reconciliation JSON parse failed after retry, skipping to avoid duplicates", "raw", raw2, "err", err)
			} else {
				slog.Warn("reconciliation JSON parse failed after retry, skipping to avoid duplicates", "err", err)
			}
			return nil, 1, nil // warnings=1 signals that facts were extracted but reconciliation was skipped
		}
	}

	// Step 4: Execute each action.
	applyActionsStart := time.Now()
	var resultIDs []string

	for _, event := range parsed.Memory {
		switch strings.ToUpper(event.Event) {
		case "ADD":
			normalizedText, temporal := normalizeReconciledTemporalContent(event.Text)
			if normalizedText == "" {
				continue
			}
			newID, addErr := s.addInsight(
				ctx,
				agentName,
				agentID,
				sessionID,
				normalizedText,
				ensureRawFallbackTag(event.Tags, facts),
				MergeTemporalMetadata(nil, temporal),
			)
			if addErr != nil {
				slog.Warn("failed to add insight", "err", addErr)
				warnings++
				continue
			}
			resultIDs = append(resultIDs, newID)

		case "UPDATE":
			intID := parseIntID(event.ID)
			if intID < 0 || intID >= len(existingMemories) {
				slog.Warn("skipping UPDATE with out-of-range ID", "id", event.ID)
				continue
			}
			realID, ok := idMap[intID]
			if !ok {
				slog.Warn("skipping UPDATE with invalid ID or empty text", "id", event.ID)
				continue
			}
			normalizedText, temporal := normalizeReconciledTemporalContent(event.Text)
			if normalizedText == "" {
				slog.Warn("skipping UPDATE with invalid ID or empty text", "id", event.ID)
				continue
			}
			effectiveTags := event.Tags
			if effectiveTags == nil {
				effectiveTags = existingMemories[intID].Tags
			}
			effectiveTags = ensureRawFallbackTag(effectiveTags, facts)
			metadata := MergeTemporalMetadata(existingMemories[intID].Metadata, temporal)
			if existingMemories[intID].MemoryType == domain.TypePinned {
				slog.Warn("skipping UPDATE for pinned memory — treating as ADD", "id", realID)
				newID, addErr := s.addInsight(ctx, agentName, agentID, sessionID, normalizedText, effectiveTags, metadata)
				if addErr != nil {
					slog.Warn("failed to add insight (pinned fallback)", "err", addErr)
					warnings++
					continue
				}
				resultIDs = append(resultIDs, newID)
				continue
			}
			newID, updateErr := s.updateInsight(ctx, agentName, agentID, sessionID, realID, normalizedText, effectiveTags, metadata)
			if updateErr != nil {
				slog.Warn("failed to update insight", "err", updateErr, "id", event.ID)
				warnings++
				continue
			}
			resultIDs = append(resultIDs, newID)

		case "DELETE":
			intID := parseIntID(event.ID)
			if intID < 0 || intID >= len(existingMemories) {
				slog.Warn("skipping DELETE with out-of-range ID", "id", event.ID)
				continue
			}
			realID, ok := idMap[intID]
			if !ok {
				slog.Warn("skipping DELETE with invalid ID", "id", event.ID)
				continue
			}
			// Guard: never auto-delete pinned memories.
			if existingMemories[intID].MemoryType == domain.TypePinned {
				slog.Warn("skipping DELETE for pinned memory", "id", realID)
				warnings++
				continue
			}
			if delErr := s.memories.SetState(ctx, realID, domain.StateDeleted); delErr != nil {
				if !errors.Is(delErr, domain.ErrNotFound) {
					slog.Warn("failed to delete memory", "err", delErr, "id", event.ID)
					warnings++
				}
			}

		case "NOOP", "NONE":
			// No action needed.

		default:
			slog.Warn("unknown reconciliation event", "event", event.Event, "id", event.ID)
		}
	}
	applyActionsDuration = time.Since(applyActionsStart)

	return resultIDs, warnings, nil
}

const gatherExistingMemoriesConcurrency = 4

type existingMemoryCandidate struct {
	applyThreshold bool
	memory         domain.Memory
}

type factSearchResult struct {
	attempts   int
	candidates []existingMemoryCandidate
	successes  int
}

// gatherExistingMemories searches relevant memories for each fact, deduplicates
// by ID, and returns a single flat list. Individual per-fact search failures are
// logged and skipped (partial recall is acceptable for the LLM reconciler).
// However, if every single search attempt fails (total outage), an error is
// returned to prevent silent duplicate writes via addAllFacts.
func (s *IngestService) gatherExistingMemories(ctx context.Context, agentID string, facts []string) ([]domain.Memory, error) {
	const perFactLimit = 5
	const contentMaxLen = 150
	const maxExistingMemories = 60
	const minSimilarityScore = 0.3 // Skip vector results with score below this threshold

	filter := domain.MemoryFilter{
		State:      "active",
		MemoryType: "insight,pinned",
		AgentID:    agentID,
	}
	ftsAvailable := s.memories.FTSAvailable()

	seen := make(map[string]struct{})
	var result []domain.Memory

	addUnseen := func(candidates []existingMemoryCandidate) {
		for _, candidate := range candidates {
			m := candidate.memory
			if _, ok := seen[m.ID]; ok {
				continue
			}
			// Skip low-similarity vector results to avoid polluting LLM context.
			if candidate.applyThreshold && m.Score != nil && *m.Score < minSimilarityScore {
				continue
			}
			seen[m.ID] = struct{}{}
			m.Content = truncateRunes(m.Content, contentMaxLen)
			result = append(result, m)
		}
	}

	searchResults := make([]factSearchResult, len(facts))
	workerCount := gatherExistingMemoriesConcurrency
	if workerCount > len(facts) {
		workerCount = len(facts)
	}
	if workerCount < 1 {
		workerCount = 1
	}

	jobs := make(chan int)
	var wg sync.WaitGroup
	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range jobs {
				searchResults[idx] = s.searchExistingMemoriesForFact(ctx, facts[idx], filter, ftsAvailable, perFactLimit)
			}
		}()
	}
	for idx := range facts {
		jobs <- idx
	}
	close(jobs)
	wg.Wait()

	var searchAttempts, searchSuccesses int
	for _, searchResult := range searchResults {
		searchAttempts += searchResult.attempts
		searchSuccesses += searchResult.successes
		addUnseen(searchResult.candidates)
	}

	// If every single search attempt failed, we have a total outage.
	// Return an error to prevent silent duplicate writes via addAllFacts.
	if searchAttempts > 0 && searchSuccesses == 0 {
		return nil, fmt.Errorf("all %d search attempts failed: search backends may be unavailable", searchAttempts)
	}

	if len(result) > maxExistingMemories {
		slog.Info("gatherExistingMemories: truncating results", "count", len(result), "max", maxExistingMemories)
		result = result[:maxExistingMemories]
	}
	return result, nil
}

func (s *IngestService) searchExistingMemoriesForFact(
	ctx context.Context,
	fact string,
	filter domain.MemoryFilter,
	ftsAvailable bool,
	perFactLimit int,
) factSearchResult {
	addMatches := func(result *factSearchResult, matches []domain.Memory, applyThreshold bool) {
		for _, match := range matches {
			result.candidates = append(result.candidates, existingMemoryCandidate{
				applyThreshold: applyThreshold,
				memory:         match,
			})
		}
	}

	if s.embedder == nil && s.autoModel == "" {
		var (
			kwErr     error
			kwMatches []domain.Memory
			result    factSearchResult
		)
		result.attempts++
		if ftsAvailable {
			kwMatches, kwErr = s.memories.FTSSearch(ctx, fact, filter, perFactLimit)
		} else {
			kwMatches, kwErr = s.memories.KeywordSearch(ctx, fact, filter, perFactLimit)
		}
		if kwErr != nil {
			slog.Warn("gatherExistingMemories: keyword/FTS search failed for fact, skipping", "fact_len", len(fact), "err", kwErr)
			return result
		}
		result.successes++
		addMatches(&result, kwMatches, false)
		return result
	}

	result := factSearchResult{}

	// Leg 1: Vector search.
	var (
		vecLegOK   bool
		vecMatches []domain.Memory
	)
	if s.autoModel != "" {
		result.attempts++
		var vecErr error
		vecMatches, vecErr = s.memories.AutoVectorSearch(ctx, fact, filter, perFactLimit)
		if vecErr != nil {
			slog.Warn("gatherExistingMemories: auto vector search failed for fact, continuing with keyword leg", "fact_len", len(fact), "err", vecErr)
		} else {
			result.successes++
			vecLegOK = true
		}
	} else {
		result.attempts++
		vec, embedErr := s.embedder.Embed(ctx, fact)
		if embedErr != nil {
			slog.Warn("gatherExistingMemories: embed failed for fact, continuing with keyword leg", "fact_len", len(fact), "err", embedErr)
		} else {
			var vecErr error
			vecMatches, vecErr = s.memories.VectorSearch(ctx, vec, filter, perFactLimit)
			if vecErr != nil {
				slog.Warn("gatherExistingMemories: vector search failed for fact, continuing with keyword leg", "fact_len", len(fact), "err", vecErr)
			} else {
				result.successes++
				vecLegOK = true
			}
		}
	}
	addMatches(&result, vecMatches, true)

	// Leg 2: FTS / keyword search — catches exact terms that vector search may miss.
	result.attempts++
	var (
		kwErr     error
		kwMatches []domain.Memory
	)
	if ftsAvailable {
		kwMatches, kwErr = s.memories.FTSSearch(ctx, fact, filter, perFactLimit)
	} else {
		kwMatches, kwErr = s.memories.KeywordSearch(ctx, fact, filter, perFactLimit)
	}
	if kwErr != nil {
		slog.Warn("gatherExistingMemories: keyword/FTS search failed for fact, skipping", "fact_len", len(fact), "err", kwErr)
	} else {
		result.successes++
		addMatches(&result, kwMatches, false)
	}

	// If neither leg succeeded for this fact, log it clearly.
	if !vecLegOK && kwErr != nil {
		slog.Error("gatherExistingMemories: both search legs failed for fact", "fact_len", len(fact), "err", kwErr)
	}

	return result
}

// addAllFacts adds all facts as new insights when no existing memories are
// found (i.e., all facts are guaranteed new). Called only when gatherExistingMemories returns empty.
func (s *IngestService) addAllFacts(ctx context.Context, agentName, agentID, sessionID string, facts []ExtractedFact) ([]string, int, error) {
	var ids []string
	var warnings int
	for _, fact := range facts {
		id, err := s.addInsight(ctx, agentName, agentID, sessionID, fact.Text, fact.Tags, MergeTemporalMetadata(nil, fact.Temporal))
		if err != nil {
			slog.Warn("failed to add fact", "err", err, "fact_len", len(fact.Text))
			warnings++
			continue
		}
		ids = append(ids, id)
	}
	return ids, warnings, nil
}

// addInsight creates a new insight memory with the given content and tags.
func (s *IngestService) addInsight(ctx context.Context, agentName, agentID, sessionID, content string, tags []string, metadata json.RawMessage) (string, error) {
	if len(tags) > maxTags {
		tags = tags[:maxTags]
	}

	var embedding []float32
	if s.autoModel == "" && s.embedder != nil {
		var err error
		embedding, err = s.embedder.Embed(ctx, content)
		if err != nil {
			return "", fmt.Errorf("embed insight: %w", err)
		}
	}

	now := time.Now()
	m := &domain.Memory{
		ID:         uuid.New().String(),
		Content:    content,
		MemoryType: domain.TypeInsight,
		Source:     agentName,
		AgentID:    agentID,
		SessionID:  sessionID,
		Embedding:  embedding,
		Tags:       tags,
		Metadata:   metadata,
		State:      domain.StateActive,
		Version:    1,
		UpdatedBy:  agentName,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	writeStart := time.Now()
	err := s.memories.Create(ctx, m)
	metrics.MemoryWriteDuration.WithLabelValues("create", metricStatus(err)).Observe(time.Since(writeStart).Seconds())
	if err != nil {
		return "", fmt.Errorf("create insight: %w", err)
	}
	return m.ID, nil
}

// updateInsight archives the old memory and creates a new one atomically (append-new + archive-old model).
func (s *IngestService) updateInsight(ctx context.Context, agentName, agentID, sessionID, oldID, newContent string, tags []string, metadata json.RawMessage) (string, error) {
	if len(tags) > maxTags {
		tags = tags[:maxTags]
	}

	newID := uuid.New().String()

	var embedding []float32
	if s.autoModel == "" && s.embedder != nil {
		var err error
		embedding, err = s.embedder.Embed(ctx, newContent)
		if err != nil {
			return "", fmt.Errorf("embed updated insight: %w", err)
		}
	}

	now := time.Now()
	// Create new memory object.
	m := &domain.Memory{
		ID:         newID,
		Content:    newContent,
		MemoryType: domain.TypeInsight,
		Source:     agentName,
		AgentID:    agentID,
		SessionID:  sessionID,
		Embedding:  embedding,
		Tags:       tags,
		Metadata:   metadata,
		State:      domain.StateActive,
		Version:    1,
		UpdatedBy:  agentName,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	writeStart := time.Now()
	err := s.memories.ArchiveAndCreate(ctx, oldID, newID, m)
	metrics.MemoryWriteDuration.WithLabelValues("archive_and_create", metricStatus(err)).Observe(time.Since(writeStart).Seconds())
	if err != nil {
		return "", fmt.Errorf("archive and create for %s: %w", oldID, err)
	}
	return newID, nil
}

// StripInjectedContext removes <relevant-memories>...</relevant-memories> tags from messages.
func StripInjectedContext(messages []IngestMessage) []IngestMessage {
	return stripInjectedContext(messages)
}

func stripInjectedContext(messages []IngestMessage) []IngestMessage {
	result := make([]IngestMessage, 0, len(messages))
	for _, msg := range messages {
		cleaned := stripMemoryTags(msg.Content)
		cleaned = strings.TrimSpace(cleaned)
		if cleaned != "" {
			result = append(result, IngestMessage{Role: msg.Role, Content: cleaned, Seq: msg.Seq})
		}
	}
	return result
}

// stripMemoryTags removes <relevant-memories>...</relevant-memories> from text.
func stripMemoryTags(s string) string {
	for {
		start := strings.Index(s, "<relevant-memories>")
		if start == -1 {
			break
		}
		end := strings.Index(s, "</relevant-memories>")
		if end == -1 {
			// Malformed tag, remove from start to end.
			s = s[:start]
			break
		}
		s = s[:start] + s[end+len("</relevant-memories>"):]
	}
	return s
}

// formatConversation formats messages into a conversation string for LLM.
func formatConversation(messages []IngestMessage) string {
	var sb strings.Builder
	for _, msg := range messages {
		role := msg.Role
		if r, _ := utf8.DecodeRuneInString(role); r != utf8.RuneError {
			role = strings.ToUpper(string(r)) + role[utf8.RuneLen(r):]
		}
		sb.WriteString(role)
		sb.WriteString(": ")
		sb.WriteString(msg.Content)
		sb.WriteString("\n\n")
	}
	return strings.TrimSpace(sb.String())
}

// parseIntID parses a string integer ID, returning -1 on failure.
func parseIntID(s string) int {
	id, err := strconv.Atoi(s)
	if err != nil {
		return -1
	}
	return id
}

// truncateRunes truncates s to at most maxRunes characters (not bytes),
// appending "..." if truncation occurred. Safe for multi-byte UTF-8.
func truncateRunes(s string, maxRunes int) string {
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes]) + "..."
}

func metricStatus(err error) string {
	if err != nil {
		return "error"
	}
	return "ok"
}
