package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
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
	// sourceSeqAdjacentTurnWeight applies a moderate boost to raw turns expanded
	// from insight memories' source provenance. Lower than direct first-hop hits
	// because the added turns come from adjacent local dialogue sessions rather
	// than from the matched source band itself.
	sourceSeqAdjacentTurnWeight = 0.6
	sourceSeqAdjacentTurnRadius = 1
	sourceSeqAdjacentTurnTopN   = 4
	sourceSeqAdjacentTurnSpan   = 4
	sourceSeqAdjacentTurnCap    = 6
	// sourceSeqLocalSessionFetchSlack keeps the raw-turn fetch bounded while
	// still allowing the helper to reconstruct the local dialogue-session
	// containing the source band plus its immediate neighbors.
	sourceSeqLocalSessionFetchSlack = 96
	sourceSeqBoundaryTurnRadius     = 1
	sourceSeqBoundaryMinSeedCount   = 2
)

type MemoryService struct {
	memories  repository.MemoryRepo
	sessions  repository.SessionRepo
	embedder  *embed.Embedder
	autoModel string
	ingest    *IngestService
}

func NewMemoryService(memories repository.MemoryRepo, llmClient *llm.Client, embedder *embed.Embedder, autoModel string, ingestMode IngestMode, sessions ...repository.SessionRepo) *MemoryService {
	var sessionRepo repository.SessionRepo
	if len(sessions) > 0 {
		sessionRepo = sessions[0]
	}
	return &MemoryService{
		memories:  memories,
		sessions:  sessionRepo,
		embedder:  embedder,
		autoModel: autoModel,
		ingest:    NewIngestService(memories, llmClient, embedder, autoModel, ingestMode),
	}
}

func (s *MemoryService) Create(ctx context.Context, agentID, content string, tags []string, metadata json.RawMessage) (*domain.Memory, int, error) {
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
		mem := &domain.Memory{
			ID:         uuid.New().String(),
			Content:    content,
			Source:     agentID,
			Tags:       tags,
			Metadata:   metadata,
			Embedding:  embedding,
			MemoryType: domain.TypeInsight,
			AgentID:    agentID,
			State:      domain.StateActive,
			Version:    1,
			UpdatedBy:  agentID,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		writeStart := time.Now()
		err := s.memories.Create(ctx, mem)
		metrics.MemoryWriteDuration.WithLabelValues("create", metricStatus(err)).Observe(time.Since(writeStart).Seconds())
		if err != nil {
			return nil, 0, fmt.Errorf("create raw memory: %w", err)
		}
		return mem, 1, nil
	}

	result, err := s.ingest.ReconcileContent(ctx, agentID, agentID, "", []string{content})
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
			mem.Metadata = metadata
		}
		if len(tags) > 0 || len(metadata) > 0 {
			if err := s.memories.UpdateOptimistic(ctx, mem, 0); err == nil {
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
		return finalizeSearchResults(mems, filter.Query), total, nil
	}
	searchFilter := filter
	searchFilter.SessionID = ""
	searchFilter.Source = ""

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
	searchFilter.SessionID = ""
	searchFilter.Source = ""

	if s.autoModel != "" {
		return s.autoHybridCandidates(ctx, searchFilter, sourcePool, opts)
	}
	if s.embedder != nil {
		return s.hybridCandidates(ctx, searchFilter, sourcePool, opts)
	}
	if s.memories.FTSAvailable() {
		return s.ftsOnlyCandidates(ctx, searchFilter, sourcePool, opts)
	}
	return s.keywordOnlyCandidates(ctx, searchFilter, sourcePool, opts)
}

const rrfK = 60.0

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
	fetchLimit := limit * 3

	ftsResults, err := s.memories.FTSSearch(ctx, filter.Query, filter, fetchLimit)
	if err != nil {
		return nil, 0, fmt.Errorf("FTS search: %w", err)
	}
	slog.Info("fts search completed", "query_len", len(filter.Query), "results", len(ftsResults))

	page, total := s.paginate(ftsResults, offset, limit)
	return finalizeSearchResults(page, filter.Query), total, nil
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

	kwResults, err := s.memories.KeywordSearch(ctx, filter.Query, filter, fetchLimit)
	if err != nil {
		return nil, 0, fmt.Errorf("keyword search: %w", err)
	}
	slog.Info("keyword search completed (FTS unavailable)", "query_len", len(filter.Query), "results", len(kwResults))

	page, total := s.paginate(kwResults, offset, limit)
	return finalizeSearchResults(page, filter.Query), total, nil
}

func (s *MemoryService) ftsOnlyCandidates(ctx context.Context, filter domain.MemoryFilter, sourcePool RecallSourcePool, opts RecallCandidateOptions) ([]RecallCandidate, error) {
	limit := normalizeRecallLimit(filter.Limit, 10)
	fetchLimit := limit * normalizeRecallFetchMultiplier(opts.FetchMultiplier, 3)

	ftsResults, err := s.memories.FTSSearch(ctx, filter.Query, filter, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("FTS search: %w", err)
	}
	return dedupRecallCandidatesByContent(mergeRecallCandidates(sourcePool, ftsResults, nil, nil)), nil
}

func (s *MemoryService) keywordOnlyCandidates(ctx context.Context, filter domain.MemoryFilter, sourcePool RecallSourcePool, opts RecallCandidateOptions) ([]RecallCandidate, error) {
	limit := normalizeRecallLimit(filter.Limit, 10)
	fetchLimit := limit * normalizeRecallFetchMultiplier(opts.FetchMultiplier, 3)

	kwResults, err := s.memories.KeywordSearch(ctx, filter.Query, filter, fetchLimit)
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

	vecResults, vecErr := s.memories.VectorSearch(ctx, queryVec, filter, fetchLimit)
	if vecErr != nil {
		return nil, 0, fmt.Errorf("vector search: %w", vecErr)
	}

	minScore := filter.MinScore
	if minScore == 0 {
		minScore = defaultMinScore
	}
	if minScore > 0 {
		filtered := vecResults[:0]
		for _, m := range vecResults {
			if m.Score != nil && *m.Score >= minScore {
				filtered = append(filtered, m)
			}
		}
		vecResults = filtered
	}

	var kwResults []domain.Memory
	if s.memories.FTSAvailable() {
		var kwErr error
		kwResults, kwErr = s.memories.FTSSearch(ctx, filter.Query, filter, fetchLimit)
		if kwErr != nil {
			return nil, 0, fmt.Errorf("FTS search: %w", kwErr)
		}
	} else {
		var kwErr error
		kwResults, kwErr = s.memories.KeywordSearch(ctx, filter.Query, filter, fetchLimit)
		if kwErr != nil {
			return nil, 0, fmt.Errorf("keyword search: %w", kwErr)
		}
	}

	slog.Info("hybrid search completed", "query_len", len(filter.Query), "vec_results", len(vecResults), "kw_results", len(kwResults))

	scores := rrfMerge(kwResults, vecResults)
	mems := collectMems(kwResults, vecResults)
	applyTypeWeights(mems, scores)
	merged := sortByScore(mems, scores)

	page, total := s.paginate(merged, offset, limit)
	return finalizeSearchResults(setScores(page, scores), filter.Query), total, nil
}

func (s *MemoryService) hybridCandidates(ctx context.Context, filter domain.MemoryFilter, sourcePool RecallSourcePool, opts RecallCandidateOptions) ([]RecallCandidate, error) {
	limit := normalizeRecallLimit(filter.Limit, 10)
	fetchLimit := limit * normalizeRecallFetchMultiplier(opts.FetchMultiplier, 3)

	queryVec, err := s.embedder.Embed(ctx, filter.Query)
	observeRecallEmbeddingRequest(s.embedder, err)
	if err != nil {
		return nil, fmt.Errorf("embed query for search: %w", err)
	}

	vecResults, err := s.memories.VectorSearch(ctx, queryVec, filter, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("vector search: %w", err)
	}
	vecResults = applyMinScore(vecResults, filter.MinScore)

	var kwResults []domain.Memory
	if s.memories.FTSAvailable() {
		kwResults, err = s.memories.FTSSearch(ctx, filter.Query, filter, fetchLimit)
		if err != nil {
			return nil, fmt.Errorf("FTS search: %w", err)
		}
	} else {
		kwResults, err = s.memories.KeywordSearch(ctx, filter.Query, filter, fetchLimit)
		if err != nil {
			return nil, fmt.Errorf("keyword search: %w", err)
		}
	}

	baseCandidates := mergeRecallCandidates(sourcePool, kwResults, vecResults, nil)
	adjacentTurns, adjacentCluster, err := s.sourceSeqLocalSessionGapFillMemories(ctx, sourcePool, baseCandidates)
	if err != nil {
		slog.WarnContext(ctx, "memory source-seq local-session gap fill skipped", "err", err)
		adjacentTurns = nil
		adjacentCluster = nil
	}

	merged := mergeRecallCandidatesWithExtraWeight(sourcePool, kwResults, vecResults, adjacentTurns, sourceSeqAdjacentTurnWeight)
	if adjacentCluster != nil && len(adjacentTurns) > 0 {
		merged = pruneSourceSeqOverlapCandidates(merged, adjacentCluster)
	}
	return dedupRecallCandidatesByContent(merged), nil
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
	fetchLimit := limit * 3

	vecResults, vecErr := s.memories.AutoVectorSearch(ctx, filter.Query, filter, fetchLimit)
	observeRecallAutoEmbeddingRequest(s.autoModel, vecErr, false)
	if vecErr != nil {
		return nil, 0, fmt.Errorf("auto vector search: %w", vecErr)
	}

	minScore := filter.MinScore
	if minScore == 0 {
		minScore = defaultMinScore
	}
	if minScore > 0 {
		filtered := vecResults[:0]
		for _, m := range vecResults {
			if m.Score != nil && *m.Score >= minScore {
				filtered = append(filtered, m)
			}
		}
		vecResults = filtered
	}

	var kwResults []domain.Memory
	if s.memories.FTSAvailable() {
		var kwErr error
		kwResults, kwErr = s.memories.FTSSearch(ctx, filter.Query, filter, fetchLimit)
		if kwErr != nil {
			return nil, 0, fmt.Errorf("FTS search: %w", kwErr)
		}
	} else {
		var kwErr error
		kwResults, kwErr = s.memories.KeywordSearch(ctx, filter.Query, filter, fetchLimit)
		if kwErr != nil {
			return nil, 0, fmt.Errorf("keyword search: %w", kwErr)
		}
	}

	slog.Info("auto hybrid search completed", "query_len", len(filter.Query), "vec_results", len(vecResults), "kw_results", len(kwResults))

	scores := rrfMerge(kwResults, vecResults)
	mems := collectMems(kwResults, vecResults)

	// Second-hop: skip when the best first-hop vector score is below the gate
	// threshold — a low score suggests the query has no strong match (e.g.
	// adversarial), so expanding search would mainly inject noise.
	maxVecScore := 0.0
	for _, m := range vecResults {
		if m.Score != nil && *m.Score > maxVecScore {
			maxVecScore = *m.Score
		}
	}
	if maxVecScore >= secondHopGateScore {
		secondHopMems := s.secondHopAutoSearch(ctx, mems, scores, filter, limit, secondHopTopN)
		for rank, m := range secondHopMems {
			scores[m.ID] += secondHopWeight / (rrfK + float64(rank+1))
			if _, exists := mems[m.ID]; !exists {
				mems[m.ID] = m
			}
		}
	}

	applyTypeWeights(mems, scores)
	merged := sortByScore(mems, scores)

	page, total := s.paginate(merged, offset, limit)
	return finalizeSearchResults(setScores(page, scores), filter.Query), total, nil
}

func (s *MemoryService) autoHybridCandidates(
	ctx context.Context,
	filter domain.MemoryFilter,
	sourcePool RecallSourcePool,
	opts RecallCandidateOptions,
) ([]RecallCandidate, error) {
	start := time.Now()
	limit := normalizeRecallLimit(filter.Limit, 10)
	fetchLimit := limit * normalizeRecallFetchMultiplier(opts.FetchMultiplier, 3)

	vectorStart := time.Now()
	vecResults, err := s.memories.AutoVectorSearch(ctx, filter.Query, filter, fetchLimit)
	observeRecallAutoEmbeddingRequest(s.autoModel, err, false)
	vectorDuration := time.Since(vectorStart)
	if err != nil {
		return nil, fmt.Errorf("auto vector search: %w", err)
	}
	vecResults = applyMinScore(vecResults, filter.MinScore)

	var kwResults []domain.Memory
	keywordStart := time.Now()
	if s.memories.FTSAvailable() {
		kwResults, err = s.memories.FTSSearch(ctx, filter.Query, filter, fetchLimit)
		if err != nil {
			return nil, fmt.Errorf("FTS search: %w", err)
		}
	} else {
		kwResults, err = s.memories.KeywordSearch(ctx, filter.Query, filter, fetchLimit)
		if err != nil {
			return nil, fmt.Errorf("keyword search: %w", err)
		}
	}
	keywordDuration := time.Since(keywordStart)

	var secondHopResults []domain.Memory
	secondHopStart := time.Now()
	if opts.EnableSecondHop {
		maxVecScore := 0.0
		for _, m := range vecResults {
			if m.Score != nil && *m.Score > maxVecScore {
				maxVecScore = *m.Score
			}
		}
		if maxVecScore >= secondHopGateScore {
			scores := rrfMerge(kwResults, vecResults)
			mems := collectMems(kwResults, vecResults)
			topN := opts.SecondHopTopN
			if topN <= 0 {
				topN = secondHopTopN
			}
			secondHopResults = s.secondHopAutoSearch(ctx, mems, scores, filter, limit, topN)
		}
	}
	secondHopDuration := time.Since(secondHopStart)

	baseCandidates := mergeRecallCandidates(sourcePool, kwResults, vecResults, secondHopResults)
	adjacentTurnStart := time.Now()
	adjacentTurns, adjacentCluster, err := s.sourceSeqLocalSessionGapFillMemories(ctx, sourcePool, baseCandidates)
	if err != nil {
		slog.WarnContext(ctx, "memory source-seq local-session gap fill skipped", "err", err)
		adjacentTurns = nil
		adjacentCluster = nil
	}
	adjacentTurnDuration := time.Since(adjacentTurnStart)

	slog.InfoContext(ctx, "memory recall candidate search",
		"query_len", len(filter.Query),
		"source_pool", string(sourcePool),
		"memory_type", filter.MemoryType,
		"fetch_limit", fetchLimit,
		"vector_ms", vectorDuration.Milliseconds(),
		"keyword_ms", keywordDuration.Milliseconds(),
		"second_hop_ms", secondHopDuration.Milliseconds(),
		"source_seq_local_session_gap_fill_ms", adjacentTurnDuration.Milliseconds(),
		"second_hop_enabled", opts.EnableSecondHop,
		"second_hop_count", len(secondHopResults),
		"source_seq_local_session_gap_fill_count", len(adjacentTurns),
		"total_ms", time.Since(start).Milliseconds(),
	)

	extraResults := make([]domain.Memory, 0, len(secondHopResults)+len(adjacentTurns))
	extraResults = append(extraResults, secondHopResults...)
	extraResults = append(extraResults, adjacentTurns...)

	merged := mergeRecallCandidatesWithExtraWeight(sourcePool, kwResults, vecResults, extraResults, sourceSeqAdjacentTurnWeight)
	if adjacentCluster != nil && len(adjacentTurns) > 0 {
		merged = pruneSourceSeqOverlapCandidates(merged, adjacentCluster)
	}
	return dedupRecallCandidatesByContent(merged), nil
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
				results, err := s.memories.VectorSearch(ctx, vec, filter, limit)
				ch <- hopResult{results: results, err: err}
			}(seed.Embedding)
		} else {
			go func(content string) {
				results, err := s.memories.AutoVectorSearch(ctx, content, filter, limit)
				ch <- hopResult{results: results, err: err}
			}(seed.Content)
		}
	}

	// Collect results: deduplicate, exclude seeds, keep best score per ID.
	bestByID := make(map[string]domain.Memory)
	bestScore := make(map[string]float64)
	for i := 0; i < topN; i++ {
		hr := <-ch
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

	if len(bestByID) == 0 {
		return nil
	}

	// Sort by cosine similarity to produce a single ranked list for RRF.
	result := make([]domain.Memory, 0, len(bestByID))
	for _, m := range bestByID {
		result = append(result, m)
	}
	sort.Slice(result, func(i, j int) bool {
		return bestScore[result[i].ID] > bestScore[result[j].ID]
	})
	return result
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

type sourceSeqAdjacentTurnSeed struct {
	Candidate  RecallCandidate
	SourceSeqs []int
}

type sourceSeqClusterPoint struct {
	SessionID string
	Seq       int
	SeedID    string
	SeedRank  int
}

type sourceSeqAdjacentCluster struct {
	SourceSeqs   []int
	SourceSeqSet map[int]struct{}
	SeedIDs      map[string]struct{}
	SessionIDs   []string
	MinSeq       int
	MaxSeq       int
	Center       float64
}

func sourceSeqsFromMemory(memory domain.Memory) []int {
	if len(memory.Metadata) == 0 {
		return nil
	}
	var metadata map[string]json.RawMessage
	if err := json.Unmarshal(memory.Metadata, &metadata); err != nil {
		return nil
	}
	return normalizeSourceSeqs(parseSourceSeqsRaw(metadata[sourceSeqsMetadataKey]))
}

func topSourceSeqAdjacentTurnSeeds(candidates []RecallCandidate, topN int) []sourceSeqAdjacentTurnSeed {
	if topN <= 0 {
		topN = sourceSeqAdjacentTurnTopN
	}
	seeds := make([]sourceSeqAdjacentTurnSeed, 0, min(topN, len(candidates)))
	seen := make(map[string]struct{}, topN)
	for _, candidate := range candidates {
		if candidate.Memory.ID == "" || candidate.Memory.SessionID == "" {
			continue
		}
		if _, ok := seen[candidate.Memory.ID]; ok {
			continue
		}
		sourceSeqs := sourceSeqsFromMemory(candidate.Memory)
		if len(sourceSeqs) == 0 {
			continue
		}
		seen[candidate.Memory.ID] = struct{}{}
		seeds = append(seeds, sourceSeqAdjacentTurnSeed{
			Candidate:  candidate,
			SourceSeqs: sourceSeqs,
		})
		if len(seeds) >= topN {
			break
		}
	}
	return seeds
}

func cloneStringSet(in map[string]struct{}) map[string]struct{} {
	out := make(map[string]struct{}, len(in))
	for key := range in {
		out[key] = struct{}{}
	}
	return out
}

func cloneIntSet(in map[int]struct{}) map[int]struct{} {
	out := make(map[int]struct{}, len(in))
	for key := range in {
		out[key] = struct{}{}
	}
	return out
}

func bestSourceSeqAdjacentCluster(seeds []sourceSeqAdjacentTurnSeed, maxSpan int) *sourceSeqAdjacentCluster {
	if maxSpan <= 0 {
		maxSpan = sourceSeqAdjacentTurnSpan
	}

	pointsBySession := make(map[string][]sourceSeqClusterPoint)
	for _, seed := range seeds {
		if seed.Candidate.Memory.ID == "" || seed.Candidate.Memory.SessionID == "" {
			continue
		}
		for _, seq := range seed.SourceSeqs {
			sessionID := seed.Candidate.Memory.SessionID
			pointsBySession[sessionID] = append(pointsBySession[sessionID], sourceSeqClusterPoint{
				SessionID: sessionID,
				Seq:       seq,
				SeedID:    seed.Candidate.Memory.ID,
				SeedRank:  seed.Candidate.RRFRank,
			})
		}
	}
	if len(pointsBySession) == 0 {
		return nil
	}

	type clusterScore struct {
		distinctSeeds int
		uniqueSeqs    int
		span          int
		bestRank      int
	}

	var best *sourceSeqAdjacentCluster
	bestScore := clusterScore{}

	for sessionID, points := range pointsBySession {
		sort.Slice(points, func(i, j int) bool {
			if points[i].Seq == points[j].Seq {
				if points[i].SeedRank == points[j].SeedRank {
					return points[i].SeedID < points[j].SeedID
				}
				return points[i].SeedRank < points[j].SeedRank
			}
			return points[i].Seq < points[j].Seq
		})

		for start := range points {
			seedIDs := make(map[string]struct{})
			seqSet := make(map[int]struct{})
			bestRank := 0
			for end := start; end < len(points); end++ {
				span := points[end].Seq - points[start].Seq
				if span > maxSpan {
					break
				}
				seedIDs[points[end].SeedID] = struct{}{}
				seqSet[points[end].Seq] = struct{}{}
				if bestRank == 0 || points[end].SeedRank < bestRank {
					bestRank = points[end].SeedRank
				}
				if len(seedIDs) < 2 {
					continue
				}

				score := clusterScore{
					distinctSeeds: len(seedIDs),
					uniqueSeqs:    len(seqSet),
					span:          span,
					bestRank:      bestRank,
				}
				if best != nil {
					if score.distinctSeeds < bestScore.distinctSeeds {
						continue
					}
					if score.distinctSeeds == bestScore.distinctSeeds && score.uniqueSeqs < bestScore.uniqueSeqs {
						continue
					}
					if score.distinctSeeds == bestScore.distinctSeeds && score.uniqueSeqs == bestScore.uniqueSeqs && score.span > bestScore.span {
						continue
					}
					if score.distinctSeeds == bestScore.distinctSeeds && score.uniqueSeqs == bestScore.uniqueSeqs && score.span == bestScore.span && score.bestRank > bestScore.bestRank {
						continue
					}
				}

				sourceSeqs := make([]int, 0, len(seqSet))
				for seq := range seqSet {
					sourceSeqs = append(sourceSeqs, seq)
				}
				sort.Ints(sourceSeqs)

				best = &sourceSeqAdjacentCluster{
					SourceSeqs:   sourceSeqs,
					SourceSeqSet: cloneIntSet(seqSet),
					SeedIDs:      cloneStringSet(seedIDs),
					SessionIDs:   []string{sessionID},
					MinSeq:       sourceSeqs[0],
					MaxSeq:       sourceSeqs[len(sourceSeqs)-1],
					Center:       float64(sourceSeqs[0]+sourceSeqs[len(sourceSeqs)-1]) / 2.0,
				}
				bestScore = score
			}
		}
	}

	return best
}

func sourceSeqLocalSessionFetchLimit(cluster *sourceSeqAdjacentCluster) int {
	if cluster == nil || len(cluster.SourceSeqs) == 0 {
		return 0
	}
	return cluster.MaxSeq + sourceSeqLocalSessionFetchSlack + 2
}

func (s *MemoryService) sourceSeqLocalSessionGapFillMemories(
	ctx context.Context,
	sourcePool RecallSourcePool,
	candidates []RecallCandidate,
) ([]domain.Memory, *sourceSeqAdjacentCluster, error) {
	if sourcePool != RecallSourceInsight || s.sessions == nil {
		return nil, nil, nil
	}

	seeds := topSourceSeqAdjacentTurnSeeds(candidates, sourceSeqAdjacentTurnTopN)
	if len(seeds) == 0 {
		return nil, nil, nil
	}

	cluster := bestSourceSeqAdjacentCluster(seeds, sourceSeqAdjacentTurnSpan)
	if cluster == nil || len(cluster.SessionIDs) == 0 || len(cluster.SourceSeqs) == 0 {
		return nil, nil, nil
	}

	fetchLimit := sourceSeqLocalSessionFetchLimit(cluster)
	if fetchLimit <= 0 {
		return nil, nil, nil
	}

	start := time.Now()
	sessions, err := s.sessions.ListBySessionIDs(ctx, cluster.SessionIDs, fetchLimit)
	if err != nil {
		if errors.Is(err, domain.ErrNotSupported) {
			return nil, nil, nil
		}
		return nil, nil, fmt.Errorf("source-seq local-session gap-fill lookup: %w", err)
	}
	adjacent := sourceSeqLocalSessionGapFillResults(cluster, sessions, sourceSeqAdjacentTurnCap)
	slog.InfoContext(ctx, "memory source-seq local-session gap fill",
		"source_pool", string(sourcePool),
		"seed_count", len(seeds),
		"session_count", len(cluster.SessionIDs),
		"cluster_span", cluster.MaxSeq-cluster.MinSeq,
		"cluster_seq_count", len(cluster.SourceSeqs),
		"fetch_limit", fetchLimit,
		"gap_fill_count", len(adjacent),
		"total_ms", time.Since(start).Milliseconds(),
	)
	return adjacent, cluster, nil
}

type reconstructedLocalSession struct {
	DateLabel string
	MaxSeq    int
	MinSeq    int
	Turns     []*domain.Session
}

func sourceSeqLocalSessionGapFillResults(cluster *sourceSeqAdjacentCluster, sessions []*domain.Session, maxTurns int) []domain.Memory {
	if cluster == nil || len(cluster.SourceSeqs) == 0 {
		return nil
	}
	if maxTurns <= 0 {
		maxTurns = sourceSeqAdjacentTurnCap
	}

	localSessions, seqToLocalSession, ok := reconstructLocalSessions(sessions)
	if !ok || len(localSessions) == 0 {
		return nil
	}

	touched := touchedLocalSessionIndexes(cluster.SourceSeqs, seqToLocalSession)
	if len(touched) != 1 {
		return nil
	}

	if !hasBoundaryAnchoredSourceSeqs(cluster.SourceSeqs, localSessions[touched[0]], seqToLocalSession) {
		return nil
	}
	targetIndexes := localSessionGapFillTargetIndexes(touched, len(localSessions))
	if len(targetIndexes) == 0 {
		return nil
	}

	bandMin, bandMax := touched[0], touched[len(touched)-1]
	type rankedGapFillTurn struct {
		boundaryDistance int
		memory           domain.Memory
		seq              int
		targetIndex      int
	}
	ranked := make([]rankedGapFillTurn, 0, maxTurns)
	seen := make(map[string]struct{})
	for _, targetIndex := range targetIndexes {
		target := localSessions[targetIndex]
		for _, turn := range target.Turns {
			if turn == nil || turn.ID == "" {
				continue
			}
			if _, ok := seen[turn.ID]; ok {
				continue
			}
			seen[turn.ID] = struct{}{}
			boundaryDistance := 0
			switch {
			case targetIndex < bandMin:
				boundaryDistance = cluster.MinSeq - turn.Seq
			case targetIndex > bandMax:
				boundaryDistance = turn.Seq - cluster.MaxSeq
			default:
				left := absInt(turn.Seq - cluster.MinSeq)
				right := absInt(turn.Seq - cluster.MaxSeq)
				boundaryDistance = left
				if right < boundaryDistance {
					boundaryDistance = right
				}
			}
			if boundaryDistance < 0 {
				boundaryDistance = 0
			}
			ranked = append(ranked, rankedGapFillTurn{
				boundaryDistance: boundaryDistance,
				memory:           sessionToMemory(turn),
				seq:              turn.Seq,
				targetIndex:      targetIndex,
			})
		}
	}
	if len(ranked) == 0 {
		return nil
	}

	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].boundaryDistance != ranked[j].boundaryDistance {
			return ranked[i].boundaryDistance < ranked[j].boundaryDistance
		}
		if ranked[i].targetIndex != ranked[j].targetIndex {
			return ranked[i].targetIndex < ranked[j].targetIndex
		}
		if ranked[i].seq != ranked[j].seq {
			return ranked[i].seq < ranked[j].seq
		}
		return ranked[i].memory.ID < ranked[j].memory.ID
	})
	if len(ranked) > maxTurns {
		ranked = ranked[:maxTurns]
	}

	results := make([]domain.Memory, 0, len(ranked))
	for _, candidate := range ranked {
		results = append(results, candidate.memory)
	}
	return results
}

func hasBoundaryAnchoredSourceSeqs(sourceSeqs []int, localSession reconstructedLocalSession, seqToLocalSession map[int]int) bool {
	if len(sourceSeqs) == 0 {
		return false
	}

	boundaryCount := 0
	seenSeqs := make(map[int]struct{}, len(sourceSeqs))
	for _, seq := range sourceSeqs {
		if _, ok := seenSeqs[seq]; ok {
			continue
		}
		seenSeqs[seq] = struct{}{}

		localIndex, ok := seqToLocalSession[seq]
		if !ok || localIndex != seqToLocalSession[localSession.MinSeq] {
			continue
		}

		leftDistance := absInt(seq - localSession.MinSeq)
		rightDistance := absInt(localSession.MaxSeq - seq)
		if leftDistance <= sourceSeqBoundaryTurnRadius || rightDistance <= sourceSeqBoundaryTurnRadius {
			boundaryCount++
			if boundaryCount >= sourceSeqBoundaryMinSeedCount {
				return true
			}
		}
	}
	return false
}

func reconstructLocalSessions(sessions []*domain.Session) ([]reconstructedLocalSession, map[int]int, bool) {
	if len(sessions) == 0 {
		return nil, nil, false
	}
	sortedSessions := append([]*domain.Session(nil), sessions...)
	sort.Slice(sortedSessions, func(i, j int) bool {
		if sortedSessions[i] == nil || sortedSessions[j] == nil {
			return sortedSessions[j] != nil
		}
		if sortedSessions[i].Seq != sortedSessions[j].Seq {
			return sortedSessions[i].Seq < sortedSessions[j].Seq
		}
		return sortedSessions[i].ID < sortedSessions[j].ID
	})

	localSessions := make([]reconstructedLocalSession, 0, 8)
	seqToLocalSession := make(map[int]int, len(sortedSessions))
	for _, turn := range sortedSessions {
		if turn == nil {
			continue
		}
		dateLabel, ok := sessionDateLabel(turn.Content)
		if !ok {
			return nil, nil, false
		}
		lastIndex := len(localSessions) - 1
		if lastIndex < 0 || localSessions[lastIndex].DateLabel != dateLabel {
			localSessions = append(localSessions, reconstructedLocalSession{
				DateLabel: dateLabel,
				MinSeq:    turn.Seq,
				MaxSeq:    turn.Seq,
				Turns:     []*domain.Session{turn},
			})
			seqToLocalSession[turn.Seq] = len(localSessions) - 1
			continue
		}
		localSessions[lastIndex].Turns = append(localSessions[lastIndex].Turns, turn)
		localSessions[lastIndex].MaxSeq = turn.Seq
		seqToLocalSession[turn.Seq] = lastIndex
	}
	return localSessions, seqToLocalSession, len(localSessions) > 0
}

func sessionDateLabel(content string) (string, bool) {
	if !strings.HasPrefix(content, "[date:") {
		return "", false
	}
	end := strings.Index(content, "]")
	if end <= len("[date:") {
		return "", false
	}
	return content[len("[date:"):end], true
}

func touchedLocalSessionIndexes(sourceSeqs []int, seqToLocalSession map[int]int) []int {
	if len(sourceSeqs) == 0 || len(seqToLocalSession) == 0 {
		return nil
	}
	seen := make(map[int]struct{}, len(sourceSeqs))
	indexes := make([]int, 0, len(sourceSeqs))
	for _, seq := range sourceSeqs {
		localIndex, ok := seqToLocalSession[seq]
		if !ok {
			continue
		}
		if _, ok := seen[localIndex]; ok {
			continue
		}
		seen[localIndex] = struct{}{}
		indexes = append(indexes, localIndex)
	}
	sort.Ints(indexes)
	return indexes
}

func localSessionGapFillTargetIndexes(touched []int, total int) []int {
	if len(touched) == 0 || total <= 0 {
		return nil
	}
	minTouched := touched[0]
	maxTouched := touched[len(touched)-1]
	if maxTouched-minTouched > 1 {
		return nil
	}
	touchedSet := make(map[int]struct{}, len(touched))
	for _, idx := range touched {
		touchedSet[idx] = struct{}{}
	}
	targets := make([]int, 0, 2)
	for _, idx := range []int{minTouched - 1, maxTouched + 1} {
		if idx < 0 || idx >= total {
			continue
		}
		if _, ok := touchedSet[idx]; ok {
			continue
		}
		targets = append(targets, idx)
	}
	return targets
}

func absFloat(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func pruneSourceSeqOverlapCandidates(candidates []RecallCandidate, cluster *sourceSeqAdjacentCluster) []RecallCandidate {
	if cluster == nil || len(candidates) == 0 {
		return candidates
	}
	windowMin := cluster.MinSeq - sourceSeqAdjacentTurnRadius
	windowMax := cluster.MaxSeq + sourceSeqAdjacentTurnRadius
	keptOverlapSummary := false
	out := make([]RecallCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.Memory.MemoryType != domain.TypeInsight {
			out = append(out, candidate)
			continue
		}
		sourceSeqs := sourceSeqsFromMemory(candidate.Memory)
		if len(sourceSeqs) == 0 || !sourceSeqWindowOverlap(sourceSeqs, windowMin, windowMax) {
			out = append(out, candidate)
			continue
		}
		if keptOverlapSummary {
			continue
		}
		out = append(out, candidate)
		keptOverlapSummary = true
	}
	return out
}

func sourceSeqWindowOverlap(sourceSeqs []int, windowMin, windowMax int) bool {
	for _, seq := range sourceSeqs {
		if seq >= windowMin && seq <= windowMax {
			return true
		}
	}
	return false
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

	writeStart := time.Now()
	err = s.memories.UpdateOptimistic(ctx, current, 0)
	metrics.MemoryWriteDuration.WithLabelValues("update", metricStatus(err)).Observe(time.Since(writeStart).Seconds())
	if err != nil {
		return nil, err
	}

	updated, err := s.memories.GetByID(ctx, id)
	if err != nil {
		current.Version++
		return current, nil
	}
	return updated, nil
}

func (s *MemoryService) Delete(ctx context.Context, id, agentName string) error {
	return s.memories.SoftDelete(ctx, id, agentName)
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

	return s.memories.BulkSoftDelete(ctx, unique, agentName)
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

		memories = append(memories, &domain.Memory{
			ID:         uuid.New().String(),
			Content:    item.Content,
			Source:     agentName,
			Tags:       item.Tags,
			Metadata:   item.Metadata,
			Embedding:  embedding,
			MemoryType: domain.TypePinned,
			State:      domain.StateActive,
			Version:    1,
			UpdatedBy:  agentName,
			CreatedAt:  now,
			UpdatedAt:  now,
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
