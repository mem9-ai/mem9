package handler

import (
	"context"
	"errors"
	"log/slog"
	"sort"
	"strings"
	"sync"

	"golang.org/x/sync/errgroup"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/runtimeusage"
	"github.com/qiffang/mnemos/server/internal/service"
)

func (s *Server) firstChainNodeAuth(auth *domain.AuthInfo) (*domain.AuthInfo, error) {
	if auth == nil || auth.Chain == nil || len(auth.Chain.Nodes) == 0 {
		return nil, &domain.ValidationError{Message: "Space Chain has no nodes."}
	}
	return chainNodeAuth(auth, auth.Chain.Nodes[0]), nil
}

func chainRoutingTargets(auth *domain.AuthInfo) []service.RoutingTarget {
	if auth == nil || auth.Chain == nil {
		return nil
	}
	targets := make([]service.RoutingTarget, 0, len(auth.Chain.Nodes))
	for _, node := range auth.Chain.Nodes {
		if node.Position == 0 || !node.RoutingPolicyEnabled {
			continue
		}
		externalSpaceID := strings.TrimSpace(node.ExternalSpaceID)
		prompt := strings.TrimSpace(node.RoutingPolicyPrompt)
		if externalSpaceID == "" || prompt == "" {
			continue
		}
		targets = append(targets, service.RoutingTarget{
			ID:   externalSpaceID,
			Name: strings.TrimSpace(node.DisplayName),
			Rule: prompt,
		})
	}
	return targets
}

type routedReconcileResult struct {
	memoriesChanged int
	insightIDs      []string
	warnings        int
}

func (s *Server) reconcileRoutedChainFacts(ctx context.Context, auth *domain.AuthInfo, req service.IngestRequest, facts []service.ExtractedFact) routedReconcileResult {
	if auth == nil || auth.Chain == nil || len(facts) == 0 {
		return routedReconcileResult{}
	}
	targetNodes := make(map[string]domain.ChainAuthNode)
	for _, node := range auth.Chain.Nodes {
		if node.Position == 0 || !node.RoutingPolicyEnabled || strings.TrimSpace(node.RoutingPolicyPrompt) == "" {
			continue
		}
		externalSpaceID := strings.TrimSpace(node.ExternalSpaceID)
		if externalSpaceID == "" {
			continue
		}
		targetNodes[externalSpaceID] = node
	}
	if len(targetNodes) == 0 {
		return routedReconcileResult{}
	}
	grouped := make(map[string][]service.ExtractedFact)
	for _, fact := range facts {
		seenTargets := make(map[string]struct{}, len(fact.RouteTargets))
		for _, targetID := range fact.RouteTargets {
			targetID = strings.TrimSpace(targetID)
			if targetID == "" {
				continue
			}
			if _, seen := seenTargets[targetID]; seen {
				continue
			}
			node, ok := targetNodes[targetID]
			if !ok || node.Position == 0 {
				continue
			}
			seenTargets[targetID] = struct{}{}
			routedFact := fact
			routedFact.RouteTargets = nil
			grouped[targetID] = append(grouped[targetID], routedFact)
		}
	}
	if len(grouped) == 0 {
		return routedReconcileResult{}
	}

	var (
		mu     sync.Mutex
		out    routedReconcileResult
		wg     sync.WaitGroup
		sem    = make(chan struct{}, 4)
		logger = s.logger
	)
	if logger == nil {
		logger = slog.Default()
	}
	for targetID, factsForTarget := range grouped {
		targetID := targetID
		factsForTarget := factsForTarget
		node := targetNodes[targetID]
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			nodeAuth := chainNodeAuth(auth, node)
			targetSvc := s.resolveServices(nodeAuth)
			var lease *runtimeusage.OperationLease
			if s.runtimeUsageEnabled() {
				var err error
				lease, err = s.runtimeUsage.BeforeMemoryCreate(ctx, subjectFromAuth(nodeAuth), 1)
				if err != nil {
					logger.WarnContext(ctx, "space chain routed reconcile skipped by runtime usage",
						"chain_id", auth.Chain.ChainID,
						"target_space_id", targetID,
						"facts", len(factsForTarget),
						"err", err,
					)
					mu.Lock()
					out.warnings++
					mu.Unlock()
					return
				}
			}
			result, err := targetSvc.ingest.ReconcilePhase2(ctx, nodeAuth.AgentName, req.AgentID, req.SessionID, factsForTarget)
			if err != nil {
				if s.runtimeUsageEnabled() && lease != nil {
					s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, err)
				}
				logger.WarnContext(ctx, "space chain routed reconcile failed",
					"chain_id", auth.Chain.ChainID,
					"target_space_id", targetID,
					"facts", len(factsForTarget),
					"err", err,
				)
				mu.Lock()
				out.warnings++
				mu.Unlock()
				return
			}
			if result == nil {
				result = &service.IngestResult{Status: "complete"}
			}
			if result.Status == "failed" {
				if s.runtimeUsageEnabled() && lease != nil {
					s.runtimeUsage.AfterMemoryCreateFailure(context.Background(), lease, errors.New("routed reconcile failed"))
				}
				logger.WarnContext(ctx, "space chain routed reconcile returned failed",
					"chain_id", auth.Chain.ChainID,
					"target_space_id", targetID,
					"facts", len(factsForTarget),
					"warnings", result.Warnings,
				)
				mu.Lock()
				out.warnings += max(1, result.Warnings)
				mu.Unlock()
				return
			}
			if s.runtimeUsageEnabled() && lease != nil {
				if err := withRuntimeUsagePostSuccessContext(func(ctx context.Context) error {
					return s.runtimeUsage.AfterMemoryCreateSuccess(ctx, lease, runtimeusage.MemoryCreateResult{
						MemoryIDs:       result.InsightIDs,
						AgentName:       nodeAuth.AgentName,
						ObjectsAffected: int64(result.MemoriesChanged),
					})
				}); err != nil {
					logger.WarnContext(ctx, "space chain routed reconcile runtime usage finalization failed",
						"chain_id", auth.Chain.ChainID,
						"target_space_id", targetID,
						"facts", len(factsForTarget),
						"err", err,
					)
					mu.Lock()
					out.warnings++
					mu.Unlock()
					return
				}
			}
			mu.Lock()
			out.memoriesChanged += result.MemoriesChanged
			out.insightIDs = append(out.insightIDs, result.InsightIDs...)
			out.warnings += result.Warnings
			mu.Unlock()
		}()
	}
	wg.Wait()
	return out
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

	if scanAll {
		results, err := s.listChainMemoriesScanAll(ctx, auth, perNodeFilter, profile, queryMode)
		if err != nil {
			return nil, 0, err
		}
		visitedNodes = len(results)
		for _, result := range results {
			visited = append(visited, result.memories...)
			topScore, stopConfidence, stopEligible, stopBlockedReason = updateChainRecallStats(
				topScore,
				stopConfidence,
				stopEligible,
				stopBlockedReason,
				result,
				queryMode,
			)
			if queryMode && result.decision.stop {
				stopReason = "scan_all"
			}
		}
	} else {
		for _, node := range auth.Chain.Nodes {
			result, err := s.listChainNodeMemories(ctx, auth, node, perNodeFilter, profile, queryMode)
			if err != nil {
				return nil, 0, err
			}
			visitedNodes++
			visited = append(visited, result.memories...)
			topScore, stopConfidence, stopEligible, stopBlockedReason = updateChainRecallStats(
				topScore,
				stopConfidence,
				stopEligible,
				stopBlockedReason,
				result,
				queryMode,
			)
			if queryMode && result.decision.stop {
				stopReason = "threshold_hit"
				break
			}
		}
	}

	totalBeforePage := len(uniqueChainMemories(visited))
	memories := finalizeChainMemories(visited, filter, requestLimit, requestOffset, queryMode)
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

type chainNodeMemoryResult struct {
	memories []domain.Memory
	topScore float64
	decision chainRecallStopStatus
}

func (s *Server) listChainMemoriesScanAll(
	ctx context.Context,
	auth *domain.AuthInfo,
	filter domain.MemoryFilter,
	profile recallQueryProfile,
	queryMode bool,
) ([]chainNodeMemoryResult, error) {
	results := make([]chainNodeMemoryResult, len(auth.Chain.Nodes))
	group, groupCtx := errgroup.WithContext(ctx)
	for i, node := range auth.Chain.Nodes {
		i, node := i, node
		group.Go(func() error {
			result, err := s.listChainNodeMemories(groupCtx, auth, node, filter, profile, queryMode)
			if err != nil {
				return err
			}
			results[i] = result
			return nil
		})
	}
	if err := group.Wait(); err != nil {
		return nil, err
	}
	return results, nil
}

func (s *Server) listChainNodeMemories(
	ctx context.Context,
	auth *domain.AuthInfo,
	node domain.ChainAuthNode,
	filter domain.MemoryFilter,
	profile recallQueryProfile,
	queryMode bool,
) (chainNodeMemoryResult, error) {
	nodeAuth := chainNodeAuth(auth, node)
	svc := s.resolveServices(nodeAuth)

	var (
		memories []domain.Memory
		err      error
	)
	switch {
	case filter.Query != "" && filter.MemoryType == "":
		memories, _, err = s.defaultConfidenceRecallSearch(ctx, nodeAuth, svc, filter)
	case filter.Query != "" && (filter.MemoryType == string(domain.TypeSession) ||
		filter.MemoryType == string(domain.TypePinned) ||
		filter.MemoryType == string(domain.TypeInsight)):
		memories, _, err = s.singlePoolConfidenceRecallSearch(ctx, nodeAuth, svc, filter)
	case filter.MemoryType == string(domain.TypeSession):
		memories, _, err = svc.session.List(ctx, filter)
	case filter.MemoryType != string(domain.TypeSession):
		memories, _, err = svc.memory.Search(ctx, filter)
	}
	if err != nil {
		return chainNodeMemoryResult{}, err
	}
	applyChainSource(memories, chainSource(auth, node))

	result := chainNodeMemoryResult{memories: memories}
	if queryMode {
		result.topScore = topChainScore(memories)
		result.decision = chainRecallStopDecision(profile, memories, s.chainRecallStopScore)
	}
	return result, nil
}

func updateChainRecallStats(
	topScore float64,
	stopConfidence int,
	stopEligible bool,
	stopBlockedReason string,
	result chainNodeMemoryResult,
	queryMode bool,
) (float64, int, bool, string) {
	if !queryMode {
		return topScore, stopConfidence, stopEligible, stopBlockedReason
	}
	if result.topScore > topScore {
		topScore = result.topScore
	}
	if result.decision.confidence > stopConfidence {
		stopConfidence = result.decision.confidence
	}
	stopEligible = result.decision.eligible
	stopBlockedReason = result.decision.blockedReason
	return topScore, stopConfidence, stopEligible, stopBlockedReason
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

func finalizeChainMemories(memories []domain.Memory, filter domain.MemoryFilter, limit, offset int, queryMode bool) []domain.Memory {
	memories = uniqueChainMemories(memories)
	if strings.TrimSpace(filter.SortBy) != "" {
		sort.SliceStable(memories, func(i, j int) bool {
			return compareChainMemoryForSort(memories[i], memories[j], filter)
		})
	} else if queryMode {
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

func compareChainMemoryForSort(left, right domain.Memory, filter domain.MemoryFilter) bool {
	desc := !strings.EqualFold(strings.TrimSpace(filter.SortDir), "asc")
	less := false
	greater := false
	switch strings.TrimSpace(filter.SortBy) {
	case "content":
		cmp := strings.Compare(strings.ToLower(left.Content), strings.ToLower(right.Content))
		less = cmp < 0
		greater = cmp > 0
	case "memory_type":
		cmp := strings.Compare(string(left.MemoryType), string(right.MemoryType))
		less = cmp < 0
		greater = cmp > 0
	case "tags":
		cmp := strings.Compare(strings.ToLower(strings.Join(left.Tags, ",")), strings.ToLower(strings.Join(right.Tags, ",")))
		less = cmp < 0
		greater = cmp > 0
	case "updated_at":
		fallthrough
	default:
		less = left.UpdatedAt.Before(right.UpdatedAt)
		greater = left.UpdatedAt.After(right.UpdatedAt)
	}
	if less || greater {
		if desc {
			return greater
		}
		return less
	}
	if left.ChainSource != nil && right.ChainSource != nil && left.ChainSource.NodePosition != right.ChainSource.NodePosition {
		return left.ChainSource.NodePosition < right.ChainSource.NodePosition
	}
	return left.ID < right.ID
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
