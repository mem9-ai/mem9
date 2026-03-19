package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

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
			i, msg.Role, msg.Content,
		)
		sessions = append(sessions, sess)
	}
	if err := s.sessions.BulkCreate(ctx, sessions); err != nil {
		return fmt.Errorf("session bulk create: %w", err)
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

func (s *SessionService) ftsSearch(ctx context.Context, f domain.MemoryFilter, limit, fetchLimit int) ([]domain.Memory, error) {
	results, err := s.sessions.FTSSearch(ctx, f.Query, f, fetchLimit)
	if err != nil {
		return nil, fmt.Errorf("session fts search: %w", err)
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
