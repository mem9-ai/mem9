package handler

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/reqid"
	"github.com/qiffang/mnemos/server/internal/service"
	"github.com/qiffang/mnemos/server/internal/tenant"
	"log/slog"
)

type handlerTenantRepo struct {
	getTenant *domain.Tenant
	getErr    error
}

func (r *handlerTenantRepo) Create(ctx context.Context, t *domain.Tenant) error {
	return nil
}

func (r *handlerTenantRepo) GetByID(ctx context.Context, id string) (*domain.Tenant, error) {
	if r.getErr != nil {
		return nil, r.getErr
	}
	if r.getTenant != nil {
		return r.getTenant, nil
	}
	return nil, domain.ErrNotFound
}

func (r *handlerTenantRepo) GetByName(ctx context.Context, name string) (*domain.Tenant, error) {
	return nil, domain.ErrNotFound
}

func (r *handlerTenantRepo) UpdateStatus(ctx context.Context, id string, status domain.TenantStatus) error {
	return nil
}

func (r *handlerTenantRepo) UpdateSchemaVersion(ctx context.Context, id string, version int) error {
	return nil
}

type handlerProvisioner struct {
	info *tenant.ClusterInfo
}

func (p *handlerProvisioner) Provision(ctx context.Context) (*tenant.ClusterInfo, error) {
	return p.info, nil
}

func (p *handlerProvisioner) InitSchema(ctx context.Context, db *sql.DB) error {
	return nil
}

func (p *handlerProvisioner) ProviderType() string {
	return "mock"
}

type handlerPool struct {
	backend string
	db      *sql.DB
}

func (p *handlerPool) Backend() string {
	return p.backend
}

func (p *handlerPool) Get(ctx context.Context, tenantID, dsn string) (*sql.DB, error) {
	return p.db, nil
}

func decodeHandlerLogs(t *testing.T, buf *bytes.Buffer) []map[string]any {
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

func findHandlerLogEntry(t *testing.T, entries []map[string]any, message string) map[string]any {
	t.Helper()

	for _, entry := range entries {
		if entry["msg"] == message {
			return entry
		}
	}

	t.Fatalf("log entry %q not found", message)
	return nil
}

func TestProvisionMem9s_FiltersUTMParamsAndKeepsResponseShape(t *testing.T) {
	t.Parallel()

	var logBuf bytes.Buffer
	logger := slog.New(reqid.NewHandler(slog.NewJSONHandler(&logBuf, nil)))
	tenantSvc := service.NewTenantService(
		&handlerTenantRepo{},
		&handlerProvisioner{
			info: &tenant.ClusterInfo{
				ID:        "tenant-handler-utm",
				ClusterID: "cluster-handler-utm",
				Host:      "test-host",
				Port:      4000,
				Username:  "root",
				Password:  "plaintext-password",
				DBName:    "mnemo",
			},
		},
		&handlerPool{backend: "tidb", db: &sql.DB{}},
		logger,
		"",
		0,
		0,
		false,
		encrypt.NewPlainEncryptor(),
	)
	srv := NewServer(tenantSvc, nil, "", nil, nil, "", false, service.ModeSmart, "", logger)

	req := httptest.NewRequest(http.MethodPost, "/v1alpha1/mem9s?utm_source=bosn&utm_campaign=spring&foo=bar&utm_medium=", nil)
	req = req.WithContext(reqid.NewContext(req.Context(), "req-handler-utm"))
	rr := httptest.NewRecorder()

	srv.provisionMem9s(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp) != 1 {
		t.Fatalf("response = %#v, want only id", resp)
	}
	if resp["id"] != "tenant-handler-utm" {
		t.Fatalf("response id = %v, want tenant-handler-utm", resp["id"])
	}

	entries := decodeHandlerLogs(t, &logBuf)
	start := findHandlerLogEntry(t, entries, "tenant provision start")
	if start["request_id"] != "req-handler-utm" {
		t.Fatalf("request_id = %v, want req-handler-utm", start["request_id"])
	}

	utm, ok := start["utm"].(map[string]any)
	if !ok {
		t.Fatalf("utm = %#v, want object", start["utm"])
	}
	if len(utm) != 2 {
		t.Fatalf("utm = %#v, want exactly 2 params", utm)
	}
	if utm["utm_source"] != "bosn" || utm["utm_campaign"] != "spring" {
		t.Fatalf("utm = %#v", utm)
	}
	if _, exists := utm["foo"]; exists {
		t.Fatalf("non-utm param leaked into utm map: %#v", utm)
	}
}

func TestGetKeyStatus(t *testing.T) {
	repoErr := errors.New("repo failed")

	tests := []struct {
		name      string
		apiKey    string
		tenant    *domain.Tenant
		repoErr   error
		wantCode  int
		wantField string
		wantValue string
	}{
		{
			name:      "missing key",
			wantCode:  http.StatusUnauthorized,
			wantField: "error",
			wantValue: "missing or malformed X-API-Key",
		},
		{
			name:      "whitespace key",
			apiKey:    "   ",
			wantCode:  http.StatusUnauthorized,
			wantField: "error",
			wantValue: "missing or malformed X-API-Key",
		},
		{
			name:      "active key",
			apiKey:    "key-active",
			tenant:    &domain.Tenant{Status: domain.TenantActive},
			wantCode:  http.StatusOK,
			wantField: "status",
			wantValue: string(domain.KeyStatusActive),
		},
		{
			name:      "inactive key",
			apiKey:    "key-provisioning",
			tenant:    &domain.Tenant{Status: domain.TenantProvisioning},
			wantCode:  http.StatusOK,
			wantField: "status",
			wantValue: string(domain.KeyStatusInactive),
		},
		{
			name:      "missing tenant",
			apiKey:    "key-missing",
			wantCode:  http.StatusNotFound,
			wantField: "error",
			wantValue: "key not found",
		},
		{
			name:      "repository failure",
			apiKey:    "key-failure",
			repoErr:   repoErr,
			wantCode:  http.StatusInternalServerError,
			wantField: "error",
			wantValue: "auth backend unavailable",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logBuf bytes.Buffer
			logger := slog.New(reqid.NewHandler(slog.NewJSONHandler(&logBuf, nil)))
			tenantSvc := service.NewTenantService(
				&handlerTenantRepo{getTenant: tt.tenant, getErr: tt.repoErr},
				nil,
				nil,
				logger,
				"",
				0,
				0,
				false,
				encrypt.NewPlainEncryptor(),
			)
			srv := NewServer(tenantSvc, nil, "", nil, nil, "", false, service.ModeSmart, "", logger)

			apiKeyMWCalled := false
			router := srv.Router(
				func(h http.Handler) http.Handler { return h },
				func(h http.Handler) http.Handler { return h },
				func(h http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						apiKeyMWCalled = true
						respondError(w, http.StatusTeapot, "apiKeyMW called")
					})
				},
			)

			req := httptest.NewRequest(http.MethodGet, "/v1alpha2/status", nil)
			if tt.apiKey != "" {
				req.Header.Set("X-API-Key", tt.apiKey)
			}
			rr := httptest.NewRecorder()

			router.ServeHTTP(rr, req)

			if apiKeyMWCalled {
				t.Fatal("apiKeyMW must not run for /v1alpha2/status")
			}
			if rr.Code != tt.wantCode {
				t.Fatalf("status = %d, body = %s, want %d", rr.Code, rr.Body.String(), tt.wantCode)
			}
			var body map[string]string
			if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body[tt.wantField] != tt.wantValue {
				t.Fatalf("response %s = %q, want %q; body = %#v", tt.wantField, body[tt.wantField], tt.wantValue, body)
			}
			if strings.Contains(logBuf.String(), tt.apiKey) && tt.apiKey != "" {
				t.Fatalf("logs leaked API key: %s", logBuf.String())
			}
		})
	}
}

func TestNormalizeUTMParams_WithoutUTMReturnsNil(t *testing.T) {
	t.Parallel()

	got := normalizeUTMParams(map[string][]string{
		"foo": {"bar"},
	})
	if got != nil {
		t.Fatalf("normalizeUTMParams() = %#v, want nil", got)
	}
}
