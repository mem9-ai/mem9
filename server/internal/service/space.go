package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/repository"
)

type SpaceService struct {
	tokens     repository.SpaceTokenRepo
	userTokens repository.UserTokenRepo
	memories   repository.MemoryRepo
}

func NewSpaceService(tokens repository.SpaceTokenRepo, userTokens repository.UserTokenRepo, memories repository.MemoryRepo) *SpaceService {
	return &SpaceService{tokens: tokens, userTokens: userTokens, memories: memories}
}

// CreateSpace creates a new space and returns the space ID and the first agent's API token.
func (s *SpaceService) CreateSpace(ctx context.Context, name, agentName, agentType string) (string, string, error) {
	if err := validateSpaceInput(name, agentName); err != nil {
		return "", "", err
	}

	spaceID := uuid.New().String()
	token, err := domain.GenerateToken()
	if err != nil {
		return "", "", err
	}

	st := &domain.SpaceToken{
		APIToken:  token,
		SpaceID:   spaceID,
		SpaceName: name,
		AgentName: agentName,
		AgentType: agentType,
	}
	if err := s.tokens.CreateToken(ctx, st); err != nil {
		return "", "", err
	}
	return spaceID, token, nil
}

// AddToken adds a new agent token to an existing space.
// callerSpaceID is the space the caller belongs to — they can only add to their own space.
func (s *SpaceService) AddToken(ctx context.Context, callerSpaceID, targetSpaceID, agentName, agentType string) (string, error) {
	if callerSpaceID != targetSpaceID {
		return "", &domain.ValidationError{Message: "cannot add token to a different space"}
	}
	if agentName == "" {
		return "", &domain.ValidationError{Field: "agent_name", Message: "required"}
	}

	// Look up the space name from an existing token.
	existing, err := s.tokens.ListBySpace(ctx, targetSpaceID)
	if err != nil {
		return "", err
	}
	if len(existing) == 0 {
		return "", domain.ErrNotFound
	}

	token, err := domain.GenerateToken()
	if err != nil {
		return "", err
	}

	st := &domain.SpaceToken{
		APIToken:  token,
		SpaceID:   targetSpaceID,
		SpaceName: existing[0].SpaceName,
		AgentName: agentName,
		AgentType: agentType,
	}
	if err := s.tokens.CreateToken(ctx, st); err != nil {
		return "", err
	}
	return token, nil
}

// GetSpaceInfo returns metadata about a space.
func (s *SpaceService) GetSpaceInfo(ctx context.Context, callerSpaceID, targetSpaceID string) (*domain.SpaceInfo, error) {
	if callerSpaceID != targetSpaceID {
		return nil, &domain.ValidationError{Message: "cannot view a different space"}
	}

	tokens, err := s.tokens.ListBySpace(ctx, targetSpaceID)
	if err != nil {
		return nil, err
	}
	if len(tokens) == 0 {
		return nil, domain.ErrNotFound
	}

	count, err := s.memories.Count(ctx, targetSpaceID)
	if err != nil {
		return nil, err
	}

	agents := make([]domain.AgentInfo, len(tokens))
	for i, t := range tokens {
		agents[i] = domain.AgentInfo{AgentName: t.AgentName, AgentType: t.AgentType}
	}

	return &domain.SpaceInfo{
		SpaceID:     targetSpaceID,
		SpaceName:   tokens[0].SpaceName,
		MemoryCount: count,
		Agents:      agents,
	}, nil
}

func validateSpaceInput(name, agentName string) error {
	if name == "" {
		return &domain.ValidationError{Field: "name", Message: "required"}
	}
	if len(name) > 255 {
		return &domain.ValidationError{Field: "name", Message: "too long (max 255)"}
	}
	if agentName == "" {
		return &domain.ValidationError{Field: "agent_name", Message: "required"}
	}
	if len(agentName) > 100 {
		return &domain.ValidationError{Field: "agent_name", Message: "too long (max 100)"}
	}
	return nil
}

func IsNotFound(err error) bool {
	return errors.Is(err, domain.ErrNotFound)
}

func (s *SpaceService) CreateUser(ctx context.Context, userName string) (string, string, error) {
	if userName == "" {
		return "", "", &domain.ValidationError{Field: "name", Message: "required"}
	}
	if len(userName) > 255 {
		return "", "", &domain.ValidationError{Field: "name", Message: "too long (max 255)"}
	}

	userID := uuid.New().String()
	token, err := domain.GenerateToken()
	if err != nil {
		return "", "", err
	}

	ut := &domain.UserToken{
		APIToken: token,
		UserID:   userID,
		UserName: userName,
	}
	if err := s.userTokens.CreateToken(ctx, ut); err != nil {
		return "", "", err
	}
	return userID, token, nil
}

func (s *SpaceService) Provision(ctx context.Context, userID, workspaceKey, agentID string) (string, error) {
	if workspaceKey == "" {
		return "", &domain.ValidationError{Field: "workspace_key", Message: "required"}
	}
	if agentID == "" {
		return "", &domain.ValidationError{Field: "agent_id", Message: "required"}
	}

	existing, err := s.tokens.GetByUserWorkspace(ctx, userID, workspaceKey)
	if err == nil {
		return existing.APIToken, nil
	}
	if !errors.Is(err, domain.ErrNotFound) {
		return "", err
	}

	spaceID := uuid.New().String()
	token, err := domain.GenerateToken()
	if err != nil {
		return "", err
	}

	st := &domain.SpaceToken{
		APIToken:     token,
		SpaceID:      spaceID,
		SpaceName:    workspaceKey,
		AgentName:    agentID,
		UserID:       userID,
		WorkspaceKey: workspaceKey,
	}
	if err := s.tokens.CreateToken(ctx, st); err != nil {
		return "", err
	}
	return token, nil
}
