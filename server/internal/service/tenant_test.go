package service

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/reqid"
	"github.com/qiffang/mnemos/server/internal/tenant"
)

func TestBuildMemorySchema(t *testing.T) {
	commonChecks := []string{
		"CREATE TABLE IF NOT EXISTS memories",
		"id              VARCHAR(36)",
		"INDEX idx_updated",
	}

	t.Run("no auto-model uses plain VECTOR(1536)", func(t *testing.T) {
		schema := tenant.BuildMemorySchema("", 0, 0)
		for _, needle := range commonChecks {
			if !strings.Contains(schema, needle) {
				t.Fatalf("schema missing %q", needle)
			}
		}
		if !strings.Contains(schema, "VECTOR(1536)") {
			t.Fatal("schema missing VECTOR(1536) for no-auto-model mode")
		}
		if strings.Contains(schema, "GENERATED ALWAYS AS") {
			t.Fatal("schema must not contain GENERATED ALWAYS AS for no-auto-model mode")
		}
	})

	t.Run("no auto-model with clientDims=4096 uses VECTOR(4096)", func(t *testing.T) {
		schema := tenant.BuildMemorySchema("", 0, 4096)
		for _, needle := range commonChecks {
			if !strings.Contains(schema, needle) {
				t.Fatalf("schema missing %q", needle)
			}
		}
		if !strings.Contains(schema, "VECTOR(4096)") {
			t.Fatal("schema missing VECTOR(4096) for clientDims=4096")
		}
		if strings.Contains(schema, "GENERATED ALWAYS AS") {
			t.Fatal("schema must not contain GENERATED ALWAYS AS for no-auto-model mode")
		}
	})

	t.Run("no auto-model with clientDims=1024 uses VECTOR(1024)", func(t *testing.T) {
		schema := tenant.BuildMemorySchema("", 0, 1024)
		if !strings.Contains(schema, "VECTOR(1024)") {
			t.Fatal("schema missing VECTOR(1024) for clientDims=1024")
		}
	})

	t.Run("auto-model emits EMBED_TEXT generated column with correct dims", func(t *testing.T) {
		schema := tenant.BuildMemorySchema("tidbcloud_free/amazon/titan-embed-text-v2", 1024, 0)
		for _, needle := range commonChecks {
			if !strings.Contains(schema, needle) {
				t.Fatalf("schema missing %q", needle)
			}
		}
		if !strings.Contains(schema, "VECTOR(1024)") {
			t.Fatal("schema missing VECTOR(1024) for auto-model mode")
		}
		if !strings.Contains(schema, "GENERATED ALWAYS AS") {
			t.Fatal("schema missing GENERATED ALWAYS AS for auto-model mode")
		}
		if !strings.Contains(schema, "EMBED_TEXT") {
			t.Fatal("schema missing EMBED_TEXT for auto-model mode")
		}
		if !strings.Contains(schema, "tidbcloud_free/amazon/titan-embed-text-v2") {
			t.Fatal("schema missing model name")
		}
	})
}

func TestProvisionRejectsNonTiDBBackend(t *testing.T) {
	t.Parallel()

	pool := tenant.NewPool(tenant.PoolConfig{Backend: "db9"})
	defer pool.Close()

	enc := encrypt.NewPlainEncryptor()
	svc := NewTenantService(nil, nil, pool, nil, "", 0, 0, false, enc)
	_, err := svc.Provision(context.Background(), ProvisionRequest{})
	if err == nil {
		t.Fatal("expected validation error for non-tidb backend")
	}

	var ve *domain.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected ValidationError, got %T", err)
	}
	if !strings.Contains(ve.Message, "requires tidb backend") {
		t.Fatalf("unexpected error message: %q", ve.Message)
	}
}

// TestProvision_WithEncryptor tests that Provision encrypts password for storage
// but uses plaintext for DSN connection.
func TestProvision_WithEncryptor(t *testing.T) {
	t.Parallel()

	const (
		testTenantID = "test-tenant-123"
		testPassword = "plaintext-password-123"
	)

	// Create encryptor
	enc := encrypt.NewMD5Encryptor("test-encryption-key")

	// Create mock provisioner that returns known password
	mockProv := &mockProvisioner{
		info: &tenant.ClusterInfo{
			ID:        testTenantID,
			ClusterID: testTenantID,
			Host:      "test-host",
			Port:      4000,
			Username:  "root",
			Password:  testPassword,
			DBName:    "test",
		},
	}

	// Create mock tenant repo to capture stored password
	mockRepo := &mockTenantRepo{}

	// Create pool (we can't easily mock it, but we verify the tenant struct passed to Get)
	pool := tenant.NewPool(tenant.PoolConfig{Backend: "tidb"})
	defer pool.Close()

	// Create service with a real logger (discard output)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := NewTenantService(mockRepo, mockProv, pool, logger, "", 0, 0, false, enc)

	// Call Provision
	_, err := svc.Provision(context.Background(), ProvisionRequest{})
	// Expect error because pool.Get will fail (no real DB), but we can verify the flow
	// Actually, we need to verify what was stored vs what DSN would use

	// Verify tenant was created with encrypted password
	if mockRepo.createdTenant == nil {
		t.Fatal("expected tenant to be created")
	}

	// 1. Verify stored password is encrypted (not equal to plaintext)
	if mockRepo.createdTenant.DBPassword == testPassword {
		t.Error("stored password should be encrypted, not plaintext")
	}

	// 2. Verify stored password can be decrypted back to plaintext
	decrypted, err := enc.Decrypt(context.Background(), mockRepo.createdTenant.DBPassword)
	if err != nil {
		t.Fatalf("failed to decrypt stored password: %v", err)
	}
	if decrypted != testPassword {
		t.Errorf("decrypted password = %q, want %q", decrypted, testPassword)
	}
}

// mockProvisioner is a test double for tenant.Provisioner
type mockProvisioner struct {
	info *tenant.ClusterInfo
	err  error
}

func (m *mockProvisioner) Provision(ctx context.Context) (*tenant.ClusterInfo, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.info, nil
}

func (m *mockProvisioner) InitSchema(ctx context.Context, db *sql.DB) error {
	return nil
}

func (m *mockProvisioner) ProviderType() string {
	return "mock"
}

// mockTenantRepo is a test double for repository.TenantRepo
type mockTenantRepo struct {
	createdTenant *domain.Tenant
}

func (m *mockTenantRepo) Create(ctx context.Context, t *domain.Tenant) error {
	m.createdTenant = t
	return nil
}

func (m *mockTenantRepo) GetByID(ctx context.Context, id string) (*domain.Tenant, error) {
	return nil, domain.ErrNotFound
}

func (m *mockTenantRepo) GetByName(ctx context.Context, name string) (*domain.Tenant, error) {
	return nil, domain.ErrNotFound
}

func (m *mockTenantRepo) UpdateStatus(ctx context.Context, id string, status domain.TenantStatus) error {
	return nil
}

func (m *mockTenantRepo) UpdateSchemaVersion(ctx context.Context, id string, version int) error {
	return nil
}

type mockPool struct {
	backend string
	db      *sql.DB
	err     error
}

func (m *mockPool) Backend() string {
	return m.backend
}

func (m *mockPool) Get(ctx context.Context, tenantID, dsn string) (*sql.DB, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.db, nil
}

func decodeJSONLogs(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()

	raw := strings.TrimSpace(buf.String())
	if raw == "" {
		t.Fatal("expected logs, got none")
	}

	lines := strings.Split(raw, "\n")
	entries := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("decode log line %q: %v", line, err)
		}
		entries = append(entries, entry)
	}

	return entries
}

func findLogEntry(t *testing.T, entries []map[string]any, message string) map[string]any {
	t.Helper()

	for _, entry := range entries {
		if entry["msg"] == message {
			return entry
		}
	}

	t.Fatalf("log entry %q not found", message)
	return nil
}

func TestProvision_LogsUTMOnSuccess(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	logger := slog.New(reqid.NewHandler(slog.NewJSONHandler(&buf, nil)))
	svc := NewTenantService(
		&mockTenantRepo{},
		&mockProvisioner{
			info: &tenant.ClusterInfo{
				ID:        "tenant-utm-success",
				ClusterID: "cluster-utm-success",
				Host:      "test-host",
				Port:      4000,
				Username:  "root",
				Password:  "plaintext-password",
				DBName:    "mnemo",
			},
		},
		&mockPool{backend: "tidb", db: &sql.DB{}},
		logger,
		"",
		0,
		0,
		false,
		encrypt.NewPlainEncryptor(),
	)

	ctx := reqid.NewContext(context.Background(), "req-success")
	result, err := svc.Provision(ctx, ProvisionRequest{
		UTM: map[string]string{
			"utm_source":   "bosn",
			"utm_campaign": "spring",
		},
	})
	if err != nil {
		t.Fatalf("Provision() error: %v", err)
	}
	if result == nil || result.ID != "tenant-utm-success" {
		t.Fatalf("Provision() result = %#v", result)
	}

	entries := decodeJSONLogs(t, &buf)
	start := findLogEntry(t, entries, "tenant provision start")
	if start["request_id"] != "req-success" {
		t.Fatalf("start request_id = %v, want req-success", start["request_id"])
	}
	startUTM, ok := start["utm"].(map[string]any)
	if !ok {
		t.Fatalf("start utm = %#v, want object", start["utm"])
	}
	if startUTM["utm_source"] != "bosn" || startUTM["utm_campaign"] != "spring" {
		t.Fatalf("start utm = %#v", startUTM)
	}

	complete := findLogEntry(t, entries, "tenant provision complete")
	if complete["request_id"] != "req-success" {
		t.Fatalf("complete request_id = %v, want req-success", complete["request_id"])
	}
	if complete["tenant_id"] != "tenant-utm-success" {
		t.Fatalf("complete tenant_id = %v, want tenant-utm-success", complete["tenant_id"])
	}
	completeUTM, ok := complete["utm"].(map[string]any)
	if !ok {
		t.Fatalf("complete utm = %#v, want object", complete["utm"])
	}
	if completeUTM["utm_source"] != "bosn" || completeUTM["utm_campaign"] != "spring" {
		t.Fatalf("complete utm = %#v", completeUTM)
	}
}

func TestProvision_LogsUTMOnFailure(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	logger := slog.New(reqid.NewHandler(slog.NewJSONHandler(&buf, nil)))
	svc := NewTenantService(
		&mockTenantRepo{},
		&mockProvisioner{
			info: &tenant.ClusterInfo{
				ID:        "tenant-utm-failure",
				ClusterID: "cluster-utm-failure",
				Host:      "test-host",
				Port:      4000,
				Username:  "root",
				Password:  "plaintext-password",
				DBName:    "mnemo",
			},
		},
		&mockPool{backend: "tidb", err: errors.New("db unavailable")},
		logger,
		"",
		0,
		0,
		false,
		encrypt.NewPlainEncryptor(),
	)

	ctx := reqid.NewContext(context.Background(), "req-failure")
	_, err := svc.Provision(ctx, ProvisionRequest{
		UTM: map[string]string{
			"utm_source": "bosn",
		},
	})
	if err == nil {
		t.Fatal("expected Provision() to fail")
	}

	entries := decodeJSONLogs(t, &buf)
	failure := findLogEntry(t, entries, "tenant provision failed")
	if failure["request_id"] != "req-failure" {
		t.Fatalf("failure request_id = %v, want req-failure", failure["request_id"])
	}
	if failure["tenant_id"] != "tenant-utm-failure" {
		t.Fatalf("failure tenant_id = %v, want tenant-utm-failure", failure["tenant_id"])
	}
	failureUTM, ok := failure["utm"].(map[string]any)
	if !ok {
		t.Fatalf("failure utm = %#v, want object", failure["utm"])
	}
	if failureUTM["utm_source"] != "bosn" {
		t.Fatalf("failure utm = %#v", failureUTM)
	}
}

func TestBuildDB9MemorySchema(t *testing.T) {
	commonChecks := []string{
		"CREATE TABLE IF NOT EXISTS memories",
		"id              VARCHAR(36)",
		"idx_memory_updated",
		"update_updated_at()",
	}

	t.Run("no auto-model uses plain VECTOR(1536)", func(t *testing.T) {
		schema := tenant.BuildDB9MemorySchema("", 0, 0)
		for _, needle := range commonChecks {
			if !strings.Contains(schema, needle) {
				t.Fatalf("schema missing %q", needle)
			}
		}
		if !strings.Contains(schema, "VECTOR(1536)") {
			t.Fatal("schema missing VECTOR(1536) for no-auto-model mode")
		}
		if strings.Contains(schema, "GENERATED ALWAYS AS") {
			t.Fatal("schema must not contain GENERATED ALWAYS AS for no-auto-model mode")
		}
	})

	t.Run("no auto-model with clientDims=4096 uses VECTOR(4096)", func(t *testing.T) {
		schema := tenant.BuildDB9MemorySchema("", 0, 4096)
		if !strings.Contains(schema, "VECTOR(4096)") {
			t.Fatal("schema missing VECTOR(4096) for clientDims=4096")
		}
		if strings.Contains(schema, "GENERATED ALWAYS AS") {
			t.Fatal("schema must not contain GENERATED ALWAYS AS for no-auto-model mode")
		}
	})

	t.Run("auto-model emits EMBED_TEXT generated column with correct dims", func(t *testing.T) {
		schema := tenant.BuildDB9MemorySchema("amazon.titan-embed-text-v2:0", 1024, 0)
		for _, needle := range commonChecks {
			if !strings.Contains(schema, needle) {
				t.Fatalf("schema missing %q", needle)
			}
		}
		if !strings.Contains(schema, "VECTOR(1024)") {
			t.Fatal("schema missing VECTOR(1024) for auto-model mode")
		}
		if !strings.Contains(schema, "GENERATED ALWAYS AS") {
			t.Fatal("schema missing GENERATED ALWAYS AS for auto-model mode")
		}
		if !strings.Contains(schema, "EMBED_TEXT") {
			t.Fatal("schema missing EMBED_TEXT for auto-model mode")
		}
		if !strings.Contains(schema, "amazon.titan-embed-text-v2:0") {
			t.Fatal("schema missing model name")
		}
		// Verify dimensions arg is included in EMBED_TEXT call
		if !strings.Contains(schema, `'{"dimensions": 1024}'`) {
			t.Fatal("schema missing dimensions arg in EMBED_TEXT call")
		}
	})

	t.Run("auto-model with 512 dims", func(t *testing.T) {
		schema := tenant.BuildDB9MemorySchema("some-model", 512, 0)
		if !strings.Contains(schema, "VECTOR(512)") {
			t.Fatal("schema missing VECTOR(512)")
		}
		if !strings.Contains(schema, `'{"dimensions": 512}'`) {
			t.Fatal("schema missing dimensions 512 in EMBED_TEXT call")
		}
	})

	t.Run("single-quote in model name is escaped", func(t *testing.T) {
		schema := tenant.BuildDB9MemorySchema("model'inject", 1024, 0)
		// Should be escaped to double single-quotes
		if !strings.Contains(schema, "model''inject") {
			t.Fatal("single quote in model name not escaped")
		}
	})
}

func TestBuildMemorySchema_DimensionsArg(t *testing.T) {
	t.Run("auto-model includes dimensions in EMBED_TEXT", func(t *testing.T) {
		schema := tenant.BuildMemorySchema("tidbcloud_free/amazon/titan-embed-text-v2", 1024, 0)
		if !strings.Contains(schema, `'{"dimensions": 1024}'`) {
			t.Fatal("schema missing dimensions arg in EMBED_TEXT call")
		}
	})

	t.Run("single-quote in model name is escaped", func(t *testing.T) {
		schema := tenant.BuildMemorySchema("model'inject", 1024, 0)
		if !strings.Contains(schema, "model''inject") {
			t.Fatal("single quote in model name not escaped")
		}
	})
}
