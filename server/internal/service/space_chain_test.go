package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestSpaceChainCreateGeneratesChainKeyPrefix(t *testing.T) {
	repo := &fakeSpaceChainRepo{}
	svc := NewSpaceChainService(repo)

	result, err := svc.Create(context.Background(), CreateSpaceChainRequest{Name: "My Chain"})
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}
	if result.Chain == nil || result.Chain.ID == "" {
		t.Fatalf("expected created chain with id, got %#v", result.Chain)
	}
	if !strings.HasPrefix(result.ChainKey, domain.ChainKeyPrefix) {
		t.Fatalf("expected chain key prefix %q, got %q", domain.ChainKeyPrefix, result.ChainKey)
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

func TestSpaceChainDisableBindingRejectsLastActiveKey(t *testing.T) {
	repo := &fakeSpaceChainRepo{
		chain: &domain.SpaceChain{
			ID: "chain-1",
			Bindings: []domain.SpaceChainBinding{
				{ID: "binding-1", ChainID: "chain-1", ChainAPIKey: "chain_key"},
			},
		},
	}
	svc := NewSpaceChainService(repo)

	err := svc.DisableBinding(context.Background(), "chain-1", "binding-1", "user-1")
	var validation *domain.ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("expected validation error, got %T: %v", err, err)
	}
	if !strings.Contains(validation.Message, "at least one Space Chain key must remain active") {
		t.Fatalf("validation message = %q", validation.Message)
	}
}

type fakeSpaceChainRepo struct {
	chain             *domain.SpaceChain
	nodes             []domain.SpaceChainNode
	disabledBindingID string
}

func (r *fakeSpaceChainRepo) Create(_ context.Context, chain *domain.SpaceChain, binding *domain.SpaceChainBinding) error {
	copied := *chain
	if binding != nil {
		copied.Bindings = []domain.SpaceChainBinding{*binding}
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

func (r *fakeSpaceChainRepo) GetByKey(_ context.Context, _ string) (*domain.SpaceChain, error) {
	if r.chain == nil {
		return nil, domain.ErrNotFound
	}
	return r.chain, nil
}

func (r *fakeSpaceChainRepo) GetByKeyIncludingDisabled(_ context.Context, _ string) (*domain.SpaceChain, error) {
	if r.chain == nil {
		return nil, domain.ErrNotFound
	}
	return r.chain, nil
}

func (r *fakeSpaceChainRepo) Update(_ context.Context, chain *domain.SpaceChain) error {
	r.chain = chain
	return nil
}

func (r *fakeSpaceChainRepo) SoftDelete(_ context.Context, _, _ string) error { return nil }

func (r *fakeSpaceChainRepo) CreateBinding(_ context.Context, binding *domain.SpaceChainBinding) error {
	if r.chain != nil {
		r.chain.Bindings = append(r.chain.Bindings, *binding)
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
