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
	"github.com/qiffang/mnemos/server/internal/middleware"
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
	router := runtimeStateRouter(nil, &domain.AuthInfo{
		TenantID:      "tenant-a",
		ClusterID:     "cluster-a",
		APIKeySubject: "mem9_test",
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/runtime-state", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var state runtimeusage.RuntimeState
	if err := json.Unmarshal(rec.Body.Bytes(), &state); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	assertRuntimeStateMeter(t, state, runtimeusage.MeterMemoryRecallRequests, runtimeusage.RuntimeBudgetTypeNotMetered, runtimeusage.RuntimeBudgetStateUnlimited)
	assertRuntimeStateMeter(t, state, runtimeusage.MeterMemoryWriteRequests, runtimeusage.RuntimeBudgetTypeNotMetered, runtimeusage.RuntimeBudgetStateUnlimited)
}

func TestGetRuntimeStateCallsProviderWhenEnabled(t *testing.T) {
	client := &runtimeStateQuotaClient{state: runtimeusage.RuntimeState{
		Mem9APIKey: runtimeusage.RuntimeStateAPIKey{Status: runtimeusage.RuntimeAPIKeyStatusActive},
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
	manager := runtimeusage.NewManager(runtimeusage.Config{Enabled: true}, client, nil, slog.Default())
	auth := &domain.AuthInfo{
		TenantID:      "tenant-a",
		ClusterID:     "cluster-a",
		APIKeySubject: "mem9_test",
		AgentName:     "Codex",
	}
	router := runtimeStateRouter(manager, auth)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/runtime-state", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(client.subjects) != 1 {
		t.Fatalf("subjects = %+v, want one", client.subjects)
	}
	got := client.subjects[0]
	if got.TenantID != auth.TenantID || got.ClusterID != auth.ClusterID || got.APIKeySubject != auth.APIKeySubject || got.AgentName != auth.AgentName {
		t.Fatalf("subject = %+v, want auth-derived subject", got)
	}

	var state runtimeusage.RuntimeState
	if err := json.Unmarshal(rec.Body.Bytes(), &state); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	assertRuntimeStateMeter(t, state, runtimeusage.MeterMemoryRecallRequests, runtimeusage.RuntimeBudgetTypeNotMetered, runtimeusage.RuntimeBudgetStateUnlimited)
}

func TestGetRuntimeStateFallsBackWhenProviderUnavailable(t *testing.T) {
	client := &runtimeStateQuotaClient{err: errors.New("provider timeout")}
	manager := runtimeusage.NewManager(runtimeusage.Config{Enabled: true}, client, nil, slog.Default())
	router := runtimeStateRouter(manager, &domain.AuthInfo{
		TenantID:      "tenant-a",
		ClusterID:     "cluster-a",
		APIKeySubject: "mem9_test",
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1alpha2/mem9s/runtime-state", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var state runtimeusage.RuntimeState
	if err := json.Unmarshal(rec.Body.Bytes(), &state); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if state.Mem9APIKey.Status != runtimeusage.RuntimeAPIKeyStatusUnknown {
		t.Fatalf("status = %q, want unknown", state.Mem9APIKey.Status)
	}
	assertRuntimeStateMeter(t, state, runtimeusage.MeterMemoryRecallRequests, runtimeusage.RuntimeBudgetTypeProviderManaged, runtimeusage.RuntimeBudgetStateProviderManaged)
	assertRuntimeStateMeter(t, state, runtimeusage.MeterMemoryWriteRequests, runtimeusage.RuntimeBudgetTypeProviderManaged, runtimeusage.RuntimeBudgetStateProviderManaged)
}

func runtimeStateRouter(manager runtimeusage.Manager, auth *domain.AuthInfo) http.Handler {
	srv := NewServer(nil, nil, "", nil, nil, "", false, service.ModeSmart, "", slog.Default())
	if manager != nil {
		srv.WithRuntimeUsage(manager)
	}
	pass := func(next http.Handler) http.Handler { return next }
	authMW := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(middleware.WithAuthContext(r.Context(), auth)))
		})
	}
	return srv.Router(pass, pass, authMW, pass)
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
