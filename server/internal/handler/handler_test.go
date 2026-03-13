package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/middleware"
)

func newTestServer() *Server {
	return NewServer(nil, nil, "", nil, nil, "", false, "", "", nil)
}

func passthroughMW(next http.Handler) http.Handler { return next }

func blockingMW(status int, msg string) func(http.Handler) http.Handler {
	return func(_ http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqID := chimw.GetReqID(r.Context())
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error":      msg,
				"request_id": reqID,
			})
		})
	}
}

func errorBody(t *testing.T, rec *httptest.ResponseRecorder) (errMsg, reqID string) {
	t.Helper()
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("response body is not valid JSON: %v — body: %s", err, rec.Body.String())
	}
	return body["error"], body["request_id"]
}

func assertRequestIDHeader(t *testing.T, rec *httptest.ResponseRecorder, bodyReqID string) {
	t.Helper()
	hdr := rec.Header().Get(chimw.RequestIDHeader)
	if hdr == "" {
		t.Errorf("X-Request-Id header is missing")
		return
	}
	if bodyReqID != "" && hdr != bodyReqID {
		t.Errorf("X-Request-Id header %q != body request_id %q", hdr, bodyReqID)
	}
}

func TestRequestIDHeader_OnHandlerError(t *testing.T) {
	srv := newTestServer()
	router := srv.Router(
		func(_ http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				respondError(w, r, http.StatusBadRequest, "validation failed")
			})
		},
		passthroughMW,
		passthroughMW,
	)

	req := httptest.NewRequest(http.MethodGet, "/v1alpha1/mem9s/test-tenant/memories", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	errMsg, reqID := errorBody(t, rec)
	if errMsg == "" {
		t.Errorf("expected non-empty error field in body")
	}
	if reqID == "" {
		t.Errorf("expected non-empty request_id in body")
	}
	assertRequestIDHeader(t, rec, reqID)
}

func TestRequestIDHeader_OnAuthFailure(t *testing.T) {
	srv := newTestServer()
	router := srv.Router(
		blockingMW(http.StatusNotFound, "tenant not found"),
		passthroughMW,
		passthroughMW,
	)

	req := httptest.NewRequest(http.MethodGet, "/v1alpha1/mem9s/bad-tenant/memories", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
	errMsg, reqID := errorBody(t, rec)
	if errMsg != "tenant not found" {
		t.Errorf("unexpected error message: %q", errMsg)
	}
	if reqID == "" {
		t.Errorf("expected non-empty request_id in body")
	}
	assertRequestIDHeader(t, rec, reqID)
}

func TestRequestIDHeader_OnForbidden(t *testing.T) {
	srv := newTestServer()
	router := srv.Router(
		blockingMW(http.StatusForbidden, "tenant not active"),
		passthroughMW,
		passthroughMW,
	)

	req := httptest.NewRequest(http.MethodGet, "/v1alpha1/mem9s/inactive-tenant/memories", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
	errMsg, reqID := errorBody(t, rec)
	if errMsg != "tenant not active" {
		t.Errorf("unexpected error message: %q", errMsg)
	}
	if reqID == "" {
		t.Errorf("expected non-empty request_id in body")
	}
	assertRequestIDHeader(t, rec, reqID)
}

func TestRequestIDHeader_OnRateLimit(t *testing.T) {
	srv := newTestServer()
	router := srv.Router(
		passthroughMW,
		blockingMW(http.StatusTooManyRequests, "rate limit exceeded"),
		passthroughMW,
	)

	req := httptest.NewRequest(http.MethodGet, "/v1alpha1/mem9s/any-tenant/memories", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rec.Code)
	}
	errMsg, reqID := errorBody(t, rec)
	if errMsg != "rate limit exceeded" {
		t.Errorf("unexpected error message: %q", errMsg)
	}
	if reqID == "" {
		t.Errorf("expected non-empty request_id in body")
	}
	assertRequestIDHeader(t, rec, reqID)
}

func TestRequestIDHeader_OnChiNative404(t *testing.T) {
	srv := newTestServer()
	router := srv.Router(passthroughMW, passthroughMW, passthroughMW)

	req := httptest.NewRequest(http.MethodGet, "/does-not-exist", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
	if hdr := rec.Header().Get(chimw.RequestIDHeader); hdr == "" {
		t.Errorf("X-Request-Id header missing on chi-native 404")
	}
	ct := rec.Header().Get("Content-Type")
	if strings.Contains(ct, "application/json") {
		var body map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&body); err == nil {
			if body["request_id"] == "" {
				t.Errorf("JSON body present but request_id missing")
			}
		}
	}
}

func TestRequestIDHeader_OnChiNative405(t *testing.T) {
	srv := newTestServer()
	router := srv.Router(passthroughMW, passthroughMW, passthroughMW)

	req := httptest.NewRequest(http.MethodPatch, "/healthz", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
	if hdr := rec.Header().Get(chimw.RequestIDHeader); hdr == "" {
		t.Errorf("X-Request-Id header missing on chi-native 405")
	}
}

func TestRealAuthMiddleware_TenantNotFound(t *testing.T) {
	srv := newTestServer()
	tenantMW := middleware.ResolveTenant(stubTenantRepo{}, nil)
	router := srv.Router(tenantMW, passthroughMW, passthroughMW)

	req := httptest.NewRequest(http.MethodGet, "/v1alpha1/mem9s/no-such-tenant/memories", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
	_, reqID := errorBody(t, rec)
	if reqID == "" {
		t.Errorf("expected non-empty request_id from auth middleware error")
	}
	assertRequestIDHeader(t, rec, reqID)
}

type stubTenantRepo struct{}

func (stubTenantRepo) Create(_ context.Context, _ *domain.Tenant) error { return nil }
func (stubTenantRepo) GetByID(_ context.Context, _ string) (*domain.Tenant, error) {
	return nil, domain.ErrNotFound
}
func (stubTenantRepo) GetByName(_ context.Context, _ string) (*domain.Tenant, error) {
	return nil, domain.ErrNotFound
}
func (stubTenantRepo) UpdateStatus(_ context.Context, _ string, _ domain.TenantStatus) error {
	return nil
}
func (stubTenantRepo) UpdateSchemaVersion(_ context.Context, _ string, _ int) error { return nil }
