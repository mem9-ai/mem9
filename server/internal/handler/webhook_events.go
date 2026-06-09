package handler

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
	"github.com/qiffang/mnemos/server/internal/webhook"
)

func (s *Server) enqueueMemoryAddedWebhook(ctx context.Context, auth *domain.AuthInfo, source *domain.ChainSource, chainAuth *domain.AuthInfo, mem *domain.Memory) {
	if s == nil || s.webhooks == nil || auth == nil || mem == nil || mem.ID == "" {
		return
	}
	data := map[string]any{"memory": mem}
	s.enqueueWebhook(ctx, webhookScopeForAuth(auth, source), webhook.EventMemoryAdded, data)
	if chainAuth != nil && chainAuth.Chain != nil {
		s.enqueueWebhook(ctx, webhook.EventScope{Type: webhook.ScopeChain, ChainID: chainAuth.Chain.ChainID}, webhook.EventMemoryAdded, data)
	}
}

func (s *Server) enqueueMemoryAddedIDWebhooks(ctx context.Context, auth *domain.AuthInfo, svc resolvedSvc, source *domain.ChainSource, chainAuth *domain.AuthInfo, result *service.IngestResult) {
	if s == nil || s.webhooks == nil || result == nil {
		return
	}
	for _, change := range result.Changes {
		if change.MemoryID == "" {
			continue
		}
		switch change.Type {
		case service.MemoryChangeAdd:
			mem, err := svc.memory.Get(ctx, change.MemoryID)
			if err != nil {
				slog.WarnContext(ctx, "webhook memory.added payload lookup failed", "memory_id", change.MemoryID, "err", err)
				continue
			}
			s.enqueueMemoryAddedWebhook(ctx, auth, source, chainAuth, mem)
		case service.MemoryChangeDelete:
			agentName := ""
			if auth != nil {
				agentName = auth.AgentName
			}
			s.enqueueMemoryDeletedWebhook(ctx, auth, source, chainAuth, change.MemoryID, agentName)
		}
	}
}

func (s *Server) enqueueMemoryDeletedWebhook(ctx context.Context, auth *domain.AuthInfo, source *domain.ChainSource, chainAuth *domain.AuthInfo, memoryID, agentName string) {
	if s == nil || s.webhooks == nil || auth == nil || memoryID == "" {
		return
	}
	data := map[string]any{
		"memory": map[string]any{
			"id":               memoryID,
			"tenant_id":        auth.TenantID,
			"deleted_by_agent": agentName,
			"deleted_at":       time.Now().UTC(),
		},
	}
	s.enqueueWebhook(ctx, webhookScopeForAuth(auth, source), webhook.EventMemoryDeleted, data)
	if chainAuth != nil && chainAuth.Chain != nil {
		s.enqueueWebhook(ctx, webhook.EventScope{Type: webhook.ScopeChain, ChainID: chainAuth.Chain.ChainID}, webhook.EventMemoryDeleted, data)
	}
}

func (s *Server) enqueueRoutedFactWebhook(ctx context.Context, chainAuth *domain.AuthInfo, targetAuth *domain.AuthInfo, node domain.ChainAuthNode, facts []service.ExtractedFact, mem *domain.Memory, agentID, appID, sessionID string) {
	if s == nil || s.webhooks == nil || chainAuth == nil || chainAuth.Chain == nil || targetAuth == nil || len(facts) == 0 {
		return
	}
	if mem != nil {
		agentID = mem.AgentID
		appID = mem.AppID
		sessionID = mem.SessionID
	}
	data := map[string]any{
		"route_id":                 uuid.NewString(),
		"chain_id":                 chainAuth.Chain.ChainID,
		"source_tenant_id":         firstChainTenantID(chainAuth),
		"target_tenant_id":         targetAuth.TenantID,
		"target_external_space_id": node.ExternalSpaceID,
		"routing_policy_node_id":   node.ID,
		"webhook_only":             node.RoutingPolicyWebhookOnly,
		"source_facts":             facts,
		"target_memory":            mem,
		"agent_id":                 agentID,
		"appId":                    appID,
		"session_id":               sessionID,
	}
	s.enqueueWebhook(ctx, webhook.EventScope{Type: webhook.ScopeChain, ChainID: chainAuth.Chain.ChainID}, webhook.EventSpaceChainFactRouted, data)
}

func (s *Server) enqueueWebhook(ctx context.Context, scope webhook.EventScope, eventType string, data any) {
	if err := s.webhooks.Enqueue(context.Background(), scope, eventType, data); err != nil {
		logger := s.logger
		if logger == nil {
			logger = slog.Default()
		}
		logger.WarnContext(ctx, "webhook enqueue failed", "event_type", eventType, "scope_type", scope.Type, "err", err)
	}
}

func firstChainTenantID(auth *domain.AuthInfo) string {
	if auth == nil || auth.Chain == nil || len(auth.Chain.Nodes) == 0 {
		return ""
	}
	return auth.Chain.Nodes[0].TenantID
}
