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
	const maxConversationRunes = 1000000
	formatted = truncateRunes(formatted, maxConversationRunes)

	insightIDs, warnings, err := s.extractAndReconcile(ctx, agentName, req.AgentID, req.SessionID, formatted)
	if err != nil {
		slog.Error("insight extraction failed", "err", err)
		return &IngestResult{Status: "failed", Warnings: warnings}, nil
	}

	status := "complete"
	if warnings > 0 && len(insightIDs) == 0 {
		status = "partial" // Facts extracted but reconciliation failed — no memories written
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

	// Extract facts first, then run one batched reconciliation over all facts.
	var allFacts []string
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

	if err := s.memories.Create(ctx, m); err != nil {
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

## Examples

Input:
User: Hi, how are you?
Assistant: I'm doing well, thank you! How can I help?
Output: {"facts": []}

Input:
User: The weather is nice today.
Assistant: Indeed it is! Enjoy your day.
Output: {"facts": []}

Input:
User: I'm looking for a restaurant in San Francisco.
Assistant: Sure, what cuisine do you prefer?
Output: {"facts": ["Looking for a restaurant in San Francisco"]}

Input:
User: Yesterday I had a meeting with John at 3pm. We discussed the new project timeline.
Assistant: Sounds productive!
Output: {"facts": ["Had a meeting with John at 3pm", "Discussed the new project timeline with John"]}

Input:
User: My name is Ming Zhang, I am a backend engineer, mainly using Go and Python.
Assistant: Hi Ming Zhang!
Output: {"facts": ["Name is Ming Zhang", "Is a backend engineer", "Mainly uses Go and Python"]}

Input:
User: My favorite movies are Inception and Interstellar. I also love Italian food, especially pizza.
Assistant: Great taste! Both are amazing films.
Output: {"facts": ["Favorite movies are Inception and Interstellar", "Loves Italian food, especially pizza"]}

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
			return nil, fmt.Errorf("extraction parse after retry: %w", err)
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
	slog.Info("facts extracted", "count", len(facts))
	return facts, nil
}

// reconcile searches relevant memories for each fact, deduplicates, then sends
// all facts and all retrieved memories to the LLM in a single call for batch
// decision-making. This gives the LLM a complete view of both the new facts and
// the existing knowledge base, enabling better ADD/UPDATE/DELETE/NOOP decisions.
func (s *IngestService) reconcile(ctx context.Context, agentName, agentID, sessionID string, facts []string) ([]string, int, error) {
	// Step 1: For each fact, search for relevant existing memories and collect them.
	existingMemories, gatherErr := s.gatherExistingMemories(ctx, agentID, facts)
	if gatherErr != nil {
		return nil, 0, fmt.Errorf("gather existing memories: %w", gatherErr)
	}
	slog.Info("gathered existing memories for reconciliation", "facts", len(facts), "existing", len(existingMemories))

	if len(existingMemories) == 0 {
		return s.addAllFacts(ctx, agentName, agentID, sessionID, facts)
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
		ref := memoryRef{IntID: i, Text: m.Content}
		if !m.UpdatedAt.IsZero() {
			ref.Age = relativeAge(m.UpdatedAt)
		}
		refs[i] = ref
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
8. Each existing memory has an "age" field showing when it was last updated. Use age as a tiebreaker: when a new fact conflicts with an existing memory on the same topic and there is no other signal, older memories are more likely outdated. Age alone is NOT sufficient reason to UPDATE or DELETE — the content must also conflict or supersede the existing memory.

## Examples

Example 1 — ADD new information:
  Existing memories: [{"id": 0, "text": "Is a software engineer", "age": "2 months ago"}]
  New facts: ["Name is John"]
  Result: {"memory": [{"id": "0", "text": "Is a software engineer", "event": "NOOP"}, {"id": "new", "text": "Name is John", "event": "ADD"}]}

Example 2 — UPDATE with more detail:
  Existing memories: [{"id": 0, "text": "Likes to play cricket", "age": "3 weeks ago"}, {"id": 1, "text": "Is a software engineer", "age": "2 months ago"}]
  New facts: ["Loves to play cricket with friends on weekends"]
  Result: {"memory": [{"id": "0", "text": "Loves to play cricket with friends on weekends", "event": "UPDATE", "old_memory": "Likes to play cricket"}, {"id": "1", "text": "Is a software engineer", "event": "NOOP"}]}

Example 3 — DELETE contradicted information:
  Existing memories: [{"id": 0, "text": "Name is John", "age": "5 months ago"}, {"id": 1, "text": "Loves cheese pizza", "age": "3 months ago"}]
  New facts: ["Dislikes cheese pizza"]
  Result: {"memory": [{"id": "0", "text": "Name is John", "event": "NOOP"}, {"id": "1", "text": "Loves cheese pizza", "event": "DELETE"}, {"id": "new", "text": "Dislikes cheese pizza", "event": "ADD"}]}

Example 4 — NOOP for equivalent information:
  Existing memories: [{"id": 0, "text": "Name is John", "age": "5 months ago"}, {"id": 1, "text": "Loves cheese pizza", "age": "3 months ago"}]
  New facts: ["Name is John"]
  Result: {"memory": [{"id": "0", "text": "Name is John", "event": "NOOP"}, {"id": "1", "text": "Loves cheese pizza", "event": "NOOP"}]}

Example 5 — Age as tiebreaker for ambiguous conflicts:
  Existing memories: [{"id": 0, "text": "Prefers vim", "age": "1 year ago"}, {"id": 1, "text": "Works at startup X", "age": "8 months ago"}]
  New facts: ["Prefers VS Code", "Works at company Y"]
  Result: {"memory": [{"id": "0", "text": "Prefers VS Code", "event": "UPDATE", "old_memory": "Prefers vim"}, {"id": "1", "text": "Works at company Y", "event": "UPDATE", "old_memory": "Works at startup X"}]}

Example 6 — Age does NOT trigger UPDATE without content conflict:
  Existing memories: [{"id": 0, "text": "Likes coffee", "age": "2 years ago"}]
  New facts: ["Enjoys coffee"]
  Result: {"memory": [{"id": "0", "text": "Likes coffee", "event": "NOOP"}]}

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
		slog.Warn("reconciliation LLM call failed, skipping to avoid duplicates", "err", err)
		return nil, 1, nil // warnings=1 signals that facts were extracted but reconciliation was skipped
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
			slog.Warn("reconciliation retry failed, skipping to avoid duplicates", "err", retryErr)
			return nil, 1, nil // warnings=1 signals that facts were extracted but reconciliation was skipped
		}
		parsed, err = llm.ParseJSON[reconcileResponse](raw2)
		if err != nil {
			slog.Warn("reconciliation JSON parse failed after retry, skipping to avoid duplicates", "err", err)
			return nil, 1, nil // warnings=1 signals that facts were extracted but reconciliation was skipped
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
			if !ok || event.Text == "" {
				slog.Warn("skipping UPDATE with invalid ID or empty text", "id", event.ID)
				continue
			}
			// Guard: never auto-update pinned memories — treat as ADD instead.
			if existingMemories[intID].MemoryType == domain.TypePinned {
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

	return resultIDs, warnings, nil
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

	var searchAttempts, searchSuccesses int
	filter := domain.MemoryFilter{
		State:      "active",
		MemoryType: "insight,pinned",
		AgentID:    agentID,
	}

	seen := make(map[string]struct{})
	var result []domain.Memory

	addUnseen := func(matches []domain.Memory, applyThreshold bool) {
		for _, m := range matches {
			if _, ok := seen[m.ID]; ok {
				continue
			}
			// Skip low-similarity vector results to avoid polluting LLM context.
			if applyThreshold && m.Score != nil && *m.Score < minSimilarityScore {
				continue
			}
			seen[m.ID] = struct{}{}
			m.Content = truncateRunes(m.Content, contentMaxLen)
			result = append(result, m)
		}
	}

	// No vector search available.
	if s.embedder == nil && s.autoModel == "" {
		// Use FTS if available, otherwise fall back to keyword (LIKE) search.
		// During cold start, FTS may not yet be available (probe still running).
		for _, fact := range facts {
			var kwMatches []domain.Memory
			var kwErr error
			if s.memories.FTSAvailable() {
				kwMatches, kwErr = s.memories.FTSSearch(ctx, fact, filter, perFactLimit)
			} else {
				kwMatches, kwErr = s.memories.KeywordSearch(ctx, fact, filter, perFactLimit)
			}
			searchAttempts++
			if kwErr != nil {
				slog.Warn("gatherExistingMemories: keyword/FTS search failed for fact, skipping", "fact_len", len(fact), "err", kwErr)
				continue
			}
			searchSuccesses++
			addUnseen(kwMatches, false)
		}
		// If every search attempt failed, return an error to prevent silent duplicate writes.
		if searchAttempts > 0 && searchSuccesses == 0 {
			return nil, fmt.Errorf("all %d search attempts failed: search backends may be unavailable", searchAttempts)
		}
		if len(result) > maxExistingMemories {
			result = result[:maxExistingMemories]
		}
		return result, nil
	}

	for _, fact := range facts {
		// Leg 1: Vector search.
		var vecMatches []domain.Memory
		var vecLegOK bool
		if s.autoModel != "" {
			searchAttempts++
			var vecErr error
			vecMatches, vecErr = s.memories.AutoVectorSearch(ctx, fact, filter, perFactLimit)
			if vecErr != nil {
				slog.Warn("gatherExistingMemories: auto vector search failed for fact, continuing with keyword leg", "fact_len", len(fact), "err", vecErr)
			} else {
				searchSuccesses++
				vecLegOK = true
			}
		} else {
			searchAttempts++
			vec, embedErr := s.embedder.Embed(ctx, fact)
			if embedErr != nil {
				slog.Warn("gatherExistingMemories: embed failed for fact, continuing with keyword leg", "fact_len", len(fact), "err", embedErr)
			} else {
				var vecErr error
				vecMatches, vecErr = s.memories.VectorSearch(ctx, vec, filter, perFactLimit)
				if vecErr != nil {
					slog.Warn("gatherExistingMemories: vector search failed for fact, continuing with keyword leg", "fact_len", len(fact), "err", vecErr)
				} else {
					searchSuccesses++
					vecLegOK = true
				}
			}
		}
		addUnseen(vecMatches, true) // Apply similarity threshold to vector results

		// Leg 2: FTS / keyword search — catches exact terms that vector search may miss.
		var kwMatches []domain.Memory
		var kwErr error
		if s.memories.FTSAvailable() {
			kwMatches, kwErr = s.memories.FTSSearch(ctx, fact, filter, perFactLimit)
		} else {
			kwMatches, kwErr = s.memories.KeywordSearch(ctx, fact, filter, perFactLimit)
		}
		searchAttempts++
		if kwErr != nil {
			slog.Warn("gatherExistingMemories: keyword/FTS search failed for fact, skipping", "fact_len", len(fact), "err", kwErr)
		} else {
			searchSuccesses++
			addUnseen(kwMatches, false) // No threshold for keyword/FTS results
		}

		// If neither leg succeeded for this fact, log it clearly.
		if !vecLegOK && kwErr != nil {
			slog.Error("gatherExistingMemories: both search legs failed for fact", "fact_len", len(fact))
		}
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

// addAllFacts adds all facts as new insights when no existing memories are
// found (i.e., all facts are guaranteed new). Called only when gatherExistingMemories returns empty.
func (s *IngestService) addAllFacts(ctx context.Context, agentName, agentID, sessionID string, facts []string) ([]string, int, error) {
	var ids []string
	var warnings int
	for _, fact := range facts {
		id, err := s.addInsight(ctx, agentName, agentID, sessionID, fact)
		if err != nil {
			slog.Warn("failed to add fact", "err", err, "fact_len", len(fact))
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
			return "", fmt.Errorf("embed updated insight: %w", err)
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
