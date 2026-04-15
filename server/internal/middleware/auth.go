package middleware

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/tenant"
)

type contextKey string

const authInfoKey contextKey = "authInfo"

const AgentIDHeader = "X-Mnemo-Agent-Id"
const APIKeyHeader = "X-API-Key"

type tenantDBGetter interface {
	Get(ctx context.Context, tenantID string, dsn string) (*sql.DB, error)
	Backend() string
}

func isSpendLimitError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "usage quota being exhausted")
}

func classifyConnError(blacklist map[string]struct{}, clusterID string, err error) string {
	if _, blocked := blacklist[clusterID]; blocked && isSpendLimitError(err) {
		return "cluster_quota_exhausted"
	}
	return "connection_error"
}

// ResolveTenant is middleware that extracts {tenantID} from the URL path,
// validates the tenant exists and is active, obtains a DB connection from the
// pool, and stores an AuthInfo in the request context.
func ResolveTenant(
	tenantRepo repository.TenantRepo,
	pool tenantDBGetter,
	enc encrypt.Encryptor,
	clusterBlacklist map[string]struct{},
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authStart := time.Now()
			tenantID := chi.URLParam(r, "tenantID")
			if tenantID == "" {
				writeError(w, http.StatusBadRequest, "missing tenant ID in path")
				return
			}

			lookupStart := time.Now()
			t, err := tenantRepo.GetByID(r.Context(), tenantID)
			lookupDuration := time.Since(lookupStart)
			if err != nil {
				writeError(w, http.StatusNotFound, "tenant not found")
				return
			}

			// only zero cluster provisioner blocks non-active tenants, starter cluster provisioner allows non-active to used
			if t.Status != domain.TenantActive && t.Provider != tenant.StarterProvisionerType {
				writeError(w, http.StatusForbidden, "tenant is not active")
				return
			}

			// Decrypt password before using
			decryptStart := time.Now()
			decryptedPassword, err := enc.Decrypt(r.Context(), t.DBPassword)
			decryptDuration := time.Since(decryptStart)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to decrypt tenant credentials")
				return
			}
			t.DBPassword = decryptedPassword

			poolStart := time.Now()
			db, err := pool.Get(r.Context(), t.ID, t.DSNForBackend(pool.Backend()))
			poolDuration := time.Since(poolStart)
			if err != nil {
				slog.ErrorContext(r.Context(), "cannot connect to tenant database", "cluster_id", t.ClusterID, "duration_ms", poolDuration.Milliseconds(), "classified_reason", classifyConnError(clusterBlacklist, t.ClusterID, err), "err", err)
				if _, blocked := clusterBlacklist[t.ClusterID]; blocked && isSpendLimitError(err) {
					writeError(w, http.StatusTooManyRequests, "cluster quota exhausted")
					return
				}
				writeError(w, http.StatusServiceUnavailable, "cannot connect to tenant database")
				return
			}
			slog.InfoContext(r.Context(), "tenant auth resolved",
				"auth_mode", "path_tenant",
				"cluster_id", t.ClusterID,
				"tenant_lookup_ms", lookupDuration.Milliseconds(),
				"decrypt_ms", decryptDuration.Milliseconds(),
				"pool_get_ms", poolDuration.Milliseconds(),
				"total_ms", time.Since(authStart).Milliseconds(),
			)

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
	pool tenantDBGetter,
	enc encrypt.Encryptor,
	clusterBlacklist map[string]struct{},
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authStart := time.Now()
			apiKey := r.Header.Get(APIKeyHeader)
			if apiKey == "" {
				writeError(w, http.StatusBadRequest, "missing API key")
				return
			}

			lookupStart := time.Now()
			t, err := tenantRepo.GetByID(r.Context(), apiKey)
			lookupDuration := time.Since(lookupStart)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid API key")
				return
			}
			if t.Status != domain.TenantActive {
				writeError(w, http.StatusBadRequest, "invalid API key")
				return
			}

			// Decrypt password before using
			decryptStart := time.Now()
			decryptedPassword, err := enc.Decrypt(r.Context(), t.DBPassword)
			decryptDuration := time.Since(decryptStart)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to decrypt tenant credentials")
				return
			}
			t.DBPassword = decryptedPassword

			poolStart := time.Now()
			db, err := pool.Get(r.Context(), t.ID, t.DSNForBackend(pool.Backend()))
			poolDuration := time.Since(poolStart)
			if err != nil {
				slog.ErrorContext(r.Context(), "cannot connect to tenant database", "cluster_id", t.ClusterID, "duration_ms", poolDuration.Milliseconds(), "classified_reason", classifyConnError(clusterBlacklist, t.ClusterID, err), "err", err)
				if _, blocked := clusterBlacklist[t.ClusterID]; blocked && isSpendLimitError(err) {
					writeError(w, http.StatusTooManyRequests, "cluster quota exhausted")
					return
				}
				writeError(w, http.StatusServiceUnavailable, "cannot connect to tenant database")
				return
			}
			slog.InfoContext(r.Context(), "tenant auth resolved",
				"auth_mode", "api_key",
				"cluster_id", t.ClusterID,
				"tenant_lookup_ms", lookupDuration.Milliseconds(),
				"decrypt_ms", decryptDuration.Milliseconds(),
				"pool_get_ms", poolDuration.Milliseconds(),
				"total_ms", time.Since(authStart).Milliseconds(),
			)

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

// WithAuthContext returns a copy of ctx carrying the given AuthInfo.
// Exported for use in handler tests.
func WithAuthContext(ctx context.Context, info *domain.AuthInfo) context.Context {
	return context.WithValue(ctx, authInfoKey, info)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
