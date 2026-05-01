package service

import (
	"context"
	"encoding/json"
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
var extractionDateTagRE = regexp.MustCompile(`(?i)\[date:\s*([^\]]+)\]`)

// IngestRequest is the input for the ingest pipeline.
type IngestRequest struct {
	Messages        []IngestMessage   `json:"messages"`
	SessionID       string            `json:"session_id"`
	AgentID         string            `json:"agent_id"`
	Mode            IngestMode        `json:"mode"`
	ObservationDate string            `json:"observation_date,omitempty"`
	Extraction      ExtractionContext `json:"-"`
}

// IngestMessage represents a single conversation message.
type IngestMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Seq     *int   `json:"seq,omitempty"`
}

// ExtractionContext carries non-source context for ADD-only extraction. The LLM
// may use these fields for reference resolution, dedupe, and linking, but new
// memories must still come only from the current New Messages.
type ExtractionContext struct {
	ObservationDate           string
	LastMessages              []IngestMessage
	RecentlyExtractedMemories []domain.Memory
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

	extractionCtx := req.Extraction
	if extractionCtx.ObservationDate == "" {
		extractionCtx.ObservationDate = req.ObservationDate
	}
	insightIDs, warnings, err := s.extractAndReconcileWithContext(ctx, agentName, req.AgentID, req.SessionID, formatted, extractionCtx)
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
	Facts       []ExtractedFact // atomic ADD-only facts extracted from new messages, each with LLM-assigned tags
	MessageTags [][]string      // per-message tags parallel to input messages; missing entries = []
}

// ExtractedFact holds a single atomic fact and the tags the LLM assigned to it.
type ExtractedFact struct {
	Text            string               `json:"text"`
	Tags            []string             `json:"tags,omitempty"`
	FactType        string               `json:"fact_type,omitempty"` // "fact" | "query_intent" | "raw_fallback"; omitted = "fact"
	AttributedTo    string               `json:"attributed_to,omitempty"`
	LinkedMemoryIDs []string             `json:"linked_memory_ids,omitempty"`
	SourceSeqs      []int                `json:"source_seqs,omitempty"`
	SourceTurns     []sourceTurnMetadata `json:"source_turns,omitempty"`
	Temporal        *TemporalMetadata    `json:"-"`
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
	return buildRawFallbackFactsAt(input, reason, time.Now())
}

func buildRawFallbackFactsAt(input preparedExtractionInput, reason string, now time.Time) []ExtractedFact {
	text := strings.TrimSpace(input.fallbackText)
	if text == "" {
		slog.Warn("raw fallback unavailable", "reason", reason)
		return nil
	}
	slog.Warn("using raw fallback fact", "reason", reason, "len", len(text))
	return annotateFactsWithSourceSeqs(input, normalizeRawFallbackFactsAt(input, []ExtractedFact{buildRawFallbackFact(text)}, now))
}

func finalizeExtractedFacts(input preparedExtractionInput, parsed []ExtractedFact, emptyReason string) []ExtractedFact {
	facts := dropQueryIntentFacts(parsed)
	if len(facts) > 0 {
		return annotateFactsWithSourceSeqs(input, normalizeTemporalFacts(input, facts))
	}
	reason := emptyReason
	if len(parsed) > 0 {
		reason = "query_intent_only"
	}
	return buildRawFallbackFacts(input, reason)
}

func finalizeAdditiveExtractedFacts(input preparedExtractionInput, parsed []ExtractedFact) []ExtractedFact {
	return finalizeAdditiveExtractedFactsAt(input, parsed, time.Now())
}

func finalizeAdditiveExtractedFactsAt(input preparedExtractionInput, parsed []ExtractedFact, now time.Time) []ExtractedFact {
	facts := dropQueryIntentFacts(parsed)
	if len(facts) == 0 {
		return nil
	}
	return annotateFactsWithSourceSeqs(input, normalizeTemporalFactsAt(input, facts, now))
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

func normalizeReconciledFactContent(fact ExtractedFact) (string, *TemporalMetadata) {
	content := StripTemporalProjection(fact.Text)
	if fact.Temporal != nil {
		return strings.TrimSpace(content), fact.Temporal
	}
	return NormalizeStandaloneTemporalContent(content, time.Now())
}

func resolveExtractionObservation(ctx ExtractionContext, input preparedExtractionInput, now time.Time) (time.Time, string) {
	if ts, ok := parseObservationTime(ctx.ObservationDate); ok {
		return ts, ts.Format("2006-01-02")
	}
	for _, msg := range input.messages {
		for _, match := range extractionDateTagRE.FindAllStringSubmatch(msg.Content, -1) {
			if len(match) > 1 {
				if ts, ok := parseObservationTime(match[1]); ok {
					return ts, ts.Format("2006-01-02")
				}
			}
		}
	}
	return now, now.Format("2006-01-02")
}

func parseObservationTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	candidates := []string{value, normalizeAMPM(value)}
	layouts := []string{
		time.RFC3339,
		"2006-01-02",
		"2006-01",
		"3:04 pm on 2 January, 2006",
		"3:04 PM on 2 January, 2006",
		"3:04 pm on 2 Jan, 2006",
		"3:04 PM on 2 Jan, 2006",
		"2 January, 2006",
		"2 Jan, 2006",
		"2 January 2006",
		"2 Jan 2006",
		"January 2, 2006",
		"Jan 2, 2006",
	}
	for _, candidate := range candidates {
		for _, layout := range layouts {
			if ts, err := time.Parse(layout, candidate); err == nil {
				return ts, true
			}
		}
	}
	return time.Time{}, false
}

func normalizeAMPM(value string) string {
	replacer := strings.NewReplacer(" am ", " AM ", " pm ", " PM ", " am", " AM", " pm", " PM")
	return replacer.Replace(value)
}

func serializePromptMemories(memories []domain.Memory) string {
	refs := make([]map[string]string, 0, len(memories))
	for _, memory := range memories {
		ref := map[string]string{
			"id":   memory.ID,
			"text": TemporalRecallProjection(memory.Content, memory.Metadata),
		}
		if !memory.UpdatedAt.IsZero() {
			ref["age"] = relativeAge(memory.UpdatedAt)
		}
		refs = append(refs, ref)
	}
	refsJSON, _ := json.Marshal(refs)
	return string(refsJSON)
}

func serializePromptMessages(messages []IngestMessage) string {
	refs := make([]map[string]string, 0, len(messages))
	for _, msg := range messages {
		content := strings.TrimSpace(msg.Content)
		if content == "" {
			continue
		}
		ref := map[string]string{
			"role":    strings.TrimSpace(msg.Role),
			"content": content,
		}
		if msg.Seq != nil {
			ref["seq"] = strconv.Itoa(*msg.Seq)
		}
		refs = append(refs, ref)
	}
	refsJSON, _ := json.Marshal(refs)
	return string(refsJSON)
}

func additiveExtractionSystemPrompt(includeMessageTags bool) string {
	messageTagRule := ""
	messageTagOutput := ""
	if includeMessageTags {
		messageTagRule = `
## Message Tags

Also assign 1-3 short lowercase tags to every new message in order. Tags describe
the message topic or type. Return exactly one array per message. Use [] for
messages with no meaningful tags.`
		messageTagOutput = `, "message_tags": [["tag1"], [], ...]`
	}
	return `You are a Memory Extractor. Your only operation is ADD: extract rich,
self-contained memories from New Messages and return only new facts.

This ADD-only algorithm is adapted from mem0 v3.

## Source Rules

1. Extract from BOTH user and assistant messages. User messages reveal personal
   facts, preferences, plans, experiences, opinions, requests, and implicit
   preferences. Assistant messages can contain recommendations, plans, schedules,
   solutions, researched information, agreements, and action items.
2. In multi-speaker conversations, the assistant role may represent another real
   person. If an assistant-role message contains "Maria: I adopted a cat named
   Bailey" or "[speaker:Maria] I adopted a cat named Bailey", extract Maria's
   personal fact and set attributed_to to "Maria".
3. Tool and system messages are extractable only when they contain durable project,
   environment, workflow, or system facts that will help future agents.
4. Extract ONLY from New Messages. Summary, Last k Messages, Recently Extracted
   Memories, and Existing Memories are context for reference resolution,
   deduplication, and linking. Never extract a memory from those context sections.

## Completeness Rules

5. Accuracy and completeness are critical. When in doubt, extract. A slightly
   redundant memory is less costly than a missing one; downstream dedupe handles
   true duplicates.
6. Casual topics are still extractable. Pets, hobbies, childhood memories, photos,
   anecdotes, foods, books, movies, games, emotions, and personal preferences are
   often high-value memory facts. Skip only purely phatic messages with zero
   informational content.
7. Extract incidental facts inside requests. If the user asks "I harvested cherry
   tomatoes from my garden; any companion plant suggestions?", extract that the
   user grows cherry tomatoes in their garden. Do not let the request hide the
   durable fact.
8. Do not let a dominant topic hide secondary facts. A session may contain career
   details, family details, entertainment preferences, dates, and recommendations;
   extract each meaningful dimension separately.
9. Preserve exact proper nouns, titles, places, brands, identifiers, dates, counts,
   quantities, roles, colors, models, and quoted strings. Never generalize "Osteria
   Francescana" to "a restaurant" or "416 pages" to "about 400 pages".
10. Extract assistant-generated recommendations and plans only when they add new
   useful information. Do not extract assistant echoes, generic acknowledgements,
   vague characterizations, or assistant meta-commentary.
11. Make every memory self-contained. Resolve pronouns using speaker names,
   Last k Messages, and New Messages. Preserve the original language and script.
12. Resolve relative time using Observation Date, not Current Date. Current Date is
   only the system date. If the message says "last week", ground it against
   Observation Date when possible.
13. Return only information not already captured by Recently Extracted Memories or
   Existing Memories. If new information is related to an existing memory but adds
   distinct facts, include that existing memory id in linked_memory_ids.
14. Do not output UPDATE, DELETE, NOOP, event, or old_memory fields.
` + messageTagRule + `
Return ONLY valid JSON. No markdown fences, no explanation.

Output shape:
{"memory": [{"text": "new memory", "tags": ["tag"], "attributed_to": "user", "linked_memory_ids": ["existing-id"]}]` + messageTagOutput + `}`
}

func additiveExtractionUserPrompt(existingMemories []domain.Memory, input preparedExtractionInput, ctx ExtractionContext, includeMessageTags bool, messageCount int) string {
	now := time.Now()
	_, observationDate := resolveExtractionObservation(ctx, input, now)
	messageTagHint := ""
	if includeMessageTags {
		messageTagHint = fmt.Sprintf("\nMessage Count: %d\nReturn message_tags with exactly %d arrays.", messageCount, messageCount)
	}
	return fmt.Sprintf(`Summary:


Last k Messages:
%s

Recently Extracted Memories:
%s

Existing Memories:
%s

New Messages:
%s

Observation Date: %s
Current Date: %s%s

Extract every ADD-worthy new memory from New Messages. Use all context sections only for reference resolution, dedupe, and linked_memory_ids.`, serializePromptMessages(ctx.LastMessages), serializePromptMemories(ctx.RecentlyExtractedMemories), serializePromptMemories(existingMemories), input.formatted, observationDate, now.Format("2006-01-02"), messageTagHint)
}

func (s *IngestService) existingMemoriesForExtraction(ctx context.Context, agentID, conversation string) []domain.Memory {
	if s.memories == nil || strings.TrimSpace(conversation) == "" {
		return nil
	}
	query := truncateRunes(conversation, 4000)
	memories, err := s.gatherExistingMemories(ctx, agentID, []string{query})
	if err != nil {
		slog.Warn("existing memories for extraction unavailable", "err", err)
		return nil
	}
	if len(memories) > 10 {
		memories = memories[:10]
	}
	return memories
}

func (s *IngestService) recentlyExtractedMemoriesForExtraction(ctx context.Context, agentID, sessionID string) []domain.Memory {
	if s.memories == nil || strings.TrimSpace(sessionID) == "" {
		return nil
	}
	memories, _, err := s.memories.List(ctx, domain.MemoryFilter{
		State:      string(domain.StateActive),
		MemoryType: string(domain.TypeInsight),
		AgentID:    agentID,
		SessionID:  sessionID,
		Limit:      20,
	})
	if err != nil {
		slog.Debug("recently extracted memories unavailable", "session_id", sessionID, "err", err)
		return nil
	}
	return memories
}

// ExtractPhase1 runs fact extraction and per-message tagging in a single LLM call.
// Returns an empty Phase1Result (no error) when LLM is nil or messages are empty.
func (s *IngestService) ExtractPhase1(ctx context.Context, messages []IngestMessage) (*Phase1Result, error) {
	return s.ExtractPhase1ForAgent(ctx, "", messages)
}

// ExtractPhase1ForAgent runs fact extraction with agent-scoped existing-memory
// context so the extractor can perform mem0-style ADD-only dedupe and linking.
func (s *IngestService) ExtractPhase1ForAgent(ctx context.Context, agentID string, messages []IngestMessage) (*Phase1Result, error) {
	return s.ExtractPhase1ForAgentWithContext(ctx, agentID, messages, ExtractionContext{})
}

func (s *IngestService) ExtractPhase1ForAgentWithContext(ctx context.Context, agentID string, messages []IngestMessage, extractionCtx ExtractionContext) (*Phase1Result, error) {
	if s.llm == nil || len(messages) == 0 {
		return &Phase1Result{}, nil
	}

	input := prepareExtractionInput(messages, maxExtractionConversationRunes)
	if input.formatted == "" {
		return &Phase1Result{}, nil
	}

	facts, messageTags, err := s.extractFactsAndTagsForAgentWithContext(ctx, agentID, input.formatted, len(input.messages), extractionCtx)
	if err != nil {
		return nil, err
	}
	return &Phase1Result{
		Facts:       annotateFactsWithSourceSeqs(input, facts),
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
	return s.ReconcileContentWithContext(ctx, agentName, agentID, sessionID, contents, ExtractionContext{})
}

func (s *IngestService) ReconcileContentWithContext(ctx context.Context, agentName, agentID, sessionID string, contents []string, extractionCtx ExtractionContext) (*IngestResult, error) {
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
	if len(extractionCtx.RecentlyExtractedMemories) == 0 {
		extractionCtx.RecentlyExtractedMemories = s.recentlyExtractedMemoriesForExtraction(ctx, agentID, sessionID)
	}

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

		facts, err := s.extractFactsForAgentWithContext(ctx, agentID, conversation, extractionCtx)
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
	contentHash := memoryContentHash(content)
	m := &domain.Memory{
		ID:          uuid.New().String(),
		Content:     content,
		MemoryType:  domain.TypeInsight,
		Source:      agentName,
		AgentID:     req.AgentID,
		SessionID:   req.SessionID,
		Embedding:   embedding,
		ContentHash: contentHash,
		State:       domain.StateActive,
		Version:     1,
		UpdatedBy:   agentName,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	writeStart := time.Now()
	err := s.memories.Create(ctx, m)
	metrics.MemoryWriteDuration.WithLabelValues("create", metricStatus(err)).Observe(time.Since(writeStart).Seconds())
	if err != nil {
		return nil, fmt.Errorf("create raw memory: %w", err)
	}
	replaceMemoryEntityLinks(ctx, s.memories, req.AgentID, m.ID, m.Content)
	return &IngestResult{
		Status:          "complete",
		MemoriesChanged: 1,
		InsightIDs:      []string{m.ID},
	}, nil
}

// extractAndReconcile runs Phase 1a (extraction) + Phase 2 (reconciliation).
func (s *IngestService) extractAndReconcile(ctx context.Context, agentName, agentID, sessionID, conversation string) ([]string, int, error) {
	return s.extractAndReconcileWithContext(ctx, agentName, agentID, sessionID, conversation, ExtractionContext{})
}

func (s *IngestService) extractAndReconcileWithContext(ctx context.Context, agentName, agentID, sessionID, conversation string, extractionCtx ExtractionContext) ([]string, int, error) {
	const maxFacts = 50 // Cap extracted facts to bound reconciliation prompt size
	if len(extractionCtx.RecentlyExtractedMemories) == 0 {
		extractionCtx.RecentlyExtractedMemories = s.recentlyExtractedMemoriesForExtraction(ctx, agentID, sessionID)
	}

	// Phase 1a: Extract facts only — no message_tags needed here (smart-ingest / raw-ingest path).
	// Use extractFacts instead of extractFactsAndTags to avoid wasting tokens on tag generation.
	facts, err := s.extractFactsForAgentWithContext(ctx, agentID, conversation, extractionCtx)
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

	// mem0 v3 additive format: {"memory":[{"text":"..."}]}.
	type additiveResponse struct {
		Memory []ExtractedFact `json:"memory"`
	}
	var additive additiveResponse
	if err := json.Unmarshal([]byte(cleaned), &additive); err == nil {
		for _, f := range additive.Memory {
			f.Text = strings.TrimSpace(f.Text)
			if f.Text != "" {
				out = append(out, f)
			}
		}
	}
	if len(out) > 0 {
		return out
	}

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
		Facts           interface{} `json:"facts"`
		Text            string      `json:"text"`
		Tags            []string    `json:"tags"`
		FactType        string      `json:"fact_type,omitempty"`
		AttributedTo    string      `json:"attributed_to,omitempty"`
		LinkedMemoryIDs []string    `json:"linked_memory_ids,omitempty"`
	}
	var flat flattenedFact
	if err := json.Unmarshal([]byte(cleaned), &flat); err == nil {
		if t := strings.TrimSpace(flat.Text); t != "" {
			slog.Warn("normalizeParsedFacts: recovered fact from flattened-fact corruption", "text", t)
			out = append(out, ExtractedFact{Text: t, Tags: flat.Tags, FactType: flat.FactType, AttributedTo: flat.AttributedTo, LinkedMemoryIDs: flat.LinkedMemoryIDs})
		}
	}
	return out
}

// extractFacts calls the LLM to extract atomic facts only, without per-message tag generation.
// Used by extractAndReconcile (ReconcileContent path) where message_tags are not needed.
func (s *IngestService) extractFacts(ctx context.Context, conversation string) ([]ExtractedFact, error) {
	return s.extractFactsForAgent(ctx, "", conversation)
}

func (s *IngestService) extractFactsForAgent(ctx context.Context, agentID, conversation string) ([]ExtractedFact, error) {
	return s.extractFactsForAgentWithContext(ctx, agentID, conversation, ExtractionContext{})
}

func (s *IngestService) extractFactsForAgentWithContext(ctx context.Context, agentID, conversation string, extractionCtx ExtractionContext) ([]ExtractedFact, error) {
	if s.llm == nil || conversation == "" {
		return nil, nil
	}
	input := prepareExtractionInputFromConversation(conversation, maxExtractionConversationRunes)
	if input.formatted == "" {
		return nil, nil
	}
	observationTime, _ := resolveExtractionObservation(extractionCtx, input, time.Now())

	existingMemories := s.existingMemoriesForExtraction(ctx, agentID, input.formatted)
	systemPrompt := additiveExtractionSystemPrompt(false)
	userPrompt := additiveExtractionUserPrompt(existingMemories, input, extractionCtx, false, 0)

	type extractResponse struct {
		Facts  []ExtractedFact `json:"facts"`
		Memory []ExtractedFact `json:"memory"`
	}

	scope := llm.CallScope{Step: "extraction"}
	raw, err := s.llm.CompleteJSONWithScope(ctx, systemPrompt, userPrompt, scope)
	if err != nil {
		slog.Warn("extraction LLM call failed, using raw fallback", "err", err)
		return buildRawFallbackFactsAt(input, "llm_error_fallback", observationTime), nil
	}

	parsed, err := llm.ParseJSON[extractResponse](raw)
	lastRaw := raw
	if err != nil {
		metrics.LLMRetryTotal.WithLabelValues("extraction", "json_parse_retry").Inc()
		raw2, retryErr := s.llm.CompleteJSONWithScope(ctx, systemPrompt,
			"Your previous response was invalid JSON:\n"+raw+"\n\nFix it and return ONLY the corrected JSON object.\n\n"+userPrompt,
			scope)
		if retryErr != nil {
			slog.Warn("extraction retry failed, using raw fallback", "err", retryErr)
			return buildRawFallbackFactsAt(input, "llm_error_fallback", observationTime), nil
		}
		parsed, err = llm.ParseJSON[extractResponse](raw2)
		if err != nil {
			if recovered := normalizeParsedFacts(raw2, nil); len(recovered) > 0 {
				facts := finalizeAdditiveExtractedFactsAt(input, recovered, observationTime)
				slog.Info("facts extracted", "facts", len(facts))
				return facts, nil
			}
			if s.llm.DebugLLM() {
				slog.Warn("json parse llm resp failed, using raw fallback", "len", len(raw2), "raw", raw2, "err", err)
			} else {
				slog.Warn("json parse llm resp failed, using raw fallback", "len", len(raw2), "err", err)
			}
			facts := buildRawFallbackFactsAt(input, "parse_error_fallback", observationTime)
			slog.Info("facts extracted", "facts", len(facts))
			return facts, nil
		}
		lastRaw = raw2
	}

	facts := finalizeAdditiveExtractedFactsAt(input, normalizeParsedFacts(lastRaw, append(parsed.Memory, parsed.Facts...)), observationTime)
	slog.Info("facts extracted", "facts", len(facts))
	return facts, nil
}

// extractFactsAndTags calls the LLM to extract atomic facts and per-message tags
// from the conversation in a single call.
func (s *IngestService) extractFactsAndTags(ctx context.Context, conversation string, messageCount int) ([]ExtractedFact, [][]string, error) {
	return s.extractFactsAndTagsForAgent(ctx, "", conversation, messageCount)
}

func (s *IngestService) extractFactsAndTagsForAgent(ctx context.Context, agentID, conversation string, messageCount int) ([]ExtractedFact, [][]string, error) {
	return s.extractFactsAndTagsForAgentWithContext(ctx, agentID, conversation, messageCount, ExtractionContext{})
}

func (s *IngestService) extractFactsAndTagsForAgentWithContext(ctx context.Context, agentID, conversation string, messageCount int, extractionCtx ExtractionContext) ([]ExtractedFact, [][]string, error) {
	input := prepareExtractionInputFromConversation(conversation, maxExtractionConversationRunes)
	if input.formatted == "" {
		return nil, normalizeMessageTags(nil, messageCount), nil
	}
	observationTime, _ := resolveExtractionObservation(extractionCtx, input, time.Now())

	existingMemories := s.existingMemoriesForExtraction(ctx, agentID, input.formatted)
	systemPrompt := additiveExtractionSystemPrompt(true)
	userPrompt := additiveExtractionUserPrompt(existingMemories, input, extractionCtx, true, messageCount)

	type extractResponse struct {
		Facts       []ExtractedFact `json:"facts"`
		Memory      []ExtractedFact `json:"memory"`
		MessageTags [][]string      `json:"message_tags"`
	}

	scope := llm.CallScope{Step: "extraction_and_classification"}
	raw, err := s.llm.CompleteJSONWithScope(ctx, systemPrompt, userPrompt, scope)
	if err != nil {
		slog.Warn("extraction LLM call failed, using raw fallback", "err", err)
		return buildRawFallbackFactsAt(input, "llm_error_fallback", observationTime), normalizeMessageTags(nil, messageCount), nil
	}

	parsed, err := llm.ParseJSON[extractResponse](raw)
	lastRaw := raw
	if err != nil {
		metrics.LLMRetryTotal.WithLabelValues("extraction_and_classification", "json_parse_retry").Inc()
		raw2, retryErr := s.llm.CompleteJSONWithScope(ctx, systemPrompt,
			"Your previous response was invalid JSON:\n"+raw+"\n\nFix it and return ONLY the corrected JSON object.\n\n"+userPrompt,
			scope)
		if retryErr != nil {
			slog.Warn("extraction retry failed, using raw fallback", "err", retryErr)
			return buildRawFallbackFactsAt(input, "llm_error_fallback", observationTime), normalizeMessageTags(nil, messageCount), nil
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
				facts := finalizeAdditiveExtractedFactsAt(input, recovered, observationTime)
				slog.Info("facts and tags extracted", "facts", len(facts), "tagged_messages", messageCount)
				return facts, messageTags, nil
			}
			if s.llm.DebugLLM() {
				slog.Warn("json parse llm resp failed, using raw fallback", "len", len(raw2), "raw", raw2, "err", err)
			} else {
				slog.Warn("json parse llm resp failed, using raw fallback", "len", len(raw2), "err", err)
			}
			facts := buildRawFallbackFactsAt(input, "parse_error_fallback", observationTime)
			slog.Info("facts and tags extracted", "facts", len(facts), "tagged_messages", messageCount)
			return facts, messageTags, nil
		}
		lastRaw = raw2
	}

	facts := finalizeAdditiveExtractedFactsAt(input, normalizeParsedFacts(lastRaw, append(parsed.Memory, parsed.Facts...)), observationTime)

	// Normalise message_tags to exactly messageCount entries.
	messageTags := normalizeMessageTags(parsed.MessageTags, messageCount)

	slog.Info("facts and tags extracted", "facts", len(facts), "tagged_messages", messageCount)
	return facts, messageTags, nil
}

// reconcile is the ADD-only persistence phase. Extraction has already seen
// relevant existing memories, so this phase validates facts, performs exact hash
// dedupe, and writes only new insight memories. It never archives, updates, or
// deletes existing memories.
func (s *IngestService) reconcile(ctx context.Context, agentName, agentID, sessionID string, facts []ExtractedFact) ([]string, int, error) {
	start := time.Now()
	var (
		applyActionsDuration time.Duration
		existingHashesCount  int
		status               = "ok"
		warnings             int
	)
	defer func() {
		slog.Info("add-only reconcile timings",
			"agent_id", agentID,
			"session_id", sessionID,
			"facts", len(facts),
			"existing_hashes", existingHashesCount,
			"status", status,
			"warnings", warnings,
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

	applyActionsStart := time.Now()
	var resultIDs []string
	seenBatch := make(map[string]struct{}, len(facts))
	hashes := make([]string, 0, len(facts))
	type candidate struct {
		fact        ExtractedFact
		content     string
		temporal    *TemporalMetadata
		contentHash string
	}
	candidates := make([]candidate, 0, len(facts))
	for _, fact := range facts {
		normalizedText, temporal := normalizeReconciledFactContent(fact)
		if normalizedText == "" {
			continue
		}
		contentHash := memoryContentHash(normalizedText)
		if contentHash == "" {
			continue
		}
		if _, ok := seenBatch[contentHash]; ok {
			continue
		}
		seenBatch[contentHash] = struct{}{}
		hashes = append(hashes, contentHash)
		candidates = append(candidates, candidate{
			fact:        fact,
			content:     normalizedText,
			temporal:    temporal,
			contentHash: contentHash,
		})
	}

	existingByHash := map[string]domain.Memory{}
	if hashRepo, ok := s.memories.(repository.MemoryHashRepo); ok && len(hashes) > 0 {
		var err error
		existingByHash, err = hashRepo.ListByContentHashes(ctx, agentID, hashes)
		if err != nil {
			status = "hash_lookup_error"
			return nil, 0, fmt.Errorf("lookup content hashes: %w", err)
		}
		existingHashesCount = len(existingByHash)
	}

	for _, candidate := range candidates {
		if _, exists := existingByHash[candidate.contentHash]; exists {
			continue
		}
		fact := candidate.fact
		fact.Temporal = candidate.temporal
		fact.LinkedMemoryIDs = validateLinkedMemoryIDs(ctx, s.memories, agentID, fact.LinkedMemoryIDs)
		metadata := mergeAdditiveMemoryMetadata(metadataForExtractedFact(fact), fact, candidate.contentHash, fact.LinkedMemoryIDs)
		newID, addErr := s.addInsight(
			ctx,
			agentName,
			agentID,
			sessionID,
			candidate.content,
			ensureRawFallbackTag(fact.Tags, facts),
			metadata,
			candidate.contentHash,
		)
		if addErr != nil {
			slog.Warn("failed to add insight", "err", addErr)
			warnings++
			continue
		}
		resultIDs = append(resultIDs, newID)
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
		normalizedText, temporal := normalizeReconciledFactContent(fact)
		if normalizedText == "" {
			continue
		}
		fact.Temporal = temporal
		contentHash := memoryContentHash(normalizedText)
		id, err := s.addInsight(ctx, agentName, agentID, sessionID, normalizedText, fact.Tags, mergeAdditiveMemoryMetadata(metadataForExtractedFact(fact), fact, contentHash, fact.LinkedMemoryIDs), contentHash)
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
func (s *IngestService) addInsight(ctx context.Context, agentName, agentID, sessionID, content string, tags []string, metadata json.RawMessage, contentHash string) (string, error) {
	if len(tags) > maxTags {
		tags = tags[:maxTags]
	}
	if contentHash == "" {
		contentHash = memoryContentHash(content)
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
		ID:          uuid.New().String(),
		Content:     content,
		MemoryType:  domain.TypeInsight,
		Source:      agentName,
		AgentID:     agentID,
		SessionID:   sessionID,
		Embedding:   embedding,
		ContentHash: contentHash,
		Tags:        tags,
		Metadata:    metadata,
		State:       domain.StateActive,
		Version:     1,
		UpdatedBy:   agentName,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	writeStart := time.Now()
	err := s.memories.Create(ctx, m)
	metrics.MemoryWriteDuration.WithLabelValues("create", metricStatus(err)).Observe(time.Since(writeStart).Seconds())
	if err != nil {
		return "", fmt.Errorf("create insight: %w", err)
	}
	replaceMemoryEntityLinks(ctx, s.memories, agentID, m.ID, m.Content)
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
	contentHash := memoryContentHash(newContent)
	// Create new memory object.
	m := &domain.Memory{
		ID:          newID,
		Content:     newContent,
		MemoryType:  domain.TypeInsight,
		Source:      agentName,
		AgentID:     agentID,
		SessionID:   sessionID,
		Embedding:   embedding,
		ContentHash: contentHash,
		Tags:        tags,
		Metadata:    mergeAdditiveMemoryMetadata(metadata, ExtractedFact{}, contentHash, nil),
		State:       domain.StateActive,
		Version:     1,
		UpdatedBy:   agentName,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	writeStart := time.Now()
	err := s.memories.ArchiveAndCreate(ctx, oldID, newID, m)
	metrics.MemoryWriteDuration.WithLabelValues("archive_and_create", metricStatus(err)).Observe(time.Since(writeStart).Seconds())
	if err != nil {
		return "", fmt.Errorf("archive and create for %s: %w", oldID, err)
	}
	replaceMemoryEntityLinks(ctx, s.memories, agentID, newID, newContent)
	deleteMemoryEntityLinks(ctx, s.memories, oldID)
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
