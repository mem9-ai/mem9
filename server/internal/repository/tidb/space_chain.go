package tidb

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/qiffang/mnemos/server/internal/domain"
)

type SpaceChainRepoImpl struct {
	db *sql.DB
}

func NewSpaceChainRepo(db *sql.DB) *SpaceChainRepoImpl {
	return &SpaceChainRepoImpl{db: db}
}

func (r *SpaceChainRepoImpl) Create(ctx context.Context, chain *domain.SpaceChain, binding *domain.SpaceChainBinding) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin create space chain: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO space_chains (id, project_id, name, description, created_by_user_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
		chain.ID, nullString(chain.ProjectID), chain.Name, nullString(chain.Description), nullString(chain.CreatedByUserID),
	); err != nil {
		return fmt.Errorf("create space chain: %w", err)
	}
	if binding != nil {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO space_chain_bindings (id, chain_id, chain_api_key, created_by_user_id, created_at)
			 VALUES (?, ?, ?, ?, NOW())`,
			binding.ID, binding.ChainID, binding.ChainAPIKey, nullString(binding.CreatedByUserID),
		); err != nil {
			return fmt.Errorf("create space chain binding: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit create space chain: %w", err)
	}
	return nil
}

func (r *SpaceChainRepoImpl) GetByID(ctx context.Context, id string) (*domain.SpaceChain, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, project_id, name, description, created_by_user_id, deleted_at, deleted_by_user_id, created_at, updated_at
		 FROM space_chains WHERE id = ?`,
		id,
	)
	chain, err := scanSpaceChain(row)
	if err != nil {
		return nil, err
	}
	if err := r.hydrate(ctx, chain); err != nil {
		return nil, err
	}
	return chain, nil
}

func (r *SpaceChainRepoImpl) GetByKey(ctx context.Context, key string) (*domain.SpaceChain, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT sc.id, sc.project_id, sc.name, sc.description, sc.created_by_user_id, sc.deleted_at, sc.deleted_by_user_id, sc.created_at, sc.updated_at
		 FROM space_chain_bindings AS b
		 INNER JOIN space_chains AS sc ON sc.id = b.chain_id
		 WHERE b.chain_api_key = ? AND b.disabled = 0 AND sc.deleted_at IS NULL`,
		key,
	)
	chain, err := scanSpaceChain(row)
	if err != nil {
		return nil, err
	}
	if err := r.hydrate(ctx, chain); err != nil {
		return nil, err
	}
	return chain, nil
}

func (r *SpaceChainRepoImpl) GetByKeyIncludingDisabled(ctx context.Context, key string) (*domain.SpaceChain, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT sc.id, sc.project_id, sc.name, sc.description, sc.created_by_user_id, sc.deleted_at, sc.deleted_by_user_id, sc.created_at, sc.updated_at
		 FROM space_chain_bindings AS b
		 INNER JOIN space_chains AS sc ON sc.id = b.chain_id
		 WHERE b.chain_api_key = ? AND sc.deleted_at IS NULL`,
		key,
	)
	chain, err := scanSpaceChain(row)
	if err != nil {
		return nil, err
	}
	if err := r.hydrate(ctx, chain); err != nil {
		return nil, err
	}
	return chain, nil
}

func (r *SpaceChainRepoImpl) Update(ctx context.Context, chain *domain.SpaceChain) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE space_chains
		 SET name = ?, description = ?, updated_at = NOW()
		 WHERE id = ? AND deleted_at IS NULL`,
		chain.Name, nullString(chain.Description), chain.ID,
	)
	if err != nil {
		return fmt.Errorf("update space chain: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("update space chain rows: %w", err)
	}
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *SpaceChainRepoImpl) SoftDelete(ctx context.Context, id, deletedByUserID string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE space_chains
		 SET deleted_at = NOW(), deleted_by_user_id = ?, updated_at = NOW()
		 WHERE id = ? AND deleted_at IS NULL`,
		nullString(deletedByUserID), id,
	)
	if err != nil {
		return fmt.Errorf("soft delete space chain: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("soft delete space chain rows: %w", err)
	}
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *SpaceChainRepoImpl) CreateBinding(ctx context.Context, binding *domain.SpaceChainBinding) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO space_chain_bindings (id, chain_id, chain_api_key, created_by_user_id, created_at)
		 VALUES (?, ?, ?, ?, NOW())`,
		binding.ID, binding.ChainID, binding.ChainAPIKey, nullString(binding.CreatedByUserID),
	)
	if err != nil {
		return fmt.Errorf("create space chain binding: %w", err)
	}
	return nil
}

func (r *SpaceChainRepoImpl) ListBindings(ctx context.Context, chainID string) ([]domain.SpaceChainBinding, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, chain_id, chain_api_key, created_by_user_id, disabled, disabled_at, disabled_by_user_id, created_at
		 FROM space_chain_bindings
		 WHERE chain_id = ?
		 ORDER BY created_at DESC, id DESC`,
		chainID,
	)
	if err != nil {
		return nil, fmt.Errorf("list space chain bindings: %w", err)
	}
	defer rows.Close()
	return scanSpaceChainBindings(rows)
}

func (r *SpaceChainRepoImpl) DisableBinding(ctx context.Context, chainID, bindingID, disabledByUserID string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE space_chain_bindings
		 SET disabled = 1, disabled_at = NOW(), disabled_by_user_id = ?
		 WHERE chain_id = ? AND id = ? AND disabled = 0`,
		nullString(disabledByUserID), chainID, bindingID,
	)
	if err != nil {
		return fmt.Errorf("disable space chain binding: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("disable space chain binding rows: %w", err)
	}
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *SpaceChainRepoImpl) ListNodes(ctx context.Context, chainID string) ([]domain.SpaceChainNode, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, chain_id, tenant_id, external_space_id, display_name, position, created_at, updated_at
		 FROM space_chain_nodes
		 WHERE chain_id = ?
		 ORDER BY position ASC, id ASC`,
		chainID,
	)
	if err != nil {
		return nil, fmt.Errorf("list space chain nodes: %w", err)
	}
	defer rows.Close()
	return scanSpaceChainNodes(rows)
}

func (r *SpaceChainRepoImpl) ReplaceNodes(ctx context.Context, chainID string, nodes []domain.SpaceChainNode) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin replace space chain nodes: %w", err)
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx, `DELETE FROM space_chain_nodes WHERE chain_id = ?`, chainID)
	if err != nil {
		return fmt.Errorf("clear space chain nodes: %w", err)
	}
	_ = res
	for _, node := range nodes {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO space_chain_nodes (id, chain_id, tenant_id, external_space_id, display_name, position, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
			node.ID, chainID, node.TenantID, nullString(node.ExternalSpaceID), nullString(node.DisplayName), node.Position,
		); err != nil {
			return fmt.Errorf("insert space chain node: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit replace space chain nodes: %w", err)
	}
	return nil
}

func (r *SpaceChainRepoImpl) RemoveNodeByExternalSpaceID(ctx context.Context, externalSpaceID string) error {
	if externalSpaceID == "" {
		return nil
	}
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM space_chain_nodes WHERE external_space_id = ?`,
		externalSpaceID,
	)
	if err != nil {
		return fmt.Errorf("remove space chain node by external space id: %w", err)
	}
	return nil
}

func (r *SpaceChainRepoImpl) KeyStatus(ctx context.Context, key string) (domain.KeyStatus, error) {
	var disabled bool
	var deletedAt sql.NullTime
	err := r.db.QueryRowContext(ctx,
		`SELECT b.disabled, sc.deleted_at
		 FROM space_chain_bindings AS b
		 INNER JOIN space_chains AS sc ON sc.id = b.chain_id
		 WHERE b.chain_api_key = ?`,
		key,
	).Scan(&disabled, &deletedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", domain.ErrNotFound
		}
		return "", fmt.Errorf("space chain key status: %w", err)
	}
	if disabled || deletedAt.Valid {
		return domain.KeyStatusInactive, nil
	}
	return domain.KeyStatusActive, nil
}

func (r *SpaceChainRepoImpl) hydrate(ctx context.Context, chain *domain.SpaceChain) error {
	bindings, err := r.ListBindings(ctx, chain.ID)
	if err != nil {
		return err
	}
	nodes, err := r.ListNodes(ctx, chain.ID)
	if err != nil {
		return err
	}
	chain.Bindings = bindings
	chain.Nodes = nodes
	return nil
}

func scanSpaceChain(row *sql.Row) (*domain.SpaceChain, error) {
	var chain domain.SpaceChain
	var projectID, description, createdByUserID, deletedByUserID sql.NullString
	var deletedAt sql.NullTime
	if err := row.Scan(&chain.ID, &projectID, &chain.Name, &description, &createdByUserID, &deletedAt, &deletedByUserID, &chain.CreatedAt, &chain.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("scan space chain: %w", err)
	}
	chain.ProjectID = projectID.String
	chain.Description = description.String
	chain.CreatedByUserID = createdByUserID.String
	chain.DeletedByUserID = deletedByUserID.String
	if deletedAt.Valid {
		chain.DeletedAt = &deletedAt.Time
	}
	return &chain, nil
}

func scanSpaceChainBindings(rows *sql.Rows) ([]domain.SpaceChainBinding, error) {
	out := []domain.SpaceChainBinding{}
	for rows.Next() {
		var binding domain.SpaceChainBinding
		var createdByUserID, disabledByUserID sql.NullString
		var disabledAt sql.NullTime
		if err := rows.Scan(&binding.ID, &binding.ChainID, &binding.ChainAPIKey, &createdByUserID, &binding.Disabled, &disabledAt, &disabledByUserID, &binding.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan space chain binding: %w", err)
		}
		binding.CreatedByUserID = createdByUserID.String
		binding.DisabledByUserID = disabledByUserID.String
		if disabledAt.Valid {
			binding.DisabledAt = &disabledAt.Time
		}
		out = append(out, binding)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate space chain bindings: %w", err)
	}
	return out, nil
}

func scanSpaceChainNodes(rows *sql.Rows) ([]domain.SpaceChainNode, error) {
	out := []domain.SpaceChainNode{}
	for rows.Next() {
		var node domain.SpaceChainNode
		var externalSpaceID, displayName sql.NullString
		if err := rows.Scan(&node.ID, &node.ChainID, &node.TenantID, &externalSpaceID, &displayName, &node.Position, &node.CreatedAt, &node.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan space chain node: %w", err)
		}
		node.ExternalSpaceID = externalSpaceID.String
		node.DisplayName = displayName.String
		out = append(out, node)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate space chain nodes: %w", err)
	}
	return out, nil
}
