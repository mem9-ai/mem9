package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/embed"
	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/repository"
)

const (
	maxContentLen     = 50000
	maxTags           = 20
	maxBulkSize       = 100
	maxBulkDeleteSize = 1000
	defaultMinScore   = 0.3

	// secondHopWeight is the RRF weight applied to second-hop vector search results.
	// Lower than 1.0 to prevent indirect matches from outranking direct hits.
	secondHopWeight = 0.3
	// secondHopTopN is the number of top first-hop results used as seeds for second-hop search.
	secondHopTopN = 3
	// secondHopGateScore is the minimum first-hop cosine similarity required to
	// trigger second-hop search. When the best vector result scores below this
	// threshold the query likely has no strong match (e.g. adversarial), so
	// second-hop is skipped to avoid injecting noise.
	secondHopGateScore = 0.5

	recallPrimaryBranchTimeout = 20 * time.Second
	recallSecondHopTimeout     = 8 * time.Second
	recallAdjacentTurnTimeout  = 5 * time.Second
	recallEntityBoostTimeout   = 2 * time.Second
	recallLinkedMemoryTimeout  = 2 * time.Second

	linkedRecallSeedLimit = 20
	linkedRecallMaxAdds   = 10
	linkedRecallWeight    = 0.85

	mem0SemanticMinScore = 0.10
	mem0EntityBoostMax   = 0.50
)

type MemoryService struct {
	memories  repository.MemoryRepo
	embedder  *embed.Embedder
	autoModel string
	ingest    *IngestService
}

type MemoryCreateOptions struct {
	ObservationDate string
}

func observationDateFromMetadata(metadata json.RawMessage) string {
	if len(metadata) == 0 {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal(metadata, &payload); err != nil {
		return ""
	}
	for _, key := range []string{"observation_date", "observed_at", "timestamp", "created_at", "date"} {
		if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func NewMemoryService(memories repository.MemoryRepo, llmClient *llm.Client, embedder *embed.Embedder, autoModel string, ingestMode IngestMode) *MemoryService {
	return &MemoryService{
		memories:  memories,
		embedder:  embedder,
		autoModel: autoModel,
		ingest:    NewIngestService(memories, llmClient, embedder, autoModel, ingestMode),
	}
}

func (s *MemoryService) Create(ctx context.Context, agentID, content string, tags []string, metadata json.RawMessage) (*domain.Memory, int, error) {
	return s.CreateWithOptions(ctx, agentID, content, tags, metadata, MemoryCreateOptions{})
}

func (s *MemoryService) CreateWithOptions(ctx context.Context, agentID, content string, tags []string, metadata json.RawMessage, opts MemoryCreateOptions) (*domain.Memory, int, error) {
	if err := validateMemoryInput(content, tags); err != nil {
		return nil, 0, err
	}

	if s.ingest == nil {
		return nil, 0, fmt.Errorf("ingest service not configured")
	}

	if !s.ingest.HasLLM() {
		// Keep no-LLM create as a single write so API semantics remain predictable.
		// This branch intentionally avoids a "create then patch tags/metadata" flow,
		// which could otherwise return an error after content is already persisted.
		var embedding []float32
		if s.autoModel == "" && s.embedder != nil {
			embeddingResult, embedErr := s.embedder.Embed(ctx, content)
			if embedErr != nil {
				return nil, 0, fmt.Errorf("embed raw content: %w", embedErr)
			}
			embedding = embeddingResult
		}

		now := time.Now()
		contentHash := memoryContentHash(content)
		mem := &domain.Memory{
			ID:          uuid.New().String(),
			Content:     content,
			Source:      agentID,
			Tags:        tags,
			Metadata:    metadata,
			Embedding:   embedding,
			ContentHash: contentHash,
			MemoryType:  domain.TypeInsight,
			AgentID:     agentID,
			State:       domain.StateActive,
			Version:     1,
			UpdatedBy:   agentID,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		writeStart := time.Now()
		err := s.memories.Create(ctx, mem)
		metrics.MemoryWriteDuration.WithLabelValues("create", metricStatus(err)).Observe(time.Since(writeStart).Seconds())
		if err != nil {
			return nil, 0, fmt.Errorf("create raw memory: %w", err)
		}
		replaceMemoryEntityLinks(ctx, s.memories, s.embedder, s.autoModel, agentID, mem.ID, mem.Content)
		return mem, 1, nil
	}

	observationDate := strings.TrimSpace(opts.ObservationDate)
	if observationDate == "" {
		observationDate = observationDateFromMetadata(metadata)
	}
	result, err := s.ingest.ReconcileContentWithContext(ctx, agentID, agentID, "", []string{content}, ExtractionContext{ObservationDate: observationDate})
	if err != nil {
		return nil, 0, err
	}

	if result.Status == "failed" {
		return nil, 0, fmt.Errorf("content reconciliation failed")
	}
	if len(result.InsightIDs) == 0 {
		return nil, 0, nil
	}

	// Apply user-provided tags/metadata to all created insights.
	patchWrites := 0
	for _, id := range result.InsightIDs {
		mem, err := s.memories.GetByID(ctx, id)
		if err != nil {
			continue
		}
		if len(tags) > 0 {
			mem.Tags = tags
		}
		if len(metadata) > 0 {
			mem.Metadata = mergeJSONMetadata(mem.Metadata, metadata)
		}
		if len(tags) > 0 || len(metadata) > 0 {
			if err := s.memories.UpdateOptimistic(ctx, mem, 0); err == nil {
				replaceMemoryEntityLinks(ctx, s.memories, s.embedder, s.autoModel, mem.AgentID, mem.ID, mem.Content)
				patchWrites++
			}
		}
	}

	latestID := result.InsightIDs[len(result.InsightIDs)-1]
	mem, getErr := s.memories.GetByID(ctx, latestID)
	if getErr != nil {
		return nil, 0, fmt.Errorf("fetch reconciled memory %s: %w", latestID, getErr)
	}
	return mem, result.MemoriesChanged + patchWrites, nil

}

func (s *MemoryService) CreatePinned(ctx context.Context, agentID, content string, tags []string, metadata json.RawMessage) (*domain.Memory, int, error) {
	memories, err := s.BulkCreate(ctx, agentID, []BulkMemoryInput{
		{
			Content:  content,
			Tags:     tags,
			Metadata: metadata,
		},
	})
	if err != nil {
		return nil, 0, err
	}
	if len(memories) == 0 {
		return nil, 0, fmt.Errorf("bulk create returned no memories")
	}

	mem := memories[0]
	return &mem, len(memories), nil
}

// Get returns a single memory by ID.
func (s *MemoryService) Get(ctx context.Context, id string) (*domain.Memory, error) {
	return s.memories.GetByID(ctx, id)
}

func (s *MemoryService) Search(ctx context.Context, filter domain.MemoryFilter) ([]domain.Memory, int, error) {
	if filter.Query == "" {
		mems, total, err := s.memories.List(ctx, filter)
		if err != nil {
			return nil, 0, err
		}
		return FinalizeSearchResults(mems, filter.Query), total, nil
	}
	searchFilter := filter

	slog.Info("memory search", "query_len", len(filter.Query), "auto_model", s.autoModel, "fts", s.memories.FTSAvailable())
	if s.autoModel != "" {
		return s.autoHybridSearch(ctx, searchFilter)
	}
	if s.embedder != nil {
		return s.hybridSearch(ctx, searchFilter)
	}
	if s.memories.FTSAvailable() {
		return s.ftsOnlySearch(ctx, searchFilter)
	}
	// FTS probe still running (cold start) — fall back to LIKE-based keyword search.
	slog.Warn("search: FTS not yet available, falling back to keyword search")
	return s.keywordOnlySearch(ctx, searchFilter)
}

func (s *MemoryService) SearchCandidates(
	ctx context.Context,
	filter domain.MemoryFilter,
	sourcePool RecallSourcePool,
	opts RecallCandidateOptions,
) ([]RecallCandidate, error) {
	if filter.Query == "" {
		return nil, nil
	}

	searchFilter := filter

	var (
		candidates []RecallCandidate
		err        error
	)
	if s.autoModel != "" {
		candidates, err = s.autoHybridCandidates(ctx, searchFilter, sourcePool, opts)
	} else if s.embedder != nil {
		candidates, err = s.hybridCandidates(ctx, searchFilter, sourcePool, opts)
	} else if s.memories.FTSAvailable() {
		candidates, err = s.ftsOnlyCandidates(ctx, searchFilter, sourcePool, opts)
	} else {
		candidates, err = s.keywordOnlyCandidates(ctx, searchFilter, sourcePool, opts)
	}
	if err != nil {
		return nil, err
	}
	candidates = s.expandLinkedMemoryCandidates(ctx, searchFilter, sourcePool, candidates)
	candidates = s.applyEntityBoosts(ctx, searchFilter, candidates)
	return applyFactProfileScoring(searchFilter, candidates), nil
}

const rrfK = 60.0

func mem0InternalFetchLimit(limit int) int {
	if limit <= 0 {
		limit = 10
	}
	return maxInt(limit*4, 60)
}

func mem0QueryTermCount(query string) int {
	lemmatized := lemmatizeForBM25(query)
	return len(strings.FieldsFunc(strings.ToLower(lemmatized), func(r rune) bool {
		return (r < 'a' || r > 'z') && (r < '0' || r > '9')
	}))
}

func mem0BM25Params(query string) (float64, float64) {
	terms := mem0QueryTermCount(query)
	switch {
	case terms <= 3:
		return 5.0, 0.7
	case terms <= 6:
		return 7.0, 0.6
	case terms <= 9:
		return 9.0, 0.5
	case terms <= 15:
		return 10.0, 0.5
	default:
		return 12.0, 0.5
	}
}

func mem0NormalizeBM25(query string, raw float64) float64 {
	midpoint, steepness := mem0BM25Params(query)
	return 1.0 / (1.0 + math.Exp(-steepness*(raw-midpoint)))
}

func memoryScore(m domain.Memory) float64 {
	if m.Score == nil {
		return 0
	}
	return *m.Score
}

func mem0SemanticThreshold(filter domain.MemoryFilter) float64 {
	if filter.MinScore < 0 {
		return -1
	}
	if filter.MinScore > 0 {
		return filter.MinScore
	}
	return mem0SemanticMinScore
}

func rrfMerge(ftsResults, vecResults []domain.Memory) map[string]float64 {
	scores := make(map[string]float64, len(ftsResults)+len(vecResults))
	for rank, m := range ftsResults {
		scores[m.ID] += 1.0 / (rrfK + float64(rank+1))
	}
	for rank, m := range vecResults {
		scores[m.ID] += 1.0 / (rrfK + float64(rank+1))
	}
	return scores
}

func (s *MemoryService) paginate(results []domain.Memory, offset, limit int) ([]domain.Memory, int) {
	return paginateResults(results, offset, limit)
}

func (s *MemoryService) entityBoostsForFilter(ctx context.Context, filter domain.MemoryFilter, entityKeys []string, limit int) (map[string]float64, error) {
	entityRepo, ok := s.memories.(repository.MemoryEntityRepo)
	if !ok || len(entityKeys) == 0 {
		return nil, nil
	}
	if limit <= 0 {
		limit = entityRecallBoostMaxMatches
	}
	if filterRepo, ok := s.memories.(repository.MemoryEntityFilterRepo); ok {
		return filterRepo.EntityMemoryBoostsForFilter(ctx, filter, entityKeys, limit)
	}
	return entityRepo.EntityMemoryBoosts(ctx, filter.AgentID, entityKeys, limit)
}

func (s *MemoryService) combinedEntityBoostsForFilter(ctx context.Context, filter domain.MemoryFilter, entityKeys []string, limit int) (map[string]float64, error) {
	boosts, err := s.entityBoostsForFilter(ctx, filter, entityKeys, limit)
	if err != nil {
		return nil, err
	}
	if boosts == nil {
		boosts = map[string]float64{}
	}
	vectorRepo, ok := s.memories.(repository.MemoryEntityVectorRepo)
	if !ok || strings.TrimSpace(filter.Query) == "" {
		return boosts, nil
	}
	var queryVec []float32
	if s.autoModel == "" {
		if s.embedder == nil {
			return boosts, nil
		}
		vec, embedErr := s.embedder.Embed(ctx, filter.Query)
		if embedErr != nil {
			slog.Warn("embed entity query failed", "err", embedErr)
			return boosts, nil
		}
		queryVec = vec
	}
	vectorBoosts, err := vectorRepo.EntityMemoryVectorBoosts(ctx, filter, filter.Query, queryVec, limit)
	if err != nil {
		slog.Warn("entity vector scoring failed", "err", err)
		return boosts, nil
	}
	for id, boost := range vectorBoosts {
		if boost < entityVectorMinScore {
			continue
		}
		if boost > boosts[id] {
			boosts[id] = boost
		}
	}
	return boosts, nil
}

func (s *MemoryService) mem0RankMemories(ctx context.Context, filter domain.MemoryFilter, kwResults, vecResults []domain.Memory, limit int) ([]domain.Memory, map[string]float64) {
	semanticThreshold := mem0SemanticThreshold(filter)
	semanticScores := make(map[string]float64, len(vecResults))
	mems := make(map[string]domain.Memory, len(vecResults)+len(kwResults))
	for _, m := range vecResults {
		score := memoryScore(m)
		if semanticThreshold >= 0 && score < semanticThreshold {
			continue
		}
		if prev, ok := semanticScores[m.ID]; !ok || score > prev {
			semanticScores[m.ID] = score
			mems[m.ID] = m
		}
	}

	keywordScores := make(map[string]float64, len(kwResults))
	for rank, m := range kwResults {
		raw := memoryScore(m)
		rankSignal := 1.0 / float64(rank+1)
		if raw <= 0 {
			raw = 1.0 / (rrfK + float64(rank+1))
		}
		normalized := mem0NormalizeBM25(filter.Query, raw)
		if raw <= 1 {
			normalized = maxFloat(normalized, rankSignal)
		}
		keywordScores[m.ID] = maxFloat(keywordScores[m.ID], normalized)
	}

	entityKeys := expandedEntityKeys(extractMemoryEntities(filter.Query))
	boostLimit := maxInt(limit*6, entityRecallBoostMaxMatches)
	boostCtx, cancel := withRecallTimeout(ctx, recallEntityBoostTimeout)
	entityBoosts, err := s.combinedEntityBoostsForFilter(boostCtx, filter, entityKeys, boostLimit)
	cancel()
	if err != nil {
		slog.Warn("entity memory scoring failed", "err", err)
		entityBoosts = nil
	}

	hasKeyword := len(keywordScores) > 0
	hasEntity := len(entityBoosts) > 0
	scores := make(map[string]float64, len(mems))
	for id, m := range mems {
		semantic := semanticScores[id]
		keyword := keywordScores[id]
		entity := clampFloat(entityBoosts[id], 0, 1)
		maxPossible := 1.0
		if hasKeyword {
			maxPossible += 1.0
		}
		if hasEntity {
			maxPossible += mem0EntityBoostMax
		}
		score := (semantic + keyword + mem0EntityBoostMax*entity) / maxPossible
		score = clampFloat(score, 0, 1)
		if m.MemoryType == domain.TypePinned {
			score *= 1.5
		}
		scores[id] = score
	}
	return sortByScore(mems, scores), scores
}

func mem0RecallCandidates(sourcePool RecallSourcePool, ranked []domain.Memory, scores map[string]float64, kwResults, vecResults []domain.Memory) []RecallCandidate {
	inKeyword := make(map[string]struct{}, len(kwResults))
	for _, m := range kwResults {
		inKeyword[m.ID] = struct{}{}
	}
	vectorSimilarity := make(map[string]float64, len(vecResults))
	for _, m := range vecResults {
		if m.Score != nil {
			vectorSimilarity[m.ID] = *m.Score
		}
	}
	candidates := make([]RecallCandidate, 0, len(ranked))
	for rank, m := range ranked {
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

func paginateResults(results []domain.Memory, offset, limit int) ([]domain.Memory, int) {
	total := len(results)
	if offset >= total {
		return []domain.Memory{}, total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return results[offset:end], total
}

func (s *MemoryService) ftsOnlySearch(ctx context.Context, filter domain.MemoryFilter) ([]domain.Memory, int, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	fetchLimit := mem0InternalFetchLimit(limit)
	textFilter := filter
	if lemmatized := strings.TrimSpace(lemmatizeForBM25(filter.Query)); lemmatized != "" {
		textFilter.Query = lemmatized
	}

	ftsResults, err := s.memories.FTSSearch(ctx, textFilter.Query, textFilter, fetchLimit)
	if err != nil {
		return nil, 0, fmt.Errorf("FTS search: %w", err)
	}
	slog.Info("fts search completed", "query_len", len(filter.Query), "results", len(ftsResults))

	page, total := s.paginate(ftsResults, offset, limit)
	return FinalizeSearchResults(page, filter.Query), total, nil
}

func observeRecallEmbeddingRequest(embedder *embed.Embedder, err error) {
	model := "unknown"
	if embedder != nil && embedder.Model() != "" {
		model = embedder.Model()
	}
	observeRecallEmbeddingRequestByModel(model, err)
}

func observeRecallAutoEmbeddingRequest(autoModel string, err error, skipped bool) {
	if skipped {
		return
	}
	observeRecallEmbeddingRequestByModel(autoModel, err)
}

func observeRecallEmbeddingRequestByModel(model string, err error) {
	if model == "" {
		model = "unknown"
	}
	status := "success"
	if err != nil {
		status = "error"
	}
	metrics.EmbeddingRequestsTotal.WithLabelValues("query_embedding", model, status).Inc()
}

// is not yet available (e.g., during cold start probe window).
func (s *MemoryService) keywordOnlySearch(ctx context.Context, filter domain.MemoryFilter) ([]domain.Memory, int, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	fetchLimit := limit * 3
	textFilter := filter
	if lemmatized := strings.TrimSpace(lemmatizeForBM25(filter.Query)); lemmatized != "" {
		textFilter.Query = lemmatized
	}

	kwResults, err := s.memories.KeywordSearch(ctx, textFilter.Query, textFilter, fetchLimit)
	if err != nil {
		return nil, 0, fmt.Errorf("keyword search: %w", err)
	}
	slog.Info("keyword search completed (FTS unavailable)", "query_len", len(filter.Query), "results", len(kwResults))

	page, total := s.paginate(kwResults, offset, limit)
	return FinalizeSearchResults(page, filter.Query), total, nil
}

func logRecallBranchFailure(ctx context.Context, scope, branch string, err error) {
	if err == nil {
		return
	}
	slog.WarnContext(ctx, "hybrid recall branch failed; continuing with available branch",
		"scope", scope,
		"branch", branch,
		"err", err,
	)
}

func joinedRecallBranchError(scope string, errs ...error) error {
	err := errors.Join(errs...)
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s recall branches failed: %w", scope, err)
}

func withRecallTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, timeout)
}

func (s *MemoryService) textSearch(ctx context.Context, filter domain.MemoryFilter, fetchLimit int) ([]domain.Memory, string, error) {
	textFilter := filter
	if lemmatized := strings.TrimSpace(lemmatizeForBM25(filter.Query)); lemmatized != "" {
		textFilter.Query = lemmatized
	}
	if s.memories.FTSAvailable() {
		branchCtx, cancel := withRecallTimeout(ctx, recallPrimaryBranchTimeout)
		results, err := s.memories.FTSSearch(branchCtx, textFilter.Query, textFilter, fetchLimit)
		cancel()
		if err != nil {
			return nil, "fts", fmt.Errorf("FTS search: %w", err)
		}
		return results, "fts", nil
	}
	branchCtx, cancel := withRecallTimeout(ctx, recallPrimaryBranchTimeout)
	results, err := s.memories.KeywordSearch(branchCtx, textFilter.Query, textFilter, fetchLimit)
	cancel()
	if err != nil {
		return nil, "keyword", fmt.Errorf("keyword search: %w", err)
	}
	return results, "keyword", nil
}

func linkedMemoryIDsFromMetadata(metadata json.RawMessage) []string {
	if len(metadata) == 0 || string(metadata) == "null" {
		return nil
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(metadata, &payload); err != nil {
		return nil
	}
	raw := payload[linkedMemoryIDsMetadataKey]
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var ids []string
	if err := json.Unmarshal(raw, &ids); err != nil {
		return nil
	}
	return normalizeLinkedMemoryIDs(ids)
}

func (s *MemoryService) expandLinkedMemoryCandidates(ctx context.Context, filter domain.MemoryFilter, sourcePool RecallSourcePool, candidates []RecallCandidate) []RecallCandidate {
	if len(candidates) == 0 || s.memories == nil {
		return candidates
	}

	out := make([]RecallCandidate, len(candidates))
	copy(out, candidates)

	idIndex := make(map[string]int, len(out))
	seenContent := make(map[string]struct{}, len(out))
	for i, candidate := range out {
		if candidate.Memory.ID != "" {
			idIndex[candidate.Memory.ID] = i
		}
		if content := strings.TrimSpace(candidate.Memory.Content); content != "" {
			seenContent[content] = struct{}{}
		}
	}

	seedLimit := minInt(len(out), linkedRecallSeedLimit)
	scoreByID := make(map[string]float64)
	order := make([]string, 0, seedLimit)
	boosted := 0
	for i := 0; i < seedLimit; i++ {
		seed := out[i]
		ids := linkedMemoryIDsFromMetadata(seed.Memory.Metadata)
		if len(ids) == 0 {
			continue
		}
		score := seed.RRFScore * linkedRecallWeight
		if score <= 0 {
			rank := seed.RRFRank
			if rank <= 0 {
				rank = i + 1
			}
			score = linkedRecallWeight / (rrfK + float64(rank))
		}
		for _, id := range ids {
			if id == "" || id == seed.Memory.ID {
				continue
			}
			if idx, ok := idIndex[id]; ok {
				out[idx].RRFScore += score * 0.5
				boosted++
				continue
			}
			if _, exists := scoreByID[id]; !exists {
				order = append(order, id)
			}
			if prev, exists := scoreByID[id]; !exists || score > prev {
				scoreByID[id] = score
			}
		}
	}
	if len(order) == 0 && boosted == 0 {
		return candidates
	}

	added := 0
	fetchCtx, cancel := withRecallTimeout(ctx, recallLinkedMemoryTimeout)
	defer cancel()
	for _, id := range order {
		if added >= linkedRecallMaxAdds || fetchCtx.Err() != nil {
			break
		}
		m, err := s.memories.GetByID(fetchCtx, id)
		if err != nil || m == nil {
			continue
		}
		if filter.AgentID != "" && m.AgentID != "" && m.AgentID != filter.AgentID {
			continue
		}
		if m.State != "" && m.State != domain.StateActive {
			continue
		}
		content := strings.TrimSpace(m.Content)
		if content != "" {
			if _, exists := seenContent[content]; exists {
				continue
			}
			seenContent[content] = struct{}{}
		}
		score := scoreByID[id]
		out = append(out, RecallCandidate{
			Memory:     *m,
			SourcePool: sourcePool,
			RRFScore:   score,
			RRFRank:    len(out) + 1,
		})
		idIndex[id] = len(out) - 1
		added++
	}

	if added == 0 && boosted == 0 {
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
	slog.InfoContext(ctx, "linked memory candidates expanded",
		"source_pool", string(sourcePool),
		"seed_limit", seedLimit,
		"linked_ids", len(order),
		"added", added,
		"boosted", boosted,
	)
	return out
}

func (s *MemoryService) ftsOnlyCandidates(ctx context.Context, filter domain.MemoryFilter, sourcePool RecallSourcePool, opts RecallCandidateOptions) ([]RecallCandidate, error) {
	limit := normalizeRecallLimit(filter.Limit, 10)
	fetchLimit := limit * normalizeRecallFetchMultiplier(opts.FetchMultiplier, 3)
	textFilter := filter
	if lemmatized := strings.TrimSpace(lemmatizeForBM25(filter.Query)); lemmatized != "" {
		textFilter.Query = lemmatized
	}

	ftsResults, err := s.memories.FTSSearch(ctx, textFilter.Query, textFilter, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("FTS search: %w", err)
	}
	return dedupRecallCandidatesByContent(mergeRecallCandidates(sourcePool, ftsResults, nil, nil)), nil
}

func (s *MemoryService) keywordOnlyCandidates(ctx context.Context, filter domain.MemoryFilter, sourcePool RecallSourcePool, opts RecallCandidateOptions) ([]RecallCandidate, error) {
	limit := normalizeRecallLimit(filter.Limit, 10)
	fetchLimit := limit * normalizeRecallFetchMultiplier(opts.FetchMultiplier, 3)
	textFilter := filter
	if lemmatized := strings.TrimSpace(lemmatizeForBM25(filter.Query)); lemmatized != "" {
		textFilter.Query = lemmatized
	}

	kwResults, err := s.memories.KeywordSearch(ctx, textFilter.Query, textFilter, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("keyword search: %w", err)
	}
	return dedupRecallCandidatesByContent(mergeRecallCandidates(sourcePool, kwResults, nil, nil)), nil
}

func (s *MemoryService) hybridSearch(ctx context.Context, filter domain.MemoryFilter) ([]domain.Memory, int, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 10
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	fetchLimit := limit * 3

	queryVec, err := s.embedder.Embed(ctx, filter.Query)
	observeRecallEmbeddingRequest(s.embedder, err)
	if err != nil {
		return nil, 0, fmt.Errorf("embed query for search: %w", err)
	}

	vectorCtx, vectorCancel := withRecallTimeout(ctx, recallPrimaryBranchTimeout)
	vecResults, vecErr := s.memories.VectorSearch(vectorCtx, queryVec, filter, fetchLimit)
	vectorCancel()
	if vecErr != nil {
		vecErr = fmt.Errorf("vector search: %w", vecErr)
		logRecallBranchFailure(ctx, "memory", "vector", vecErr)
	} else {
		minScore := mem0SemanticThreshold(filter)
		if minScore >= 0 {
			filtered := vecResults[:0]
			for _, m := range vecResults {
				if m.Score != nil && *m.Score >= minScore {
					filtered = append(filtered, m)
				}
			}
			vecResults = filtered
		}
	}

	kwResults, textBranch, kwErr := s.textSearch(ctx, filter, fetchLimit)
	if kwErr != nil {
		logRecallBranchFailure(ctx, "memory", textBranch, kwErr)
	}
	if vecErr != nil && kwErr != nil {
		return nil, 0, joinedRecallBranchError("memory", vecErr, kwErr)
	}

	slog.Info("hybrid search completed", "query_len", len(filter.Query), "vec_results", len(vecResults), "kw_results", len(kwResults))

	if vecErr != nil && len(vecResults) == 0 {
		page, total := s.paginate(kwResults, offset, limit)
		return FinalizeSearchResults(page, filter.Query), total, nil
	}
	merged, scores := s.mem0RankMemories(ctx, filter, kwResults, vecResults, limit)

	page, total := s.paginate(merged, offset, limit)
	return FinalizeSearchResults(overwriteScores(page, scores), filter.Query), total, nil
}

func (s *MemoryService) hybridCandidates(ctx context.Context, filter domain.MemoryFilter, sourcePool RecallSourcePool, opts RecallCandidateOptions) ([]RecallCandidate, error) {
	limit := normalizeRecallLimit(filter.Limit, 10)
	fetchLimit := maxInt(mem0InternalFetchLimit(limit), limit*normalizeRecallFetchMultiplier(opts.FetchMultiplier, 3))

	queryVec, err := s.embedder.Embed(ctx, filter.Query)
	observeRecallEmbeddingRequest(s.embedder, err)
	if err != nil {
		return nil, fmt.Errorf("embed query for search: %w", err)
	}

	vectorCtx, vectorCancel := withRecallTimeout(ctx, recallPrimaryBranchTimeout)
	vecResults, vecErr := s.memories.VectorSearch(vectorCtx, queryVec, filter, fetchLimit)
	vectorCancel()
	if vecErr != nil {
		vecErr = fmt.Errorf("vector search: %w", vecErr)
		logRecallBranchFailure(ctx, "memory", "vector", vecErr)
	} else {
		minScore := mem0SemanticThreshold(filter)
		if minScore >= 0 {
			vecResults = applyMinScore(vecResults, minScore)
		}
	}

	kwResults, textBranch, kwErr := s.textSearch(ctx, filter, fetchLimit)
	if kwErr != nil {
		logRecallBranchFailure(ctx, "memory", textBranch, kwErr)
	}
	if vecErr != nil && kwErr != nil {
		return nil, joinedRecallBranchError("memory", vecErr, kwErr)
	}

	if vecErr != nil && len(vecResults) == 0 {
		return dedupRecallCandidatesByContent(mergeRecallCandidates(sourcePool, kwResults, nil, nil)), nil
	}
	merged, scores := s.mem0RankMemories(ctx, filter, kwResults, vecResults, limit)
	return dedupRecallCandidatesByContent(mem0RecallCandidates(sourcePool, merged, scores, kwResults, vecResults)), nil
}

func (s *MemoryService) autoHybridSearch(ctx context.Context, filter domain.MemoryFilter) ([]domain.Memory, int, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 10
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	fetchLimit := mem0InternalFetchLimit(limit)

	vectorCtx, vectorCancel := withRecallTimeout(ctx, recallPrimaryBranchTimeout)
	vecResults, vecErr := s.memories.AutoVectorSearch(vectorCtx, filter.Query, filter, fetchLimit)
	vectorCancel()
	skipped := errors.Is(vecErr, domain.ErrAutoVectorSearchSkipped)
	vectorUnavailable := false
	observeRecallAutoEmbeddingRequest(s.autoModel, vecErr, skipped)
	if vecErr != nil {
		if skipped {
			vecErr = nil
			vecResults = nil
			vectorUnavailable = true
		} else {
			vecErr = fmt.Errorf("auto vector search: %w", vecErr)
			vectorUnavailable = true
			logRecallBranchFailure(ctx, "memory", "auto_vector", vecErr)
		}
	} else {
		minScore := mem0SemanticThreshold(filter)
		if minScore >= 0 {
			filtered := vecResults[:0]
			for _, m := range vecResults {
				if m.Score != nil && *m.Score >= minScore {
					filtered = append(filtered, m)
				}
			}
			vecResults = filtered
		}
	}

	kwResults, textBranch, kwErr := s.textSearch(ctx, filter, fetchLimit)
	if kwErr != nil {
		logRecallBranchFailure(ctx, "memory", textBranch, kwErr)
	}
	if vecErr != nil && kwErr != nil {
		return nil, 0, joinedRecallBranchError("memory", vecErr, kwErr)
	}

	slog.Info("auto hybrid search completed", "query_len", len(filter.Query), "vec_results", len(vecResults), "kw_results", len(kwResults))

	if vectorUnavailable && len(vecResults) == 0 {
		page, total := s.paginate(kwResults, offset, limit)
		return FinalizeSearchResults(page, filter.Query), total, nil
	}
	merged, scores := s.mem0RankMemories(ctx, filter, kwResults, vecResults, limit)

	page, total := s.paginate(merged, offset, limit)
	return FinalizeSearchResults(overwriteScores(page, scores), filter.Query), total, nil
}

func (s *MemoryService) autoHybridCandidates(
	ctx context.Context,
	filter domain.MemoryFilter,
	sourcePool RecallSourcePool,
	opts RecallCandidateOptions,
) ([]RecallCandidate, error) {
	start := time.Now()
	limit := normalizeRecallLimit(filter.Limit, 10)
	fetchLimit := maxInt(mem0InternalFetchLimit(limit), limit*normalizeRecallFetchMultiplier(opts.FetchMultiplier, 3))

	vectorStart := time.Now()
	vectorCtx, vectorCancel := withRecallTimeout(ctx, recallPrimaryBranchTimeout)
	vecResults, err := s.memories.AutoVectorSearch(vectorCtx, filter.Query, filter, fetchLimit)
	vectorCancel()
	skipped := errors.Is(err, domain.ErrAutoVectorSearchSkipped)
	observeRecallAutoEmbeddingRequest(s.autoModel, err, skipped)
	vectorDuration := time.Since(vectorStart)
	var vecErr error
	vectorUnavailable := false
	if err != nil {
		if skipped {
			vecResults = nil
			vectorUnavailable = true
		} else {
			vecErr = fmt.Errorf("auto vector search: %w", err)
			vectorUnavailable = true
			logRecallBranchFailure(ctx, "memory", "auto_vector", vecErr)
		}
	} else {
		minScore := mem0SemanticThreshold(filter)
		if minScore >= 0 {
			vecResults = applyMinScore(vecResults, minScore)
		}
	}

	keywordStart := time.Now()
	kwResults, textBranch, kwErr := s.textSearch(ctx, filter, fetchLimit)
	if kwErr != nil {
		logRecallBranchFailure(ctx, "memory", textBranch, kwErr)
	}
	keywordDuration := time.Since(keywordStart)
	if vecErr != nil && kwErr != nil {
		return nil, joinedRecallBranchError("memory", vecErr, kwErr)
	}

	secondHopDuration := time.Duration(0)

	slog.InfoContext(ctx, "memory recall candidate search",
		"query_len", len(filter.Query),
		"source_pool", string(sourcePool),
		"memory_type", filter.MemoryType,
		"fetch_limit", fetchLimit,
		"vector_ms", vectorDuration.Milliseconds(),
		"keyword_ms", keywordDuration.Milliseconds(),
		"second_hop_ms", secondHopDuration.Milliseconds(),
		"second_hop_enabled", false,
		"second_hop_count", 0,
		"total_ms", time.Since(start).Milliseconds(),
	)

	if vectorUnavailable && len(vecResults) == 0 {
		return dedupRecallCandidatesByContent(mergeRecallCandidates(sourcePool, kwResults, nil, nil)), nil
	}
	merged, scores := s.mem0RankMemories(ctx, filter, kwResults, vecResults, limit)
	return dedupRecallCandidatesByContent(mem0RecallCandidates(sourcePool, merged, scores, kwResults, vecResults)), nil
}

// secondHopAutoSearch runs concurrent AutoVectorSearch calls using the top-N
// first-hop results as seed queries. Returns a merged, deduplicated, ranked list
// of second-hop results (excluding seed memories).
func (s *MemoryService) secondHopAutoSearch(
	ctx context.Context,
	firstHopMems map[string]domain.Memory,
	firstHopScores map[string]float64,
	filter domain.MemoryFilter,
	limit int,
	topN int,
) []domain.Memory {
	sorted := sortByScore(firstHopMems, firstHopScores)
	if topN <= 0 {
		topN = secondHopTopN
	}
	if topN > len(sorted) {
		topN = len(sorted)
	}
	if topN == 0 {
		return nil
	}

	seeds := sorted[:topN]
	seedIDs := make(map[string]struct{}, topN)
	for _, m := range seeds {
		seedIDs[m.ID] = struct{}{}
	}

	hopCtx, cancel := withRecallTimeout(ctx, recallSecondHopTimeout)
	defer cancel()

	// Launch concurrent second-hop searches using first-hop embeddings
	// to avoid redundant embedding API calls.
	type hopResult struct {
		results []domain.Memory
		err     error
	}
	ch := make(chan hopResult, topN)
	for _, seed := range seeds {
		if len(seed.Embedding) > 0 {
			go func(vec []float32) {
				results, err := s.memories.VectorSearch(hopCtx, vec, filter, limit)
				ch <- hopResult{results: results, err: err}
			}(seed.Embedding)
		} else {
			go func(content string) {
				results, err := s.memories.AutoVectorSearch(hopCtx, content, filter, limit)
				ch <- hopResult{results: results, err: err}
			}(seed.Content)
		}
	}

	// Collect results: deduplicate, exclude seeds, keep best score per ID.
	bestByID := make(map[string]domain.Memory)
	bestScore := make(map[string]float64)
	rankedResults := func() []domain.Memory {
		if len(bestByID) == 0 {
			return nil
		}
		result := make([]domain.Memory, 0, len(bestByID))
		for _, m := range bestByID {
			result = append(result, m)
		}
		sort.Slice(result, func(i, j int) bool {
			return bestScore[result[i].ID] > bestScore[result[j].ID]
		})
		return result
	}
	for i := 0; i < topN; i++ {
		var hr hopResult
		select {
		case hr = <-ch:
		case <-hopCtx.Done():
			slog.Warn("second-hop search timed out", "err", hopCtx.Err(), "received", i, "top_n", topN)
			return rankedResults()
		}
		if hr.err != nil {
			slog.Warn("second-hop search failed", "err", hr.err)
			continue
		}
		for _, m := range hr.results {
			if _, isSeed := seedIDs[m.ID]; isSeed {
				continue
			}
			if defaultMinScore > 0 && m.Score != nil && *m.Score < defaultMinScore {
				continue
			}
			sc := 0.0
			if m.Score != nil {
				sc = *m.Score
			}
			if prev, exists := bestScore[m.ID]; !exists || sc > prev {
				bestByID[m.ID] = m
				bestScore[m.ID] = sc
			}
		}
	}

	return rankedResults()
}

func collectMems(kwResults, vecResults []domain.Memory) map[string]domain.Memory {
	mems := make(map[string]domain.Memory, len(kwResults)+len(vecResults))
	for _, m := range kwResults {
		mems[m.ID] = m
	}
	for _, m := range vecResults {
		if _, seen := mems[m.ID]; !seen {
			mems[m.ID] = m
		}
	}
	return mems
}

func sortByScore(mems map[string]domain.Memory, scores map[string]float64) []domain.Memory {
	result := make([]domain.Memory, 0, len(mems))
	for id := range mems {
		result = append(result, mems[id])
	}
	sort.Slice(result, func(i, j int) bool {
		return scores[result[i].ID] > scores[result[j].ID]
	})
	return result
}

// setScores sets the Score field on each memory.
// It preserves the original cosine similarity from vector search when available
// (set by VectorSearch/AutoVectorSearch as 1-distance), falling back to the
// RRF fusion score for keyword-only results.
func setScores(page []domain.Memory, scores map[string]float64) []domain.Memory {
	for i := range page {
		if page[i].Score == nil {
			sc := scores[page[i].ID]
			page[i].Score = &sc
		}
	}
	return page
}

func overwriteScores(page []domain.Memory, scores map[string]float64) []domain.Memory {
	for i := range page {
		sc := scores[page[i].ID]
		page[i].Score = &sc
	}
	return page
}

// applyTypeWeights adjusts RRF scores based on memory_type.
// pinned = 1.5x boost (user-explicit memories), insight = 1.0x (standard).
func applyTypeWeights(mems map[string]domain.Memory, scores map[string]float64) {
	for id, m := range mems {
		if m.MemoryType == domain.TypePinned {
			scores[id] *= 1.5
		}
	}
}

// relativeAge returns a human-readable recency string for the given timestamp.
// Returns "just now" for timestamps in the future (clock skew) or under 1 minute.
func relativeAge(t time.Time) string {
	d := time.Since(t)
	if d < 0 {
		return "just now"
	}
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		n := int(d.Minutes())
		if n == 1 {
			return "1 minute ago"
		}
		return fmt.Sprintf("%d minutes ago", n)
	case d < 24*time.Hour:
		n := int(d.Hours())
		if n == 1 {
			return "1 hour ago"
		}
		return fmt.Sprintf("%d hours ago", n)
	case d < 7*24*time.Hour:
		n := int(d.Hours() / 24)
		if n == 1 {
			return "1 day ago"
		}
		return fmt.Sprintf("%d days ago", n)
	case d < 30*24*time.Hour:
		n := int(d.Hours() / (24 * 7))
		if n == 1 {
			return "1 week ago"
		}
		return fmt.Sprintf("%d weeks ago", n)
	case d < 365*24*time.Hour:
		n := int(d.Hours() / (24 * 30))
		if n >= 12 {
			return "1 year ago"
		}
		if n == 1 {
			return "1 month ago"
		}
		return fmt.Sprintf("%d months ago", n)
	default:
		n := int(d.Hours() / (24 * 365))
		if n == 1 {
			return "1 year ago"
		}
		return fmt.Sprintf("%d years ago", n)
	}
}

func populateRelativeAge(memories []domain.Memory) []domain.Memory {
	for i := range memories {
		memories[i].RelativeAge = relativeAge(memories[i].UpdatedAt)
	}
	return memories
}

// Update modifies an existing memory with LWW conflict resolution.
func (s *MemoryService) Update(ctx context.Context, agentName, id, content string, tags []string, metadata json.RawMessage, ifMatch int) (*domain.Memory, error) {
	current, err := s.memories.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if ifMatch > 0 && ifMatch != current.Version {
		slog.Warn("version conflict, applying LWW",
			"memory_id", id,
			"expected_version", ifMatch,
			"actual_version", current.Version,
			"agent", agentName,
		)
	}

	contentChanged := false
	if content != "" {
		if len(content) > maxContentLen {
			return nil, &domain.ValidationError{Field: "content", Message: "too long (max 50000)"}
		}
		current.Content = content
		contentChanged = true
	}
	if tags != nil {
		if len(tags) > maxTags {
			return nil, &domain.ValidationError{Field: "tags", Message: "too many (max 20)"}
		}
		current.Tags = tags
	}
	if metadata != nil {
		current.Metadata = metadata
	}
	current.UpdatedBy = agentName

	if contentChanged && s.autoModel == "" && s.embedder != nil {
		embedding, err := s.embedder.Embed(ctx, current.Content)
		if err != nil {
			return nil, err
		}
		current.Embedding = embedding
	}
	if contentChanged {
		current.ContentHash = memoryContentHash(current.Content)
	}

	writeStart := time.Now()
	err = s.memories.UpdateOptimistic(ctx, current, 0)
	metrics.MemoryWriteDuration.WithLabelValues("update", metricStatus(err)).Observe(time.Since(writeStart).Seconds())
	if err != nil {
		return nil, err
	}
	if contentChanged {
		replaceMemoryEntityLinks(ctx, s.memories, s.embedder, s.autoModel, current.AgentID, current.ID, current.Content)
	}

	updated, err := s.memories.GetByID(ctx, id)
	if err != nil {
		current.Version++
		return current, nil
	}
	return updated, nil
}

func (s *MemoryService) Delete(ctx context.Context, id, agentName string) error {
	if err := s.memories.SoftDelete(ctx, id, agentName); err != nil {
		return err
	}
	deleteMemoryEntityLinks(ctx, s.memories, id)
	return nil
}

// BulkDelete soft-deletes multiple memories by ID. Returns the number of
// memories actually deleted (already-deleted rows are excluded from the count).
func (s *MemoryService) BulkDelete(ctx context.Context, ids []string, agentName string) (int64, error) {
	if len(ids) == 0 {
		return 0, &domain.ValidationError{Field: "ids", Message: "required"}
	}
	if len(ids) > maxBulkDeleteSize {
		return 0, &domain.ValidationError{Field: "ids", Message: "too many (max 1000)"}
	}

	seen := make(map[string]struct{}, len(ids))
	unique := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			unique = append(unique, id)
		}
	}
	if len(unique) == 0 {
		return 0, &domain.ValidationError{Field: "ids", Message: "required"}
	}

	deleted, err := s.memories.BulkSoftDelete(ctx, unique, agentName)
	if err != nil {
		return deleted, err
	}
	for _, id := range unique {
		deleteMemoryEntityLinks(ctx, s.memories, id)
	}
	return deleted, nil
}

func (s *MemoryService) Bootstrap(ctx context.Context, limit int) ([]domain.Memory, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	return s.memories.ListBootstrap(ctx, limit)
}

// BulkCreate creates multiple memories at once.
func (s *MemoryService) BulkCreate(ctx context.Context, agentName string, items []BulkMemoryInput) ([]domain.Memory, error) {
	if len(items) == 0 {
		return nil, &domain.ValidationError{Field: "memories", Message: "required"}
	}
	if len(items) > maxBulkSize {
		return nil, &domain.ValidationError{Field: "memories", Message: "too many (max 100)"}
	}

	now := time.Now()
	memories := make([]*domain.Memory, 0, len(items))
	for i, item := range items {
		if err := validateMemoryInput(item.Content, item.Tags); err != nil {
			var ve *domain.ValidationError
			if errors.As(err, &ve) {
				ve.Field = "memories[" + strconv.Itoa(i) + "]." + ve.Field
			}
			return nil, err
		}

		var embedding []float32
		if s.autoModel == "" && s.embedder != nil {
			var err error
			embedding, err = s.embedder.Embed(ctx, item.Content)
			if err != nil {
				return nil, err
			}
		}

		contentHash := memoryContentHash(item.Content)
		memories = append(memories, &domain.Memory{
			ID:          uuid.New().String(),
			Content:     item.Content,
			Source:      agentName,
			Tags:        item.Tags,
			Metadata:    item.Metadata,
			Embedding:   embedding,
			ContentHash: contentHash,
			MemoryType:  domain.TypePinned,
			State:       domain.StateActive,
			Version:     1,
			UpdatedBy:   agentName,
			CreatedAt:   now,
			UpdatedAt:   now,
		})
	}

	writeStart := time.Now()
	err := s.memories.BulkCreate(ctx, memories)
	metrics.MemoryWriteDuration.WithLabelValues("bulk_create", metricStatus(err)).Observe(time.Since(writeStart).Seconds())
	if err != nil {
		return nil, err
	}

	result := make([]domain.Memory, len(memories))
	for i, m := range memories {
		replaceMemoryEntityLinks(ctx, s.memories, s.embedder, s.autoModel, m.AgentID, m.ID, m.Content)
		result[i] = *m
	}
	return result, nil
}

// BulkMemoryInput is the input shape for each item in a bulk create request.
type BulkMemoryInput struct {
	Content  string          `json:"content"`
	Tags     []string        `json:"tags,omitempty"`
	Metadata json.RawMessage `json:"metadata,omitempty"`
}

func validateMemoryInput(content string, tags []string) error {
	if content == "" {
		return &domain.ValidationError{Field: "content", Message: "required"}
	}
	if len(content) > maxContentLen {
		return &domain.ValidationError{Field: "content", Message: "too long (max 50000)"}
	}
	if len(tags) > maxTags {
		return &domain.ValidationError{Field: "tags", Message: "too many (max 20)"}
	}
	return nil
}

func (s *MemoryService) CountStats(ctx context.Context) (total int64, last7d int64, err error) {
	return s.memories.CountStats(ctx)
}
