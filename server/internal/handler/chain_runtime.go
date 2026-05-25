package handler

import (
	"context"
	"errors"
	"log/slog"
	"sort"
	"strings"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

func (s *Server) firstChainNodeAuth(auth *domain.AuthInfo) (*domain.AuthInfo, error) {
	if auth == nil || auth.Chain == nil || len(auth.Chain.Nodes) == 0 {
		return nil, &domain.ValidationError{Message: "Space Chain has no nodes."}
	}
	return chainNodeAuth(auth, auth.Chain.Nodes[0]), nil
}

func chainNodeAuth(auth *domain.AuthInfo, node domain.ChainAuthNode) *domain.AuthInfo {
	apiKeySubject := auth.APIKeySubject
	if apiKeySubject == "" && auth.Chain != nil {
		apiKeySubject = auth.Chain.APIKey
	}
	return &domain.AuthInfo{
		AgentName:     auth.AgentName,
		TenantID:      node.TenantID,
		TenantDB:      node.TenantDB,
		ClusterID:     node.ClusterID,
		APIKeySubject: apiKeySubject,
	}
}

func chainSource(auth *domain.AuthInfo, node domain.ChainAuthNode) *domain.ChainSource {
	return &domain.ChainSource{
		ChainID:         auth.Chain.ChainID,
		NodePosition:    node.Position,
		TenantID:        node.TenantID,
		ExternalSpaceID: node.ExternalSpaceID,
	}
}

func applyChainSource(memories []domain.Memory, source *domain.ChainSource) {
	for i := range memories {
		memories[i].ChainSource = source
	}
}

type chainMemoryTarget struct {
	nodeAuth *domain.AuthInfo
	svc      resolvedSvc
	source   *domain.ChainSource
}

type chainDeleteGroup struct {
	target chainMemoryTarget
	ids    []string
}

func (s *Server) findChainMemoryTarget(ctx context.Context, auth *domain.AuthInfo, id string) (chainMemoryTarget, error) {
	return s.findChainMemoryTargetWithOptions(ctx, auth, id, false)
}

func (s *Server) findChainDeleteTarget(ctx context.Context, auth *domain.AuthInfo, id string) (chainMemoryTarget, error) {
	return s.findChainMemoryTargetWithOptions(ctx, auth, id, true)
}

func (s *Server) findChainMemoryTargetWithOptions(ctx context.Context, auth *domain.AuthInfo, id string, includeSessions bool) (chainMemoryTarget, error) {
	if auth == nil || auth.Chain == nil || len(auth.Chain.Nodes) == 0 {
		return chainMemoryTarget{}, &domain.ValidationError{Message: "Space Chain has no nodes."}
	}
	for _, node := range auth.Chain.Nodes {
		nodeAuth := chainNodeAuth(auth, node)
		svc := s.resolveServices(nodeAuth)
		if _, err := svc.memory.Get(ctx, id); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				if !includeSessions {
					continue
				}
				if _, sessionErr := svc.session.Get(ctx, id); sessionErr != nil {
					if errors.Is(sessionErr, domain.ErrNotFound) || errors.Is(sessionErr, domain.ErrNotSupported) {
						continue
					}
					return chainMemoryTarget{}, sessionErr
				}
			} else {
				return chainMemoryTarget{}, err
			}
		}
		return chainMemoryTarget{
			nodeAuth: nodeAuth,
			svc:      svc,
			source:   chainSource(auth, node),
		}, nil
	}
	return chainMemoryTarget{}, domain.ErrNotFound
}

func (s *Server) chainDeleteGroups(ctx context.Context, auth *domain.AuthInfo, ids []string) ([]chainDeleteGroup, error) {
	deleteIDs, err := service.ValidateBulkDeleteIDs(ids)
	if err != nil {
		return nil, err
	}
	groups := make([]chainDeleteGroup, 0)
	groupIndexes := make(map[string]int)
	for _, id := range deleteIDs {
		target, err := s.findChainDeleteTarget(ctx, auth, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				continue
			}
			return nil, err
		}
		key := target.nodeAuth.TenantID + "\x00" + target.nodeAuth.ClusterID
		index, ok := groupIndexes[key]
		if !ok {
			index = len(groups)
			groupIndexes[key] = index
			groups = append(groups, chainDeleteGroup{target: target})
		}
		groups[index].ids = append(groups[index].ids, id)
	}
	return groups, nil
}

func (s *Server) listChainMemories(ctx context.Context, auth *domain.AuthInfo, filter domain.MemoryFilter) ([]domain.Memory, int, error) {
	if auth == nil || auth.Chain == nil || len(auth.Chain.Nodes) == 0 {
		return nil, 0, &domain.ValidationError{Message: "Space Chain has no nodes."}
	}
	requestLimit := filter.Limit
	requestOffset := filter.Offset
	if requestLimit <= 0 {
		requestLimit = 20
	}

	visited := make([]domain.Memory, 0, requestLimit*len(auth.Chain.Nodes))
	visitedNodes := 0
	stopReason := "exhausted_chain"
	topScore := 0.0
	stopConfidence := 0
	stopEligible := false
	stopBlockedReason := ""
	queryMode := filter.Query != ""
	scanAll := filter.ScanAll
	profile := buildRecallQueryProfile(filter.Query)

	perNodeFilter := filter
	perNodeFilter.Offset = 0
	perNodeFilter.Limit = requestLimit + requestOffset
	if perNodeFilter.Limit <= 0 {
		perNodeFilter.Limit = requestLimit
	}

	for _, node := range auth.Chain.Nodes {
		nodeAuth := chainNodeAuth(auth, node)
		svc := s.resolveServices(nodeAuth)
		visitedNodes++

		var (
			memories []domain.Memory
			err      error
		)
		switch {
		case perNodeFilter.Query != "" && perNodeFilter.MemoryType == "":
			memories, _, err = s.defaultConfidenceRecallSearch(ctx, nodeAuth, svc, perNodeFilter)
		case perNodeFilter.Query != "" && (perNodeFilter.MemoryType == string(domain.TypeSession) ||
			perNodeFilter.MemoryType == string(domain.TypePinned) ||
			perNodeFilter.MemoryType == string(domain.TypeInsight)):
			memories, _, err = s.singlePoolConfidenceRecallSearch(ctx, nodeAuth, svc, perNodeFilter)
		case perNodeFilter.MemoryType == string(domain.TypeSession):
			memories, _, err = svc.session.List(ctx, perNodeFilter)
		case perNodeFilter.MemoryType != string(domain.TypeSession):
			memories, _, err = svc.memory.Search(ctx, perNodeFilter)
		}
		if err != nil {
			return nil, 0, err
		}
		applyChainSource(memories, chainSource(auth, node))
		visited = append(visited, memories...)

		if queryMode {
			nodeTopScore := topChainScore(memories)
			if nodeTopScore > topScore {
				topScore = nodeTopScore
			}
			decision := chainRecallStopDecision(profile, memories, s.chainRecallStopScore)
			if decision.confidence > stopConfidence {
				stopConfidence = decision.confidence
			}
			stopEligible = decision.eligible
			stopBlockedReason = decision.blockedReason
			if decision.stop && !scanAll {
				stopReason = "threshold_hit"
				break
			}
			if decision.stop && scanAll {
				stopReason = "scan_all"
			}
		}
	}

	totalBeforePage := len(uniqueChainMemories(visited))
	memories := finalizeChainMemories(visited, requestLimit, requestOffset, queryMode)
	slog.InfoContext(ctx, "space chain recall",
		"chain_id", auth.Chain.ChainID,
		"visited_node_count", visitedNodes,
		"stop_reason", stopReason,
		"top_score", topScore,
		"stop_confidence", stopConfidence,
		"stop_eligible", stopEligible,
		"stop_blocked_reason", stopBlockedReason,
		"threshold", s.chainRecallStopScore,
		"scan_all", scanAll,
		"returned", len(memories),
	)
	return memories, totalBeforePage, nil
}

type chainRecallStopStatus struct {
	stop          bool
	eligible      bool
	confidence    int
	blockedReason string
}

func chainRecallStopDecision(profile recallQueryProfile, memories []domain.Memory, threshold float64) chainRecallStopStatus {
	confidence := topChainStopConfidence(memories)
	eligible, blockedReason := chainRecallStopEligible(profile)
	if !eligible {
		return chainRecallStopStatus{
			eligible:      false,
			confidence:    confidence,
			blockedReason: blockedReason,
		}
	}
	thresholdConfidence := chainRecallStopConfidenceThreshold(threshold)
	return chainRecallStopStatus{
		stop:       confidence >= thresholdConfidence,
		eligible:   true,
		confidence: confidence,
	}
}

func chainRecallStopEligible(profile recallQueryProfile) (bool, string) {
	if strings.TrimSpace(profile.lower) == "" {
		return false, "empty_query"
	}
	if profile.shape == recallQueryShapeEnumeration {
		return false, "enumeration_query"
	}
	switch profile.shape {
	case recallQueryShapeEntity, recallQueryShapeCount, recallQueryShapeTime, recallQueryShapeLocation, recallQueryShapeExact:
		return true, ""
	}
	if len(extractRecallQueryTokens(profile.lower)) < 2 {
		return false, "single_token_query"
	}
	return true, ""
}

func chainRecallStopConfidenceThreshold(threshold float64) int {
	if threshold < 0 {
		threshold = 0
	}
	if threshold > 1 {
		threshold = 1
	}
	return int(threshold*100 + 0.5)
}

func topChainStopConfidence(memories []domain.Memory) int {
	best := 0
	for _, mem := range memories {
		confidence := chainStopConfidence(mem)
		if confidence > best {
			best = confidence
		}
	}
	return best
}

func chainStopConfidence(mem domain.Memory) int {
	if mem.Confidence == nil {
		return 0
	}
	if *mem.Confidence < 0 {
		return 0
	}
	if *mem.Confidence > 100 {
		return 100
	}
	return *mem.Confidence
}

func (s *Server) getChainMemory(ctx context.Context, auth *domain.AuthInfo, id string) (*domain.Memory, error) {
	if auth == nil || auth.Chain == nil || len(auth.Chain.Nodes) == 0 {
		return nil, &domain.ValidationError{Message: "Space Chain has no nodes."}
	}
	for _, node := range auth.Chain.Nodes {
		nodeAuth := chainNodeAuth(auth, node)
		svc := s.resolveServices(nodeAuth)
		mem, err := svc.memory.Get(ctx, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				mem, err = svc.session.Get(ctx, id)
				if err != nil {
					if errors.Is(err, domain.ErrNotFound) || errors.Is(err, domain.ErrNotSupported) {
						continue
					}
					return nil, err
				}
			} else {
				return nil, err
			}
		}
		mem.ChainSource = chainSource(auth, node)
		return mem, nil
	}
	return nil, domain.ErrNotFound
}

func topChainScore(memories []domain.Memory) float64 {
	var best float64
	for _, mem := range memories {
		score := chainRankScore(mem)
		if score > best {
			best = score
		}
	}
	return best
}

func chainRankScore(mem domain.Memory) float64 {
	if mem.Score != nil {
		return *mem.Score
	}
	if mem.Confidence != nil {
		return float64(*mem.Confidence) / 100
	}
	return 0
}

func finalizeChainMemories(memories []domain.Memory, limit, offset int, queryMode bool) []domain.Memory {
	memories = uniqueChainMemories(memories)
	if queryMode {
		sort.SliceStable(memories, func(i, j int) bool {
			leftConfidence := chainStopConfidence(memories[i])
			rightConfidence := chainStopConfidence(memories[j])
			if leftConfidence != rightConfidence {
				return leftConfidence > rightConfidence
			}
			leftScore := chainRankScore(memories[i])
			rightScore := chainRankScore(memories[j])
			if leftScore != rightScore {
				return leftScore > rightScore
			}
			return memories[i].UpdatedAt.After(memories[j].UpdatedAt)
		})
	} else {
		sort.SliceStable(memories, func(i, j int) bool {
			if !memories[i].UpdatedAt.Equal(memories[j].UpdatedAt) {
				return memories[i].UpdatedAt.After(memories[j].UpdatedAt)
			}
			if memories[i].ChainSource != nil && memories[j].ChainSource != nil && memories[i].ChainSource.NodePosition != memories[j].ChainSource.NodePosition {
				return memories[i].ChainSource.NodePosition < memories[j].ChainSource.NodePosition
			}
			return memories[i].ID < memories[j].ID
		})
	}
	if offset >= len(memories) {
		return []domain.Memory{}
	}
	end := offset + limit
	if limit <= 0 || end > len(memories) {
		end = len(memories)
	}
	return memories[offset:end]
}

func uniqueChainMemories(memories []domain.Memory) []domain.Memory {
	out := make([]domain.Memory, 0, len(memories))
	seen := make(map[string]struct{}, len(memories))
	for _, mem := range memories {
		key := mem.ID
		if mem.ChainSource != nil {
			key = mem.ChainSource.TenantID + ":" + mem.ID
		}
		if key == "" {
			key = mem.Content
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, mem)
	}
	return out
}

func (s *Server) listChainSessionMessages(ctx context.Context, auth *domain.AuthInfo, sessionIDs []string, limitPerSession int) ([]sessionMessageResponse, error) {
	if auth == nil || auth.Chain == nil || len(auth.Chain.Nodes) == 0 {
		return nil, &domain.ValidationError{Message: "Space Chain has no nodes."}
	}
	messages := []sessionMessageResponse{}
	for _, node := range auth.Chain.Nodes {
		nodeAuth := chainNodeAuth(auth, node)
		svc := s.resolveServices(nodeAuth)
		sessions, err := svc.session.ListBySessionIDs(ctx, sessionIDs, limitPerSession)
		if err != nil {
			return nil, err
		}
		source := chainSource(auth, node)
		for _, sess := range sessions {
			messages = append(messages, sessionMessageResponse{
				ID:          sess.ID,
				SessionID:   sess.SessionID,
				AgentID:     sess.AgentID,
				Source:      sess.Source,
				Seq:         sess.Seq,
				Role:        sess.Role,
				Content:     sess.Content,
				ContentType: sess.ContentType,
				Tags:        sess.Tags,
				State:       sess.State,
				CreatedAt:   sess.CreatedAt,
				UpdatedAt:   sess.UpdatedAt,
				ChainSource: source,
			})
		}
	}
	sortChainSessionMessages(messages)
	return messages, nil
}

func sortChainSessionMessages(messages []sessionMessageResponse) {
	sort.SliceStable(messages, func(i, j int) bool {
		if messages[i].SessionID != messages[j].SessionID {
			return messages[i].SessionID < messages[j].SessionID
		}
		if !messages[i].CreatedAt.Equal(messages[j].CreatedAt) {
			return messages[i].CreatedAt.Before(messages[j].CreatedAt)
		}
		if messages[i].Seq != messages[j].Seq {
			return messages[i].Seq < messages[j].Seq
		}
		if messages[i].ChainSource != nil && messages[j].ChainSource != nil && messages[i].ChainSource.NodePosition != messages[j].ChainSource.NodePosition {
			return messages[i].ChainSource.NodePosition < messages[j].ChainSource.NodePosition
		}
		return messages[i].ID < messages[j].ID
	})
}
