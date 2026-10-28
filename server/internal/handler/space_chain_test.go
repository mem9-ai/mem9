package handler

import (
	"bytes"
	"context"
	"encoding/json"
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
	chainReadSpaceKeyA = "space-key-secret-aaaaaaaaaaaa"
	chainReadSpaceKeyB = "space-key-secret-bbbbbbbbbbbb"
)

func chainReadSecrets() []string {
	return []string{chainReadMgmtKey, chainReadOtherKey, chainReadSpaceKeyA, chainReadSpaceKeyB}
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
			{ID: "b-1", ChainID: chainReadID, ChainAPIKey: chainReadMgmtKey, CreatedByUserID: "user-creator", CreatedAt: ts},
			{ID: "b-2", ChainID: chainReadID, ChainAPIKey: chainReadOtherKey, CreatedByUserID: "user-other", Disabled: true, DisabledAt: &ts, DisabledByUserID: "user-admin", CreatedAt: ts},
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
	chain *domain.SpaceChain
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

func (r *chainReadRepo) Create(_ context.Context, chain *domain.SpaceChain, binding *domain.SpaceChainBinding) error {
	cp := *chain
	binding.CreatedAt = chainReadTime
	cp.CreatedAt = chainReadTime
	cp.UpdatedAt = chainReadTime
	cp.Bindings = []domain.SpaceChainBinding{*binding}
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
	binding.CreatedAt = chainReadTime
	r.chain.Bindings = append(r.chain.Bindings, *binding)
	return nil
}

func (r *chainReadRepo) ListBindings(context.Context, string) ([]domain.SpaceChainBinding, error) {
	if r.chain == nil {
		return nil, nil
	}
	return cloneKeepingNil(r.chain.Bindings), nil
}

func (r *chainReadRepo) DisableBinding(context.Context, string, string, string) error { return nil }

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

func assertChainReadBody(t *testing.T, label string, chain map[string]any) {
	t.Helper()
	assertJSONKeys(t, label, chain,
		"id", "project_id", "name", "description", "created_at", "updated_at", "bindings", "nodes")
	bindings, _ := chain["bindings"].([]any)
	if len(bindings) != 2 {
		t.Fatalf("%s bindings = %v, want 2", label, chain["bindings"])
	}
	assertJSONKeys(t, label+" binding 0", bindings[0],
		"id", "chain_id", "masked_chain_api_key", "disabled", "created_at")
	assertJSONKeys(t, label+" binding 1", bindings[1],
		"id", "chain_id", "masked_chain_api_key", "disabled", "disabled_at", "disabled_by_user_id", "created_at")
	if got := bindings[0].(map[string]any)["masked_chain_api_key"]; got != "chain_...0001" {
		t.Fatalf("%s binding 0 mask = %v, want chain_...0001", label, got)
	}
	if got := bindings[1].(map[string]any)["masked_chain_api_key"]; got != "chain_...0002" {
		t.Fatalf("%s binding 1 mask = %v, want chain_...0002", label, got)
	}
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
	bindings, _ := body["bindings"].([]any)
	if len(bindings) != 2 {
		t.Fatalf("bindings = %v, want 2", body["bindings"])
	}
	assertJSONKeys(t, "binding 0", bindings[0], "id", "chain_id", "masked_chain_api_key", "disabled", "created_at")
	assertJSONKeys(t, "binding 1", bindings[1], "id", "chain_id", "masked_chain_api_key", "disabled", "disabled_at", "disabled_by_user_id", "created_at")
	if got := bindings[0].(map[string]any)["masked_chain_api_key"]; got != "chain_...0001" {
		t.Fatalf("binding 0 mask = %v, want chain_...0001", got)
	}
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

func TestCreateSpaceChainStillReturnsPlaintextKeyOnce(t *testing.T) {
	repo := &chainReadRepo{}
	router := newChainReadRouter(t, repo)

	rr := chainReadDo(t, router, http.MethodPost, "/v1alpha2/space-chains", "", map[string]any{"name": "fresh"})

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rr.Code, rr.Body.String())
	}
	body := decodeJSONObject(t, rr.Body.Bytes())
	assertJSONKeys(t, "POST chain", body, "chain", "chain_api_key", "binding_id", "key_prefix", "key_preview")
	key, _ := body["chain_api_key"].(string)
	if !strings.HasPrefix(key, domain.ChainKeyPrefix) || len(key) <= 12 {
		t.Fatalf("chain_api_key = %q, want plaintext chain_ key", key)
	}
	if body["key_prefix"] != domain.ChainKeyPrefix || body["key_preview"] != key[:12]+"..." {
		t.Fatalf("key_prefix/key_preview = %v/%v, want chain_ and first 12 bytes plus ...", body["key_prefix"], body["key_preview"])
	}
	if repo.chain == nil || repo.chain.Bindings[0].ChainAPIKey != key {
		t.Fatalf("stored key does not match the returned key")
	}
}

func TestCreateSpaceChainBindingStillReturnsPlaintextKey(t *testing.T) {
	repo := &chainReadRepo{chain: newChainReadFixture()}
	router := newChainReadRouter(t, repo)

	rr := chainReadDo(t, router, http.MethodPost, "/v1alpha2/space-chains/"+chainReadID+"/bindings", chainReadMgmtKey,
		map[string]any{"created_by_user_id": "user-new"})

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rr.Code, rr.Body.String())
	}
	body := decodeJSONObject(t, rr.Body.Bytes())
	assertJSONKeys(t, "POST binding", body, "id", "chain_id", "chain_api_key", "created_by_user_id", "disabled", "created_at")
	if key, _ := body["chain_api_key"].(string); !strings.HasPrefix(key, domain.ChainKeyPrefix) || len(key) <= 12 {
		t.Fatalf("chain_api_key = %q, want plaintext chain_ key", key)
	}
}
