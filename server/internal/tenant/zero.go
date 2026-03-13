package tenant

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
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
	client *ZeroClient
}

// NewZeroProvisioner creates a provisioner for TiDB Zero API.
func NewZeroProvisioner(baseURL string) *ZeroProvisioner {
	return &ZeroProvisioner{
		client: NewZeroClient(baseURL),
	}
}

// Provision acquires a cluster from TiDB Zero.
func (p *ZeroProvisioner) Provision(ctx context.Context) (*ClusterInfo, error) {
	inst, err := p.client.CreateInstance(ctx, "mem9s")
	if err != nil {
		return nil, err
	}

	return &ClusterInfo{
		ID:       inst.ID,
		Host:     inst.Host,
		Port:     inst.Port,
		Username: inst.Username,
		Password: inst.Password,
		DBName:   "test",
	}, nil
}

// InitSchema executes DDL to create the schema for Zero clusters.
func (p *ZeroProvisioner) InitSchema(ctx context.Context, db *sql.DB) error {
	// Schema creation is handled by TenantService.initSchema()
	// This method exists to satisfy the Provisioner interface
	// Actual DDL is executed in TenantService using buildMemorySchema
	return nil
}
