package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/embed"
	"github.com/qiffang/mnemos/server/internal/repository"
)

const (
	defaultSessionFetchMultiplier = 4
	DefaultSessionLimit           = 10
)

type SessionService struct {
	sessions  repository.SessionRepo
	embedder  *embed.Embedder
	autoModel string
}

func NewSessionService(sessions repository.SessionRepo, embedder *embed.Embedder, autoModel string) *SessionService {
	return &SessionService{
		sessions:  sessions,
		embedder:  embedder,
		autoModel: autoModel,
	}
}

func (s *SessionService) ListBySessionIDs(ctx context.Context, sessionIDs []string, limitPerSession int) ([]*domain.Session, error) {
	return s.sessions.ListBySessionIDs(ctx, sessionIDs, limitPerSession)
}

func (s *SessionService) PatchTags(ctx context.Context, sessionID, contentHash string, tags []string) error {
	return s.sessions.PatchTags(ctx, sessionID, contentHash, tags)
}

func (s *SessionService) BulkCreate(ctx context.Context, agentName string, req IngestRequest) error {
	sessions := make([]*domain.Session, 0, len(req.Messages))
	explicitSeqs := make(map[int]struct{}, len(req.Messages))
	maxExplicitSeq := -1
	for _, msg := range req.Messages {
		if msg.Seq != nil {
			if *msg.Seq < 0 {
				return &domain.ValidationError{Field: "messages.seq", Message: "must be non-negative"}
			}
			if _, exists := explicitSeqs[*msg.Seq]; exists {
				return &domain.ValidationError{Field: "messages.seq", Message: "duplicate explicit seq in request"}
			}
			explicitSeqs[*msg.Seq] = struct{}{}
			if *msg.Seq > maxExplicitSeq {
				maxExplicitSeq = *msg.Seq
			}
		}
	}
	for i, msg := range req.Messages {
		seq := i
		if msg.Seq != nil {
			seq = *msg.Seq
		} else {
			nextSeq, err := s.sessions.NextSeq(ctx, req.SessionID)
			if err != nil {
				return fmt.Errorf("session next seq: %w", err)
			}
			for attempts := 0; ; attempts++ {
				if _, exists := explicitSeqs[nextSeq]; !exists {
					break
				}
				if attempts >= 100 {
					if maxExplicitSeq >= 0 {
						nextSeq = maxExplicitSeq + 1
						break
					}
					return fmt.Errorf("session next seq: unable to find non-conflicting seq")
				}
				nextSeq, err = s.sessions.NextSeq(ctx, req.SessionID)
				if err != nil {
					return fmt.Errorf("session next seq: %w", err)
				}
			}
			seq = nextSeq
		}
		sess := newSessionFromIngestMessage(
			req.SessionID, req.AgentID, agentName,
			seq, msg.Role, msg.Content,
		)
		sessions = append(sessions, sess)
	}
	if err := s.sessions.BulkCreate(ctx, sessions); err != nil {
		return fmt.Errorf("session bulk create: %w", err)
	}
	return nil
}

func (s *SessionService) CreateRawTurn(ctx context.Context, sessionID, agentID, source string, seq int, role, content string) error {
	if seq < 0 {
		nextSeq, err := s.sessions.NextSeq(ctx, sessionID)
		if err != nil {
			return fmt.Errorf("session next seq: %w", err)
		}
		seq = nextSeq
	}
	sess := newSessionFromIngestMessage(sessionID, agentID, source, seq, role, content)
	if err := s.sessions.BulkCreate(ctx, []*domain.Session{sess}); err != nil {
		return fmt.Errorf("session raw create: %w", err)
	}
	return nil
}

func (s *SessionService) Search(ctx context.Context, f domain.MemoryFilter) ([]domain.Memory, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = DefaultSessionLimit
	}
	fetchLimit := limit * defaultSessionFetchMultiplier

	sf := f
	sf.Offset = 0

	var results []domain.Memory
	var err error

	if s.autoModel != "" {
		results, err = s.autoHybridSearch(ctx, sf, limit, fetchLimit)
	} else if s.embedder != nil {
		results, err = s.hybridSearch(ctx, sf, limit, fetchLimit)
	} else if s.sessions.FTSAvailable() {
		results, err = s.ftsSearch(ctx, sf, limit, fetchLimit)
	} else {
		results, err = s.keywordSearch(ctx, sf, limit, fetchLimit)
	}
	if err != nil {
		return nil, err
	}
	if f.SessionID != "" {
		return dedupBySessionTurn(results), nil
	}
	// All search paths return results sorted by score descending; dedupByContent
	// therefore retains the highest-scored occurrence for each unique content string.
	return dedupByContent(results), nil
}

func (s *SessionService) SearchInSessionSet(ctx context.Context, f domain.MemoryFilter, sessionIDs []string) ([]domain.Memory, error) {
	if len(sessionIDs) == 0 {
		return nil, nil
	}

	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = DefaultSessionLimit
	}
	fetchLimit := limit * defaultSessionFetchMultiplier

	sf := f
	sf.Offset = 0

	var results []domain.Memory
	var err error

	if s.autoModel != "" {
		results, err = s.autoHybridSearchInSessionSet(ctx, sf, sessionIDs, limit, fetchLimit)
	} else if s.embedder != nil {
		results, err = s.hybridSearchInSessionSet(ctx, sf, sessionIDs, limit, fetchLimit)
	} else if s.sessions.FTSAvailable() {
		results, err = s.ftsSearchInSessionSet(ctx, sf, sessionIDs, limit, fetchLimit)
	} else {
		results, err = s.keywordSearchInSessionSet(ctx, sf, sessionIDs, limit, fetchLimit)
	}
	if err != nil {
		return nil, err
	}
	return dedupBySessionTurn(results), nil
}

func (s *SessionService) ListNeighbors(ctx context.Context, sessionID string, seq int, before int, after int) ([]domain.Memory, error) {
	results, err := s.sessions.ListNeighbors(ctx, sessionID, seq, before, after)
	if err != nil {
		return nil, fmt.Errorf("session list neighbors: %w", err)
	}
	return dedupBySessionTurn(results), nil
}

func (s *SessionService) autoHybridSearch(ctx context.Context, f domain.MemoryFilter, limit, fetchLimit int) ([]domain.Memory, error) {
	vecResults, err := s.sessions.AutoVectorSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session auto vector search: %w", err)
	}
	vecResults = applyMinScore(vecResults, f.MinScore)

	kwResults, err := s.ftsOrKeyword(ctx, f, fetchLimit)
	if err != nil {
		return nil, err
	}

	slog.Info("session auto hybrid search", "query_len", len(f.Query), "vec", len(vecResults), "kw", len(kwResults))

	scores := rrfMerge(kwResults, vecResults)
	mems := collectMems(kwResults, vecResults)
	if f.EnableSecondHop {
		maxVecScore := 0.0
		for _, m := range vecResults {
			if m.Score != nil && *m.Score > maxVecScore {
				maxVecScore = *m.Score
			}
		}
		if maxVecScore >= secondHopGateScore {
			secondHopMems := s.secondHopAutoSearch(ctx, mems, scores, f, limit)
			for rank, m := range secondHopMems {
				scores[m.ID] += secondHopWeight / (rrfK + float64(rank+1))
				if _, exists := mems[m.ID]; !exists {
					mems[m.ID] = m
				}
			}
		}
	}
	merged := sortByScore(mems, scores)
	page, _ := paginateResults(merged, f.Offset, limit)
	return populateRelativeAge(setScores(page, scores)), nil
}

func (s *SessionService) autoHybridSearchInSessionSet(ctx context.Context, f domain.MemoryFilter, sessionIDs []string, limit, fetchLimit int) ([]domain.Memory, error) {
	vecResults, err := s.sessions.AutoVectorSearchInSessionSet(ctx, f.Query, f, sessionIDs, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session routed auto vector search: %w", err)
	}
	vecResults = applyMinScore(vecResults, f.MinScore)

	kwResults, err := s.ftsOrKeywordInSessionSet(ctx, f, sessionIDs, fetchLimit)
	if err != nil {
		return nil, err
	}

	slog.Info("session routed auto hybrid search", "query_len", len(f.Query), "sessions", len(sessionIDs), "vec", len(vecResults), "kw", len(kwResults))

	scores := rrfMerge(kwResults, vecResults)
	mems := collectMems(kwResults, vecResults)
	if f.EnableSecondHop {
		maxVecScore := 0.0
		for _, m := range vecResults {
			if m.Score != nil && *m.Score > maxVecScore {
				maxVecScore = *m.Score
			}
		}
		if maxVecScore >= secondHopGateScore {
			secondHopMems := s.secondHopAutoSearchInSessionSet(ctx, mems, scores, f, sessionIDs, limit)
			for rank, m := range secondHopMems {
				scores[m.ID] += secondHopWeight / (rrfK + float64(rank+1))
				if _, exists := mems[m.ID]; !exists {
					mems[m.ID] = m
				}
			}
		}
	}
	merged := sortByScore(mems, scores)
	page, _ := paginateResults(merged, f.Offset, limit)
	return populateRelativeAge(setScores(page, scores)), nil
}

func (s *SessionService) secondHopAutoSearch(
	ctx context.Context,
	firstHopMems map[string]domain.Memory,
	firstHopScores map[string]float64,
	filter domain.MemoryFilter,
	limit int,
) []domain.Memory {
	sorted := sortByScore(firstHopMems, firstHopScores)
	topN := secondHopTopN
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

	type hopResult struct {
		results []domain.Memory
		err     error
	}
	ch := make(chan hopResult, topN)
	for _, seed := range seeds {
		go func(content string) {
			enriched := strings.TrimSpace(filter.Query + " " + content)
			results, err := s.sessions.AutoVectorSearch(ctx, enriched, filter, limit)
			ch <- hopResult{results: results, err: err}
		}(seed.Content)
	}

	bestByID := make(map[string]domain.Memory)
	bestScore := make(map[string]float64)
	for i := 0; i < topN; i++ {
		hr := <-ch
		if hr.err != nil {
			slog.Warn("session second-hop search failed", "err", hr.err)
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

	result := make([]domain.Memory, 0, len(bestByID))
	for _, m := range bestByID {
		result = append(result, m)
	}
	sort.Slice(result, func(i, j int) bool {
		return bestScore[result[i].ID] > bestScore[result[j].ID]
	})
	return result
}

func (s *SessionService) secondHopAutoSearchInSessionSet(
	ctx context.Context,
	firstHopMems map[string]domain.Memory,
	firstHopScores map[string]float64,
	filter domain.MemoryFilter,
	sessionIDs []string,
	limit int,
) []domain.Memory {
	sorted := sortByScore(firstHopMems, firstHopScores)
	topN := secondHopTopN
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

	type hopResult struct {
		results []domain.Memory
		err     error
	}
	ch := make(chan hopResult, topN)
	for _, seed := range seeds {
		go func(content string) {
			enriched := strings.TrimSpace(filter.Query + " " + content)
			results, err := s.sessions.AutoVectorSearchInSessionSet(ctx, enriched, filter, sessionIDs, limit)
			ch <- hopResult{results: results, err: err}
		}(seed.Content)
	}

	bestByID := make(map[string]domain.Memory)
	bestScore := make(map[string]float64)
	for i := 0; i < topN; i++ {
		hr := <-ch
		if hr.err != nil {
			slog.Warn("session routed second-hop search failed", "err", hr.err)
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

	result := make([]domain.Memory, 0, len(bestByID))
	for _, m := range bestByID {
		result = append(result, m)
	}
	sort.Slice(result, func(i, j int) bool {
		return bestScore[result[i].ID] > bestScore[result[j].ID]
	})
	return result
}

func (s *SessionService) hybridSearch(ctx context.Context, f domain.MemoryFilter, limit, fetchLimit int) ([]domain.Memory, error) {
	queryVec, err := s.embedder.Embed(ctx, f.Query)
	if err != nil {
		return nil, fmt.Errorf("session embed query: %w", err)
	}

	vecResults, err := s.sessions.VectorSearch(ctx, queryVec, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session vector search: %w", err)
	}
	vecResults = applyMinScore(vecResults, f.MinScore)

	kwResults, err := s.ftsOrKeyword(ctx, f, fetchLimit)
	if err != nil {
		return nil, err
	}

	slog.Info("session hybrid search", "query_len", len(f.Query), "vec", len(vecResults), "kw", len(kwResults))

	scores := rrfMerge(kwResults, vecResults)
	mems := collectMems(kwResults, vecResults)
	merged := sortByScore(mems, scores)
	page, _ := paginateResults(merged, f.Offset, limit)
	return populateRelativeAge(setScores(page, scores)), nil
}

func (s *SessionService) hybridSearchInSessionSet(ctx context.Context, f domain.MemoryFilter, sessionIDs []string, limit, fetchLimit int) ([]domain.Memory, error) {
	queryVec, err := s.embedder.Embed(ctx, f.Query)
	if err != nil {
		return nil, fmt.Errorf("session routed embed query: %w", err)
	}

	vecResults, err := s.sessions.VectorSearchInSessionSet(ctx, queryVec, f, sessionIDs, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session routed vector search: %w", err)
	}
	vecResults = applyMinScore(vecResults, f.MinScore)

	kwResults, err := s.ftsOrKeywordInSessionSet(ctx, f, sessionIDs, fetchLimit)
	if err != nil {
		return nil, err
	}

	slog.Info("session routed hybrid search", "query_len", len(f.Query), "sessions", len(sessionIDs), "vec", len(vecResults), "kw", len(kwResults))

	scores := rrfMerge(kwResults, vecResults)
	mems := collectMems(kwResults, vecResults)
	merged := sortByScore(mems, scores)
	page, _ := paginateResults(merged, f.Offset, limit)
	return populateRelativeAge(setScores(page, scores)), nil
}

func (s *SessionService) ftsSearch(ctx context.Context, f domain.MemoryFilter, limit, fetchLimit int) ([]domain.Memory, error) {
	results, err := s.sessions.FTSSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session fts search: %w", err)
	}
	page, _ := paginateResults(results, f.Offset, limit)
	return populateRelativeAge(page), nil
}

func (s *SessionService) ftsSearchInSessionSet(ctx context.Context, f domain.MemoryFilter, sessionIDs []string, limit, fetchLimit int) ([]domain.Memory, error) {
	results, err := s.sessions.FTSSearchInSessionSet(ctx, f.Query, f, sessionIDs, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session routed fts search: %w", err)
	}
	page, _ := paginateResults(results, f.Offset, limit)
	return populateRelativeAge(page), nil
}

func (s *SessionService) keywordSearch(ctx context.Context, f domain.MemoryFilter, limit, fetchLimit int) ([]domain.Memory, error) {
	results, err := s.sessions.KeywordSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session keyword search: %w", err)
	}
	page, _ := paginateResults(results, f.Offset, limit)
	return populateRelativeAge(page), nil
}

func (s *SessionService) keywordSearchInSessionSet(ctx context.Context, f domain.MemoryFilter, sessionIDs []string, limit, fetchLimit int) ([]domain.Memory, error) {
	results, err := s.sessions.KeywordSearchInSessionSet(ctx, f.Query, f, sessionIDs, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session routed keyword search: %w", err)
	}
	page, _ := paginateResults(results, f.Offset, limit)
	return populateRelativeAge(page), nil
}

func (s *SessionService) ftsOrKeyword(ctx context.Context, f domain.MemoryFilter, fetchLimit int) ([]domain.Memory, error) {
	if s.sessions.FTSAvailable() {
		r, err := s.sessions.FTSSearch(ctx, f.Query, f, fetchLimit)
		if err != nil {
			return nil, fmt.Errorf("session fts search: %w", err)
		}
		return r, nil
	}
	r, err := s.sessions.KeywordSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session keyword search: %w", err)
	}
	return r, nil
}

func (s *SessionService) ftsOrKeywordInSessionSet(ctx context.Context, f domain.MemoryFilter, sessionIDs []string, fetchLimit int) ([]domain.Memory, error) {
	if s.sessions.FTSAvailable() {
		r, err := s.sessions.FTSSearchInSessionSet(ctx, f.Query, f, sessionIDs, fetchLimit)
		if err != nil {
			return nil, fmt.Errorf("session routed fts search: %w", err)
		}
		return r, nil
	}
	r, err := s.sessions.KeywordSearchInSessionSet(ctx, f.Query, f, sessionIDs, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session routed keyword search: %w", err)
	}
	return r, nil
}

func applyMinScore(results []domain.Memory, minScore float64) []domain.Memory {
	if minScore == 0 {
		minScore = defaultMinScore
	}
	if minScore <= 0 {
		return results
	}
	filtered := results[:0]
	for _, m := range results {
		if m.Score != nil && *m.Score >= minScore {
			filtered = append(filtered, m)
		}
	}
	return filtered
}

func dedupByContent(mems []domain.Memory) []domain.Memory {
	seen := make(map[string]struct{}, len(mems))
	out := make([]domain.Memory, 0, len(mems))
	for _, m := range mems {
		if _, ok := seen[m.Content]; ok {
			continue
		}
		seen[m.Content] = struct{}{}
		out = append(out, m)
	}
	return out
}

func dedupBySessionTurn(mems []domain.Memory) []domain.Memory {
	seen := make(map[string]struct{}, len(mems))
	out := make([]domain.Memory, 0, len(mems))
	for _, m := range mems {
		key := m.ID
		if key == "" {
			key = m.SessionID + "\x00" + string(m.Metadata)
			if key == "\x00" {
				key = m.Content
			}
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, m)
	}
	return out
}

// sessionContentHash returns SHA-256(sessionID+role+content) as a hex string.
// Two sends of the same message content within the same session produce the same
// hash, so INSERT IGNORE deduplicates them. This is intentional: the plugin sends
// cumulative overlapping slices on every agent turn; verbatim logging would store
// each message N times. Identical messages in different sessions or roles are always
// distinct (session_id and role are part of the input).
//
// TODO(content-hash-migration): migrate to SHA-256(role+content) — dropping sessionID from the hash keeps
// the same write-time dedup guarantee (the unique index is (session_id, content_hash),
// so cross-session collisions are still impossible) while making content_hash
// comparable across sessions. That would let the search path dedup by content_hash
// instead of by the raw content string.
func sessionContentHash(sessionID, role, content string) string {
	h := sha256.Sum256([]byte(sessionID + role + content))
	return hex.EncodeToString(h[:])
}

// SessionContentHash is the exported version for use by the handler fan-out goroutine.
func SessionContentHash(sessionID, role, content string) string {
	return sessionContentHash(sessionID, role, content)
}

func newSessionFromIngestMessage(sessionID, agentID, source string, seq int, role, content string) *domain.Session {
	return &domain.Session{
		ID:          uuid.New().String(),
		SessionID:   sessionID,
		AgentID:     agentID,
		Source:      source,
		Seq:         seq,
		Role:        role,
		Content:     content,
		ContentType: detectSessionContentType(content),
		ContentHash: sessionContentHash(sessionID, role, content),
		Tags:        []string{},
		State:       domain.StateActive,
	}
}

func detectSessionContentType(content string) string {
	trimmed := strings.TrimSpace(content)
	if len(trimmed) > 0 && (trimmed[0] == '{' || trimmed[0] == '[') && json.Valid([]byte(trimmed)) {
		return "json"
	}
	return "text"
}
