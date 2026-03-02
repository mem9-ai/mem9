package tidb

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/qiffang/mnemos/server/internal/domain"
)

type SpaceTokenRepo struct {
	db *sql.DB
}

func NewSpaceTokenRepo(db *sql.DB) *SpaceTokenRepo {
	return &SpaceTokenRepo{db: db}
}

func (r *SpaceTokenRepo) CreateToken(ctx context.Context, st *domain.SpaceToken) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO space_tokens (api_token, space_id, space_name, agent_name, agent_type, user_id, workspace_key, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
		st.APIToken, st.SpaceID, st.SpaceName, st.AgentName, nullString(st.AgentType),
		st.UserID, st.WorkspaceKey,
	)
	if err != nil {
		return fmt.Errorf("create token: %w", err)
	}
	return nil
}

func (r *SpaceTokenRepo) GetByToken(ctx context.Context, token string) (*domain.SpaceToken, error) {
	var st domain.SpaceToken
	var agentType sql.NullString
	err := r.db.QueryRowContext(ctx,
		`SELECT api_token, space_id, space_name, agent_name, agent_type, created_at
		 FROM space_tokens WHERE api_token = ?`, token,
	).Scan(&st.APIToken, &st.SpaceID, &st.SpaceName, &st.AgentName, &agentType, &st.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get token: %w", err)
	}
	st.AgentType = agentType.String
	return &st, nil
}

func (r *SpaceTokenRepo) ListBySpace(ctx context.Context, spaceID string) ([]domain.SpaceToken, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT api_token, space_id, space_name, agent_name, agent_type, created_at
		 FROM space_tokens WHERE space_id = ? ORDER BY created_at`, spaceID,
	)
	if err != nil {
		return nil, fmt.Errorf("list tokens: %w", err)
	}
	defer rows.Close()

	var tokens []domain.SpaceToken
	for rows.Next() {
		var st domain.SpaceToken
		var agentType sql.NullString
		if err := rows.Scan(&st.APIToken, &st.SpaceID, &st.SpaceName, &st.AgentName, &agentType, &st.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan token: %w", err)
		}
		st.AgentType = agentType.String
		tokens = append(tokens, st)
	}
	return tokens, rows.Err()
}

func (r *SpaceTokenRepo) GetByUserWorkspace(ctx context.Context, userID, workspaceKey string) (*domain.SpaceToken, error) {
	var st domain.SpaceToken
	var agentType sql.NullString
	err := r.db.QueryRowContext(ctx,
		`SELECT api_token, space_id, space_name, agent_name, agent_type, user_id, workspace_key, created_at
		 FROM space_tokens WHERE user_id = ? AND workspace_key = ? LIMIT 1`,
		userID, workspaceKey,
	).Scan(&st.APIToken, &st.SpaceID, &st.SpaceName, &st.AgentName, &agentType, &st.UserID, &st.WorkspaceKey, &st.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get by user workspace: %w", err)
	}
	st.AgentType = agentType.String
	return &st, nil
}
