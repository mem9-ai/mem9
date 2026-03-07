package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/embed"
	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/repository"
)

// IngestMode controls which pipeline stages run.
type IngestMode string

const (
	ModeSmart IngestMode = "smart" // Extract + Reconcile
	ModeRaw   IngestMode = "raw"   // Store as-is (no LLM)
)

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
}

// IngestResult is the output of the ingest pipeline.
type IngestResult struct {
	Status         string   `json:"status"`          // complete | partial | failed
	MemoriesChanged int      `json:"memories_changed"` // count of ADD + UPDATE actions executed
	InsightIDs     []string `json:"insight_ids,omitempty"`
	Warnings       int      `json:"warnings,omitempty"`
	Error          string   `json:"error,omitempty"`
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
	// For raw mode or no LLM, skip pipeline.
	if mode == ModeRaw || s.llm == nil {
		return s.ingestRaw(ctx, agentName, req)
	}

	// Strip previously injected memory context from messages.
	cleaned := stripInjectedContext(req.Messages)

	// Format conversation for LLM.
	formatted := formatConversation(cleaned)
	if formatted == "" {
		return &IngestResult{Status: "complete"}, nil
	}

	// Cap conversation size to avoid blowing LLM token limits.
	const maxConversationRunes = 32000
	formatted = truncateRunes(formatted, maxConversationRunes)

	insightIDs, warnings, err := s.extractAndReconcile(ctx, agentName, req.AgentID, req.SessionID, formatted)
	if err != nil {
		slog.Error("insight extraction failed", "err", err)
		return &IngestResult{Status: "failed", Warnings: warnings}, nil
	}

	return &IngestResult{
		Status:        "complete",
		MemoriesChanged: len(insightIDs),
		InsightIDs:    insightIDs,
		Warnings:      warnings,
	}, nil
}

// ingestRaw stores messages as a single raw memory (legacy behavior).
func (s *IngestService) ingestRaw(ctx context.Context, agentName string, req IngestRequest) (*IngestResult, error) {
	content := strings.TrimSpace(formatConversation(req.Messages))
	if content == "" {
		return &IngestResult{Status: "complete"}, nil
	}

	var embedding []float32
	if s.autoModel == "" && s.embedder != nil {
		var err error
		embedding, err = s.embedder.Embed(ctx, content)
		if err != nil {
			slog.Warn("embedding failed for raw ingest", "err", err)
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

	if err := s.memories.Create(ctx, m); err != nil {
		return nil, fmt.Errorf("create raw memory: %w", err)
	}
	return &IngestResult{
		Status:        "complete",
		MemoriesChanged: 1,
		InsightIDs:    []string{m.ID},
	}, nil
}

// extractAndReconcile runs Phase 1a (extraction) + Phase 2 (reconciliation).
func (s *IngestService) extractAndReconcile(ctx context.Context, agentName, agentID, sessionID, conversation string) ([]string, int, error) {
	const maxFacts = 30 // Cap extracted facts to bound reconciliation prompt size

	// Phase 1a: Extract facts.
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

// extractFacts calls the LLM to extract atomic facts from the conversation.
func (s *IngestService) extractFacts(ctx context.Context, conversation string) ([]string, error) {
	currentDate := time.Now().Format("2006-01-02")

	systemPrompt := `You are an information extraction engine. Your task is to identify distinct, 
atomic facts from a conversation and return them as a structured JSON array.

## Rules

1. Extract facts ONLY from the user's messages. Ignore assistant and system messages entirely.
2. Each fact must be a single, self-contained statement (one idea per fact).
3. Prefer specific details over vague summaries.
   - Good: "Uses Go 1.22 for backend services"
   - Bad: "Knows some programming languages"
4. Preserve the user's original language. If the user writes in Chinese, extract facts in Chinese.
5. Omit ephemeral information (greetings, filler, debugging chatter with no lasting value).
6. Omit information that is only relevant to the current task and has no future reuse value.
7. If no meaningful facts exist in the conversation, return an empty array.

## Output Format

Return ONLY valid JSON. No markdown fences, no explanation.

{"facts": ["fact one", "fact two", ...]}`

	userPrompt := fmt.Sprintf("Extract facts from this conversation. Today's date is %s.\n\n%s", currentDate, conversation)

	raw, err := s.llm.CompleteJSON(ctx, systemPrompt, userPrompt)
	if err != nil {
		return nil, fmt.Errorf("extraction LLM call: %w", err)
	}

	type extractResponse struct {
		Facts []string `json:"facts"`
	}
	parsed, err := llm.ParseJSON[extractResponse](raw)
	if err != nil {
		// Retry once.
		raw2, retryErr := s.llm.CompleteJSON(ctx, systemPrompt,
			"Your previous response was not valid JSON. Return ONLY the JSON object.\n\n"+userPrompt)
		if retryErr != nil {
			return nil, fmt.Errorf("extraction retry: %w", retryErr)
		}
		parsed, err = llm.ParseJSON[extractResponse](raw2)
		if err != nil {
			return nil, nil // Give up, treat as no facts.
		}
	}

	// Filter out empty strings.
	var facts []string
	for _, f := range parsed.Facts {
		f = strings.TrimSpace(f)
		if f != "" {
			facts = append(facts, f)
		}
	}
	return facts, nil
}

// reconcile searches relevant memories for each fact, deduplicates, then sends
// all facts and all retrieved memories to the LLM in a single call for batch
// decision-making. This gives the LLM a complete view of both the new facts and
// the existing knowledge base, enabling better ADD/UPDATE/DELETE/NOOP decisions.
func (s *IngestService) reconcile(ctx context.Context, agentName, agentID, sessionID string, facts []string) ([]string, int, error) {
	// Step 1: For each fact, search for relevant existing memories and collect them.
	existingMemories := s.gatherExistingMemories(ctx, agentID, facts)

	if len(existingMemories) == 0 {
		return s.addAllFacts(ctx, agentName, agentID, sessionID, facts)
	}

	// Step 2: Map real UUIDs to integer IDs to prevent LLM hallucination.
	type memoryRef struct {
		IntID int    `json:"id"`
		Text  string `json:"text"`
	}
	refs := make([]memoryRef, len(existingMemories))
	idMap := make(map[int]string, len(existingMemories))
	for i, m := range existingMemories {
		refs[i] = memoryRef{IntID: i, Text: m.Content}
		idMap[i] = m.ID
	}

	refsJSON, _ := json.Marshal(refs)
	factsJSON, _ := json.Marshal(facts)

	// Step 3: Single LLM call with all facts + all existing memories.
	systemPrompt := `You are a memory management engine. You manage a knowledge base by comparing newly extracted facts against existing memories and deciding the correct action for each fact.

## Actions

- **ADD**: The fact is new information not present in any existing memory.
- **UPDATE**: The fact refines, corrects, or adds detail to an existing memory. Keep the same ID. If the existing memory and the new fact convey the same meaning, keep the one with more information. Do NOT update if they mean the same thing (e.g., "Likes pizza" vs "Loves pizza").
- **DELETE**: The fact directly contradicts an existing memory, making it obsolete.
- **NOOP**: The fact is already captured by an existing memory. No action needed.

## Rules

1. Reference existing memories by their integer ID ONLY (0, 1, 2...). Never invent IDs.
2. For UPDATE, always include the original text in "old_memory".
3. For ADD, the "id" field is ignored by the system — set it to "new" or omit it.
4. When the fact adds detail or corrects an existing memory on the same topic, prefer UPDATE.
5. When the fact covers a topic not in any existing memory, use ADD.
6. When the fact means the same thing as an existing memory (even if worded differently), use NOOP.
7. Preserve the language of the original facts. Do not translate.

## Output Format

Return ONLY valid JSON. No markdown fences.

{
  "memory": [
    {"id": "0", "text": "...", "event": "NOOP"},
    {"id": "1", "text": "updated text", "event": "UPDATE", "old_memory": "original text"},
    {"id": "2", "text": "...", "event": "DELETE"},
    {"id": "new", "text": "brand new fact", "event": "ADD"}
  ]
}`

	userPrompt := fmt.Sprintf(`Current memory contents:

%s

New facts extracted from recent conversation:

%s

Analyze the new facts and determine whether each should be added, updated, or deleted in memory. Return the full memory state after reconciliation.`, string(refsJSON), string(factsJSON))

	raw, err := s.llm.CompleteJSON(ctx, systemPrompt, userPrompt)
	if err != nil {
		slog.Warn("reconciliation LLM call failed, falling back to ADD-all", "err", err)
		return s.addAllFacts(ctx, agentName, agentID, sessionID, facts)
	}

	type reconcileEvent struct {
		ID        string `json:"id"`
		Text      string `json:"text"`
		Event     string `json:"event"`
		OldMemory string `json:"old_memory,omitempty"`
	}
	type reconcileResponse struct {
		Memory []reconcileEvent `json:"memory"`
	}

	parsed, err := llm.ParseJSON[reconcileResponse](raw)
	if err != nil {
		// Retry once.
		raw2, retryErr := s.llm.CompleteJSON(ctx, systemPrompt,
			"Your previous response was not valid JSON. Return ONLY the JSON object.\n\n"+userPrompt)
		if retryErr != nil {
			slog.Warn("reconciliation retry failed, falling back to ADD-all", "err", retryErr)
			return s.addAllFacts(ctx, agentName, agentID, sessionID, facts)
		}
		parsed, err = llm.ParseJSON[reconcileResponse](raw2)
		if err != nil {
			slog.Warn("reconciliation JSON parse failed after retry, falling back to ADD-all", "err", err)
			return s.addAllFacts(ctx, agentName, agentID, sessionID, facts)
		}
	}

	// Step 4: Execute each action.
	var resultIDs []string
	var warnings int

	for _, event := range parsed.Memory {
		switch strings.ToUpper(event.Event) {
		case "ADD":
			if event.Text == "" {
				continue
			}
			newID, addErr := s.addInsight(ctx, agentName, agentID, sessionID, event.Text)
			if addErr != nil {
				slog.Warn("failed to add insight", "err", addErr, "text", event.Text)
				warnings++
				continue
			}
			resultIDs = append(resultIDs, newID)

		case "UPDATE":
			intID := parseIntID(event.ID)
			realID, ok := idMap[intID]
			if !ok || event.Text == "" {
				slog.Warn("skipping UPDATE with invalid ID or empty text", "id", event.ID)
				continue
			}
			// Guard: never auto-update pinned memories — treat as ADD instead.
			if intID >= 0 && intID < len(existingMemories) && existingMemories[intID].MemoryType == domain.TypePinned {
				slog.Warn("skipping UPDATE for pinned memory — treating as ADD", "id", realID)
				newID, addErr := s.addInsight(ctx, agentName, agentID, sessionID, event.Text)
				if addErr != nil {
					slog.Warn("failed to add insight (pinned fallback)", "err", addErr)
					warnings++
					continue
				}
				resultIDs = append(resultIDs, newID)
				continue
			}
			newID, updateErr := s.updateInsight(ctx, agentName, agentID, sessionID, realID, event.Text)
			if updateErr != nil {
				slog.Warn("failed to update insight", "err", updateErr, "id", event.ID)
				warnings++
				continue
			}
			resultIDs = append(resultIDs, newID)

		case "DELETE":
			intID := parseIntID(event.ID)
			realID, ok := idMap[intID]
			if !ok {
				slog.Warn("skipping DELETE with invalid ID", "id", event.ID)
				continue
			}
			// Guard: never auto-delete pinned memories.
			if intID >= 0 && intID < len(existingMemories) && existingMemories[intID].MemoryType == domain.TypePinned {
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

	return resultIDs, warnings, nil
}

// gatherExistingMemories searches relevant memories for each fact, deduplicates
// by ID, and returns a single flat list. All memories (pinned + insight) belong
// to the same agent, so a single query with agent_id scoping is sufficient.
//
// Graceful degradation contract: on any search/list failure, the error is logged
// and that source is skipped. A nil return means all sources failed or the store
// is empty — the caller (reconcile) will fall through to addAllFacts, which may
// create duplicates but never loses data.
func (s *IngestService) gatherExistingMemories(ctx context.Context, agentID string, facts []string) []domain.Memory {
	const perFactLimit = 5
	const contentMaxLen = 150
	const maxExistingMemories = 60 // Cap total results to prevent LLM token overflow

	filter := domain.MemoryFilter{
		State:      "active",
		MemoryType: "insight,pinned",
		AgentID:    agentID,
	}

	if s.embedder == nil && s.autoModel == "" {
		// No vector search — fall back to listing recent memories.
		filter.Limit = perFactLimit * len(facts)
		if filter.Limit > maxExistingMemories {
			filter.Limit = maxExistingMemories
		}
		mems, _, err := s.memories.List(ctx, filter)
		if err != nil {
			slog.Warn("list memories for reconcile failed", "err", err)
			return nil
		}
		for i := range mems {
			mems[i].Content = truncateRunes(mems[i].Content, contentMaxLen)
		}
		return mems
	}

	// Vector search: for each fact, search top-K and deduplicate across all results.
	seen := make(map[string]struct{})
	var result []domain.Memory

	for _, fact := range facts {
		var matches []domain.Memory
		var err error

		if s.autoModel != "" {
			matches, err = s.memories.AutoVectorSearch(ctx, fact, filter, perFactLimit)
		} else {
			vec, embedErr := s.embedder.Embed(ctx, fact)
			if embedErr != nil {
				slog.Warn("embedding failed for fact during reconcile", "err", embedErr)
				continue
			}
			matches, err = s.memories.VectorSearch(ctx, vec, filter, perFactLimit)
		}
		if err != nil {
			slog.Warn("vector search failed during reconcile", "err", err)
			continue
		}

		for _, m := range matches {
			if _, ok := seen[m.ID]; ok {
				continue
			}
			seen[m.ID] = struct{}{}
			m.Content = truncateRunes(m.Content, contentMaxLen)
			result = append(result, m)
		}
	}

	if len(result) > maxExistingMemories {
		slog.Warn("gatherExistingMemories: truncating vector results", "count", len(result), "max", maxExistingMemories)
		result = result[:maxExistingMemories]
	}
	return result
}

// addAllFacts adds all facts as new insights (fallback when reconciliation is
// not possible, e.g., no existing memories or LLM failure).
func (s *IngestService) addAllFacts(ctx context.Context, agentName, agentID, sessionID string, facts []string) ([]string, int, error) {
	var ids []string
	var warnings int
	for _, fact := range facts {
		id, err := s.addInsight(ctx, agentName, agentID, sessionID, fact)
		if err != nil {
			slog.Warn("failed to add fact", "err", err, "fact", fact)
			warnings++
			continue
		}
		ids = append(ids, id)
	}
	return ids, warnings, nil
}

// addInsight creates a new insight memory.
func (s *IngestService) addInsight(ctx context.Context, agentName, agentID, sessionID, content string) (string, error) {
	var embedding []float32
	if s.autoModel == "" && s.embedder != nil {
		var err error
		embedding, err = s.embedder.Embed(ctx, content)
		if err != nil {
			slog.Warn("embedding failed for insight", "err", err)
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
		State:      domain.StateActive,
		Version:    1,
		UpdatedBy:  agentName,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	if err := s.memories.Create(ctx, m); err != nil {
		return "", fmt.Errorf("create insight: %w", err)
	}
	return m.ID, nil
}

// updateInsight archives the old memory and creates a new one atomically (append-new + archive-old model).
func (s *IngestService) updateInsight(ctx context.Context, agentName, agentID, sessionID, oldID, newContent string) (string, error) {
	newID := uuid.New().String()

	// Create new memory object.
	var embedding []float32
	if s.autoModel == "" && s.embedder != nil {
		var err error
		embedding, err = s.embedder.Embed(ctx, newContent)
		if err != nil {
			slog.Warn("embedding failed for updated insight", "err", err)
		}
	}

	now := time.Now()
	m := &domain.Memory{
		ID:         newID,
		Content:    newContent,
		MemoryType: domain.TypeInsight,
		Source:     agentName,
		AgentID:    agentID,
		SessionID:  sessionID,
		Embedding:  embedding,
		State:      domain.StateActive,
		Version:    1,
		UpdatedBy:  agentName,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	// Archive old + create new in a single transaction.
	if err := s.memories.ArchiveAndCreate(ctx, oldID, newID, m); err != nil {
		return "", fmt.Errorf("archive and create for %s: %w", oldID, err)
	}
	return newID, nil
}

// stripInjectedContext removes <relevant-memories>...</relevant-memories> tags from messages.
func stripInjectedContext(messages []IngestMessage) []IngestMessage {
	result := make([]IngestMessage, 0, len(messages))
	for _, msg := range messages {
		cleaned := stripMemoryTags(msg.Content)
		cleaned = strings.TrimSpace(cleaned)
		if cleaned != "" {
			result = append(result, IngestMessage{Role: msg.Role, Content: cleaned})
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
