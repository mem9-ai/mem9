package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

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

type CreateSpaceChainResult struct {
	Chain      *domain.SpaceChain `json:"chain"`
	ChainKey   string             `json:"chain_api_key"`
	BindingID  string             `json:"binding_id"`
	KeyPrefix  string             `json:"key_prefix"`
	KeyPreview string             `json:"key_preview"`
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
	binding := &domain.SpaceChainBinding{
		ID:              uuid.New().String(),
		ChainID:         chain.ID,
		ChainAPIKey:     generateChainKey(),
		CreatedByUserID: chain.CreatedByUserID,
	}
	if err := s.chains.Create(ctx, chain, binding); err != nil {
		return nil, err
	}

	created, err := s.chains.GetByID(ctx, chain.ID)
	if err != nil {
		return nil, err
	}
	return &CreateSpaceChainResult{
		Chain:      created,
		ChainKey:   binding.ChainAPIKey,
		BindingID:  binding.ID,
		KeyPrefix:  domain.ChainKeyPrefix,
		KeyPreview: keyPreview(binding.ChainAPIKey),
	}, nil
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

func (s *SpaceChainService) AuthorizeManagement(ctx context.Context, chainID, key string) (*domain.SpaceChain, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil, &domain.ValidationError{Field: "X-API-Key", Message: "missing or malformed X-API-Key"}
	}
	if !strings.HasPrefix(key, domain.ChainKeyPrefix) {
		return nil, &domain.ValidationError{Field: "X-API-Key", Message: "not a chain key"}
	}
	chain, err := s.chains.GetByKeyIncludingDisabled(ctx, key)
	if err != nil {
		return nil, err
	}
	if chain.ID != chainID {
		return nil, domain.ErrNotFound
	}
	return chain, nil
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
	binding := &domain.SpaceChainBinding{
		ID:              uuid.New().String(),
		ChainID:         chainID,
		ChainAPIKey:     chainAPIKey,
		CreatedByUserID: strings.TrimSpace(req.CreatedByUserID),
	}
	if err := s.chains.CreateBinding(ctx, binding); err != nil {
		return nil, err
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
	foundActive := false
	active := 0
	bindings, err := s.chains.ListBindings(ctx, chainID)
	if err != nil {
		return err
	}
	for _, binding := range bindings {
		if binding.Disabled {
			continue
		}
		active++
		if binding.ID == bindingID {
			foundActive = true
		}
	}
	if !foundActive {
		return domain.ErrNotFound
	}
	if active <= 1 {
		return &domain.ValidationError{Field: "binding_id", Message: "at least one Space Chain key must remain active"}
	}
	return s.chains.DisableBinding(ctx, chainID, bindingID, strings.TrimSpace(disabledByUserID))
}

func (s *SpaceChainService) ReplaceNodes(ctx context.Context, chainID string, req ReplaceSpaceChainNodesRequest) ([]domain.SpaceChainNode, error) {
	chainID = strings.TrimSpace(chainID)
	if chainID == "" {
		return nil, &domain.ValidationError{Field: "chain_id", Message: "required"}
	}
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
		nodes = append(nodes, domain.SpaceChainNode{
			ID:              uuid.New().String(),
			ChainID:         chainID,
			TenantID:        tenantID,
			ExternalSpaceID: externalSpaceID,
			DisplayName:     strings.TrimSpace(in.DisplayName),
			Position:        i,
		})
	}
	if err := s.chains.ReplaceNodes(ctx, chainID, nodes); err != nil {
		return nil, err
	}
	return s.chains.ListNodes(ctx, chainID)
}

func (s *SpaceChainService) ListNodes(ctx context.Context, chainID string) ([]domain.SpaceChainNode, error) {
	return s.chains.ListNodes(ctx, strings.TrimSpace(chainID))
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

func keyPreview(key string) string {
	if len(key) <= len(domain.ChainKeyPrefix)+6 {
		return key
	}
	return key[:len(domain.ChainKeyPrefix)+6] + "..."
}
