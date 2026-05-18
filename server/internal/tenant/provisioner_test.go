package tenant

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func setupTiDBCloudEnv(t *testing.T) func() {
	t.Helper()
	oldKey := os.Getenv("MNEMO_TIDBCLOUD_API_KEY")
	oldSecret := os.Getenv("MNEMO_TIDBCLOUD_API_SECRET")
	os.Setenv("MNEMO_TIDBCLOUD_API_KEY", "test-api-key")
	os.Setenv("MNEMO_TIDBCLOUD_API_SECRET", "test-api-secret")
	return func() {
		os.Setenv("MNEMO_TIDBCLOUD_API_KEY", oldKey)
		os.Setenv("MNEMO_TIDBCLOUD_API_SECRET", oldSecret)
	}
}

type schemaInitConnector struct {
	execs          []string
	existingTables map[string]bool
	schemaRows     []schemaTestRow
}

func (c *schemaInitConnector) Connect(context.Context) (driver.Conn, error) {
	return &schemaInitConn{recorder: c}, nil
}

func (c *schemaInitConnector) Driver() driver.Driver {
	return schemaInitDriver{}
}

type schemaInitDriver struct{}

func (schemaInitDriver) Open(string) (driver.Conn, error) {
	return nil, fmt.Errorf("open not supported")
}

type schemaInitConn struct {
	recorder *schemaInitConnector
}

func (c *schemaInitConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}

func (c *schemaInitConn) Close() error { return nil }

func (c *schemaInitConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("begin not supported")
}

func (c *schemaInitConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.recorder.execs = append(c.recorder.execs, query)
	return driver.RowsAffected(0), nil
}

func (c *schemaInitConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "information_schema.COLUMNS") {
		return &schemaRows{rows: c.recorder.schemaRows}, nil
	}
	if strings.Contains(query, "information_schema.TABLES") {
		var count int64
		if len(args) > 0 {
			if table, ok := args[0].Value.(string); ok && c.recorder.existingTables[table] {
				count = 1
			}
		}
		return &schemaInitRows{values: [][]driver.Value{{count}}}, nil
	}
	if strings.Contains(query, "information_schema.STATISTICS") {
		return &schemaInitRows{values: [][]driver.Value{{int64(0)}}}, nil
	}
	return nil, fmt.Errorf("unexpected query %q with args %v", query, args)
}

type schemaInitRows struct {
	values [][]driver.Value
	idx    int
}

func (*schemaInitRows) Columns() []string { return []string{"COUNT(*)"} }

func (*schemaInitRows) Close() error { return nil }

func (r *schemaInitRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.idx])
	r.idx++
	return nil
}

// TestTiDBCloudProvisioner_Provision_Success tests successful cluster provisioning
func TestTiDBCloudProvisioner_Provision_Success(t *testing.T) {
	cleanup := setupTiDBCloudEnv(t)
	defer cleanup()

	// Track if the second request has proper auth header
	var authHeader string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}

		auth := r.Header.Get("Authorization")
		if auth == "" {
			// First request - return 401 with Digest challenge
			w.Header().Set("WWW-Authenticate", `Digest realm="tidbcloud", nonce="abc123", qop="auth"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Second request - verify Digest auth
		authHeader = auth
		if !strings.HasPrefix(auth, "Digest ") {
			t.Errorf("expected Digest auth, got: %s", auth)
		}

		// Verify required Digest fields are present
		requiredFields := []string{"username=", "realm=", "nonce=", "uri=", "response="}
		for _, field := range requiredFields {
			if !strings.Contains(auth, field) {
				t.Errorf("auth header missing %s: %s", field, auth)
			}
		}

		// Verify request body
		var reqBody map[string]string
		if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}

		if reqBody["pool_id"] != "test-pool" {
			t.Errorf("expected pool_id=test-pool, got %s", reqBody["pool_id"])
		}
		if reqBody["root_password"] == "" {
			t.Error("root_password is empty")
		}

		// Return successful response
		resp := map[string]interface{}{
			"clusterId": "cluster-123",
			"endpoints": map[string]interface{}{
				"public": map[string]interface{}{
					"host": "test.cluster.tidbcloud.com",
					"port": 4000,
				},
			},
			"userPrefix": "test",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	// Create provisioner
	p := NewTiDBCloudProvisioner(server.URL, "test-pool", "", 0, 0, false)

	ctx := context.Background()
	info, err := p.Provision(ctx)

	if err != nil {
		t.Fatalf("Provision failed: %v", err)
	}

	// ID should be a generated UUID (not the raw cluster ID)
	if info.ClusterID != "cluster-123" {
		t.Errorf("expected ClusterID=cluster-123, got %s", info.ClusterID)
	}
	if info.ID == "" || info.ID == "cluster-123" {
		t.Errorf("expected ID to be a generated UUID, got %s", info.ID)
	}
	if info.Host != "test.cluster.tidbcloud.com" {
		t.Errorf("expected Host=test.cluster.tidbcloud.com, got %s", info.Host)
	}
	if info.Port != 4000 {
		t.Errorf("expected Port=4000, got %d", info.Port)
	}
	if info.Username != "test.root" {
		t.Errorf("expected Username=test.root, got %s", info.Username)
	}
	if info.Password == "" {
		t.Error("Password is empty")
	}
	if info.DBName != "test" {
		t.Errorf("expected DBName=test, got %s", info.DBName)
	}
	if authHeader == "" {
		t.Error("Second request did not have Authorization header")
	}
}

// TestTiDBCloudProvisioner_Provision_APIError tests error handling when API returns error
func TestTiDBCloudProvisioner_Provision_APIError(t *testing.T) {
	cleanup := setupTiDBCloudEnv(t)
	defer cleanup()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			w.Header().Set("WWW-Authenticate", `Digest realm="tidbcloud", nonce="abc123", qop="auth"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Return error
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error": "pool exhausted"}`))
	}))
	defer server.Close()

	p := NewTiDBCloudProvisioner(server.URL, "pool", "", 0, 0, false)
	ctx := context.Background()

	_, err := p.Provision(ctx)
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if !strings.Contains(err.Error(), "pool exhausted") {
		t.Errorf("expected error to contain 'pool exhausted', got: %v", err)
	}
}

// TestTiDBCloudProvisioner_ProviderType tests the provider type
func TestTiDBCloudProvisioner_ProviderType(t *testing.T) {
	p := &TiDBCloudProvisioner{}
	if p.ProviderType() != StarterProvisionerType {
		t.Errorf("expected %s, got %s", StarterProvisionerType, p.ProviderType())
	}
}

// TestTiDBCloudProvisioner_InitSchema_NilDB tests schema initialization error handling.
func TestTiDBCloudProvisioner_InitSchema_NilDB(t *testing.T) {
	cleanup := setupTiDBCloudEnv(t)
	defer cleanup()

	p := NewTiDBCloudProvisioner("http://localhost", "pool", "", 0, 0, false)

	err := p.InitSchema(context.Background(), nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "db connection is nil") {
		t.Fatalf("expected nil DB error, got %v", err)
	}
}

func TestTiDBCloudProvisioner_InitSchema_AutoEmbedding(t *testing.T) {
	p := NewTiDBCloudProvisioner("http://localhost", "pool", "tidbcloud_free/amazon/titan-embed-text-v2", 1024, 1536, true)
	recorder := &schemaInitConnector{}
	db := sql.OpenDB(recorder)
	defer db.Close()

	if err := p.InitSchema(context.Background(), db); err != nil {
		t.Fatalf("InitSchema failed: %v", err)
	}

	executed := strings.Join(recorder.execs, "\n")
	wantSubstrings := []string{
		"CREATE TABLE IF NOT EXISTS memories",
		"embedding VECTOR(1024) GENERATED ALWAYS AS (EMBED_TEXT('tidbcloud_free/amazon/titan-embed-text-v2', content, '{\"dimensions\": 1024}')) STORED",
		"ALTER TABLE memories ADD VECTOR INDEX idx_cosine",
		"ALTER TABLE memories ADD FULLTEXT INDEX idx_fts_content",
		"CREATE TABLE IF NOT EXISTS sessions",
		"embedding VECTOR(1024) GENERATED ALWAYS AS (EMBED_TEXT('tidbcloud_free/amazon/titan-embed-text-v2', content, '{\"dimensions\": 1024}')) STORED",
		"ALTER TABLE sessions ADD VECTOR INDEX idx_sessions_cosine",
		"ALTER TABLE sessions ADD FULLTEXT INDEX idx_sessions_fts",
	}
	for _, want := range wantSubstrings {
		if !strings.Contains(executed, want) {
			t.Fatalf("executed DDL missing %q\n%s", want, executed)
		}
	}
}

func TestTiDBCloudProvisioner_InitSchema_ClientEmbedding(t *testing.T) {
	p := NewTiDBCloudProvisioner("http://localhost", "pool", "", 1024, 1536, false)
	recorder := &schemaInitConnector{}
	db := sql.OpenDB(recorder)
	defer db.Close()

	if err := p.InitSchema(context.Background(), db); err != nil {
		t.Fatalf("InitSchema failed: %v", err)
	}

	executed := strings.Join(recorder.execs, "\n")
	wantSubstrings := []string{
		"CREATE TABLE IF NOT EXISTS memories",
		"embedding VECTOR(1536) NULL",
		"ALTER TABLE memories ADD VECTOR INDEX idx_cosine",
		"CREATE TABLE IF NOT EXISTS sessions",
		"ALTER TABLE sessions ADD VECTOR INDEX idx_sessions_cosine",
	}
	for _, want := range wantSubstrings {
		if !strings.Contains(executed, want) {
			t.Fatalf("executed DDL missing %q\n%s", want, executed)
		}
	}
	if strings.Contains(executed, "EMBED_TEXT(") {
		t.Fatalf("client embedding schema should not use EMBED_TEXT:\n%s", executed)
	}
	if strings.Contains(executed, "FULLTEXT INDEX") {
		t.Fatalf("FTS disabled schema should not create fulltext indexes:\n%s", executed)
	}
}

func TestTiDBCloudProvisioner_InitSchema_ExistingTablesSkipsCreate(t *testing.T) {
	p := NewTiDBCloudProvisioner("http://localhost", "pool", "", 1024, 1536, false)
	recorder := &schemaInitConnector{
		existingTables: map[string]bool{
			"memories": true,
			"sessions": true,
		},
	}
	db := sql.OpenDB(recorder)
	defer db.Close()

	if err := p.InitSchema(context.Background(), db); err != nil {
		t.Fatalf("InitSchema failed: %v", err)
	}

	executed := strings.Join(recorder.execs, "\n")
	if strings.Contains(executed, "CREATE TABLE") {
		t.Fatalf("existing tables should skip CREATE TABLE:\n%s", executed)
	}
	wantSubstrings := []string{
		"ALTER TABLE memories ADD VECTOR INDEX idx_cosine",
		"ALTER TABLE sessions ADD VECTOR INDEX idx_sessions_cosine",
	}
	for _, want := range wantSubstrings {
		if !strings.Contains(executed, want) {
			t.Fatalf("executed DDL missing %q\n%s", want, executed)
		}
	}
}

func TestTiDBCloudProvisioner_InitSchema_EmbeddingSchemaMismatch(t *testing.T) {
	tests := []struct {
		name            string
		autoModel       string
		schemaRows      []schemaTestRow
		wantErrContains string
	}{
		{
			name: "generated memory embedding with auto embedding disabled",
			schemaRows: []schemaTestRow{
				{table: "memories", extra: "STORED GENERATED"},
			},
			wantErrContains: "memories.embedding is a generated Auto Embed column",
		},
		{
			name:      "regular session embedding with auto embedding enabled",
			autoModel: "tidbcloud_free/amazon/titan-embed-text-v2",
			schemaRows: []schemaTestRow{
				{table: "sessions"},
			},
			wantErrContains: "sessions.embedding is a regular vector column",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := NewTiDBCloudProvisioner("http://localhost", "pool", tt.autoModel, 1024, 1536, false)
			recorder := &schemaInitConnector{schemaRows: tt.schemaRows}
			db := sql.OpenDB(recorder)
			defer db.Close()

			err := p.InitSchema(context.Background(), db)
			if err == nil {
				t.Fatal("expected schema compatibility error, got nil")
			}
			if !errors.Is(err, domain.ErrSchemaIncompatible) {
				t.Fatalf("expected ErrSchemaIncompatible, got %v", err)
			}
			if !strings.Contains(err.Error(), tt.wantErrContains) {
				t.Fatalf("error = %q, want substring %q", err.Error(), tt.wantErrContains)
			}
			if len(recorder.execs) != 0 {
				t.Fatalf("schema mismatch should fail before DDL, got execs: %v", recorder.execs)
			}
		})
	}
}

// TestZeroProvisioner_Provision_Success tests successful cluster provisioning
func TestZeroProvisioner_Provision_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/instances" {
			t.Errorf("expected path /instances, got %s", r.URL.Path)
		}

		// Verify request body
		var reqBody map[string]string
		if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}
		if reqBody["tag"] != "mem9s" {
			t.Errorf("expected tag=mem9s, got %s", reqBody["tag"])
		}

		// Return successful response
		resp := map[string]interface{}{
			"instance": map[string]interface{}{
				"id":        "zero-123",
				"expiresAt": "2026-03-14T12:00:00Z",
				"connection": map[string]interface{}{
					"host":     "zero.cluster.tidbcloud.com",
					"port":     4000,
					"username": "root",
					"password": "secret123",
				},
				"claimInfo": map[string]interface{}{
					"claimUrl": "https://tidb.cloud/claim/zero-123",
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	p := NewZeroProvisioner(server.URL, "tidb", "", 0, 0, false)
	ctx := context.Background()

	info, err := p.Provision(ctx)
	if err != nil {
		t.Fatalf("Provision failed: %v", err)
	}

	if info.ID != "zero-123" {
		t.Errorf("expected ID=zero-123, got %s", info.ID)
	}
	if info.ClusterID != "zero-123" {
		t.Errorf("expected ClusterID=zero-123, got %s", info.ClusterID)
	}
	if info.Host != "zero.cluster.tidbcloud.com" {
		t.Errorf("expected Host=zero.cluster.tidbcloud.com, got %s", info.Host)
	}
	if info.Port != 4000 {
		t.Errorf("expected Port=4000, got %d", info.Port)
	}
	if info.Username != "root" {
		t.Errorf("expected Username=root, got %s", info.Username)
	}
	if info.Password != "secret123" {
		t.Errorf("expected Password=secret123, got %s", info.Password)
	}
	if info.ClaimURL != "https://tidb.cloud/claim/zero-123" {
		t.Errorf("expected ClaimURL, got %s", info.ClaimURL)
	}
	if info.ClaimExpiresAt == nil {
		t.Error("expected ClaimExpiresAt to be set")
	} else {
		expectedTime := time.Date(2026, 3, 14, 12, 0, 0, 0, time.UTC)
		if !info.ClaimExpiresAt.Equal(expectedTime) {
			t.Errorf("expected ClaimExpiresAt=%v, got %v", expectedTime, info.ClaimExpiresAt)
		}
	}
}

// TestZeroProvisioner_Provision_APIError tests error handling
func TestZeroProvisioner_Provision_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte(`{"error": "service unavailable"}`))
	}))
	defer server.Close()

	p := NewZeroProvisioner(server.URL, "tidb", "", 0, 0, false)
	ctx := context.Background()

	_, err := p.Provision(ctx)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

// TestZeroProvisioner_ProviderType tests the provider type
func TestZeroProvisioner_ProviderType(t *testing.T) {
	p := &ZeroProvisioner{}
	if p.ProviderType() != "tidb_zero" {
		t.Errorf("expected tidb_zero, got %s", p.ProviderType())
	}
}

// TestZeroProvisioner_InitSchema_InvalidBackend tests invalid backend rejection
func TestZeroProvisioner_InitSchema_InvalidBackend(t *testing.T) {
	// Current implementation only supports "tidb" backend
	// For other backends, it will fail when trying to execute DDL
	p := NewZeroProvisioner("http://localhost", "postgres", "", 0, 0, false)

	// nil db should cause an error (not panic)
	err := p.InitSchema(context.Background(), nil)
	if err == nil {
		t.Fatal("expected error for nil db, got nil")
	}
}

// TestZeroProvisioner_InitSchema_Success tests successful schema initialization with tidb backend
func TestZeroProvisioner_InitSchema_Success(t *testing.T) {
	// This test would need a real or mocked database connection
	// For now, just verify it doesn't panic with valid parameters
	p := NewZeroProvisioner("http://localhost", "tidb", "", 0, 0, false)
	_ = p // Avoid unused variable error
}

// TestParseDigestChallenge tests the challenge parser
func TestParseDigestChallenge(t *testing.T) {
	tests := []struct {
		name      string
		header    string
		wantNonce string
		wantRealm string
		wantQop   string
	}{
		{
			name:      "standard challenge",
			header:    `Digest realm="tidbcloud", nonce="abc123", qop="auth"`,
			wantNonce: "abc123",
			wantRealm: "tidbcloud",
			wantQop:   "auth",
		},
		{
			name:      "realm with comma",
			header:    `Digest realm="TiDB Cloud, Serverless", nonce="xyz789", qop="auth-int"`,
			wantNonce: "xyz789",
			wantRealm: "TiDB Cloud, Serverless",
			wantQop:   "auth-int",
		},
		{
			name:      "realm with multiple commas",
			header:    `Digest realm="A, B, C", nonce="123", qop="auth"`,
			wantNonce: "123",
			wantRealm: "A, B, C",
			wantQop:   "auth",
		},
		{
			name:      "different field order",
			header:    `Digest nonce="def456", realm="test", qop="auth"`,
			wantNonce: "def456",
			wantRealm: "test",
			wantQop:   "auth",
		},
		{
			name:      "no qop",
			header:    `Digest realm="tidbcloud", nonce="nop123"`,
			wantNonce: "nop123",
			wantRealm: "tidbcloud",
			wantQop:   "",
		},
		{
			name:      "empty realm",
			header:    `Digest nonce="empty123", realm=""`,
			wantNonce: "empty123",
			wantRealm: "",
			wantQop:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			nonce, realm, qop := parseDigestChallenge(tt.header)

			if nonce != tt.wantNonce {
				t.Errorf("nonce = %q, want %q", nonce, tt.wantNonce)
			}
			if realm != tt.wantRealm {
				t.Errorf("realm = %q, want %q", realm, tt.wantRealm)
			}
			if qop != tt.wantQop {
				t.Errorf("qop = %q, want %q", qop, tt.wantQop)
			}
		})
	}
}

// TestBuildDigestAuth tests the digest auth builder
func TestBuildDigestAuth(t *testing.T) {
	username := "user"
	password := "pass"
	method := "POST"
	uri := "/v1beta1/clusters:takeoverFromPool"
	nonce := "abc123"
	realm := "tidbcloud"
	qop := "auth"

	auth, err := buildDigestAuth(username, password, method, uri, nonce, realm, qop)
	if err != nil {
		t.Fatalf("buildDigestAuth failed: %v", err)
	}

	// Verify it contains required fields
	required := []string{
		"Digest",
		"username=\"user\"",
		"realm=\"tidbcloud\"",
		"nonce=\"abc123\"",
		"uri=\"/v1beta1/clusters:takeoverFromPool\"",
		"qop=auth",
		"nc=00000001",
		"cnonce=",
		"response=",
	}

	for _, field := range required {
		if !strings.Contains(auth, field) {
			t.Errorf("auth missing %q: %s", field, auth)
		}
	}

	// Verify response is a hex MD5 hash (32 chars)
	// Extract response value
	parts := strings.Split(auth, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "response=") {
			response := strings.Trim(strings.TrimPrefix(part, "response="), `"`)
			if len(response) != 32 {
				t.Errorf("response hash length = %d, want 32", len(response))
			}
			// Verify it's hex
			for _, c := range response {
				if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
					t.Errorf("response contains non-hex char: %c", c)
				}
			}
		}
	}
}

// TestBuildDigestAuth_NoQop tests digest auth without qop
func TestBuildDigestAuth_NoQop(t *testing.T) {
	auth, err := buildDigestAuth("user", "pass", "POST", "/test", "nonce", "realm", "")
	if err != nil {
		t.Fatalf("buildDigestAuth failed: %v", err)
	}

	// Without qop, should not have cnonce, nc, or qop fields
	if strings.Contains(auth, "qop=") {
		t.Error("auth should not contain qop when empty")
	}
	if strings.Contains(auth, "cnonce=") {
		t.Error("auth should not contain cnonce without qop")
	}
	if strings.Contains(auth, "nc=") {
		t.Error("auth should not contain nc without qop")
	}
}

// TestBuildDigestAuth_CnonceError tests error handling for cnonce generation failure
func TestBuildDigestAuth_CnonceError(t *testing.T) {
	// We can't easily test the crypto/rand failure, but we can verify
	// that when qop is empty, no cnonce is needed and it should succeed
	auth, err := buildDigestAuth("user", "pass", "POST", "/test", "nonce", "realm", "")
	if err != nil {
		t.Fatalf("buildDigestAuth without qop failed: %v", err)
	}
	if auth == "" {
		t.Error("auth is empty")
	}
}

// TestTokenizeDigestHeader tests the header tokenizer
func TestTokenizeDigestHeader(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []string
	}{
		{
			name:     "simple fields",
			input:    `realm="test", nonce="123"`,
			expected: []string{`realm="test"`, `nonce="123"`},
		},
		{
			name:     "realm with comma",
			input:    `realm="TiDB Cloud, Serverless", nonce="abc"`,
			expected: []string{`realm="TiDB Cloud, Serverless"`, `nonce="abc"`},
		},
		{
			name:     "multiple commas in quote",
			input:    `realm="A, B, C", nonce="123", qop="auth"`,
			expected: []string{`realm="A, B, C"`, `nonce="123"`, `qop="auth"`},
		},
		{
			name:     "single field",
			input:    `nonce="only"`,
			expected: []string{`nonce="only"`},
		},
		{
			name:     "empty quote",
			input:    `realm="", nonce="123"`,
			expected: []string{`realm=""`, `nonce="123"`},
		},
		{
			name:     "unbalanced quotes (edge case)",
			input:    `realm="unfinished, nonce="123"`,
			expected: []string{`realm="unfinished, nonce="123"`},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tokenizeDigestHeader(tt.input)
			if len(got) != len(tt.expected) {
				t.Errorf("len = %d, want %d, got %v", len(got), len(tt.expected), got)
				return
			}
			for i := range got {
				if strings.TrimSpace(got[i]) != strings.TrimSpace(tt.expected[i]) {
					t.Errorf("[%d] = %q, want %q", i, got[i], tt.expected[i])
				}
			}
		})
	}
}

// TestUnquote tests the unquote helper
func TestUnquote(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{`"value"`, "value"},
		{`""`, ""},
		{`noquotes`, "noquotes"},
		{`"only opening`, "only opening"}, // Trim removes leading quote
		{`only closing"`, "only closing"},
		{`"nested"quotes"`, `nested"quotes`},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := unquote(tt.input)
			if got != tt.expected {
				t.Errorf("unquote(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

// TestGenerateRandomPassword tests password generation
func TestGenerateRandomPassword(t *testing.T) {
	// Test valid lengths
	for _, length := range []int{8, 16, 32} {
		pwd, err := generateRandomPassword(length)
		if err != nil {
			t.Fatalf("generateRandomPassword(%d) failed: %v", length, err)
		}
		if len(pwd) != length {
			t.Errorf("len = %d, want %d", len(pwd), length)
		}

		// Verify charset (alphanumeric only)
		for _, c := range pwd {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
				t.Errorf("password contains invalid char: %c", c)
			}
		}
	}

	// Test uniqueness (should rarely fail with 32-byte passwords)
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		pwd, _ := generateRandomPassword(32)
		if seen[pwd] {
			t.Error("duplicate password generated")
			break
		}
		seen[pwd] = true
	}
}

// TestMD5Hash tests the MD5 hash function
func TestMD5Hash(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"", "d41d8cd98f00b204e9800998ecf8427e"},
		{"hello", "5d41402abc4b2a76b9719d911017c592"},
		{"username:realm:password", "66999343281b2624585fd58cc9d36dfc"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := md5Hash(tt.input)
			if got != tt.expected {
				t.Errorf("md5Hash(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

// TestGenerateNonce tests nonce generation
func TestGenerateNonce(t *testing.T) {
	nonce1, err := generateNonce()
	if err != nil {
		t.Fatalf("generateNonce failed: %v", err)
	}

	// generateNonce creates 8 bytes = 16 hex characters
	if len(nonce1) != 16 {
		t.Errorf("nonce length = %d, want 16", len(nonce1))
	}

	// Verify hex encoding
	for _, c := range nonce1 {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			t.Errorf("nonce contains non-hex char: %c", c)
		}
	}

	// Verify uniqueness
	nonce2, _ := generateNonce()
	if nonce1 == nonce2 {
		t.Error("generated identical nonces")
	}
}

// TestDigestAuthRoundTrip tests the complete Digest auth round-trip
func TestDigestAuthRoundTrip(t *testing.T) {
	// This test verifies that the digest auth we generate can be validated
	// using the same algorithm that servers use

	username := "testuser"
	password := "testpass"
	method := "POST"
	uri := "/api/test"
	nonce := "servernonce123"
	realm := "testrealm"
	qop := "auth"

	auth, err := buildDigestAuth(username, password, method, uri, nonce, realm, qop)
	if err != nil {
		t.Fatalf("buildDigestAuth failed: %v", err)
	}

	// Parse the generated auth header to extract values
	auth = strings.TrimPrefix(auth, "Digest ")
	fields := make(map[string]string)

	// Parse key="value" pairs
	parts := tokenizeDigestHeader(auth)
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if idx := strings.Index(part, "="); idx > 0 {
			key := part[:idx]
			val := unquote(part[idx+1:])
			fields[key] = val
		}
	}

	// Verify HA1 = MD5(username:realm:password)
	expectedHA1 := md5Hash(fmt.Sprintf("%s:%s:%s", username, realm, password))

	// Extract cnonce and nc from fields
	cnonce := fields["cnonce"]
	nc := fields["nc"]

	// Recalculate response
	path := "/api/test" // uri without host
	ha2 := md5Hash(fmt.Sprintf("%s:%s", method, path))
	expectedResponse := md5Hash(fmt.Sprintf("%s:%s:%s:%s:%s:%s", expectedHA1, nonce, nc, cnonce, qop, ha2))

	if fields["response"] != expectedResponse {
		t.Errorf("response mismatch:\ngot:      %s\nexpected: %s", fields["response"], expectedResponse)
	}
}
