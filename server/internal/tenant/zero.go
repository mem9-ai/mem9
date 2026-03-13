package tenant

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

type ZeroClient struct {
	baseURL    string
	httpClient *http.Client
}

type ZeroInstance struct {
	ID             string     `json:"id"`
	Host           string     `json:"host"`
	Port           int        `json:"port"`
	Username       string     `json:"username"`
	Password       string     `json:"password"`
	ClaimURL       string     `json:"claim_url"`
	ClaimExpiresAt *time.Time `json:"claim_expires_at,omitempty"`
}

func NewZeroClient(baseURL string) *ZeroClient {
	return &ZeroClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type zeroCreateRequest struct {
	Tag string `json:"tag"`
}

type zeroCreateResponse struct {
	Instance struct {
		ID         string `json:"id"`
		ExpiresAt  string `json:"expiresAt"`
		Connection struct {
			Host     string `json:"host"`
			Port     int    `json:"port"`
			Username string `json:"username"`
			Password string `json:"password"`
		} `json:"connection"`
		ClaimInfo struct {
			ClaimURL string `json:"claimUrl"`
		} `json:"claimInfo"`
	} `json:"instance"`
}

func (c *ZeroClient) CreateInstance(ctx context.Context, tag string) (*ZeroInstance, error) {
	endpoint := strings.TrimRight(c.baseURL, "/") + "/instances"
	payload, err := json.Marshal(zeroCreateRequest{Tag: tag})
	if err != nil {
		return nil, fmt.Errorf("zero api create instance: encode request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("zero api create instance: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("zero api create instance: request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("zero api create instance: read response: %w", err)
	}

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		snippet := string(body)
		if len(snippet) > 1024 {
			snippet = snippet[:1024]
		}
		return nil, fmt.Errorf("zero api create instance: status %d: %s", resp.StatusCode, snippet)
	}

	var parsed zeroCreateResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("zero api create instance: decode response: %w", err)
	}

	inst := &ZeroInstance{
		ID:       parsed.Instance.ID,
		Host:     parsed.Instance.Connection.Host,
		Port:     parsed.Instance.Connection.Port,
		Username: parsed.Instance.Connection.Username,
		Password: parsed.Instance.Connection.Password,
		ClaimURL: parsed.Instance.ClaimInfo.ClaimURL,
	}
	if parsed.Instance.ExpiresAt != "" {
		if t, err := time.Parse(time.RFC3339, parsed.Instance.ExpiresAt); err == nil {
			inst.ClaimExpiresAt = &t
		}
	}
	return inst, nil
}

// ZeroProvisioner implements service.Provisioner for TiDB Zero API.
type ZeroProvisioner struct {
	client     *ZeroClient
	backend    string
	autoModel  string
	autoDims   int
	ftsEnabled bool
}

// NewZeroProvisioner creates a provisioner for TiDB Zero API.
// backend is "tidb", "postgres", or "db9".
func NewZeroProvisioner(baseURL, backend, autoModel string, autoDims int, ftsEnabled bool) *ZeroProvisioner {
	return &ZeroProvisioner{
		client:     NewZeroClient(baseURL),
		backend:    backend,
		autoModel:  autoModel,
		autoDims:   autoDims,
		ftsEnabled: ftsEnabled,
	}
}

// Provision acquires a cluster from TiDB Zero.
func (p *ZeroProvisioner) Provision(ctx context.Context) (*ClusterInfo, error) {
	inst, err := p.client.CreateInstance(ctx, "mem9s")
	if err != nil {
		return nil, err
	}

	return &ClusterInfo{
		ID:             inst.ID,
		Host:           inst.Host,
		Port:           inst.Port,
		Username:       inst.Username,
		Password:       inst.Password,
		DBName:         "test",
		ClaimURL:       inst.ClaimURL,
		ClaimExpiresAt: inst.ClaimExpiresAt,
	}, nil
}

// ProviderType returns the provider identifier.
func (p *ZeroProvisioner) ProviderType() string {
	return "tidb_zero"
}

// InitSchema executes DDL to create the schema for Zero clusters.
// Note: Zero mode only supports tidb backend for auto-provisioning.
func (p *ZeroProvisioner) InitSchema(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("init schema: db connection is nil")
	}
	/*
		case "postgres":
			if _, err := db.ExecContext(ctx, `CREATE EXTENSION IF NOT EXISTS vector`); err != nil {
				return fmt.Errorf("init schema: pgvector extension: %w", err)
			}
			if _, err := db.ExecContext(ctx, TenantMemorySchemaPostgres); err != nil {
				return fmt.Errorf("init schema: create table: %w", err)
			}
			return nil

		case "db9":
			if _, err := db.ExecContext(ctx, `CREATE EXTENSION IF NOT EXISTS embedding`); err != nil {
				// Continue anyway - embedding extension may not be required
			}
			if _, err := db.ExecContext(ctx, `CREATE EXTENSION IF NOT EXISTS vector`); err != nil {
				return fmt.Errorf("init schema: vector extension: %w", err)
			}
			if _, err := db.ExecContext(ctx, BuildDB9MemorySchema(p.autoModel, p.autoDims)); err != nil {
				return fmt.Errorf("init schema: create table: %w", err)
			}
			// Add HNSW index
			if _, err := db.ExecContext(ctx,
				`CREATE INDEX IF NOT EXISTS idx_memory_embedding ON memories USING hnsw (embedding vector_cosine_ops)`); err != nil {
				return fmt.Errorf("init schema: hnsw index: %w", err)
			}
			return nil
	*/
	if _, err := db.ExecContext(ctx, BuildMemorySchema(p.autoModel, p.autoDims)); err != nil {
		return fmt.Errorf("init schema: create table: %w", err)
	}
	if p.autoModel != "" {
		_, err := db.ExecContext(ctx,
			`ALTER TABLE memories ADD VECTOR INDEX idx_cosine ((VEC_COSINE_DISTANCE(embedding))) ADD_COLUMNAR_REPLICA_ON_DEMAND`)
		if err != nil && !isIndexExistsError(err) {
			return fmt.Errorf("init schema: vector index: %w", err)
		}
	}
	if p.ftsEnabled {
		_, err := db.ExecContext(ctx,
			`ALTER TABLE memories ADD FULLTEXT INDEX idx_fts_content (content) WITH PARSER MULTILINGUAL ADD_COLUMNAR_REPLICA_ON_DEMAND`)
		if err != nil && !isIndexExistsError(err) {
			return fmt.Errorf("init schema: fulltext index: %w", err)
		}
	}
	return nil

}

// isIndexExistsError checks if the error is a duplicate index error.
func isIndexExistsError(err error) bool {
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		return mysqlErr.Number == 1061
	}
	return strings.Contains(err.Error(), "already exists")
}
