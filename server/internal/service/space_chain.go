package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/repository"
)

type SpaceChainService struct {
	chains repository.SpaceChainRepo
}

func NewSpaceChainService(chains repository.SpaceChainRepo) *SpaceChainService {
	return &SpaceChainService{chains: chains}
}

type CreateSpaceChainRequest struct {
	ProjectID       string `json:"project_id,omitempty"`
	Name            string `json:"name"`
	Description     string `json:"description,omitempty"`
	CreatedByUserID string `json:"created_by_user_id,omitempty"`
}

// CreateSpaceChainResult is the new chain with the two keys issued for it. The
// bindings carry the plaintext keys; this is the only time they are returned.
type CreateSpaceChainResult struct {
	Chain             *domain.SpaceChain
	ManagementBinding *domain.SpaceChainBinding
	MemoryBinding     *domain.SpaceChainBinding
}

type UpdateSpaceChainRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type ReplaceSpaceChainNodesRequest struct {
	Nodes []SpaceChainNodeInput `json:"nodes"`
}

type SpaceChainNodeInput struct {
	TenantID        string `json:"tenant_id"`
	ExternalSpaceID string `json:"external_space_id,omitempty"`
	DisplayName     string `json:"display_name,omitempty"`
}

type CreateSpaceChainBindingRequest struct {
	ChainAPIKey     string `json:"chain_api_key,omitempty"`
	CreatedByUserID string `json:"created_by_user_id,omitempty"`
}

type UpdateSpaceChainNodeRoutingPolicyRequest struct {
	Enabled     bool   `json:"enabled"`
	Prompt      string `json:"prompt,omitempty"`
	WebhookOnly bool   `json:"webhook_only"`
}

const maxRoutingPolicyPromptRunes = 1200

func (s *SpaceChainService) Create(ctx context.Context, req CreateSpaceChainRequest) (*CreateSpaceChainResult, error) {
	if s == nil || s.chains == nil {
		return nil, fmt.Errorf("space chain repository not configured")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, &domain.ValidationError{Field: "name", Message: "required"}
	}

	chain := &domain.SpaceChain{
		ID:              uuid.New().String(),
		ProjectID:       strings.TrimSpace(req.ProjectID),
		Name:            name,
		Description:     strings.TrimSpace(req.Description),
		CreatedByUserID: strings.TrimSpace(req.CreatedByUserID),
	}
	newBinding := func(role string) *domain.SpaceChainBinding {
		return &domain.SpaceChainBinding{
			ID:              uuid.New().String(),
			ChainID:         chain.ID,
			Role:            role,
			ChainAPIKey:     generateChainKey(),
			CreatedByUserID: chain.CreatedByUserID,
		}
	}
	management := newBinding(domain.SpaceChainRoleManagement)
	memory := newBinding(domain.SpaceChainRoleMemory)
	// The chain and both bindings are written together, so a failure leaves
	// neither a chain without keys nor a single key.
	if err := s.chains.Create(ctx, chain, management, memory); err != nil {
		return nil, err
	}

	created, err := s.chains.GetByID(ctx, chain.ID)
	if err != nil {
		return nil, err
	}
	return &CreateSpaceChainResult{Chain: created, ManagementBinding: management, MemoryBinding: memory}, nil
}

func (s *SpaceChainService) Get(ctx context.Context, id string) (*domain.SpaceChain, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, &domain.ValidationError{Field: "id", Message: "required"}
	}
	return s.chains.GetByID(ctx, id)
}

func (s *SpaceChainService) GetByKey(ctx context.Context, key string) (*domain.SpaceChain, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil, &domain.ValidationError{Field: "X-API-Key", Message: "missing or malformed X-API-Key"}
	}
	if !strings.HasPrefix(key, domain.ChainKeyPrefix) {
		return nil, &domain.ValidationError{Field: "X-API-Key", Message: "not a chain key"}
	}
	return s.chains.GetByKey(ctx, key)
}

func (s *SpaceChainService) Authorize(ctx context.Context, chainID, key string) (*domain.SpaceChain, error) {
	chain, err := s.GetByKey(ctx, key)
	if err != nil {
		return nil, err
	}
	if chain.ID != chainID {
		return nil, domain.ErrNotFound
	}
	return chain, nil
}

// AuthorizeManagement finds the chain for a key, checks the chain id, and then
// requires the key to be a management key. Lookup and chain id failures stay
// not-found; only a valid key of the wrong role gets ErrManagementKeyRequired.
func (s *SpaceChainService) AuthorizeManagement(ctx context.Context, chainID, key string) (*domain.SpaceChain, error) {
	chain, err := s.Authorize(ctx, chainID, key)
	if err != nil {
		return nil, err
	}
	if err := requireManagementKey(chain, strings.TrimSpace(key)); err != nil {
		return nil, err
	}
	return chain, nil
}

// GetByManagementKey is the lookup by key for callers that administer the
// chain: the key must belong to a management binding.
func (s *SpaceChainService) GetByManagementKey(ctx context.Context, key string) (*domain.SpaceChain, error) {
	chain, err := s.GetByKey(ctx, key)
	if err != nil {
		return nil, err
	}
	if err := requireManagementKey(chain, strings.TrimSpace(key)); err != nil {
		return nil, err
	}
	return chain, nil
}

// requireManagementKey is the one place that decides whether a presented key
// is a management key. Only the exact role "management" qualifies, so an empty
// or unknown role, or a key that matches no active binding, is refused.
func requireManagementKey(chain *domain.SpaceChain, key string) error {
	for _, binding := range chain.Bindings {
		if binding.ChainAPIKey != key || binding.Disabled {
			continue
		}
		if binding.Role == domain.SpaceChainRoleManagement {
			return nil
		}
		break
	}
	return domain.ErrManagementKeyRequired
}

func (s *SpaceChainService) Update(ctx context.Context, chainID string, req UpdateSpaceChainRequest) (*domain.SpaceChain, error) {
	chainID = strings.TrimSpace(chainID)
	name := strings.TrimSpace(req.Name)
	if chainID == "" {
		return nil, &domain.ValidationError{Field: "id", Message: "required"}
	}
	if name == "" {
		return nil, &domain.ValidationError{Field: "name", Message: "required"}
	}
	if err := s.chains.Update(ctx, &domain.SpaceChain{
		ID:          chainID,
		Name:        name,
		Description: strings.TrimSpace(req.Description),
	}); err != nil {
		return nil, err
	}
	return s.chains.GetByID(ctx, chainID)
}

func (s *SpaceChainService) Delete(ctx context.Context, chainID, deletedByUserID string) error {
	chainID = strings.TrimSpace(chainID)
	if chainID == "" {
		return &domain.ValidationError{Field: "id", Message: "required"}
	}
	return s.chains.SoftDelete(ctx, chainID, strings.TrimSpace(deletedByUserID))
}

func (s *SpaceChainService) CreateBinding(ctx context.Context, chainID string, req CreateSpaceChainBindingRequest) (*domain.SpaceChainBinding, error) {
	chainID = strings.TrimSpace(chainID)
	if chainID == "" {
		return nil, &domain.ValidationError{Field: "chain_id", Message: "required"}
	}
	chainAPIKey := strings.TrimSpace(req.ChainAPIKey)
	if chainAPIKey == "" {
		chainAPIKey = generateChainKey()
	} else if !strings.HasPrefix(chainAPIKey, domain.ChainKeyPrefix) {
		return nil, &domain.ValidationError{Field: "chain_api_key", Message: "must start with " + domain.ChainKeyPrefix}
	}
	// Every key issued after the chain is created is a memory key; the request
	// has no say in the role.
	binding := &domain.SpaceChainBinding{
		ID:              uuid.New().String(),
		ChainID:         chainID,
		Role:            domain.SpaceChainRoleMemory,
		ChainAPIKey:     chainAPIKey,
		CreatedByUserID: strings.TrimSpace(req.CreatedByUserID),
	}
	if err := s.chains.CreateBinding(ctx, binding); err != nil {
		return nil, err
	}
	// The stores do not fill created_at on the value they are given, so read the
	// row back. The key is already issued, so a failed read must not fail the call.
	if stored, err := s.chains.ListBindings(ctx, chainID); err == nil {
		for i := range stored {
			if stored[i].ID == binding.ID {
				return &stored[i], nil
			}
		}
	}
	return binding, nil
}

func (s *SpaceChainService) ListBindings(ctx context.Context, chainID string) ([]domain.SpaceChainBinding, error) {
	return s.chains.ListBindings(ctx, strings.TrimSpace(chainID))
}

func (s *SpaceChainService) DisableBinding(ctx context.Context, chainID, bindingID, disabledByUserID string) error {
	chainID = strings.TrimSpace(chainID)
	bindingID = strings.TrimSpace(bindingID)
	if chainID == "" {
		return &domain.ValidationError{Field: "chain_id", Message: "required"}
	}
	if bindingID == "" {
		return &domain.ValidationError{Field: "binding_id", Message: "required"}
	}
	bindings, err := s.chains.ListBindings(ctx, chainID)
	if err != nil {
		return err
	}
	var target *domain.SpaceChainBinding
	activeManagement := 0
	for i, binding := range bindings {
		if binding.Disabled {
			continue
		}
		if binding.Role == domain.SpaceChainRoleManagement {
			activeManagement++
		}
		if binding.ID == bindingID {
			target = &bindings[i]
		}
	}
	if target == nil {
		return domain.ErrNotFound
	}
	// Memory keys can all be disabled; the last active management key cannot.
	if target.Role == domain.SpaceChainRoleManagement && activeManagement <= 1 {
		return &domain.ValidationError{Field: "binding_id", Message: "at least one management key must remain active"}
	}
	return s.chains.DisableBinding(ctx, chainID, bindingID, strings.TrimSpace(disabledByUserID))
}

func (s *SpaceChainService) ReplaceNodes(ctx context.Context, chainID string, req ReplaceSpaceChainNodesRequest) ([]domain.SpaceChainNode, error) {
	chainID = strings.TrimSpace(chainID)
	if chainID == "" {
		return nil, &domain.ValidationError{Field: "chain_id", Message: "required"}
	}
	existingNodes, err := s.chains.ListNodes(ctx, chainID)
	if err != nil {
		return nil, err
	}
	existingPolicies := routingPoliciesByStableNodeKey(existingNodes)
	nodes := make([]domain.SpaceChainNode, 0, len(req.Nodes))
	seenTenant := make(map[string]struct{}, len(req.Nodes))
	seenExternal := make(map[string]struct{}, len(req.Nodes))
	for i, in := range req.Nodes {
		tenantID := strings.TrimSpace(in.TenantID)
		if tenantID == "" {
			return nil, &domain.ValidationError{Field: "nodes", Message: "tenant_id required"}
		}
		if strings.HasPrefix(tenantID, domain.ChainKeyPrefix) {
			return nil, &domain.ValidationError{Field: "nodes", Message: "chain nodes must be spaces, not Space Chains"}
		}
		if _, ok := seenTenant[tenantID]; ok {
			return nil, &domain.ValidationError{Field: "nodes", Message: "duplicate tenant_id"}
		}
		seenTenant[tenantID] = struct{}{}

		externalSpaceID := strings.TrimSpace(in.ExternalSpaceID)
		if externalSpaceID != "" {
			if _, ok := seenExternal[externalSpaceID]; ok {
				return nil, &domain.ValidationError{Field: "nodes", Message: "duplicate external_space_id"}
			}
			seenExternal[externalSpaceID] = struct{}{}
		}
		node := domain.SpaceChainNode{
			ID:              uuid.New().String(),
			ChainID:         chainID,
			TenantID:        tenantID,
			ExternalSpaceID: externalSpaceID,
			DisplayName:     strings.TrimSpace(in.DisplayName),
			Position:        i,
		}
		if existing, ok := existingPolicies[stableNodePolicyKey(node)]; ok {
			node.RoutingPolicyEnabled = existing.RoutingPolicyEnabled
			node.RoutingPolicyPrompt = existing.RoutingPolicyPrompt
			node.RoutingPolicyWebhookOnly = existing.RoutingPolicyWebhookOnly
		}
		nodes = append(nodes, node)
	}
	if err := s.chains.ReplaceNodes(ctx, chainID, nodes); err != nil {
		return nil, err
	}
	return s.chains.ListNodes(ctx, chainID)
}

func routingPoliciesByStableNodeKey(nodes []domain.SpaceChainNode) map[string]domain.SpaceChainNode {
	out := make(map[string]domain.SpaceChainNode, len(nodes))
	for _, node := range nodes {
		if key := stableNodePolicyKey(node); key != "" {
			out[key] = node
		}
	}
	return out
}

func stableNodePolicyKey(node domain.SpaceChainNode) string {
	if strings.TrimSpace(node.ExternalSpaceID) != "" {
		return "external:" + strings.TrimSpace(node.ExternalSpaceID)
	}
	if strings.TrimSpace(node.TenantID) != "" {
		return "tenant:" + strings.TrimSpace(node.TenantID)
	}
	return ""
}

func (s *SpaceChainService) ListNodes(ctx context.Context, chainID string) ([]domain.SpaceChainNode, error) {
	return s.chains.ListNodes(ctx, strings.TrimSpace(chainID))
}

func (s *SpaceChainService) UpdateNodeRoutingPolicy(ctx context.Context, chainID, nodeID string, req UpdateSpaceChainNodeRoutingPolicyRequest) (*domain.SpaceChainNode, error) {
	chainID = strings.TrimSpace(chainID)
	nodeID = strings.TrimSpace(nodeID)
	prompt := strings.TrimSpace(req.Prompt)
	if chainID == "" {
		return nil, &domain.ValidationError{Field: "chain_id", Message: "required"}
	}
	if nodeID == "" {
		return nil, &domain.ValidationError{Field: "node_id", Message: "required"}
	}
	if req.Enabled && prompt == "" {
		return nil, &domain.ValidationError{Field: "prompt", Message: "required when enabled"}
	}
	if utf8.RuneCountInString(prompt) > maxRoutingPolicyPromptRunes {
		return nil, &domain.ValidationError{Field: "prompt", Message: "must be at most 1200 characters"}
	}
	nodes, err := s.chains.ListNodes(ctx, chainID)
	if err != nil {
		return nil, err
	}
	for _, node := range nodes {
		if node.ID != nodeID {
			continue
		}
		if node.Position == 0 {
			return nil, &domain.ValidationError{Field: "node_id", Message: "routing policy cannot be configured on the first Space Chain node"}
		}
		return s.chains.UpdateNodeRoutingPolicy(ctx, chainID, nodeID, req.Enabled, prompt, req.WebhookOnly)
	}
	return nil, domain.ErrNotFound
}

func (s *SpaceChainService) RemoveNodeByExternalSpaceID(ctx context.Context, externalSpaceID string) error {
	return s.chains.RemoveNodeByExternalSpaceID(ctx, strings.TrimSpace(externalSpaceID))
}

func (s *SpaceChainService) KeyStatus(ctx context.Context, apiKey string) (domain.KeyStatus, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return "", &domain.ValidationError{Field: "X-API-Key", Message: "missing or malformed X-API-Key"}
	}
	if !strings.HasPrefix(apiKey, domain.ChainKeyPrefix) {
		return "", domain.ErrNotFound
	}
	status, err := s.chains.KeyStatus(ctx, apiKey)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return "", domain.ErrNotFound
		}
		return "", fmt.Errorf("space chain key status: %w", err)
	}
	return status, nil
}

func generateChainKey() string {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		return domain.ChainKeyPrefix + strings.ReplaceAll(uuid.New().String(), "-", "")
	}
	return domain.ChainKeyPrefix + base64.RawURLEncoding.EncodeToString(b[:])
}
