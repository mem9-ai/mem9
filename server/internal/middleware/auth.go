package middleware

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/tenant"
)

type contextKey string

const authInfoKey contextKey = "authInfo"

const AgentIDHeader = "X-Mnemo-Agent-Id"
const APIKeyHeader = "X-API-Key"

// ResolveTenant is middleware that extracts {tenantID} from the URL path,
// validates the tenant exists and is active, obtains a DB connection from the
// pool, and stores an AuthInfo in the request context.
func ResolveTenant(
	tenantRepo repository.TenantRepo,
	pool *tenant.TenantPool,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tenantID := chi.URLParam(r, "tenantID")
			if tenantID == "" {
				writeError(w, http.StatusBadRequest, "missing tenant ID in path")
				return
			}

			t, err := tenantRepo.GetByID(r.Context(), tenantID)
			if err != nil {
				writeError(w, http.StatusNotFound, "tenant not found")
				return
			}

			// only zero cluster provisioner blocks non-active tenants, starter cluster provisioner allows non-active to used
			if t.Status != domain.TenantActive && t.Provider == tenant.ZeroProvisionerType {
				writeError(w, http.StatusForbidden, "tenant is not active")
				return
			}

			db, err := pool.Get(r.Context(), t.ID, t.DSNForBackend(pool.Backend()))
			if err != nil {
				writeError(w, http.StatusServiceUnavailable, "cannot connect to tenant database")
				return
			}

			info := &domain.AuthInfo{
				TenantID:  t.ID,
				TenantDB:  db,
				ClusterID: t.ClusterID,
			}
			if agentID := r.Header.Get(AgentIDHeader); agentID != "" {
				info.AgentName = agentID
			}

			ctx := context.WithValue(r.Context(), authInfoKey, info)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ResolveApiKey is middleware that extracts X-API-Key from the request headers,
// validates the tenant exists and is active, obtains a DB connection from the
// pool, and stores an AuthInfo in the request context.
func ResolveApiKey(
	tenantRepo repository.TenantRepo,
	pool *tenant.TenantPool,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			apiKey := r.Header.Get(APIKeyHeader)
			if apiKey == "" {
				writeError(w, http.StatusBadRequest, "missing API key")
				return
			}

			t, err := tenantRepo.GetByID(r.Context(), apiKey)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid API key")
				return
			}
			if t.Status != domain.TenantActive {
				writeError(w, http.StatusBadRequest, "invalid API key")
				return
			}

			db, err := pool.Get(r.Context(), t.ID, t.DSNForBackend(pool.Backend()))
			if err != nil {
				writeError(w, http.StatusServiceUnavailable, "cannot connect to tenant database")
				return
			}

			info := &domain.AuthInfo{
				TenantID:  t.ID,
				TenantDB:  db,
				ClusterID: t.ClusterID,
			}
			if agentID := r.Header.Get(AgentIDHeader); agentID != "" {
				info.AgentName = agentID
			}

			ctx := context.WithValue(r.Context(), authInfoKey, info)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func AuthFromContext(ctx context.Context) *domain.AuthInfo {
	info, _ := ctx.Value(authInfoKey).(*domain.AuthInfo)
	return info
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
