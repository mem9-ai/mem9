package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
	"github.com/qiffang/mnemos/server/internal/webhook"
)

// Webhook payloads are asserted through the events the server stores. A chain
// subscriber must never receive a Space key; a Space subscriber keeps its own.

func (s *captureWebhookStore) snapshot() []webhook.EventRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]webhook.EventRecord(nil), s.events...)
}

func newWebhookCaptureServer(memRepo *testMemoryRepo) (*Server, *captureWebhookStore) {
	store := &captureWebhookStore{}
	srv := newTestServer(memRepo, &testSessionRepo{}).
		WithWebhookService(webhook.NewService(store, nil, true))
	return srv, store
}

func eventsOf(events []webhook.EventRecord, scopeType, eventType string) []webhook.EventRecord {
	var out []webhook.EventRecord
	for _, event := range events {
		if event.ScopeType == scopeType && event.EventType == eventType {
			out = append(out, event)
		}
	}
	return out
}

// decodeEvent returns the stored envelope and its data object.
func decodeEvent(t *testing.T, event webhook.EventRecord) (webhook.EventEnvelope, map[string]any) {
	t.Helper()
	var envelope webhook.EventEnvelope
	if err := json.Unmarshal(event.Payload, &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	return envelope, decodeJSONObject(t, envelope.Data)
}

func assertChainEventHasNoSpaceKey(t *testing.T, label string, event webhook.EventRecord) {
	t.Helper()
	raw := string(event.Payload)
	if strings.Contains(raw, chainSourceSpaceKey) || strings.Contains(raw, "tenant_id") {
		t.Fatalf("%s payload carries a Space key: %s", label, raw)
	}
	envelope, _ := decodeEvent(t, event)
	if envelope.Scope.Type != webhook.ScopeChain || envelope.Scope.ChainID != "chain-a" || envelope.Scope.TenantID != "" {
		t.Fatalf("%s scope = %+v, want chain scope for chain-a without tenant_id", label, envelope.Scope)
	}
}

func assertSpaceDeletedEvent(t *testing.T, label string, event webhook.EventRecord, memoryID string) {
	t.Helper()
	envelope, data := decodeEvent(t, event)
	if envelope.Scope.Type != webhook.ScopeTenant || envelope.Scope.TenantID != chainSourceSpaceKey {
		t.Fatalf("%s scope = %+v, want Space scope for %s", label, envelope.Scope, chainSourceSpaceKey)
	}
	assertJSONKeys(t, label+" data", data, "memory")
	memory := data["memory"].(map[string]any)
	assertJSONKeys(t, label+" memory", memory, "id", "tenant_id", "deleted_by_agent", "deleted_at")
	if memory["id"] != memoryID || memory["tenant_id"] != chainSourceSpaceKey || memory["deleted_by_agent"] != "test-agent" {
		t.Fatalf("%s memory = %v, want id %s, tenant_id %s, agent test-agent", label, memory, memoryID, chainSourceSpaceKey)
	}
}

func assertChainDeletedEvent(t *testing.T, label string, event webhook.EventRecord, memoryID string) {
	t.Helper()
	assertChainEventHasNoSpaceKey(t, label, event)
	_, data := decodeEvent(t, event)
	assertJSONKeys(t, label+" data", data, "memory")
	memory := data["memory"].(map[string]any)
	assertJSONKeys(t, label+" memory", memory, "id", "deleted_by_agent", "deleted_at")
	if memory["id"] != memoryID || memory["deleted_by_agent"] != "test-agent" {
		t.Fatalf("%s memory = %v, want id %s and agent test-agent", label, memory, memoryID)
	}
}

func TestDeleteMemoryChainWebhookSplitsSpaceAndChainPayloads(t *testing.T) {
	srv, store := newWebhookCaptureServer(&testMemoryRepo{createCalls: []*domain.Memory{{ID: "mem-1", Content: "old", Version: 1}}})
	req := withURLParam(makeChainSourceRequest(t, http.MethodDelete, "/memories/mem-1", nil), "id", "mem-1")
	rr := httptest.NewRecorder()

	srv.deleteMemory(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204: %s", rr.Code, rr.Body.String())
	}
	events := store.snapshot()
	spaceEvents := eventsOf(events, webhook.ScopeTenant, webhook.EventMemoryDeleted)
	chainEvents := eventsOf(events, webhook.ScopeChain, webhook.EventMemoryDeleted)
	if len(events) != 2 || len(spaceEvents) != 1 || len(chainEvents) != 1 {
		t.Fatalf("events = %+v, want one Space and one chain memory.deleted", events)
	}
	assertSpaceDeletedEvent(t, "Space memory.deleted", spaceEvents[0], "mem-1")
	assertChainDeletedEvent(t, "chain memory.deleted", chainEvents[0], "mem-1")
}

func TestBatchDeleteMemoriesChainWebhookSplitsSpaceAndChainPayloads(t *testing.T) {
	srv, store := newWebhookCaptureServer(&testMemoryRepo{
		createCalls: []*domain.Memory{
			{ID: "mem-1", Content: "one", Version: 1},
			{ID: "mem-2", Content: "two", Version: 1},
		},
		bulkSoftDeleteResult: 2,
	})
	req := makeChainSourceRequest(t, http.MethodPost, "/memories/delete", map[string]any{"ids": []string{"mem-1", "mem-2"}})
	rr := httptest.NewRecorder()

	srv.batchDeleteMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	events := store.snapshot()
	spaceEvents := eventsOf(events, webhook.ScopeTenant, webhook.EventMemoryDeleted)
	chainEvents := eventsOf(events, webhook.ScopeChain, webhook.EventMemoryDeleted)
	if len(spaceEvents) != 2 || len(chainEvents) != 2 {
		t.Fatalf("events = %+v, want two Space and two chain memory.deleted", events)
	}
	for i, id := range []string{"mem-1", "mem-2"} {
		assertSpaceDeletedEvent(t, "Space memory.deleted "+id, spaceEvents[i], id)
		assertChainDeletedEvent(t, "chain memory.deleted "+id, chainEvents[i], id)
	}
}

func TestDeleteMemoryWithSpaceKeyStillSendsTenantIDToSpaceSubscribers(t *testing.T) {
	srv, store := newWebhookCaptureServer(&testMemoryRepo{createCalls: []*domain.Memory{{ID: "mem-1", Content: "old", Version: 1}}})
	req := withURLParam(makeTenantRequest(t, http.MethodDelete, "/memories/mem-1", nil), "id", "mem-1")
	rr := httptest.NewRecorder()

	srv.deleteMemory(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204: %s", rr.Code, rr.Body.String())
	}
	events := store.snapshot()
	if len(events) != 1 || events[0].ScopeType != webhook.ScopeTenant || events[0].EventType != webhook.EventMemoryDeleted {
		t.Fatalf("events = %+v, want one Space memory.deleted", events)
	}
	assertSpaceDeletedEvent(t, "Space memory.deleted", events[0], "mem-1")
}

func TestCreatePinnedMemoryChainWebhookPayloadsOmitSpaceKeyFromChainSource(t *testing.T) {
	srv, store := newWebhookCaptureServer(&testMemoryRepo{})
	req := makeChainSourceRequest(t, http.MethodPost, "/memories", map[string]any{
		"content": "pinned through a chain", "memory_type": "pinned", "agent_id": "actor-agent",
	})
	rr := httptest.NewRecorder()

	srv.createMemory(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rr.Code, rr.Body.String())
	}
	assertChainSourceHasNoSpaceKey(t, "create memory", rr.Body.String(), decodeJSONObject(t, rr.Body.Bytes())["chain_source"])
	events := store.snapshot()
	spaceEvents := eventsOf(events, webhook.ScopeTenant, webhook.EventMemoryAdded)
	chainEvents := eventsOf(events, webhook.ScopeChain, webhook.EventMemoryAdded)
	if len(spaceEvents) != 1 || len(chainEvents) != 1 {
		t.Fatalf("events = %+v, want one Space and one chain memory.added", events)
	}

	assertChainEventHasNoSpaceKey(t, "chain memory.added", chainEvents[0])
	for label, event := range map[string]webhook.EventRecord{"chain": chainEvents[0], "Space": spaceEvents[0]} {
		_, data := decodeEvent(t, event)
		memory := data["memory"].(map[string]any)
		assertJSONKeys(t, label+" memory.added chain_source", memory["chain_source"], "chain_id", "node_position", "external_space_id")
	}

	// The Space subscriber keeps the Space key in the envelope scope.
	spaceEnvelope, _ := decodeEvent(t, spaceEvents[0])
	if spaceEnvelope.Scope.TenantID != chainSourceSpaceKey {
		t.Fatalf("Space memory.added scope = %+v, want tenant_id %s", spaceEnvelope.Scope, chainSourceSpaceKey)
	}
}

// When a routed fact is written to the target node, space_chain.fact_routed
// carries the stored memory; its chain_source must not reveal the target Space key.
func TestRoutedFactWebhookWithTargetMemoryOmitsSpaceKeyFromChainSource(t *testing.T) {
	const targetSpaceKey = "tenant-target"
	srv, store := newWebhookCaptureServer(&testMemoryRepo{})
	chainAuth := authInfo(makeChainSourceRequest(t, http.MethodGet, "/memories", nil))
	targetNode := domain.ChainAuthNode{SpaceChainNode: domain.SpaceChainNode{
		ID: "node-target", TenantID: targetSpaceKey, ExternalSpaceID: "space-target", Position: 1,
	}}
	stored := &domain.Memory{
		ID: "mem-routed", Content: "routed fact", AgentID: "actor-agent",
		ChainSource: &domain.ChainSource{ChainID: "chain-a", NodePosition: 1, TenantID: targetSpaceKey, ExternalSpaceID: "space-target"},
	}

	srv.enqueueRoutedFactWebhook(context.Background(), chainAuth, chainAuth, targetNode,
		[]service.ExtractedFact{{Text: "routed fact"}}, stored, "", "", "")

	events := eventsOf(store.snapshot(), webhook.ScopeChain, webhook.EventSpaceChainFactRouted)
	if len(events) != 1 {
		t.Fatalf("events = %+v, want one chain fact_routed", store.snapshot())
	}
	assertChainEventHasNoSpaceKey(t, "chain fact_routed", events[0])
	if strings.Contains(string(events[0].Payload), targetSpaceKey) {
		t.Fatalf("fact_routed payload carries the target Space key: %s", events[0].Payload)
	}
	_, data := decodeEvent(t, events[0])
	target, ok := data["target_memory"].(map[string]any)
	if !ok {
		t.Fatalf("target_memory = %v, want the stored memory", data["target_memory"])
	}
	assertJSONKeys(t, "target_memory chain_source", target["chain_source"], "chain_id", "node_position", "external_space_id")
	if data["source_node_id"] != "node-source" || data["source_external_space_id"] != "space-source" ||
		data["routing_policy_node_id"] != "node-target" || data["target_external_space_id"] != "space-target" {
		t.Fatalf("fact_routed identifiers = %v, want source node-source/space-source and target node-target/space-target", data)
	}
}
