package tidb

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/qiffang/mnemos/server/internal/domain"
)

type UserTokenRepo struct {
	db *sql.DB
}

func NewUserTokenRepo(db *sql.DB) *UserTokenRepo {
	return &UserTokenRepo{db: db}
}

func (r *UserTokenRepo) CreateToken(ctx context.Context, ut *domain.UserToken) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO user_tokens (api_token, user_id, user_name, created_at)
		 VALUES (?, ?, ?, NOW())`,
		ut.APIToken, ut.UserID, ut.UserName,
	)
	if err != nil {
		return fmt.Errorf("create user token: %w", err)
	}
	return nil
}

func (r *UserTokenRepo) GetByToken(ctx context.Context, token string) (*domain.UserToken, error) {
	var ut domain.UserToken
	err := r.db.QueryRowContext(ctx,
		`SELECT api_token, user_id, user_name, created_at
		 FROM user_tokens WHERE api_token = ?`, token,
	).Scan(&ut.APIToken, &ut.UserID, &ut.UserName, &ut.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get user token: %w", err)
	}
	return &ut, nil
}
