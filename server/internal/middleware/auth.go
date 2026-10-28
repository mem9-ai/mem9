package middleware

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/sync/errgroup"

	"github.com/qiffang/mnemos/server/internal/credentials"
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

type authOption func(*authConfig)

type authConfig struct {
	spendLimitAdjuster tenant.SpendLimitAdjuster
	spendLimitCooldown *SpendLimitCooldown
	autoSpendLimitCfg  AutoSpendLimitConfig
	spaceChains        repository.SpaceChainRepo
	credentials        *credentials.Store
}

// AutoSpendLimitConfig controls auto spend-limit adjustment behavior.
type AutoSpendLimitConfig struct {
	Enabled   bool
	Increment int
	Max       int
}

// WithSpendLimitAdjuster wires spend-limit adjustment dependencies into auth middleware.
func WithSpendLimitAdjuster(adjuster tenant.SpendLimitAdjuster, cooldown *SpendLimitCooldown, cfg AutoSpendLimitConfig) authOption {
	return func(c *authConfig) {
		c.spendLimitAdjuster = adjuster
		c.spendLimitCooldown = cooldown
		c.autoSpendLimitCfg = cfg
	}
}

func WithSpaceChainRepo(chains repository.SpaceChainRepo) authOption {
	return func(c *authConfig) {
		c.spaceChains = chains
	}
}

func WithCredentials(store *credentials.Store) authOption {
	return func(c *authConfig) { c.credentials = store }
}

func lookupCredentialTenant(ctx context.Context, repo repository.TenantRepo, key string, store *credentials.Store) (*domain.Tenant, *credentials.Lease, error) {
	if store == nil {
		t, err := repo.GetByID(ctx, key)
		return t, nil, err
	}
	rec, err := store.LookupTenant(ctx, key)
	if err != nil {
		return nil, nil, err
	}
	rec, lease, err := store.HoldRecord(ctx, rec.ID)
	if err != nil {
		return nil, nil, err
	}
	t, err := repo.GetByID(ctx, rec.TenantID)
	if err != nil {
		lease.Close()
		return nil, nil, err
	}
	return t, lease, nil
}

func isSpendLimitError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "usage quota being exhausted")
}

func credentialBlacklist(ctx context.Context, store *credentials.Store, blacklist map[string]struct{}, clusterID string) map[string]struct{} {
	if store == nil || !strings.HasPrefix(clusterID, credentials.ReferencePrefix) {
		return blacklist
	}
	raw, err := store.ResolveReference(ctx, clusterID)
	if err != nil {
		return blacklist
	}
	if _, ok := blacklist[raw]; !ok {
		return blacklist
	}
	mapped := make(map[string]struct{}, len(blacklist)+1)
	for k, v := range blacklist {
		mapped[k] = v
	}
	mapped[clusterID] = struct{}{}
	return mapped
}

func classifyConnError(blacklist map[string]struct{}, clusterID string, err error) string {
	if _, blocked := blacklist[clusterID]; blocked && isSpendLimitError(err) {
		return "cluster_quota_exhausted"
	}
	return "connection_error"
}

type authResolutionError struct {
	status  int
	message string
	err     error
}

func (e *authResolutionError) Error() string {
	if e == nil {
		return ""
	}
	if e.err != nil {
		return e.err.Error()
	}
	return e.message
}

func (e *authResolutionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func resolveSpaceChainAuthNodes(
	ctx context.Context,
	chainID string,
	nodes []domain.SpaceChainNode,
	tenantRepo repository.TenantRepo,
	pool tenantDBGetter,
	enc encrypt.Encryptor,
	clusterBlacklist map[string]struct{},
	stores ...*credentials.Store,
) ([]domain.ChainAuthNode, time.Duration, error) {
	resolved := make([]domain.ChainAuthNode, len(nodes))
	var totalPoolNanos atomic.Int64
	group, groupCtx := errgroup.WithContext(ctx)

	for i, node := range nodes {
		i, node := i, node
		group.Go(func() error {
			t, err := tenantRepo.GetByID(groupCtx, node.TenantID)
			if err != nil || t == nil || t.DeletedAt != nil || t.Status != domain.TenantActive {
				slog.ErrorContext(groupCtx, "space chain node tenant unavailable",
					"chain_id", chainID,
					"node_position", node.Position,
					"tenant_id", node.TenantID,
					"err", err)
				return &authResolutionError{
					status:  http.StatusServiceUnavailable,
					message: "chain node tenant unavailable",
					err:     err,
				}
			}

			decryptedPassword, err := enc.Decrypt(groupCtx, t.DBPassword)
			if err != nil {
				return &authResolutionError{
					status:  http.StatusInternalServerError,
					message: "failed to decrypt tenant credentials",
					err:     err,
				}
			}
			t.DBPassword = decryptedPassword

			poolStart := time.Now()
			db, err := pool.Get(groupCtx, t.ID, t.DSNForBackend(pool.Backend()))
			poolDuration := time.Since(poolStart)
			totalPoolNanos.Add(int64(poolDuration))
			if err != nil {
				blacklist := clusterBlacklist
				if len(stores) > 0 {
					blacklist = credentialBlacklist(groupCtx, stores[0], blacklist, t.ClusterID)
				}
				slog.ErrorContext(groupCtx, "cannot connect to space chain node database",
					"chain_id", chainID,
					"node_position", node.Position,
					"tenant_id", t.ID,
					"cluster_id", t.ClusterID,
					"duration_ms", poolDuration.Milliseconds(),
					"classified_reason", classifyConnError(blacklist, t.ClusterID, err),
					"err", err)
				switch {
				case errors.Is(err, domain.ErrSchemaIncompatible):
					return &authResolutionError{
						status:  http.StatusConflict,
						message: err.Error(),
						err:     err,
					}
				case isBlacklistedSpendLimitError(blacklist, t.ClusterID, err):
					return &authResolutionError{
						status:  http.StatusTooManyRequests,
						message: "cluster quota exhausted",
						err:     err,
					}
				default:
					return &authResolutionError{
						status:  http.StatusServiceUnavailable,
						message: "chain node tenant unavailable",
						err:     err,
					}
				}
			}

			resolved[i] = domain.ChainAuthNode{
				SpaceChainNode: node,
				TenantDB:       db,
				ClusterID:      t.ClusterID,
			}
			return nil
		})
	}

	if err := group.Wait(); err != nil {
		return nil, time.Duration(totalPoolNanos.Load()), err
	}
	return resolved, time.Duration(totalPoolNanos.Load()), nil
}

func isBlacklistedSpendLimitError(blacklist map[string]struct{}, clusterID string, err error) bool {
	_, blocked := blacklist[clusterID]
	return blocked && isSpendLimitError(err)
}

// ResolveTenant is middleware that extracts {tenantID} from the URL path,
// validates the tenant exists and is active, obtains a DB connection from the
// pool, and stores an AuthInfo in the request context.
func ResolveTenant(
	tenantRepo repository.TenantRepo,
	pool tenantDBGetter,
	enc encrypt.Encryptor,
	clusterBlacklist map[string]struct{},
	opts ...authOption,
) func(http.Handler) http.Handler {
	state := authConfig{}
	for _, opt := range opts {
		if opt != nil {
			opt(&state)
		}
	}
	_ = state

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authStart := time.Now()
			tenantID := chi.URLParam(r, "tenantID")
			if tenantID == "" {
				writeError(w, http.StatusBadRequest, "missing tenant ID in path")
				return
			}

			lookupStart := time.Now()
			t, lease, err := lookupCredentialTenant(r.Context(), tenantRepo, tenantID, state.credentials)
			if lease != nil {
				defer lease.Close()
			}
			lookupDuration := time.Since(lookupStart)
			if err != nil {
				if state.credentials != nil && !errors.Is(err, domain.ErrNotFound) {
					writeError(w, http.StatusServiceUnavailable, "auth backend unavailable; retry request")
					return
				}
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
				blacklist := credentialBlacklist(r.Context(), state.credentials, clusterBlacklist, t.ClusterID)
				isStarterOrZero := t.Provider == tenant.StarterProvisionerType || t.Provider == tenant.ZeroProvisionerType
				if state.spendLimitAdjuster != nil && state.autoSpendLimitCfg.Enabled && isSpendLimitError(err) {
					if isStarterOrZero && state.spendLimitCooldown.TryStartRaise(t.ClusterID) {
						adjuster := state.spendLimitAdjuster
						cool := state.spendLimitCooldown
						cfg := state.autoSpendLimitCfg
						cid := t.ClusterID
						go func() {
							succeeded := false
							defer func() {
								if !succeeded {
									cool.RecordFailure(cid)
								}
							}()
							ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
							defer cancel()
							currentLimit, err := adjuster.GetSpendLimit(ctx, cid)
							if err != nil {
								slog.ErrorContext(ctx, "auto spend limit: get current limit failed",
									"cluster_id", cid, "err", err)
								return
							}
							newLimit := min(currentLimit+cfg.Increment, cfg.Max)
							if newLimit <= currentLimit {
								slog.InfoContext(ctx, "auto spend limit: already at max cap",
									"cluster_id", cid, "current", currentLimit, "max", cfg.Max)
								return
							}
							if err := adjuster.IncreaseSpendLimit(ctx, cid, newLimit); err != nil {
								slog.ErrorContext(ctx, "auto spend limit: PATCH failed",
									"cluster_id", cid, "from_amount", currentLimit, "to_amount", newLimit, "err", err)
								return
							}
							succeeded = true
							cool.RecordSuccess(cid)
							slog.InfoContext(ctx, "auto spend limit: increased",
								"cluster_id", cid, "from_amount", currentLimit, "to_amount", newLimit)
						}()
					}
				}
				slog.ErrorContext(r.Context(), "cannot connect to tenant database", "cluster_id", t.ClusterID, "duration_ms", poolDuration.Milliseconds(), "classified_reason", classifyConnError(blacklist, t.ClusterID, err), "err", err)
				if errors.Is(err, domain.ErrSchemaIncompatible) {
					writeError(w, http.StatusConflict, err.Error())
					return
				}
				if _, blocked := blacklist[t.ClusterID]; blocked && isSpendLimitError(err) {
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
				TenantID:      t.ID,
				TenantDB:      db,
				ClusterID:     t.ClusterID,
				APIKeySubject: tenantID,
			}
			if lease != nil {
				info.CredentialID = lease.CredentialID
				info.Hold = lease.Retain
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
	opts ...authOption,
) func(http.Handler) http.Handler {
	state := authConfig{}
	for _, opt := range opts {
		if opt != nil {
			opt(&state)
		}
	}
	_ = state

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authStart := time.Now()
			apiKey := strings.TrimSpace(r.Header.Get(APIKeyHeader))
			if apiKey == "" {
				writeError(w, http.StatusBadRequest, "missing API key")
				return
			}

			if strings.HasPrefix(apiKey, domain.ChainKeyPrefix) {
				if state.spaceChains == nil {
					writeError(w, http.StatusServiceUnavailable, "space chain auth unavailable")
					return
				}
				chainLookupStart := time.Now()
				chain, err := state.spaceChains.GetByKey(r.Context(), apiKey)
				chainLookupDuration := time.Since(chainLookupStart)
				if err != nil {
					writeError(w, http.StatusBadRequest, "invalid API key")
					return
				}
				if len(chain.Nodes) == 0 {
					writeError(w, http.StatusBadRequest, "Space Chain has no nodes.")
					return
				}

				info := &domain.AuthInfo{
					Chain: &domain.ChainAuth{
						ChainID: chain.ID,
						APIKey:  apiKey,
						Nodes:   make([]domain.ChainAuthNode, 0, len(chain.Nodes)),
					},
				}
				if agentID := r.Header.Get(AgentIDHeader); agentID != "" {
					info.AgentName = agentID
				}

				var leases []*credentials.Lease
				if state.credentials != nil {
					for i := range chain.Nodes {
						rec, err := state.credentials.ForTenant(r.Context(), chain.Nodes[i].TenantID)
						if errors.Is(err, domain.ErrNotFound) {
							rec, err = state.credentials.LookupTenant(r.Context(), chain.Nodes[i].TenantID)
						}
						if err != nil {
							writeError(w, http.StatusServiceUnavailable, "chain tenant unavailable")
							return
						}
						rec, l, err := state.credentials.HoldRecord(r.Context(), rec.ID)
						if err != nil {
							writeError(w, http.StatusServiceUnavailable, "chain tenant migrating; retry request")
							return
						}
						defer l.Close()
						leases = append(leases, l)
						chain.Nodes[i].TenantID = rec.TenantID
					}
					info.Hold = func() func() {
						var releases []func()
						for _, l := range leases {
							releases = append(releases, l.Retain())
						}
						return func() {
							for _, release := range releases {
								release()
							}
						}
					}
				}
				nodes, totalPoolDuration, err := resolveSpaceChainAuthNodes(
					r.Context(),
					chain.ID,
					chain.Nodes,
					tenantRepo,
					pool,
					enc,
					clusterBlacklist,
					state.credentials,
				)
				if err != nil {
					var authErr *authResolutionError
					if errors.As(err, &authErr) {
						writeError(w, authErr.status, authErr.message)
					} else {
						writeError(w, http.StatusServiceUnavailable, "chain node tenant unavailable")
					}
					return
				}

				if state.credentials != nil {
					rec, err := state.credentials.EnsureSubject(r.Context(), apiKey, "")
					if err != nil {
						writeError(w, http.StatusServiceUnavailable, "chain credential unavailable")
						return
					}
					info.CredentialID = rec.ID
				}
				info.APIKeySubject = apiKey
				info.Chain.Nodes = nodes

				slog.InfoContext(r.Context(), "tenant auth resolved",
					"auth_mode", "space_chain_key",
					"chain_id", chain.ID,
					"nodes", len(info.Chain.Nodes),
					"chain_lookup_ms", chainLookupDuration.Milliseconds(),
					"pool_get_ms", totalPoolDuration.Milliseconds(),
					"total_ms", time.Since(authStart).Milliseconds(),
				)
				ctx := context.WithValue(r.Context(), authInfoKey, info)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			lookupStart := time.Now()
			t, lease, err := lookupCredentialTenant(r.Context(), tenantRepo, apiKey, state.credentials)
			if lease != nil {
				defer lease.Close()
			}
			lookupDuration := time.Since(lookupStart)
			if err != nil {
				if state.credentials != nil && !errors.Is(err, domain.ErrNotFound) {
					writeError(w, http.StatusServiceUnavailable, "auth backend unavailable; retry request")
					return
				}
				writeError(w, http.StatusBadRequest, "invalid API key")
				return
			}
			if t.DeletedAt != nil || t.Status != domain.TenantActive {
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
				blacklist := credentialBlacklist(r.Context(), state.credentials, clusterBlacklist, t.ClusterID)
				isStarterOrZero := t.Provider == tenant.StarterProvisionerType || t.Provider == tenant.ZeroProvisionerType
				if state.spendLimitAdjuster != nil && state.autoSpendLimitCfg.Enabled && isSpendLimitError(err) {
					if isStarterOrZero && state.spendLimitCooldown.TryStartRaise(t.ClusterID) {
						adjuster := state.spendLimitAdjuster
						cool := state.spendLimitCooldown
						cfg := state.autoSpendLimitCfg
						cid := t.ClusterID
						go func() {
							succeeded := false
							defer func() {
								if !succeeded {
									cool.RecordFailure(cid)
								}
							}()
							ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
							defer cancel()
							currentLimit, err := adjuster.GetSpendLimit(ctx, cid)
							if err != nil {
								slog.ErrorContext(ctx, "auto spend limit: get current limit failed",
									"cluster_id", cid, "err", err)
								return
							}
							newLimit := min(currentLimit+cfg.Increment, cfg.Max)
							if newLimit <= currentLimit {
								slog.InfoContext(ctx, "auto spend limit: already at max cap",
									"cluster_id", cid, "current", currentLimit, "max", cfg.Max)
								return
							}
							if err := adjuster.IncreaseSpendLimit(ctx, cid, newLimit); err != nil {
								slog.ErrorContext(ctx, "auto spend limit: PATCH failed",
									"cluster_id", cid, "from_amount", currentLimit, "to_amount", newLimit, "err", err)
								return
							}
							succeeded = true
							cool.RecordSuccess(cid)
							slog.InfoContext(ctx, "auto spend limit: increased",
								"cluster_id", cid, "from_amount", currentLimit, "to_amount", newLimit)
						}()
					}
				}
				slog.ErrorContext(r.Context(), "cannot connect to tenant database", "cluster_id", t.ClusterID, "duration_ms", poolDuration.Milliseconds(), "classified_reason", classifyConnError(blacklist, t.ClusterID, err), "err", err)
				if errors.Is(err, domain.ErrSchemaIncompatible) {
					writeError(w, http.StatusConflict, err.Error())
					return
				}
				if _, blocked := blacklist[t.ClusterID]; blocked && isSpendLimitError(err) {
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
				TenantID:      t.ID,
				TenantDB:      db,
				ClusterID:     t.ClusterID,
				APIKeySubject: apiKey,
			}
			if lease != nil {
				info.CredentialID = lease.CredentialID
				info.Hold = lease.Retain
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
