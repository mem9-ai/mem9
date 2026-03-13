package tenant

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// TiDBCloudProvisioner implements service.Provisioner for TiDB Cloud Pool API.
// Note: TIDBCLOUD_API_KEY and TIDBCLOUD_API_SECRET are read via os.Getenv()
// (not Config) as these are sensitive credentials that should not be persisted.
type TiDBCloudProvisioner struct {
	apiURL    string
	apiKey    string
	apiSecret string
	poolID    string
	client    *http.Client
}

// NewTiDBCloudProvisioner creates a provisioner for TiDB Cloud Pool API.
func NewTiDBCloudProvisioner(apiURL, poolID string) *TiDBCloudProvisioner {
	return &TiDBCloudProvisioner{
		apiURL:    apiURL,
		apiKey:    os.Getenv("TIDBCLOUD_API_KEY"),
		apiSecret: os.Getenv("TIDBCLOUD_API_SECRET"),
		poolID:    poolID,
		client:    &http.Client{Timeout: 60 * time.Second},
	}
}

// Provision acquires a cluster from the TiDB Cloud Pool.
func (p *TiDBCloudProvisioner) Provision(ctx context.Context) (*ClusterInfo, error) {
	password, err := generateRandomPassword(16)
	if err != nil {
		return nil, fmt.Errorf("generate random password: %w", err)
	}

	endpoint := fmt.Sprintf("%s/v1beta1/clusters:takeoverFromPool", strings.TrimRight(p.apiURL, "/"))
	payload := map[string]string{
		"pool_id":       p.poolID,
		"root_password": password,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal request body: %w", err)
	}

	resp, err := p.doDigestAuthRequest(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return nil, fmt.Errorf("tidb cloud provision: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("tidb cloud provision: status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var result struct {
		ClusterID string `json:"clusterId"`
		Endpoints struct {
			Public struct {
				Host string `json:"host"`
				Port int    `json:"port"`
			} `json:"public"`
		} `json:"endpoints"`
		UserPrefix string `json:"userPrefix"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("tidb cloud provision: decode response: %w", err)
	}

	return &ClusterInfo{
		ID:       result.ClusterID,
		Host:     result.Endpoints.Public.Host,
		Port:     result.Endpoints.Public.Port,
		Username: result.UserPrefix + ".root",
		Password: password,
		DBName:   "test",
	}, nil
}

// ProviderType returns the provider identifier.
func (p *TiDBCloudProvisioner) ProviderType() string {
	return "tidb_cloud_starter"
}

// InitSchema for TiDB Cloud Pool is intentionally a no-op.
// The Pool API guarantees every claimed cluster already has the memories
// table pre-created before takeover. If this guarantee is ever violated,
// activation failure will surface at first memory write (no cluster_id context).
func (p *TiDBCloudProvisioner) InitSchema(ctx context.Context, db *sql.DB) error {
	return nil
}

// doDigestAuthRequest performs an HTTP request with Digest authentication.
func (p *TiDBCloudProvisioner) doDigestAuthRequest(ctx context.Context, method, urlStr string, body []byte) (*http.Response, error) {
	// Step 1: Initial request to get nonce
	req, err := http.NewRequestWithContext(ctx, method, urlStr, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusUnauthorized {
		// Expected 401 to get nonce
		return resp, nil
	}
	resp.Body.Close()

	// Parse WWW-Authenticate header
	wwwAuth := resp.Header.Get("WWW-Authenticate")
	if wwwAuth == "" {
		return nil, fmt.Errorf("missing WWW-Authenticate header")
	}

	nonce, realm, qop := parseDigestChallenge(wwwAuth)
	if nonce == "" {
		return nil, fmt.Errorf("invalid digest challenge")
	}

	// Step 2: Build authenticated request
	authHeader, err := buildDigestAuth(p.apiKey, p.apiSecret, method, urlStr, nonce, realm, qop)
	if err != nil {
		return nil, fmt.Errorf("build digest auth: %w", err)
	}

	req, err = http.NewRequestWithContext(ctx, method, urlStr, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)

	return p.client.Do(req)
}

// parseDigestChallenge extracts nonce, realm, and qop from WWW-Authenticate header.
// Handles quoted-string values correctly (RFC 7616) - commas inside quotes are not delimiters.
func parseDigestChallenge(header string) (nonce, realm, qop string) {
	// Strip "Digest " prefix
	header = strings.TrimPrefix(header, "Digest ")

	// Tokenize respecting quoted strings
	parts := tokenizeDigestHeader(header)
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "nonce=") {
			nonce = unquote(strings.TrimPrefix(part, "nonce="))
		}
		if strings.HasPrefix(part, "realm=") {
			realm = unquote(strings.TrimPrefix(part, "realm="))
		}
		if strings.HasPrefix(part, "qop=") {
			qop = unquote(strings.TrimPrefix(part, "qop="))
		}
	}
	return
}

// tokenizeDigestHeader splits the header by commas, but not commas inside quoted strings.
func tokenizeDigestHeader(header string) []string {
	var parts []string
	var current strings.Builder
	inQuote := false

	for i := 0; i < len(header); i++ {
		ch := header[i]
		switch ch {
		case '"':
			inQuote = !inQuote
			current.WriteByte(ch)
		case ',':
			if inQuote {
				current.WriteByte(ch)
			} else {
				parts = append(parts, current.String())
				current.Reset()
			}
		default:
			current.WriteByte(ch)
		}
	}
	if current.Len() > 0 {
		parts = append(parts, current.String())
	}
	return parts
}

// unquote removes surrounding quotes from a value.
func unquote(s string) string {
	return strings.Trim(s, `"`)
}

// buildDigestAuth constructs the Digest Authorization header.
func buildDigestAuth(username, password, method, uri, nonce, realm, qop string) (string, error) {
	nc := "00000001"
	cnonce, err := generateNonce()
	if err != nil {
		return "", err
	}

	// HA1 = MD5(username:realm:password)
	ha1 := md5Hash(fmt.Sprintf("%s:%s:%s", username, realm, password))

	// HA2 = MD5(method:uri)
	parsedURL, err := url.Parse(uri)
	if err != nil {
		return "", fmt.Errorf("parse uri: %w", err)
	}
	path := parsedURL.Path
	if parsedURL.RawQuery != "" {
		path = path + "?" + parsedURL.RawQuery
	}
	ha2 := md5Hash(fmt.Sprintf("%s:%s", method, path))

	// Response = MD5(HA1:nonce:nc:cnonce:qop:HA2)
	var response string
	if qop == "auth" {
		response = md5Hash(fmt.Sprintf("%s:%s:%s:%s:%s:%s", ha1, nonce, nc, cnonce, qop, ha2))
	} else {
		response = md5Hash(fmt.Sprintf("%s:%s:%s", ha1, nonce, ha2))
	}

	if qop == "auth" {
		return fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", qop=%s, nc=%s, cnonce="%s", response="%s"`,
			username, realm, nonce, path, qop, nc, cnonce, response), nil
	}
	return fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", response="%s"`,
		username, realm, nonce, path, response), nil
}

func md5Hash(s string) string {
	return fmt.Sprintf("%x", md5.Sum([]byte(s)))
}

func generateNonce() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", b), nil
}

func generateRandomPassword(length int) (string, error) {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = charset[int(b[i])%len(charset)]
	}
	return string(b), nil
}
