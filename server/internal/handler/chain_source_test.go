package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/middleware"
)

const chainSourceSpaceKey = "tenant-a"

// makeChainSourceRequest builds a chain-authenticated request whose first node
// has both a Space key and an external Space id.
func makeChainSourceRequest(t *testing.T, method, path string, body any) *http.Request {
	t.Helper()
	req := makeRequest(t, method, path, body)
	auth := &domain.AuthInfo{
		AgentName: "test-agent",
		Chain: &domain.ChainAuth{
			ChainID: "chain-a",
			APIKey:  "chain-key-a",
			Nodes: []domain.ChainAuthNode{{
				SpaceChainNode: domain.SpaceChainNode{
					ID:              "node-source",
					TenantID:        chainSourceSpaceKey,
					ExternalSpaceID: "space-source",
					Position:        0,
				},
				ClusterID: "10006636",
			}},
		},
	}
	return req.WithContext(middleware.WithAuthContext(req.Context(), auth))
}

func assertChainSourceHasNoSpaceKey(t *testing.T, label string, rawBody string, chainSource any) {
	t.Helper()
	if strings.Contains(rawBody, chainSourceSpaceKey) {
		t.Fatalf("%s leaks the Space key: %s", label, rawBody)
	}
	assertJSONKeys(t, label+" chain_source", chainSource, "chain_id", "node_position", "external_space_id")
	got := chainSource.(map[string]any)
	if got["chain_id"] != "chain-a" || got["node_position"] != float64(0) || got["external_space_id"] != "space-source" {
		t.Fatalf("%s chain_source = %v, want chain-a / 0 / space-source", label, got)
	}
}

func TestChainMemoryResponsesOmitSpaceKeyFromChainSource(t *testing.T) {
	now := time.Now()
	sessionRow := &domain.Memory{
		ID: "sess-row-1", Content: "raw turn", MemoryType: domain.TypeSession,
		State: domain.StateActive, CreatedAt: now, UpdatedAt: now,
	}

	t.Run("get memory", func(t *testing.T) {
		srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{getResult: sessionRow})
		req := withURLParam(makeChainSourceRequest(t, http.MethodGet, "/memories/sess-row-1", nil), "id", "sess-row-1")
		rr := httptest.NewRecorder()

		srv.getMemory(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
		}
		body := decodeJSONObject(t, rr.Body.Bytes())
		assertChainSourceHasNoSpaceKey(t, "get memory", rr.Body.String(), body["chain_source"])
	})

	t.Run("update memory", func(t *testing.T) {
		memRepo := &testMemoryRepo{createCalls: []*domain.Memory{{ID: "mem-1", Content: "old", Version: 1}}}
		srv := newTestServer(memRepo, &testSessionRepo{})
		req := withURLParam(makeChainSourceRequest(t, http.MethodPatch, "/memories/mem-1", map[string]any{"content": "new"}), "id", "mem-1")
		rr := httptest.NewRecorder()

		srv.updateMemory(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
		}
		body := decodeJSONObject(t, rr.Body.Bytes())
		assertChainSourceHasNoSpaceKey(t, "update memory", rr.Body.String(), body["chain_source"])
	})

	t.Run("list memories", func(t *testing.T) {
		srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{listResults: []domain.Memory{*sessionRow}, listTotal: 1})
		req := makeChainSourceRequest(t, http.MethodGet, "/memories?memory_type=session&limit=10&offset=0&state=active", nil)
		rr := httptest.NewRecorder()

		srv.listMemories(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
		}
		body := decodeJSONObject(t, rr.Body.Bytes())
		memories, _ := body["memories"].([]any)
		if len(memories) != 1 {
			t.Fatalf("memories = %v, want 1", body["memories"])
		}
		assertChainSourceHasNoSpaceKey(t, "list memories", rr.Body.String(), memories[0].(map[string]any)["chain_source"])
	})

	t.Run("list session messages", func(t *testing.T) {
		sessions := &testSessionRepo{sessionListResults: []*domain.Session{{
			ID: "sess-row-1", SessionID: "sess-1", Role: "user", Content: "raw turn",
			ContentType: "text/plain", State: domain.StateActive, CreatedAt: now, UpdatedAt: now,
		}}}
		srv := newTestServer(&testMemoryRepo{}, sessions)
		req := makeChainSourceRequest(t, http.MethodGet, "/session-messages?session_id=sess-1", nil)
		rr := httptest.NewRecorder()

		srv.handleListSessionMessages(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
		}
		body := decodeJSONObject(t, rr.Body.Bytes())
		messages, _ := body["messages"].([]any)
		if len(messages) != 1 {
			t.Fatalf("messages = %v, want 1", body["messages"])
		}
		assertChainSourceHasNoSpaceKey(t, "list session messages", rr.Body.String(), messages[0].(map[string]any)["chain_source"])
	})
}
