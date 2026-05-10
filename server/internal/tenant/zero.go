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
	"sync"
	"time"
)

type ZeroClient struct {
	baseURL     string
	httpClient  *http.Client
	limiter     *zeroCreateLimiter
	maxAttempts int
	retryBase   time.Duration
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
		baseURL:     baseURL,
		limiter:     newZeroCreateLimiter(2, 10),
		maxAttempts: 5,
		retryBase:   2 * time.Second,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type zeroCreateLimiter struct {
	mu        sync.Mutex
	perSecond int
	perMinute int
	calls     []time.Time
}

func newZeroCreateLimiter(perSecond, perMinute int) *zeroCreateLimiter {
	return &zeroCreateLimiter{
		perSecond: perSecond,
		perMinute: perMinute,
	}
}

func (l *zeroCreateLimiter) Wait(ctx context.Context) error {
	if l == nil {
		return nil
	}
	for {
		delay := l.reserveDelay(time.Now())
		if delay <= 0 {
			return nil
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func (l *zeroCreateLimiter) reserveDelay(now time.Time) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()

	minuteCutoff := now.Add(-time.Minute)
	secondCutoff := now.Add(-time.Second)
	kept := l.calls[:0]
	recentSecond := 0
	for _, t := range l.calls {
		if t.After(minuteCutoff) {
			kept = append(kept, t)
			if t.After(secondCutoff) {
				recentSecond++
			}
		}
	}
	l.calls = kept

	var delay time.Duration
	if l.perSecond > 0 && recentSecond >= l.perSecond {
		threshold := now
		seen := 0
		for _, t := range l.calls {
			if t.After(secondCutoff) {
				seen++
				if seen == recentSecond-l.perSecond+1 {
					threshold = t.Add(time.Second)
					break
				}
			}
		}
		delay = maxDuration(delay, time.Until(threshold))
	}
	if l.perMinute > 0 && len(l.calls) >= l.perMinute {
		threshold := l.calls[len(l.calls)-l.perMinute].Add(time.Minute)
		delay = maxDuration(delay, time.Until(threshold))
	}
	if delay > 0 {
		return delay + deterministicLimiterJitter(now)
	}

	l.calls = append(l.calls, now)
	return 0
}

func deterministicLimiterJitter(now time.Time) time.Duration {
	return time.Duration(now.UnixNano()%250) * time.Millisecond
}

func maxDuration(a, b time.Duration) time.Duration {
	if b > a {
		return b
	}
	return a
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

	maxAttempts := c.maxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 1
	}
	retryBase := c.retryBase
	if retryBase <= 0 {
		retryBase = time.Second
	}

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := c.limiter.Wait(ctx); err != nil {
			return nil, err
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

		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("zero api create instance: read response: %w", readErr)
		}

		if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
			snippet := string(body)
			if len(snippet) > 1024 {
				snippet = snippet[:1024]
			}
			if resp.StatusCode == http.StatusTooManyRequests && attempt < maxAttempts {
				if err := sleepContext(ctx, zeroRateLimitRetryDelay(snippet, retryBase, attempt)); err != nil {
					return nil, err
				}
				continue
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
	return nil, fmt.Errorf("zero api create instance: exhausted retries")
}

func zeroRateLimitRetryDelay(body string, base time.Duration, attempt int) time.Duration {
	lower := strings.ToLower(body)
	switch {
	case strings.Contains(lower, "per minute"):
		return time.Duration(attempt*5) * base
	case strings.Contains(lower, "per second"):
		return time.Duration(attempt) * base
	default:
		return time.Duration(attempt) * base
	}
}

func sleepContext(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// ZeroProvisioner implements service.Provisioner for TiDB Zero API.
type ZeroProvisioner struct {
	client     *ZeroClient
	backend    string
	autoModel  string
	autoDims   int
	clientDims int
	ftsEnabled bool
}

// NewZeroProvisioner creates a provisioner for TiDB Zero API.
// backend is "tidb", "postgres", or "db9".
func NewZeroProvisioner(baseURL, backend, autoModel string, autoDims int, clientDims int, ftsEnabled bool) *ZeroProvisioner {
	return &ZeroProvisioner{
		client:     NewZeroClient(baseURL),
		backend:    backend,
		autoModel:  autoModel,
		autoDims:   autoDims,
		clientDims: clientDims,
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
		ClusterID:      inst.ID, // Zero provisioner issues real UUIDs; no derivation needed
		Host:           inst.Host,
		Port:           inst.Port,
		Username:       inst.Username,
		Password:       inst.Password,
		DBName:         "test",
		ClaimURL:       inst.ClaimURL,
		ClaimExpiresAt: inst.ClaimExpiresAt,
	}, nil
}

const ZeroProvisionerType = "tidb_zero"

// ProviderType returns the provider identifier.
func (p *ZeroProvisioner) ProviderType() string {
	return ZeroProvisionerType
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
			if _, err := db.ExecContext(ctx, BuildDB9MemorySchema(p.autoModel, p.autoDims, p.clientDims)); err != nil {
				return fmt.Errorf("init schema: create table: %w", err)
			}
			// Add HNSW index
			if _, err := db.ExecContext(ctx,
				`CREATE INDEX IF NOT EXISTS idx_memory_embedding ON memories USING hnsw (embedding vector_cosine_ops)`); err != nil {
				return fmt.Errorf("init schema: hnsw index: %w", err)
			}
			return nil
	*/
	if _, err := db.ExecContext(ctx, BuildMemorySchema(p.autoModel, p.autoDims, p.clientDims)); err != nil {
		return fmt.Errorf("init schema: create table: %w", err)
	}
	if _, err := db.ExecContext(ctx, BuildMemoryEntitiesSchema("tidb", p.autoModel, p.autoDims, p.clientDims)); err != nil {
		return fmt.Errorf("init schema: memory entities table: %w", err)
	}
	if p.autoModel != "" {
		exists, err := IndexExists(ctx, db, "memories", "idx_cosine")
		if err != nil {
			return fmt.Errorf("init schema: check vector index: %w", err)
		}
		if !exists {
			if _, err := db.ExecContext(ctx,
				`ALTER TABLE memories ADD VECTOR INDEX idx_cosine ((VEC_COSINE_DISTANCE(embedding))) ADD_COLUMNAR_REPLICA_ON_DEMAND`); err != nil && !IsIndexExistsError(err) {
				return fmt.Errorf("init schema: vector index: %w", err)
			}
		}
	}
	if p.ftsEnabled {
		exists, err := IndexExists(ctx, db, "memories", "idx_fts_content")
		if err != nil {
			return fmt.Errorf("init schema: check fulltext index: %w", err)
		}
		if !exists {
			if _, err := db.ExecContext(ctx,
				`ALTER TABLE memories ADD FULLTEXT INDEX idx_fts_content (content) WITH PARSER MULTILINGUAL ADD_COLUMNAR_REPLICA_ON_DEMAND`); err != nil && !IsIndexExistsError(err) {
				return fmt.Errorf("init schema: fulltext index: %w", err)
			}
		}
	}
	if _, err := db.ExecContext(ctx, BuildSessionsSchema(p.autoModel, p.autoDims, p.clientDims)); err != nil {
		return fmt.Errorf("init schema: sessions table: %w", err)
	}
	if p.autoModel != "" {
		exists, err := IndexExists(ctx, db, "sessions", "idx_sessions_cosine")
		if err != nil {
			return fmt.Errorf("init schema: check sessions vector index: %w", err)
		}
		if !exists {
			if _, err := db.ExecContext(ctx,
				`ALTER TABLE sessions ADD VECTOR INDEX idx_sessions_cosine ((VEC_COSINE_DISTANCE(embedding))) ADD_COLUMNAR_REPLICA_ON_DEMAND`); err != nil && !IsIndexExistsError(err) {
				return fmt.Errorf("init schema: sessions vector index: %w", err)
			}
		}
	}
	if p.ftsEnabled {
		exists, err := IndexExists(ctx, db, "sessions", "idx_sessions_fts")
		if err != nil {
			return fmt.Errorf("init schema: check sessions fulltext index: %w", err)
		}
		if !exists {
			if _, err := db.ExecContext(ctx,
				`ALTER TABLE sessions ADD FULLTEXT INDEX idx_sessions_fts (content) WITH PARSER MULTILINGUAL ADD_COLUMNAR_REPLICA_ON_DEMAND`); err != nil && !IsIndexExistsError(err) {
				return fmt.Errorf("init schema: sessions fulltext index: %w", err)
			}
		}
	}
	return nil

}
