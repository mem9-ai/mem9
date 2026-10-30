package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestSpaceChainCreateIssuesAManagementKeyAndAMemoryKey(t *testing.T) {
	repo := &fakeSpaceChainRepo{}
	svc := NewSpaceChainService(repo)

	result, err := svc.Create(context.Background(), CreateSpaceChainRequest{Name: "My Chain", CreatedByUserID: "user-1"})
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}
	if result.Chain == nil || result.Chain.ID == "" {
		t.Fatalf("expected created chain with id, got %#v", result.Chain)
	}
	if len(repo.createdBindings) != 2 {
		t.Fatalf("expected both bindings in one store call, got %d", len(repo.createdBindings))
	}
	management, memory := result.ManagementBinding, result.MemoryBinding
	if management == nil || memory == nil {
		t.Fatalf("expected both bindings in the result, got %#v and %#v", management, memory)
	}
	if management.Role != domain.SpaceChainRoleManagement || memory.Role != domain.SpaceChainRoleMemory {
		t.Fatalf("roles = %q and %q, want management and memory", management.Role, memory.Role)
	}
	for _, b := range []*domain.SpaceChainBinding{management, memory} {
		if !strings.HasPrefix(b.ChainAPIKey, domain.ChainKeyPrefix) {
			t.Fatalf("expected chain key prefix %q, got %q", domain.ChainKeyPrefix, b.ChainAPIKey)
		}
		if b.ChainID != result.Chain.ID || b.CreatedByUserID != "user-1" {
			t.Fatalf("binding %#v does not carry the chain id and creator", b)
		}
	}
	if management.ChainAPIKey == memory.ChainAPIKey || management.ID == memory.ID {
		t.Fatalf("the two bindings must differ, got %#v and %#v", management, memory)
	}
	if repo.createdBindings[0].Role != domain.SpaceChainRoleManagement || repo.createdBindings[1].Role != domain.SpaceChainRoleMemory {
		t.Fatalf("stored roles = %q and %q", repo.createdBindings[0].Role, repo.createdBindings[1].Role)
	}
}

func TestSpaceChainCreateReturnsNoKeysWhenTheStoreFails(t *testing.T) {
	boom := errors.New("store failed")
	svc := NewSpaceChainService(&fakeSpaceChainRepo{createErr: boom})

	result, err := svc.Create(context.Background(), CreateSpaceChainRequest{Name: "My Chain"})

	if !errors.Is(err, boom) || result != nil {
		t.Fatalf("Create = %#v, %v; want nil result and the store error", result, err)
	}
}

func TestSpaceChainCreateBindingIssuesAMemoryKey(t *testing.T) {
	tests := []struct {
		name string
		key  string
	}{
		{name: "generated key"},
		{name: "caller-supplied key", key: "chain_supplied"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeSpaceChainRepo{chain: &domain.SpaceChain{ID: "chain-1"}}
			svc := NewSpaceChainService(repo)

			binding, err := svc.CreateBinding(context.Background(), "chain-1", CreateSpaceChainBindingRequest{ChainAPIKey: tt.key})
			if err != nil {
				t.Fatalf("CreateBinding returned error: %v", err)
			}
			if binding.Role != domain.SpaceChainRoleMemory {
				t.Fatalf("role = %q, want memory", binding.Role)
			}
			if !binding.CreatedAt.Equal(fakeStoredAt) {
				t.Fatalf("created_at = %v, want the stored time %v", binding.CreatedAt, fakeStoredAt)
			}
			if tt.key != "" && binding.ChainAPIKey != tt.key {
				t.Fatalf("key = %q, want the supplied key", binding.ChainAPIKey)
			}
			if !strings.HasPrefix(binding.ChainAPIKey, domain.ChainKeyPrefix) {
				t.Fatalf("expected chain key prefix, got %q", binding.ChainAPIKey)
			}
			if len(repo.chain.Bindings) != 1 || repo.chain.Bindings[0].Role != domain.SpaceChainRoleMemory {
				t.Fatalf("stored bindings = %#v, want one memory binding", repo.chain.Bindings)
			}
		})
	}
}

func TestSpaceChainReplaceNodesUsesZeroBasedPositions(t *testing.T) {
	repo := &fakeSpaceChainRepo{}
	svc := NewSpaceChainService(repo)

	nodes, err := svc.ReplaceNodes(context.Background(), "chain-1", ReplaceSpaceChainNodesRequest{
		Nodes: []SpaceChainNodeInput{
			{TenantID: "space-1", ExternalSpaceID: "console-space-1"},
			{TenantID: "space-2", ExternalSpaceID: "console-space-2"},
		},
	})
	if err != nil {
		t.Fatalf("ReplaceNodes returned error: %v", err)
	}
	if len(nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(nodes))
	}
	if nodes[0].Position != 0 || nodes[1].Position != 1 {
		t.Fatalf("expected 0-based positions, got %d and %d", nodes[0].Position, nodes[1].Position)
	}
}

func TestSpaceChainReplaceNodesRejectsDuplicates(t *testing.T) {
	repo := &fakeSpaceChainRepo{}
	svc := NewSpaceChainService(repo)

	_, err := svc.ReplaceNodes(context.Background(), "chain-1", ReplaceSpaceChainNodesRequest{
		Nodes: []SpaceChainNodeInput{
			{TenantID: "space-1", ExternalSpaceID: "console-space-1"},
			{TenantID: "space-1", ExternalSpaceID: "console-space-2"},
		},
	})
	var validation *domain.ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("expected duplicate tenant validation error, got %T: %v", err, err)
	}

	_, err = svc.ReplaceNodes(context.Background(), "chain-1", ReplaceSpaceChainNodesRequest{
		Nodes: []SpaceChainNodeInput{
			{TenantID: "space-1", ExternalSpaceID: "console-space-1"},
			{TenantID: "space-2", ExternalSpaceID: "console-space-1"},
		},
	})
	if !errors.As(err, &validation) {
		t.Fatalf("expected duplicate external space validation error, got %T: %v", err, err)
	}
}

func TestSpaceChainReplaceNodesRejectsChainKeyNode(t *testing.T) {
	repo := &fakeSpaceChainRepo{}
	svc := NewSpaceChainService(repo)

	_, err := svc.ReplaceNodes(context.Background(), "chain-1", ReplaceSpaceChainNodesRequest{
		Nodes: []SpaceChainNodeInput{{TenantID: "chain_abc"}},
	})
	var validation *domain.ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("expected chain node validation error, got %T: %v", err, err)
	}
}

func TestSpaceChainReplaceNodesPreservesRoutingPolicyForSameSpace(t *testing.T) {
	repo := &fakeSpaceChainRepo{
		nodes: []domain.SpaceChainNode{
			{
				ID:                       "node-1",
				ChainID:                  "chain-1",
				TenantID:                 "tenant-1",
				ExternalSpaceID:          "space-1",
				Position:                 1,
				RoutingPolicyEnabled:     true,
				RoutingPolicyPrompt:      "facts about mem9",
				RoutingPolicyWebhookOnly: true,
			},
		},
	}
	svc := NewSpaceChainService(repo)

	nodes, err := svc.ReplaceNodes(context.Background(), "chain-1", ReplaceSpaceChainNodesRequest{
		Nodes: []SpaceChainNodeInput{
			{TenantID: "tenant-0", ExternalSpaceID: "space-0"},
			{TenantID: "tenant-1", ExternalSpaceID: "space-1"},
		},
	})
	if err != nil {
		t.Fatalf("ReplaceNodes returned error: %v", err)
	}
	if len(nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(nodes))
	}
	if !nodes[1].RoutingPolicyEnabled || nodes[1].RoutingPolicyPrompt != "facts about mem9" || !nodes[1].RoutingPolicyWebhookOnly {
		t.Fatalf("routing policy was not preserved: %#v", nodes[1])
	}
}

func TestSpaceChainUpdateRoutingPolicyRejectsFirstNode(t *testing.T) {
	repo := &fakeSpaceChainRepo{
		nodes: []domain.SpaceChainNode{
			{ID: "node-0", ChainID: "chain-1", TenantID: "tenant-0", ExternalSpaceID: "space-0", Position: 0},
			{ID: "node-1", ChainID: "chain-1", TenantID: "tenant-1", ExternalSpaceID: "space-1", Position: 1},
		},
	}
	svc := NewSpaceChainService(repo)

	_, err := svc.UpdateNodeRoutingPolicy(context.Background(), "chain-1", "node-0", UpdateSpaceChainNodeRoutingPolicyRequest{
		Enabled: true,
		Prompt:  "facts about mem9",
	})
	var validation *domain.ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("expected validation error, got %T: %v", err, err)
	}
	if !strings.Contains(validation.Message, "first Space Chain node") {
		t.Fatalf("validation message = %q", validation.Message)
	}
}

func TestSpaceChainUpdateRoutingPolicyRequiresPromptWhenEnabled(t *testing.T) {
	repo := &fakeSpaceChainRepo{
		nodes: []domain.SpaceChainNode{
			{ID: "node-1", ChainID: "chain-1", TenantID: "tenant-1", ExternalSpaceID: "space-1", Position: 1},
		},
	}
	svc := NewSpaceChainService(repo)

	_, err := svc.UpdateNodeRoutingPolicy(context.Background(), "chain-1", "node-1", UpdateSpaceChainNodeRoutingPolicyRequest{
		Enabled: true,
	})
	var validation *domain.ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("expected validation error, got %T: %v", err, err)
	}
	if validation.Field != "prompt" {
		t.Fatalf("validation field = %q, want prompt", validation.Field)
	}
}

func TestSpaceChainDisableBinding(t *testing.T) {
	binding := func(id, role string, disabled bool) domain.SpaceChainBinding {
		return domain.SpaceChainBinding{ID: id, ChainID: "chain-1", ChainAPIKey: "chain_" + id, Role: role, Disabled: disabled}
	}
	const management, memory = domain.SpaceChainRoleManagement, domain.SpaceChainRoleMemory

	tests := []struct {
		name     string
		bindings []domain.SpaceChainBinding
		target   string
		wantErr  string // substring of a validation message
		notFound bool
	}{
		{
			name:     "the only active management key is kept",
			bindings: []domain.SpaceChainBinding{binding("m1", management, false), binding("k1", memory, false), binding("k2", memory, false)},
			target:   "m1",
			wantErr:  "at least one management key must remain active",
		},
		{
			name:     "a management key whose twin is already disabled is kept",
			bindings: []domain.SpaceChainBinding{binding("m1", management, false), binding("m2", management, true)},
			target:   "m1",
			wantErr:  "at least one management key must remain active",
		},
		{
			name:     "one of two management keys can go",
			bindings: []domain.SpaceChainBinding{binding("m1", management, false), binding("m2", management, false), binding("k1", memory, false)},
			target:   "m1",
		},
		{
			name:     "a memory key can go while a management key stays",
			bindings: []domain.SpaceChainBinding{binding("m1", management, false), binding("k1", memory, false)},
			target:   "k1",
		},
		{
			name:     "the last active memory key can go",
			bindings: []domain.SpaceChainBinding{binding("m1", management, false), binding("k1", memory, false), binding("k2", memory, true)},
			target:   "k1",
		},
		{
			name:     "a binding without a recognized role does not count as management",
			bindings: []domain.SpaceChainBinding{binding("m1", management, false), binding("x1", "", false)},
			target:   "x1",
		},
		{
			name:     "a binding without a recognized role does not keep the last management key alive",
			bindings: []domain.SpaceChainBinding{binding("m1", management, false), binding("x1", "", false)},
			target:   "m1",
			wantErr:  "at least one management key must remain active",
		},
		{
			name:     "a disabled binding is not found",
			bindings: []domain.SpaceChainBinding{binding("m1", management, false), binding("k1", memory, true)},
			target:   "k1",
			notFound: true,
		},
		{
			name:     "an unknown binding is not found",
			bindings: []domain.SpaceChainBinding{binding("m1", management, false)},
			target:   "nope",
			notFound: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeSpaceChainRepo{chain: &domain.SpaceChain{ID: "chain-1", Bindings: tt.bindings}}
			svc := NewSpaceChainService(repo)

			err := svc.DisableBinding(context.Background(), "chain-1", tt.target, "user-1")

			switch {
			case tt.notFound:
				if !errors.Is(err, domain.ErrNotFound) {
					t.Fatalf("error = %v, want not found", err)
				}
			case tt.wantErr != "":
				var validation *domain.ValidationError
				if !errors.As(err, &validation) || !strings.Contains(validation.Message, tt.wantErr) {
					t.Fatalf("error = %v, want validation error containing %q", err, tt.wantErr)
				}
			default:
				if err != nil {
					t.Fatalf("DisableBinding returned error: %v", err)
				}
			}
			wantDisabled := ""
			if !tt.notFound && tt.wantErr == "" {
				wantDisabled = tt.target
			}
			if repo.disabledBindingID != wantDisabled {
				t.Fatalf("disabled binding = %q, want %q", repo.disabledBindingID, wantDisabled)
			}
		})
	}
}

func TestSpaceChainManagementCheck(t *testing.T) {
	chainWith := func(role string) *domain.SpaceChain {
		return &domain.SpaceChain{ID: "chain-1", Bindings: []domain.SpaceChainBinding{
			{ID: "binding-1", ChainID: "chain-1", ChainAPIKey: "chain_presented", Role: role},
			{ID: "binding-2", ChainID: "chain-1", ChainAPIKey: "chain_other", Role: domain.SpaceChainRoleManagement},
		}}
	}
	tests := []struct {
		name    string
		role    string
		chainID string
		key     string
		want    error
	}{
		{name: "a management key passes", role: domain.SpaceChainRoleManagement, chainID: "chain-1", key: "chain_presented"},
		{name: "a memory key is refused", role: domain.SpaceChainRoleMemory, chainID: "chain-1", key: "chain_presented", want: domain.ErrManagementKeyRequired},
		{name: "an empty role is refused", role: "", chainID: "chain-1", key: "chain_presented", want: domain.ErrManagementKeyRequired},
		{name: "an unknown role is refused", role: "admin", chainID: "chain-1", key: "chain_presented", want: domain.ErrManagementKeyRequired},
		{name: "a role must match exactly", role: "Management", chainID: "chain-1", key: "chain_presented", want: domain.ErrManagementKeyRequired},
		{name: "another chain is not found before the role is looked at", role: domain.SpaceChainRoleMemory, chainID: "chain-2", key: "chain_presented", want: domain.ErrNotFound},
		{name: "an unknown key is not found", role: domain.SpaceChainRoleManagement, chainID: "chain-1", key: "chain_unknown", want: domain.ErrNotFound},
	}
	for _, tt := range tests {
		t.Run("authorize "+tt.name, func(t *testing.T) {
			svc := NewSpaceChainService(&fakeSpaceChainRepo{chain: chainWith(tt.role)})

			chain, err := svc.AuthorizeManagement(context.Background(), tt.chainID, tt.key)

			if !errors.Is(err, tt.want) || (tt.want == nil) != (chain != nil) {
				t.Fatalf("AuthorizeManagement = %v, %v; want error %v", chain, err, tt.want)
			}
		})
		if tt.chainID != "chain-1" {
			continue // the lookup by key has no chain id
		}
		t.Run("lookup by key "+tt.name, func(t *testing.T) {
			svc := NewSpaceChainService(&fakeSpaceChainRepo{chain: chainWith(tt.role)})

			chain, err := svc.GetByManagementKey(context.Background(), tt.key)

			if !errors.Is(err, tt.want) || (tt.want == nil) != (chain != nil) {
				t.Fatalf("GetByManagementKey = %v, %v; want error %v", chain, err, tt.want)
			}
		})
	}
}

func TestSpaceChainManagementErrorDoesNotEchoTheKey(t *testing.T) {
	svc := NewSpaceChainService(&fakeSpaceChainRepo{chain: &domain.SpaceChain{ID: "chain-1", Bindings: []domain.SpaceChainBinding{
		{ID: "binding-1", ChainID: "chain-1", ChainAPIKey: "chain_secret_memory_key", Role: domain.SpaceChainRoleMemory},
	}}})

	_, err := svc.AuthorizeManagement(context.Background(), "chain-1", "chain_secret_memory_key")

	if err == nil || strings.Contains(err.Error(), "chain_secret_memory_key") {
		t.Fatalf("error = %v, want one that does not contain the key", err)
	}
}

func TestSpaceChainAuthorizeManagementRejectsDisabledKey(t *testing.T) {
	repo := &fakeSpaceChainRepo{
		chain: &domain.SpaceChain{
			ID: "chain-1",
			Bindings: []domain.SpaceChainBinding{
				{
					ID:          "binding-1",
					ChainID:     "chain-1",
					ChainAPIKey: "chain_disabled",
					Disabled:    true,
				},
			},
		},
		getByKeyErr: domain.ErrNotFound,
	}
	svc := NewSpaceChainService(repo)

	_, err := svc.AuthorizeManagement(context.Background(), "chain-1", "chain_disabled")
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected disabled key to be rejected, got %T: %v", err, err)
	}
}

type fakeSpaceChainRepo struct {
	chain             *domain.SpaceChain
	nodes             []domain.SpaceChainNode
	disabledBindingID string
	getByKeyErr       error
	createErr         error
	createdBindings   []domain.SpaceChainBinding
}

func (r *fakeSpaceChainRepo) Create(_ context.Context, chain *domain.SpaceChain, bindings ...*domain.SpaceChainBinding) error {
	if r.createErr != nil {
		return r.createErr
	}
	copied := *chain
	copied.Bindings = nil
	for _, b := range bindings {
		copied.Bindings = append(copied.Bindings, *b)
		r.createdBindings = append(r.createdBindings, *b)
	}
	r.chain = &copied
	return nil
}

func (r *fakeSpaceChainRepo) GetByID(_ context.Context, id string) (*domain.SpaceChain, error) {
	if r.chain == nil {
		return &domain.SpaceChain{ID: id, Name: "fake", Bindings: nil, Nodes: r.nodes}, nil
	}
	copied := *r.chain
	copied.Nodes = r.nodes
	return &copied, nil
}

// GetByKey finds the chain by an active binding's key, like the real stores do.
func (r *fakeSpaceChainRepo) GetByKey(_ context.Context, key string) (*domain.SpaceChain, error) {
	if r.getByKeyErr != nil {
		return nil, r.getByKeyErr
	}
	if r.chain == nil {
		return nil, domain.ErrNotFound
	}
	for _, b := range r.chain.Bindings {
		if b.ChainAPIKey == key && !b.Disabled {
			return r.chain, nil
		}
	}
	return nil, domain.ErrNotFound
}

func (r *fakeSpaceChainRepo) Update(_ context.Context, chain *domain.SpaceChain) error {
	r.chain = chain
	return nil
}

func (r *fakeSpaceChainRepo) SoftDelete(_ context.Context, _, _ string) error { return nil }

// fakeStoredAt is the time the fake store gives a new binding. Like the
// database, it sets it on the stored row, not on the value the caller passed.
var fakeStoredAt = time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)

func (r *fakeSpaceChainRepo) CreateBinding(_ context.Context, binding *domain.SpaceChainBinding) error {
	if r.chain != nil {
		stored := *binding
		stored.CreatedAt = fakeStoredAt
		r.chain.Bindings = append(r.chain.Bindings, stored)
	}
	return nil
}

func (r *fakeSpaceChainRepo) ListBindings(_ context.Context, _ string) ([]domain.SpaceChainBinding, error) {
	if r.chain == nil {
		return nil, nil
	}
	return r.chain.Bindings, nil
}

func (r *fakeSpaceChainRepo) DisableBinding(_ context.Context, _, bindingID, _ string) error {
	r.disabledBindingID = bindingID
	return nil
}

func (r *fakeSpaceChainRepo) ListNodes(_ context.Context, _ string) ([]domain.SpaceChainNode, error) {
	return r.nodes, nil
}

func (r *fakeSpaceChainRepo) ReplaceNodes(_ context.Context, _ string, nodes []domain.SpaceChainNode) error {
	r.nodes = append([]domain.SpaceChainNode(nil), nodes...)
	return nil
}

func (r *fakeSpaceChainRepo) UpdateNodeRoutingPolicy(_ context.Context, _, nodeID string, enabled bool, prompt string, webhookOnly bool) (*domain.SpaceChainNode, error) {
	for i := range r.nodes {
		if r.nodes[i].ID != nodeID {
			continue
		}
		r.nodes[i].RoutingPolicyEnabled = enabled
		r.nodes[i].RoutingPolicyPrompt = prompt
		r.nodes[i].RoutingPolicyWebhookOnly = webhookOnly
		return &r.nodes[i], nil
	}
	return nil, domain.ErrNotFound
}

func (r *fakeSpaceChainRepo) RemoveNodeByExternalSpaceID(_ context.Context, _ string) error {
	return nil
}

func (r *fakeSpaceChainRepo) KeyStatus(_ context.Context, _ string) (domain.KeyStatus, error) {
	return domain.KeyStatusActive, nil
}
