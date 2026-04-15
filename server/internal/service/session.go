package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/embed"
	"github.com/qiffang/mnemos/server/internal/repository"
)

const (
	defaultSessionFetchMultiplier = 3
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
	for i, msg := range req.Messages {
		sess := newSessionFromIngestMessage(
			req.SessionID, req.AgentID, agentName,
			i, msg,
		)
		sessions = append(sessions, sess)
	}
	if err := s.sessions.BulkCreate(ctx, sessions); err != nil {
		return fmt.Errorf("session bulk create: %w", err)
	}
	return nil
}

func (s *SessionService) CreateRawTurn(ctx context.Context, sessionID, agentID, source string, seq int, role, content string) error {
	sess := newSession(sessionID, agentID, source, seq, role, content, &seq)
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
	// All search paths return results sorted by score descending; dedupByContent
	// therefore retains the highest-scored occurrence for each unique content string.
	return dedupByContent(results), nil
}

func (s *SessionService) SearchCandidates(
	ctx context.Context,
	f domain.MemoryFilter,
	sourcePool RecallSourcePool,
	opts RecallCandidateOptions,
) ([]RecallCandidate, error) {
	limit := normalizeRecallLimit(f.Limit, DefaultSessionLimit)
	fetchLimit := limit * normalizeRecallFetchMultiplier(opts.FetchMultiplier, defaultSessionFetchMultiplier)

	sf := f
	sf.Offset = 0

	var candidates []RecallCandidate
	var err error

	if s.autoModel != "" {
		candidates, err = s.autoHybridCandidates(ctx, sf, sourcePool, limit, fetchLimit)
	} else if s.embedder != nil {
		candidates, err = s.hybridCandidates(ctx, sf, sourcePool, limit, fetchLimit)
	} else if s.sessions.FTSAvailable() {
		candidates, err = s.ftsCandidates(ctx, sf, sourcePool, fetchLimit)
	} else {
		candidates, err = s.keywordCandidates(ctx, sf, sourcePool, fetchLimit)
	}
	if err != nil {
		return nil, err
	}
	return dedupRecallCandidatesByContent(candidates), nil
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
	merged := sortByScore(mems, scores)
	page, _ := paginateResults(merged, f.Offset, limit)
	return populateRelativeAge(setScores(page, scores)), nil
}

func (s *SessionService) autoHybridCandidates(
	ctx context.Context,
	f domain.MemoryFilter,
	sourcePool RecallSourcePool,
	_,
	fetchLimit int,
) ([]RecallCandidate, error) {
	start := time.Now()
	vectorStart := time.Now()
	vecResults, err := s.sessions.AutoVectorSearch(ctx, f.Query, f, fetchLimit)
	vectorDuration := time.Since(vectorStart)
	if err != nil {
		return nil, fmt.Errorf("session auto vector search: %w", err)
	}
	vecResults = applyMinScore(vecResults, f.MinScore)

	keywordStart := time.Now()
	kwResults, err := s.ftsOrKeyword(ctx, f, fetchLimit)
	keywordDuration := time.Since(keywordStart)
	if err != nil {
		return nil, err
	}

	slog.InfoContext(ctx, "session recall candidate search",
		"query_len", len(f.Query),
		"source_pool", string(sourcePool),
		"fetch_limit", fetchLimit,
		"vector_ms", vectorDuration.Milliseconds(),
		"keyword_ms", keywordDuration.Milliseconds(),
		"total_ms", time.Since(start).Milliseconds(),
	)

	return mergeRecallCandidates(sourcePool, kwResults, vecResults, nil), nil
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

func (s *SessionService) hybridCandidates(
	ctx context.Context,
	f domain.MemoryFilter,
	sourcePool RecallSourcePool,
	_,
	fetchLimit int,
) ([]RecallCandidate, error) {
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

	return mergeRecallCandidates(sourcePool, kwResults, vecResults, nil), nil
}

func (s *SessionService) ftsSearch(ctx context.Context, f domain.MemoryFilter, limit, fetchLimit int) ([]domain.Memory, error) {
	results, err := s.sessions.FTSSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session fts search: %w", err)
	}
	page, _ := paginateResults(results, f.Offset, limit)
	return populateRelativeAge(page), nil
}

func (s *SessionService) ftsCandidates(ctx context.Context, f domain.MemoryFilter, sourcePool RecallSourcePool, fetchLimit int) ([]RecallCandidate, error) {
	results, err := s.sessions.FTSSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session fts search: %w", err)
	}
	return mergeRecallCandidates(sourcePool, results, nil, nil), nil
}

func (s *SessionService) keywordSearch(ctx context.Context, f domain.MemoryFilter, limit, fetchLimit int) ([]domain.Memory, error) {
	results, err := s.sessions.KeywordSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session keyword search: %w", err)
	}
	page, _ := paginateResults(results, f.Offset, limit)
	return populateRelativeAge(page), nil
}

func (s *SessionService) keywordCandidates(ctx context.Context, f domain.MemoryFilter, sourcePool RecallSourcePool, fetchLimit int) ([]RecallCandidate, error) {
	results, err := s.sessions.KeywordSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session keyword search: %w", err)
	}
	return mergeRecallCandidates(sourcePool, results, nil, nil), nil
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

// sessionContentHash returns a stable dedup hash as a hex string.
// Without an explicit seq, it preserves the legacy SHA-256(sessionID+role+content)
// behavior so cumulative overlapping plugin slices still deduplicate.
// When seq is provided, it is folded into the hash to preserve distinct turn-level
// provenance for otherwise identical message bodies within the same session.
//
// TODO(content-hash-migration): migrate to SHA-256(role+content) — dropping sessionID from the hash keeps
// the same write-time dedup guarantee (the unique index is (session_id, content_hash),
// so cross-session collisions are still impossible) while making content_hash
// comparable across sessions. That would let the search path dedup by content_hash
// instead of by the raw content string.
func sessionContentHash(sessionID, role, content string, seq *int) string {
	input := sessionID + role + content
	if seq != nil {
		input = fmt.Sprintf("%s\x00%s\x00%d\x00%s", sessionID, role, *seq, content)
	}
	h := sha256.Sum256([]byte(input))
	return hex.EncodeToString(h[:])
}

// SessionContentHash is the exported version for use by the handler fan-out goroutine.
func SessionContentHash(sessionID, role, content string, seq *int) string {
	return sessionContentHash(sessionID, role, content, seq)
}

func effectiveMessageSeq(msg IngestMessage, fallback int) int {
	if msg.Seq != nil {
		return *msg.Seq
	}
	return fallback
}

func newSessionFromIngestMessage(sessionID, agentID, source string, fallbackSeq int, msg IngestMessage) *domain.Session {
	seq := effectiveMessageSeq(msg, fallbackSeq)
	return newSession(sessionID, agentID, source, seq, msg.Role, msg.Content, msg.Seq)
}

func newSession(sessionID, agentID, source string, seq int, role, content string, explicitSeq *int) *domain.Session {
	return &domain.Session{
		ID:          uuid.New().String(),
		SessionID:   sessionID,
		AgentID:     agentID,
		Source:      source,
		Seq:         seq,
		Role:        role,
		Content:     content,
		ContentType: detectSessionContentType(content),
		ContentHash: sessionContentHash(sessionID, role, content, explicitSeq),
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
