package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/runtimeusage"
	"github.com/qiffang/mnemos/server/internal/service"
)

type runtimeStateQuotaClient struct {
	state    runtimeusage.RuntimeState
	err      error
	subjects []runtimeusage.Subject
}

func (c *runtimeStateQuotaClient) RuntimeState(_ context.Context, subject runtimeusage.Subject) (runtimeusage.RuntimeState, error) {
	c.subjects = append(c.subjects, subject)
	if c.err != nil {
		return runtimeusage.RuntimeState{}, c.err
	}
	return c.state, nil
}

func (c *runtimeStateQuotaClient) Reserve(context.Context, runtimeusage.Subject, string, runtimeusage.Operation) (*runtimeusage.Reservation, error) {
	return nil, nil
}

func (c *runtimeStateQuotaClient) FinalizeReservation(context.Context, runtimeusage.Subject, string, string, string) error {
	return nil
}

func TestGetRuntimeStateReturnsDisabledFallback(t *testing.T) {
	apiKeyMWCalled := false
	router := runtimeStateRouter(t, nil, &domain.Tenant{
		ID:        "tenant-a",
		ClusterID: "cluster-a",
		Status:    domain.TenantActive,
	}, nil, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			apiKeyMWCalled = true
			respondError(w, http.StatusServiceUnavailable, "data-plane auth should not run")
		})
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/runtime-state", nil)
	req.Header.Set("X-API-Key", "mem9_test")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if apiKeyMWCalled {
		t.Fatal("apiKeyMW called for runtime-state route")
	}
	var state runtimeusage.RuntimeState
	if err := json.Unmarshal(rec.Body.Bytes(), &state); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if state.Mem9APIKey.Status != runtimeusage.RuntimeAPIKeyStatusActive {
		t.Fatalf("status = %q, want active", state.Mem9APIKey.Status)
	}
	assertRuntimeStateMeter(t, state, runtimeusage.MeterMemoryRecallRequests, runtimeusage.RuntimeBudgetTypeNotMetered, runtimeusage.RuntimeBudgetStateUnlimited)
	assertRuntimeStateMeter(t, state, runtimeusage.MeterMemoryWriteRequests, runtimeusage.RuntimeBudgetTypeNotMetered, runtimeusage.RuntimeBudgetStateUnlimited)
}

func TestGetRuntimeStateCallsProviderWhenEnabled(t *testing.T) {
	client := &runtimeStateQuotaClient{state: runtimeusage.RuntimeState{
		Mem9APIKey:   runtimeusage.RuntimeStateAPIKey{Status: runtimeusage.RuntimeAPIKeyStatusUnknown},
		ProviderData: json.RawMessage(`{"bindingState":"claimed"}`),
		Meters: []runtimeusage.RuntimeStateMeter{{
			Meter: runtimeusage.MeterMemoryRecallRequests,
			Budgets: []runtimeusage.RuntimeStatusBudget{{
				Type:  runtimeusage.RuntimeBudgetTypeNotMetered,
				State: runtimeusage.RuntimeBudgetStateUnlimited,
				Measure: runtimeusage.RuntimeStatusMeasure{
					Kind:     runtimeusage.RuntimeMeasureKindCount,
					Quantity: "request",
					Scale:    1,
				},
				Period:   runtimeusage.RuntimeStatusPeriod{Type: runtimeusage.RuntimePeriodTypeNone},
				Capacity: runtimeusage.RuntimeStatusCapacity{Type: runtimeusage.RuntimeCapacityTypeUnlimited},
			}},
		}},
	}}
	manager := runtimeusage.NewManager(runtimeusage.Config{Enabled: true, ProviderID: "mem9-official"}, client, nil, slog.Default())
	router := runtimeStateRouter(t, manager, &domain.Tenant{
		ID:        "tenant-a",
		ClusterID: "cluster-a",
		Status:    domain.TenantActive,
	}, nil, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/runtime-state", nil)
	req.Header.Set("X-API-Key", "mem9_test")
	req.Header.Set("X-Mnemo-Agent-Id", "agent-a")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(client.subjects) != 1 {
		t.Fatalf("subjects = %+v, want one", client.subjects)
	}
	got := client.subjects[0]
	if got.TenantID != "tenant-a" || got.ClusterID != "cluster-a" || got.APIKeySubject != "mem9_test" || got.AgentName != "agent-a" || got.APIKeyStatus != runtimeusage.RuntimeAPIKeyStatusActive {
		t.Fatalf("subject = %+v, want auth-derived subject", got)
	}

	var state runtimeusage.RuntimeState
	if err := json.Unmarshal(rec.Body.Bytes(), &state); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if state.Mem9APIKey.Status != runtimeusage.RuntimeAPIKeyStatusActive {
		t.Fatalf("status = %q, want local active status", state.Mem9APIKey.Status)
	}
	if state.ProviderID != "mem9-official" {
		t.Fatalf("ProviderID = %q, want mem9-official", state.ProviderID)
	}
	assertRuntimeStateMeter(t, state, runtimeusage.MeterMemoryRecallRequests, runtimeusage.RuntimeBudgetTypeNotMetered, runtimeusage.RuntimeBudgetStateUnlimited)
}

func TestGetRuntimeStateFallsBackWithLocalStatusWhenProviderUnavailable(t *testing.T) {
	client := &runtimeStateQuotaClient{err: errors.New("provider timeout")}
	manager := runtimeusage.NewManager(runtimeusage.Config{Enabled: true}, client, nil, slog.Default())
	router := runtimeStateRouter(t, manager, &domain.Tenant{
		ID:        "tenant-a",
		ClusterID: "cluster-a",
		Status:    domain.TenantProvisioning,
	}, nil, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/runtime-state", nil)
	req.Header.Set("X-API-Key", "mem9_test")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var state runtimeusage.RuntimeState
	if err := json.Unmarshal(rec.Body.Bytes(), &state); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if state.Mem9APIKey.Status != runtimeusage.RuntimeAPIKeyStatusInactive {
		t.Fatalf("status = %q, want inactive", state.Mem9APIKey.Status)
	}
	assertRuntimeStateMeter(t, state, runtimeusage.MeterMemoryRecallRequests, runtimeusage.RuntimeBudgetTypeProviderManaged, runtimeusage.RuntimeBudgetStateProviderManaged)
	assertRuntimeStateMeter(t, state, runtimeusage.MeterMemoryWriteRequests, runtimeusage.RuntimeBudgetTypeProviderManaged, runtimeusage.RuntimeBudgetStateProviderManaged)
}

func TestGetRuntimeStateKeyStatusErrors(t *testing.T) {
	tests := []struct {
		name     string
		apiKey   string
		tenant   *domain.Tenant
		wantCode int
	}{
		{
			name:     "missing key",
			wantCode: http.StatusUnauthorized,
		},
		{
			name:     "unknown key",
			apiKey:   "missing",
			wantCode: http.StatusNotFound,
		},
		{
			name:     "deleted key",
			apiKey:   "deleted",
			tenant:   &domain.Tenant{ID: "tenant-a", Status: domain.TenantDeleted},
			wantCode: http.StatusNotFound,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := runtimeStateRouter(t, nil, tt.tenant, nil, nil)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/runtime-state", nil)
			if tt.apiKey != "" {
				req.Header.Set("X-API-Key", tt.apiKey)
			}
			router.ServeHTTP(rec, req)

			if rec.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantCode, rec.Body.String())
			}
		})
	}
}

func TestGetRuntimeStateUsesChainKeySubjectWithoutDataPlaneAuth(t *testing.T) {
	client := &runtimeStateQuotaClient{state: runtimeusage.RuntimeUsageDisabledState()}
	manager := runtimeusage.NewManager(runtimeusage.Config{Enabled: true}, client, nil, slog.Default())
	chains := &runtimeStateSpaceChainRepo{status: domain.KeyStatusActive}
	router := runtimeStateRouter(t, manager, nil, service.NewSpaceChainService(chains), func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("apiKeyMW called for chain runtime-state route")
		})
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/runtime-state", nil)
	req.Header.Set("X-API-Key", domain.ChainKeyPrefix+"runtime")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if chains.getByKeyCalls != 0 {
		t.Fatalf("GetByKey calls = %d, want 0", chains.getByKeyCalls)
	}
	if len(client.subjects) != 1 || client.subjects[0].APIKeySubject != domain.ChainKeyPrefix+"runtime" || client.subjects[0].APIKeyStatus != runtimeusage.RuntimeAPIKeyStatusActive {
		t.Fatalf("subjects = %+v, want chain API key subject", client.subjects)
	}
}

func runtimeStateRouter(t *testing.T, manager runtimeusage.Manager, tenant *domain.Tenant, chains *service.SpaceChainService, apiKeyMW func(http.Handler) http.Handler) http.Handler {
	t.Helper()
	tenantSvc := service.NewTenantService(
		&handlerTenantRepo{getTenant: tenant},
		nil,
		nil,
		slog.Default(),
		"",
		0,
		0,
		false,
		encrypt.NewPlainEncryptor(),
	)
	srv := NewServer(tenantSvc, nil, "", nil, nil, "", false, service.ModeSmart, "", slog.Default()).
		WithSpaceChainService(chains, 0.8)
	if manager != nil {
		srv.WithRuntimeUsage(manager)
	}
	pass := func(next http.Handler) http.Handler { return next }
	if apiKeyMW == nil {
		apiKeyMW = pass
	}
	return srv.Router(pass, pass, apiKeyMW, pass)
}

func assertRuntimeStateMeter(t *testing.T, state runtimeusage.RuntimeState, meter string, budgetType string, budgetState string) {
	t.Helper()
	for _, item := range state.Meters {
		if item.Meter != meter {
			continue
		}
		if len(item.Budgets) != 1 {
			t.Fatalf("%s budgets = %+v, want one", meter, item.Budgets)
		}
		got := item.Budgets[0]
		if got.Type != budgetType || got.State != budgetState {
			t.Fatalf("%s budget = %+v, want type=%s state=%s", meter, got, budgetType, budgetState)
		}
		return
	}
	t.Fatalf("meter %s missing from %+v", meter, state.Meters)
}

type runtimeStateSpaceChainRepo struct {
	status        domain.KeyStatus
	err           error
	getByKeyCalls int
}

func (r *runtimeStateSpaceChainRepo) Create(context.Context, *domain.SpaceChain, *domain.SpaceChainBinding) error {
	return nil
}
func (r *runtimeStateSpaceChainRepo) GetByID(context.Context, string) (*domain.SpaceChain, error) {
	return nil, domain.ErrNotFound
}
func (r *runtimeStateSpaceChainRepo) GetByKey(context.Context, string) (*domain.SpaceChain, error) {
	r.getByKeyCalls++
	return nil, domain.ErrNotFound
}
func (r *runtimeStateSpaceChainRepo) GetByKeyIncludingDisabled(context.Context, string) (*domain.SpaceChain, error) {
	return nil, domain.ErrNotFound
}
func (r *runtimeStateSpaceChainRepo) Update(context.Context, *domain.SpaceChain) error { return nil }
func (r *runtimeStateSpaceChainRepo) SoftDelete(context.Context, string, string) error { return nil }
func (r *runtimeStateSpaceChainRepo) CreateBinding(context.Context, *domain.SpaceChainBinding) error {
	return nil
}
func (r *runtimeStateSpaceChainRepo) ListBindings(context.Context, string) ([]domain.SpaceChainBinding, error) {
	return nil, nil
}
func (r *runtimeStateSpaceChainRepo) DisableBinding(context.Context, string, string, string) error {
	return nil
}
func (r *runtimeStateSpaceChainRepo) ListNodes(context.Context, string) ([]domain.SpaceChainNode, error) {
	return nil, nil
}
func (r *runtimeStateSpaceChainRepo) ReplaceNodes(context.Context, string, []domain.SpaceChainNode) error {
	return nil
}
func (r *runtimeStateSpaceChainRepo) UpdateNodeRoutingPolicy(context.Context, string, string, bool, string, bool) (*domain.SpaceChainNode, error) {
	return nil, domain.ErrNotFound
}
func (r *runtimeStateSpaceChainRepo) RemoveNodeByExternalSpaceID(context.Context, string) error {
	return nil
}
func (r *runtimeStateSpaceChainRepo) KeyStatus(context.Context, string) (domain.KeyStatus, error) {
	if r.err != nil {
		return "", r.err
	}
	return r.status, nil
}
