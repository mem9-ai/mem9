package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/repository"
)

const recallWriteTimeout = 5 * time.Second

type RecallService struct {
	repo repository.RecallEventRepo
	llm  *llm.Client
}

func NewRecallService(repo repository.RecallEventRepo, llmClient *llm.Client) *RecallService {
	return &RecallService{repo: repo, llm: llmClient}
}

func (s *RecallService) Record(agentID, sessionID, searchID, requestID, query string, results []domain.Memory) {
	ctx, cancel := context.WithTimeout(context.Background(), recallWriteTimeout)
	defer cancel()

	events := buildRecallEvents(searchID, query, agentID, sessionID, results)
	if err := s.repo.BulkRecord(ctx, events); err != nil {
		slog.Warn("recall_events write failed — event dropped",
			"search_id", searchID,
			"request_id", requestID,
			"agent_id", agentID,
			"event_count", len(events),
			"err", err)
	}
}

func (s *RecallService) Interests(ctx context.Context, f domain.InterestFilter) (*domain.InterestProfile, error) {
	profile, err := s.repo.Aggregate(ctx, f)
	if err != nil {
		return nil, err
	}

	if f.IncludeSummary && s.llm != nil && len(profile.TagProfile) > 0 {
		if summary, err := s.summarize(ctx, profile, f.From, f.To); err != nil {
			slog.Warn("recall_events summarize failed", "err", err)
		} else {
			profile.TopicSummary = summary
		}
	}
	return profile, nil
}

func (s *RecallService) summarize(ctx context.Context, profile *domain.InterestProfile, from, to time.Time) (string, error) {
	days := int(to.Sub(from).Hours() / 24)
	if days < 1 {
		days = 1
	}

	var sb strings.Builder
	for i, ts := range profile.TagProfile {
		if i >= 20 {
			break
		}
		fmt.Fprintf(&sb, "%s (%d recalls)", ts.Tag, ts.RecallCount)
		if i < len(profile.TagProfile)-1 && i < 19 {
			sb.WriteString(", ")
		}
	}

	user := fmt.Sprintf(
		"Given the following recall analytics for an AI agent over the past %d days, "+
			"write a 1-2 sentence summary of what the agent was primarily working on.\n\n"+
			"Tags (by frequency): %s",
		days, sb.String(),
	)

	return s.llm.Complete(ctx, "You are a concise technical analyst.", user)
}

func buildRecallEvents(searchID, query, agentID, sessionID string, results []domain.Memory) []*domain.RecallEvent {
	h := sha256.Sum256([]byte(query))
	queryHash := hex.EncodeToString(h[:])

	events := make([]*domain.RecallEvent, 0, len(results))
	for _, m := range results {
		tags := m.Tags
		if tags == nil {
			tags = []string{}
		}
		events = append(events, &domain.RecallEvent{
			ID:         uuid.NewString(),
			SearchID:   searchID,
			Query:      query,
			QueryHash:  queryHash,
			AgentID:    agentID,
			SessionID:  sessionID,
			MemoryID:   m.ID,
			MemoryType: string(m.MemoryType),
			Tags:       tags,
			Score:      m.Score,
		})
	}
	return events
}
