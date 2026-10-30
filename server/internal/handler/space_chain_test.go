package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

// The vectors below are shared with the console server; keep both tables identical.
func TestVisibleMaskSharedVectors(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"long key", "chain_AbCdEfGhIjKlMnOpQrStUvWxYz012345", "chain_...2345"},
		{"surrounding spaces are trimmed", "  chain_AbCdEfGhIjKlMnOpQrStUvWxYz012345  ", "chain_...2345"},
		{"exactly twelve bytes", "chain_abcdef", "chain_...cdef"},
		{"eleven bytes", "chain_abcde", "len11"},
		{"non chain prefix", "mk_test_key_1234567890", "mk_tes...7890"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := visibleMask(tt.input); got != tt.want {
				t.Fatalf("visibleMask(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// Sentinel credentials. Any of them appearing in a read response is a leak.
const (
	chainReadID        = "chain-1"
	chainReadMgmtKey   = "chain_ManagementKeySecretValue000001"
	chainReadOtherKey  = "chain_OtherHolderKeySecretValue00002"
	chainReadMemoryKey = "chain_MemoryKeySecretValue0000000003"
	chainReadSpaceKeyA = "space-key-secret-aaaaaaaaaaaa"
	chainReadSpaceKeyB = "space-key-secret-bbbbbbbbbbbb"
)

func chainReadSecrets() []string {
	return []string{chainReadMgmtKey, chainReadOtherKey, chainReadMemoryKey, chainReadSpaceKeyA, chainReadSpaceKeyB}
}

var chainReadTime = time.Date(2026, 10, 27, 0, 0, 0, 0, time.UTC)

func newChainReadFixture() *domain.SpaceChain {
	ts := chainReadTime
	return &domain.SpaceChain{
		ID:              chainReadID,
		ProjectID:       "project-1",
		Name:            "example",
		Description:     "example chain",
		CreatedByUserID: "user-creator",
		CreatedAt:       ts,
		UpdatedAt:       ts,
		Bindings: []domain.SpaceChainBinding{
			{ID: "b-1", ChainID: chainReadID, Role: domain.SpaceChainRoleManagement, ChainAPIKey: chainReadMgmtKey, CreatedByUserID: "user-creator", CreatedAt: ts},
			{ID: "b-2", ChainID: chainReadID, Role: domain.SpaceChainRoleMemory, ChainAPIKey: chainReadOtherKey, CreatedByUserID: "user-other", Disabled: true, DisabledAt: &ts, DisabledByUserID: "user-admin", CreatedAt: ts},
			{ID: "b-3", ChainID: chainReadID, Role: domain.SpaceChainRoleMemory, ChainAPIKey: chainReadMemoryKey, CreatedByUserID: "user-creator", CreatedAt: ts},
		},
		Nodes: []domain.SpaceChainNode{
			{ID: "n-1", ChainID: chainReadID, TenantID: chainReadSpaceKeyA, DisplayName: "Personal", Position: 0, CreatedAt: ts, UpdatedAt: ts},
			{ID: "n-2", ChainID: chainReadID, TenantID: chainReadSpaceKeyB, ExternalSpaceID: "space-team", DisplayName: "Team", Position: 1,
				RoutingPolicyEnabled: true, RoutingPolicyPrompt: "team facts", CreatedAt: ts, UpdatedAt: ts},
		},
	}
}

// chainReadRepo is an in-memory Space Chain repository that stores plaintext
// keys and Space keys the way the real repositories do.
type chainReadRepo struct {
	chain     *domain.SpaceChain
	createErr error
}

// hasKey reports whether any binding, active or not, already uses the key. The
// real stores keep chain keys unique across all chains.
func (r *chainReadRepo) hasKey(key string) bool {
	if r.chain == nil {
		return false
	}
	for _, binding := range r.chain.Bindings {
		if binding.ChainAPIKey == key {
			return true
		}
	}
	return false
}

// cloneKeepingNil copies a slice and keeps the difference between a nil slice
// and an empty one, because the two encode differently (null vs []).
func cloneKeepingNil[T any](in []T) []T {
	if in == nil {
		return nil
	}
	out := make([]T, len(in))
	copy(out, in)
	return out
}

func (r *chainReadRepo) copyChain() *domain.SpaceChain {
	if r.chain == nil {
		return nil
	}
	cp := *r.chain
	cp.Bindings = cloneKeepingNil(r.chain.Bindings)
	cp.Nodes = cloneKeepingNil(r.chain.Nodes)
	return &cp
}

func (r *chainReadRepo) Create(_ context.Context, chain *domain.SpaceChain, bindings ...*domain.SpaceChainBinding) error {
	if r.createErr != nil {
		return r.createErr
	}
	cp := *chain
	cp.CreatedAt = chainReadTime
	cp.UpdatedAt = chainReadTime
	cp.Bindings = nil
	for _, binding := range bindings {
		binding.CreatedAt = chainReadTime
		cp.Bindings = append(cp.Bindings, *binding)
	}
	r.chain = &cp
	return nil
}

func (r *chainReadRepo) GetByID(_ context.Context, id string) (*domain.SpaceChain, error) {
	if r.chain == nil || r.chain.ID != id {
		return nil, domain.ErrNotFound
	}
	return r.copyChain(), nil
}

func (r *chainReadRepo) GetByKey(_ context.Context, key string) (*domain.SpaceChain, error) {
	if r.chain != nil {
		for _, binding := range r.chain.Bindings {
			if !binding.Disabled && binding.ChainAPIKey == key {
				return r.copyChain(), nil
			}
		}
	}
	return nil, domain.ErrNotFound
}

func (r *chainReadRepo) Update(_ context.Context, chain *domain.SpaceChain) error {
	if r.chain == nil || r.chain.ID != chain.ID {
		return domain.ErrNotFound
	}
	r.chain.Name = chain.Name
	r.chain.Description = chain.Description
	return nil
}

func (r *chainReadRepo) SoftDelete(context.Context, string, string) error { return nil }

func (r *chainReadRepo) CreateBinding(_ context.Context, binding *domain.SpaceChainBinding) error {
	if r.hasKey(binding.ChainAPIKey) {
		return domain.ErrDuplicateKey
	}
	// Like the database, the store sets created_at on the stored row, not on
	// the value the caller passed in.
	stored := *binding
	stored.CreatedAt = chainReadTime
	r.chain.Bindings = append(r.chain.Bindings, stored)
	return nil
}

func (r *chainReadRepo) ListBindings(context.Context, string) ([]domain.SpaceChainBinding, error) {
	if r.chain == nil {
		return nil, nil
	}
	return cloneKeepingNil(r.chain.Bindings), nil
}

func (r *chainReadRepo) DisableBinding(_ context.Context, _, bindingID, _ string) error {
	for i := range r.chain.Bindings {
		if r.chain.Bindings[i].ID == bindingID && !r.chain.Bindings[i].Disabled {
			r.chain.Bindings[i].Disabled = true
			return nil
		}
	}
	return domain.ErrNotFound
}

func (r *chainReadRepo) ListNodes(context.Context, string) ([]domain.SpaceChainNode, error) {
	if r.chain == nil {
		return nil, nil
	}
	return cloneKeepingNil(r.chain.Nodes), nil
}

func (r *chainReadRepo) ReplaceNodes(_ context.Context, _ string, nodes []domain.SpaceChainNode) error {
	for i := range nodes {
		nodes[i].CreatedAt = chainReadTime
		nodes[i].UpdatedAt = chainReadTime
	}
	r.chain.Nodes = append([]domain.SpaceChainNode(nil), nodes...)
	return nil
}

func (r *chainReadRepo) UpdateNodeRoutingPolicy(_ context.Context, _, nodeID string, enabled bool, prompt string, webhookOnly bool) (*domain.SpaceChainNode, error) {
	for i := range r.chain.Nodes {
		if r.chain.Nodes[i].ID != nodeID {
			continue
		}
		r.chain.Nodes[i].RoutingPolicyEnabled = enabled
		r.chain.Nodes[i].RoutingPolicyPrompt = prompt
		r.chain.Nodes[i].RoutingPolicyWebhookOnly = webhookOnly
		node := r.chain.Nodes[i]
		return &node, nil
	}
	return nil, domain.ErrNotFound
}

func (r *chainReadRepo) RemoveNodeByExternalSpaceID(context.Context, string) error { return nil }

func (r *chainReadRepo) KeyStatus(context.Context, string) (domain.KeyStatus, error) {
	return domain.KeyStatusActive, nil
}

func newChainReadRouter(t *testing.T, repo *chainReadRepo) http.Handler {
	t.Helper()
	srv := NewServer(nil, nil, "", nil, nil, "", false, service.ModeSmart, "", slog.Default()).
		WithSpaceChainService(service.NewSpaceChainService(repo), 0.8)
	pass := func(next http.Handler) http.Handler { return next }
	return srv.Router(pass, pass, pass, pass)
}

func chainReadDo(t *testing.T, router http.Handler, method, path, apiKey string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("X-API-Key", apiKey)
	}
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	return rr
}

func decodeJSONObject(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return out
}

func assertNoSecrets(t *testing.T, label, body string) {
	t.Helper()
	for _, secret := range chainReadSecrets() {
		if strings.Contains(body, secret) {
			t.Fatalf("%s leaks %q: %s", label, secret, body)
		}
	}
}

func assertJSONKeys(t *testing.T, label string, obj any, want ...string) {
	t.Helper()
	m, ok := obj.(map[string]any)
	if !ok {
		t.Fatalf("%s is %T, want JSON object", label, obj)
	}
	got := make([]string, 0, len(m))
	for k := range m {
		got = append(got, k)
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("%s keys = %v, want %v", label, got, want)
	}
}

// assertChainReadBindings checks the three fixture bindings as a read response
// shows them: each with its role and a masked key, never a plaintext key.
func assertChainReadBindings(t *testing.T, label string, raw any) {
	t.Helper()
	bindings, _ := raw.([]any)
	if len(bindings) != 3 {
		t.Fatalf("%s bindings = %v, want 3", label, raw)
	}
	assertJSONKeys(t, label+" binding 0", bindings[0],
		"id", "chain_id", "role", "masked_chain_api_key", "disabled", "created_at")
	assertJSONKeys(t, label+" binding 1", bindings[1],
		"id", "chain_id", "role", "masked_chain_api_key", "disabled", "disabled_at", "disabled_by_user_id", "created_at")
	assertJSONKeys(t, label+" binding 2", bindings[2],
		"id", "chain_id", "role", "masked_chain_api_key", "disabled", "created_at")
	for i, want := range []struct{ role, mask string }{
		{domain.SpaceChainRoleManagement, "chain_...0001"},
		{domain.SpaceChainRoleMemory, "chain_...0002"},
		{domain.SpaceChainRoleMemory, "chain_...0003"},
	} {
		binding := bindings[i].(map[string]any)
		if binding["role"] != want.role || binding["masked_chain_api_key"] != want.mask {
			t.Fatalf("%s binding %d role/mask = %v/%v, want %s/%s", label, i, binding["role"], binding["masked_chain_api_key"], want.role, want.mask)
		}
	}
}

func assertChainReadBody(t *testing.T, label string, chain map[string]any) {
	t.Helper()
	assertJSONKeys(t, label, chain,
		"id", "project_id", "name", "description", "created_at", "updated_at", "bindings", "nodes")
	assertChainReadBindings(t, label, chain["bindings"])
	nodes, _ := chain["nodes"].([]any)
	if len(nodes) != 2 {
		t.Fatalf("%s nodes = %v, want 2", label, chain["nodes"])
	}
	assertJSONKeys(t, label+" node 0", nodes[0],
		"id", "chain_id", "display_name", "position", "routing_policy_enabled", "routing_policy_webhook_only", "created_at", "updated_at")
	assertJSONKeys(t, label+" node 1", nodes[1],
		"id", "chain_id", "external_space_id", "display_name", "position", "routing_policy_enabled", "routing_policy_prompt", "routing_policy_webhook_only", "created_at", "updated_at")
}

func TestGetSpaceChainMasksBindingsAndOmitsSpaceKeys(t *testing.T) {
	router := newChainReadRouter(t, &chainReadRepo{chain: newChainReadFixture()})

	rr := chainReadDo(t, router, http.MethodGet, "/v1alpha2/space-chains/"+chainReadID, chainReadMgmtKey, nil)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	assertNoSecrets(t, "GET chain", rr.Body.String())
	assertChainReadBody(t, "GET chain", decodeJSONObject(t, rr.Body.Bytes()))
}

func TestGetSpaceChainByKeyMasksBindingsAndOmitsSpaceKeys(t *testing.T) {
	router := newChainReadRouter(t, &chainReadRepo{chain: newChainReadFixture()})

	rr := chainReadDo(t, router, http.MethodGet, "/v1alpha2/space-chains/by-key", chainReadMgmtKey, nil)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	assertNoSecrets(t, "GET by-key", rr.Body.String())
	assertChainReadBody(t, "GET by-key", decodeJSONObject(t, rr.Body.Bytes()))
}

func TestUpdateSpaceChainResponseMasksBindingsAndOmitsSpaceKeys(t *testing.T) {
	repo := &chainReadRepo{chain: newChainReadFixture()}
	router := newChainReadRouter(t, repo)

	rr := chainReadDo(t, router, http.MethodPatch, "/v1alpha2/space-chains/"+chainReadID, chainReadMgmtKey,
		map[string]any{"name": "renamed", "description": "updated"})

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	assertNoSecrets(t, "PATCH chain", rr.Body.String())
	body := decodeJSONObject(t, rr.Body.Bytes())
	assertChainReadBody(t, "PATCH chain", body)
	if body["name"] != "renamed" || body["description"] != "updated" {
		t.Fatalf("PATCH chain name/description = %v/%v, want renamed/updated", body["name"], body["description"])
	}
}

func TestListSpaceChainBindingsMasksKeys(t *testing.T) {
	router := newChainReadRouter(t, &chainReadRepo{chain: newChainReadFixture()})

	rr := chainReadDo(t, router, http.MethodGet, "/v1alpha2/space-chains/"+chainReadID+"/bindings", chainReadMgmtKey, nil)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	assertNoSecrets(t, "GET bindings", rr.Body.String())
	body := decodeJSONObject(t, rr.Body.Bytes())
	assertJSONKeys(t, "GET bindings", body, "bindings")
	assertChainReadBindings(t, "GET bindings", body["bindings"])
}

func TestListSpaceChainNodesOmitsSpaceKeys(t *testing.T) {
	router := newChainReadRouter(t, &chainReadRepo{chain: newChainReadFixture()})

	rr := chainReadDo(t, router, http.MethodGet, "/v1alpha2/space-chains/"+chainReadID+"/nodes", chainReadMgmtKey, nil)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	assertNoSecrets(t, "GET nodes", rr.Body.String())
	body := decodeJSONObject(t, rr.Body.Bytes())
	assertJSONKeys(t, "GET nodes", body, "nodes")
	nodes, _ := body["nodes"].([]any)
	if len(nodes) != 2 {
		t.Fatalf("nodes = %v, want 2", body["nodes"])
	}
	assertJSONKeys(t, "node 0", nodes[0],
		"id", "chain_id", "display_name", "position", "routing_policy_enabled", "routing_policy_webhook_only", "created_at", "updated_at")
	assertJSONKeys(t, "node 1", nodes[1],
		"id", "chain_id", "external_space_id", "display_name", "position", "routing_policy_enabled", "routing_policy_prompt", "routing_policy_webhook_only", "created_at", "updated_at")
}

// The real repositories always return a non-nil list, so a chain without nodes
// answers with an empty array. A nil list never comes out of them; this case
// pins the mapping the spec asks to keep (nil in, null out).
func TestListSpaceChainNodesKeepsNullForNilNodeList(t *testing.T) {
	chain := newChainReadFixture()
	chain.Nodes = nil
	router := newChainReadRouter(t, &chainReadRepo{chain: chain})

	rr := chainReadDo(t, router, http.MethodGet, "/v1alpha2/space-chains/"+chainReadID+"/nodes", chainReadMgmtKey, nil)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	if got := strings.TrimSpace(rr.Body.String()); got != `{"nodes":null}` {
		t.Fatalf("body = %s, want {\"nodes\":null}", got)
	}
}

func TestListSpaceChainNodesKeepsEmptyArrayForEmptyNodeList(t *testing.T) {
	chain := newChainReadFixture()
	chain.Nodes = []domain.SpaceChainNode{}
	router := newChainReadRouter(t, &chainReadRepo{chain: chain})

	rr := chainReadDo(t, router, http.MethodGet, "/v1alpha2/space-chains/"+chainReadID+"/nodes", chainReadMgmtKey, nil)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	if got := strings.TrimSpace(rr.Body.String()); got != `{"nodes":[]}` {
		t.Fatalf("body = %s, want {\"nodes\":[]}", got)
	}
}

// A chain cannot authenticate without a binding, so an empty binding list is
// not reachable through the router; pin the list mapping on the views instead.
func TestSpaceChainViewListsKeepNilAndEmpty(t *testing.T) {
	tests := []struct {
		name string
		got  any
		want string
	}{
		{"nil bindings", newSpaceChainBindingViews(nil), `null`},
		{"empty bindings", newSpaceChainBindingViews([]domain.SpaceChainBinding{}), `[]`},
		{"nil nodes", newSpaceChainNodeViews(nil), `null`},
		{"empty nodes", newSpaceChainNodeViews([]domain.SpaceChainNode{}), `[]`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := json.Marshal(tt.got)
			if err != nil {
				t.Fatal(err)
			}
			if string(raw) != tt.want {
				t.Fatalf("encoded = %s, want %s", raw, tt.want)
			}
		})
	}
}

func TestReplaceSpaceChainNodesAcceptsTenantIDButDoesNotEchoIt(t *testing.T) {
	repo := &chainReadRepo{chain: newChainReadFixture()}
	router := newChainReadRouter(t, repo)

	rr := chainReadDo(t, router, http.MethodPut, "/v1alpha2/space-chains/"+chainReadID+"/nodes", chainReadMgmtKey, map[string]any{
		"nodes": []map[string]any{
			{"tenant_id": chainReadSpaceKeyA, "display_name": "Personal"},
			{"tenant_id": chainReadSpaceKeyB, "external_space_id": "space-team", "display_name": "Team"},
		},
	})

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	if len(repo.chain.Nodes) != 2 || repo.chain.Nodes[0].TenantID != chainReadSpaceKeyA || repo.chain.Nodes[1].TenantID != chainReadSpaceKeyB {
		t.Fatalf("stored nodes = %+v, want request tenant_id values stored", repo.chain.Nodes)
	}
	assertNoSecrets(t, "PUT nodes", rr.Body.String())
	body := decodeJSONObject(t, rr.Body.Bytes())
	assertJSONKeys(t, "PUT nodes", body, "nodes")
	nodes, _ := body["nodes"].([]any)
	if len(nodes) != 2 {
		t.Fatalf("nodes = %v, want 2", body["nodes"])
	}
	assertJSONKeys(t, "node 0", nodes[0],
		"id", "chain_id", "display_name", "position", "routing_policy_enabled", "routing_policy_webhook_only", "created_at", "updated_at")
	// The node that keeps its external_space_id keeps its routing policy.
	assertJSONKeys(t, "node 1", nodes[1],
		"id", "chain_id", "external_space_id", "display_name", "position", "routing_policy_enabled", "routing_policy_prompt", "routing_policy_webhook_only", "created_at", "updated_at")
	if nodes[1].(map[string]any)["routing_policy_prompt"] != "team facts" {
		t.Fatalf("node 1 routing_policy_prompt = %v, want team facts", nodes[1].(map[string]any)["routing_policy_prompt"])
	}
}

func TestUpdateSpaceChainNodeRoutingPolicyResponseOmitsSpaceKey(t *testing.T) {
	router := newChainReadRouter(t, &chainReadRepo{chain: newChainReadFixture()})

	rr := chainReadDo(t, router, http.MethodPut, "/v1alpha2/space-chains/"+chainReadID+"/nodes/n-2/routing-policy", chainReadMgmtKey,
		map[string]any{"enabled": true, "prompt": "team facts", "webhook_only": true})

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	assertNoSecrets(t, "PUT routing-policy", rr.Body.String())
	body := decodeJSONObject(t, rr.Body.Bytes())
	assertJSONKeys(t, "PUT routing-policy", body,
		"id", "chain_id", "external_space_id", "display_name", "position", "routing_policy_enabled", "routing_policy_prompt", "routing_policy_webhook_only", "created_at", "updated_at")
	if body["routing_policy_webhook_only"] != true {
		t.Fatalf("routing_policy_webhook_only = %v, want true", body["routing_policy_webhook_only"])
	}
}

func TestMaskedChainKeyIsNotAUsableAPIKey(t *testing.T) {
	router := newChainReadRouter(t, &chainReadRepo{chain: newChainReadFixture()})

	rr := chainReadDo(t, router, http.MethodGet, "/v1alpha2/space-chains/by-key", "chain_...0001", nil)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rr.Code, rr.Body.String())
	}
}

func TestCreateSpaceChainReturnsBothKeysOnce(t *testing.T) {
	repo := &chainReadRepo{}
	router := newChainReadRouter(t, repo)

	rr := chainReadDo(t, router, http.MethodPost, "/v1alpha2/space-chains", "", map[string]any{"name": "fresh", "created_by_user_id": "user-creator"})

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rr.Code, rr.Body.String())
	}
	body := decodeJSONObject(t, rr.Body.Bytes())
	assertJSONKeys(t, "POST chain", body, "chain", "management_binding", "memory_binding")

	keys := map[string]string{}
	for field, wantRole := range map[string]string{"management_binding": domain.SpaceChainRoleManagement, "memory_binding": domain.SpaceChainRoleMemory} {
		binding, _ := body[field].(map[string]any)
		assertJSONKeys(t, field, binding, "id", "role", "chain_api_key")
		key, _ := binding["chain_api_key"].(string)
		if binding["role"] != wantRole || !strings.HasPrefix(key, domain.ChainKeyPrefix) || len(key) <= 12 {
			t.Fatalf("%s = %v, want role %s and a plaintext chain_ key", field, binding, wantRole)
		}
		keys[wantRole] = key
		if got := strings.Count(rr.Body.String(), key); got != 1 {
			t.Fatalf("%s key appears %d times in the response, want exactly once", field, got)
		}
	}
	if keys[domain.SpaceChainRoleManagement] == keys[domain.SpaceChainRoleMemory] {
		t.Fatal("the two bindings share one key")
	}

	// The chain object is the same masked read model that GET returns.
	chain, _ := body["chain"].(map[string]any)
	assertJSONKeys(t, "POST chain chain", chain, "id", "name", "created_at", "updated_at", "bindings")
	bindings, _ := chain["bindings"].([]any)
	if len(bindings) != 2 {
		t.Fatalf("chain bindings = %v, want 2", chain["bindings"])
	}
	for i, wantRole := range []string{domain.SpaceChainRoleManagement, domain.SpaceChainRoleMemory} {
		assertJSONKeys(t, "chain binding", bindings[i], "id", "chain_id", "role", "masked_chain_api_key", "disabled", "created_at")
		if bindings[i].(map[string]any)["role"] != wantRole {
			t.Fatalf("chain binding %d = %v, want role %s", i, bindings[i], wantRole)
		}
	}

	if repo.chain == nil || len(repo.chain.Bindings) != 2 {
		t.Fatalf("stored chain = %+v, want one chain with two bindings", repo.chain)
	}
	for _, stored := range repo.chain.Bindings {
		if keys[stored.Role] != stored.ChainAPIKey || stored.CreatedByUserID != "user-creator" {
			t.Fatalf("stored binding %+v does not match the response or lacks the creator", stored)
		}
	}

	// Reading the chain back never shows either plaintext key again.
	read := chainReadDo(t, router, http.MethodGet, "/v1alpha2/space-chains/"+repo.chain.ID, keys[domain.SpaceChainRoleManagement], nil)
	if read.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200: %s", read.Code, read.Body.String())
	}
	for _, key := range keys {
		if strings.Contains(read.Body.String(), key) {
			t.Fatalf("GET chain leaks a plaintext key: %s", read.Body.String())
		}
	}
}

func TestCreateSpaceChainKeepsBothKeysUsableForTheirRoles(t *testing.T) {
	repo := &chainReadRepo{}
	router := newChainReadRouter(t, repo)
	created := decodeJSONObject(t, chainReadDo(t, router, http.MethodPost, "/v1alpha2/space-chains", "", map[string]any{"name": "fresh"}).Body.Bytes())
	management := created["management_binding"].(map[string]any)["chain_api_key"].(string)
	memory := created["memory_binding"].(map[string]any)["chain_api_key"].(string)
	path := "/v1alpha2/space-chains/" + repo.chain.ID

	if rr := chainReadDo(t, router, http.MethodGet, path, management, nil); rr.Code != http.StatusOK {
		t.Fatalf("management key status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	if rr := chainReadDo(t, router, http.MethodGet, path, memory, nil); rr.Code != http.StatusUnauthorized {
		t.Fatalf("memory key status = %d, want 401: %s", rr.Code, rr.Body.String())
	}
}

func TestCreateSpaceChainFailureLeavesNothingAndReturnsNoKeys(t *testing.T) {
	repo := &chainReadRepo{createErr: errors.New("store failed")}
	router := newChainReadRouter(t, repo)

	rr := chainReadDo(t, router, http.MethodPost, "/v1alpha2/space-chains", "", map[string]any{"name": "fresh"})

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500: %s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), domain.ChainKeyPrefix) {
		t.Fatalf("failed create returned a key: %s", rr.Body.String())
	}
	if repo.chain != nil {
		t.Fatalf("failed create left %+v behind", repo.chain)
	}
}

func TestIssueSpaceChainKeyReturnsAMemoryKey(t *testing.T) {
	const supplied = "chain_CallerSuppliedKeyValue0000000009"
	tests := []struct {
		name    string
		body    any // nil sends no body at all
		wantKey string
	}{
		{name: "no body", body: nil},
		{name: "empty object", body: map[string]any{}},
		{name: "creator id only", body: map[string]any{"created_by_user_id": "user-new"}},
		{name: "a role in the body is ignored", body: map[string]any{"role": "management"}},
		{name: "caller-supplied key", body: map[string]any{"chain_api_key": supplied}, wantKey: supplied},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &chainReadRepo{chain: newChainReadFixture()}
			router := newChainReadRouter(t, repo)

			rr := chainReadDo(t, router, http.MethodPost, "/v1alpha2/space-chains/"+chainReadID+"/bindings", chainReadMgmtKey, tt.body)

			if rr.Code != http.StatusCreated {
				t.Fatalf("status = %d, want 201: %s", rr.Code, rr.Body.String())
			}
			body := decodeJSONObject(t, rr.Body.Bytes())
			assertJSONKeys(t, "POST binding", body, "id", "chain_id", "role", "chain_api_key", "disabled", "created_at")
			key, _ := body["chain_api_key"].(string)
			if !strings.HasPrefix(key, domain.ChainKeyPrefix) || len(key) <= 12 || (tt.wantKey != "" && key != tt.wantKey) {
				t.Fatalf("chain_api_key = %q, want a plaintext chain_ key (%q)", key, tt.wantKey)
			}
			if body["role"] != domain.SpaceChainRoleMemory || body["chain_id"] != chainReadID || body["disabled"] != false {
				t.Fatalf("binding = %v, want an active memory key of this chain", body)
			}
			if body["created_at"] != chainReadTime.Format(time.RFC3339) {
				t.Fatalf("created_at = %v, want the stored time %s", body["created_at"], chainReadTime.Format(time.RFC3339))
			}
			stored := repo.chain.Bindings[len(repo.chain.Bindings)-1]
			if stored.ChainAPIKey != key || stored.Role != domain.SpaceChainRoleMemory {
				t.Fatalf("stored binding = %+v, want the returned key as a memory binding", stored)
			}
		})
	}
}

func TestIssueSpaceChainKeyStoresTheCreatorButDoesNotReturnIt(t *testing.T) {
	repo := &chainReadRepo{chain: newChainReadFixture()}
	router := newChainReadRouter(t, repo)

	rr := chainReadDo(t, router, http.MethodPost, "/v1alpha2/space-chains/"+chainReadID+"/bindings", chainReadMgmtKey,
		map[string]any{"created_by_user_id": "user-new"})

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "user-new") {
		t.Fatalf("response returns the creator id: %s", rr.Body.String())
	}
	if got := repo.chain.Bindings[len(repo.chain.Bindings)-1].CreatedByUserID; got != "user-new" {
		t.Fatalf("stored creator = %q, want user-new", got)
	}
}

func TestIssueSpaceChainKeyRefusesADuplicateKey(t *testing.T) {
	repo := &chainReadRepo{chain: newChainReadFixture()}
	router := newChainReadRouter(t, repo)

	rr := chainReadDo(t, router, http.MethodPost, "/v1alpha2/space-chains/"+chainReadID+"/bindings", chainReadMgmtKey,
		map[string]any{"chain_api_key": chainReadMemoryKey})

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", rr.Code, rr.Body.String())
	}
	if len(repo.chain.Bindings) != 3 {
		t.Fatalf("bindings = %d, want 3 (nothing added)", len(repo.chain.Bindings))
	}
}

func TestIssueSpaceChainKeyKeepsBodyErrors(t *testing.T) {
	tests := []struct {
		name string
		body string
		want int
	}{
		{name: "invalid JSON", body: `{"chain_api_key":`, want: http.StatusBadRequest},
		{name: "key without the chain_ prefix", body: `{"chain_api_key":"mk_not_a_chain_key"}`, want: http.StatusBadRequest},
		{name: "oversized body", body: `{"created_by_user_id":"` + strings.Repeat("a", 1<<20) + `"}`, want: http.StatusRequestEntityTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := newChainReadRouter(t, &chainReadRepo{chain: newChainReadFixture()})
			req := httptest.NewRequest(http.MethodPost, "/v1alpha2/space-chains/"+chainReadID+"/bindings", strings.NewReader(tt.body))
			req.Header.Set("X-API-Key", chainReadMgmtKey)
			rr := httptest.NewRecorder()

			router.ServeHTTP(rr, req)

			if rr.Code != tt.want {
				t.Fatalf("status = %d, want %d: %.200s", rr.Code, tt.want, rr.Body.String())
			}
		})
	}
}

// Every route under a chain id, the lookup by key, and the chain webhook routes
// need a management key. The memory routes are not in this table: they accept
// any active chain key, and a middleware test covers that.
func TestSpaceChainAdministrationRoutesRequireAManagementKey(t *testing.T) {
	const base = "/v1alpha2/space-chains/" + chainReadID
	routes := []struct {
		name   string
		method string
		path   string
		body   any
		want   int // status for a management key
	}{
		{"read chain", http.MethodGet, base, nil, http.StatusOK},
		{"update chain", http.MethodPatch, base, map[string]any{"name": "renamed"}, http.StatusOK},
		{"delete chain", http.MethodDelete, base, nil, http.StatusNoContent},
		{"list nodes", http.MethodGet, base + "/nodes", nil, http.StatusOK},
		{"replace nodes", http.MethodPut, base + "/nodes", map[string]any{"nodes": []map[string]any{{"tenant_id": chainReadSpaceKeyA}}}, http.StatusOK},
		{"routing policy", http.MethodPut, base + "/nodes/n-2/routing-policy", map[string]any{"enabled": true, "prompt": "team facts"}, http.StatusOK},
		{"list bindings", http.MethodGet, base + "/bindings", nil, http.StatusOK},
		{"issue key", http.MethodPost, base + "/bindings", map[string]any{}, http.StatusCreated},
		{"disable key", http.MethodPatch, base + "/bindings/b-3", map[string]any{"disabled": true}, http.StatusNoContent},
		// The chain webhook routes pass the key check and then stop at the missing webhook service of this test.
		{"list webhooks", http.MethodGet, base + "/webhooks", nil, http.StatusServiceUnavailable},
		{"create webhook", http.MethodPost, base + "/webhooks", map[string]any{}, http.StatusServiceUnavailable},
		{"list webhook deliveries", http.MethodGet, base + "/webhook-deliveries", nil, http.StatusServiceUnavailable},
		{"lookup by key", http.MethodGet, "/v1alpha2/space-chains/by-key", nil, http.StatusOK},
	}
	for _, rt := range routes {
		t.Run(rt.name, func(t *testing.T) {
			do := func(key string) *httptest.ResponseRecorder {
				router := newChainReadRouter(t, &chainReadRepo{chain: newChainReadFixture()})
				return chainReadDo(t, router, rt.method, rt.path, key, rt.body)
			}

			if rr := do(chainReadMgmtKey); rr.Code != rt.want {
				t.Fatalf("management key: status = %d, want %d: %s", rr.Code, rt.want, rr.Body.String())
			}

			rr := do(chainReadMemoryKey)
			if rr.Code != http.StatusUnauthorized {
				t.Fatalf("memory key: status = %d, want 401: %s", rr.Code, rr.Body.String())
			}
			body := decodeJSONObject(t, rr.Body.Bytes())
			assertJSONKeys(t, "401 body", body, "error")
			if body["error"] != domain.ErrManagementKeyRequired.Error() {
				t.Fatalf("401 message = %v, want %q", body["error"], domain.ErrManagementKeyRequired.Error())
			}
			assertNoSecrets(t, "401 body", rr.Body.String())

			// A key that is unknown or disabled is still not found, not a role error.
			for name, key := range map[string]string{"unknown": "chain_UnknownKeyValue00000000000000", "disabled": chainReadOtherKey} {
				if rr := do(key); rr.Code != http.StatusNotFound {
					t.Fatalf("%s key: status = %d, want 404: %s", name, rr.Code, rr.Body.String())
				}
			}
		})
	}
}

func TestSpaceChainAdministrationKeepsNotFoundForAnotherChain(t *testing.T) {
	router := newChainReadRouter(t, &chainReadRepo{chain: newChainReadFixture()})

	for name, key := range map[string]string{"management key": chainReadMgmtKey, "memory key": chainReadMemoryKey} {
		rr := chainReadDo(t, router, http.MethodGet, "/v1alpha2/space-chains/chain-2", key, nil)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("%s on another chain: status = %d, want 404: %s", name, rr.Code, rr.Body.String())
		}
	}
}

func TestSpaceChainDisableKeyRulesOverHTTP(t *testing.T) {
	const base = "/v1alpha2/space-chains/" + chainReadID + "/bindings/"
	disable := func(router http.Handler, id string) *httptest.ResponseRecorder {
		return chainReadDo(t, router, http.MethodPatch, base+id, chainReadMgmtKey, map[string]any{"disabled": true})
	}

	t.Run("the last management key is kept", func(t *testing.T) {
		rr := disable(newChainReadRouter(t, &chainReadRepo{chain: newChainReadFixture()}), "b-1")
		if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "at least one management key must remain active") {
			t.Fatalf("status/body = %d/%s, want 400 naming the management key rule", rr.Code, rr.Body.String())
		}
	})
	t.Run("a memory key can be disabled and then stops working", func(t *testing.T) {
		router := newChainReadRouter(t, &chainReadRepo{chain: newChainReadFixture()})
		if rr := disable(router, "b-3"); rr.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204: %s", rr.Code, rr.Body.String())
		}
		if rr := chainReadDo(t, router, http.MethodGet, "/v1alpha2/space-chains/by-key", chainReadMemoryKey, nil); rr.Code != http.StatusNotFound {
			t.Fatalf("disabled memory key: status = %d, want 404: %s", rr.Code, rr.Body.String())
		}
	})
}
