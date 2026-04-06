---
title: Tenant Cluster Blacklist for Spend-Limit Error Suppression
updated: 2026-04-05
watches:
  - server/internal/middleware/auth.go
  - server/internal/config/config.go
  - server/cmd/mnemo-server/main.go
  - k8s/base/configmap.yaml
  - k8s/overlays/dev/configmap-patch.yaml
  - k8s/overlays/prod/configmap-patch.yaml
---

## Summary

When a TiDB Serverless cluster exhausts its usage quota, both auth middleware paths
return 503, firing infrastructure alerts. The fix is a static env-var blacklist that
returns 429 instead for known offending cluster IDs.

## Problem

When a TiDB Serverless cluster exhausts its usage quota, every auth middleware call
to `pool.Get` times out (~2.3 s) then returns:

```
Error 1105 (HY000): Due to the usage quota being exhausted, access to the cluster
has been restricted.
```

Both auth paths (`ResolveTenant` at `auth.go:65` and `ResolveApiKey` at `auth.go:122`)
map this to `503 Service Unavailable`. This is technically correct — the backend is
unreachable — but operationally wrong: the failure is tenant-owned, not infrastructure-
owned. It fires alerts and contaminates error-rate SLOs that we rely on.

We cannot fix the tenant's quota, so the goal is to reclassify the response as
`429 Too Many Requests` for known offending clusters, which is excluded from our
infrastructure SLOs and suppresses the alert.

## Approach: Static Cluster Blacklist via Env Var

Operators manually add cluster IDs to `MNEMO_CLUSTER_BLACKLIST` in the ConfigMap.
At startup the server parses the list into an in-memory set (O(1) lookup via
`map[string]struct{}`). Both auth middleware functions attempt `pool.Get` normally
for all clusters including blacklisted ones. The blacklist only changes the **error
handling path**: when `pool.Get` fails with a spend-limit error AND the cluster is
blacklisted, return 429 instead of 503. All other `pool.Get` failures (transient
network errors, etc.) continue to return 503 regardless of blacklist membership.
Normal traffic on a blacklisted cluster is fully unaffected.

No dynamic self-population. No TTL. Entries take effect on the next ConfigMap update

- pod rollout.

## Changes

### 1. `server/internal/config/config.go`

Add one field and parse it from the env var:

```go
// ClusterBlacklist is the set of TiDB cluster IDs whose spend-limit errors
// should be returned as 429 instead of 503. Populated from
// MNEMO_CLUSTER_BLACKLIST (comma-separated). Empty by default.
ClusterBlacklist map[string]struct{}
```

Parsing in `Load()`:

```go
ClusterBlacklist: parseClusterBlacklist(os.Getenv("MNEMO_CLUSTER_BLACKLIST")),
```

Helper (also in `config.go`):

```go
func parseClusterBlacklist(raw string) map[string]struct{} {
    out := make(map[string]struct{})
    for _, id := range strings.Split(raw, ",") {
        if id := strings.TrimSpace(id); id != "" {
            out[id] = struct{}{}
        }
    }
    return out
}
```

### 2. `server/internal/middleware/auth.go`

#### 2a. Error classification helpers (pure functions, unexported)

```go
// isSpendLimitError reports whether err is a TiDB Serverless quota-exhaustion
// error. This is an intentional string-match heuristic against the observed
// error text from TiDB Serverless (Error 1105). If TiDB changes the message,
// this function must be updated.
func isSpendLimitError(err error) bool {
    return err != nil && strings.Contains(err.Error(), "usage quota being exhausted")
}

func classifyConnError(blacklist map[string]struct{}, clusterID string, err error) string {
    if _, blocked := blacklist[clusterID]; blocked && isSpendLimitError(err) {
        return "cluster_quota_exhausted"
    }
    return "connection_error"
}
```

Both functions are pure (no I/O, no state) and tested directly — independent of any
pool wiring.

#### 2b. Pool interface seam

`TenantPool.Get` hardcodes `sql.Open("mysql", dsn)` at `pool.go:109`, making it
impossible to inject a synthetic error from outside. To make the 429 branch unit-
testable, introduce a two-method interface in the middleware package:

```go
// tenantDBGetter abstracts the pool so middleware tests can inject errors.
type tenantDBGetter interface {
    Get(ctx context.Context, tenantID string, dsn string) (*sql.DB, error)
    Backend() string
}
```

`*tenant.TenantPool` satisfies this interface already — both `Get` and `Backend`
are existing methods with matching signatures. No change to `TenantPool` itself.

Both `ResolveTenant` and `ResolveApiKey` change their `pool` parameter from
`*tenant.TenantPool` to `tenantDBGetter`:

```go
func ResolveTenant(
    tenantRepo repository.TenantRepo,
    pool       tenantDBGetter,
    enc        encrypt.Encryptor,
    clusterBlacklist map[string]struct{},
) func(http.Handler) http.Handler
```

`main.go` passes `tenantPool` unchanged — `*tenant.TenantPool` satisfies the
interface implicitly.

#### 2c. Error handling branch after `pool.Get`

```go
poolStart := time.Now()
db, err := pool.Get(r.Context(), t.ID, t.DSNForBackend(pool.Backend()))
if err != nil {
    slog.ErrorContext(r.Context(), "cannot connect to tenant database",
        "cluster_id", t.ClusterID,
        "duration_ms", time.Since(poolStart).Milliseconds(),
        "classified_reason", classifyConnError(clusterBlacklist, t.ClusterID, err),
        "err", err)
    if _, blocked := clusterBlacklist[t.ClusterID]; blocked && isSpendLimitError(err) {
        writeError(w, http.StatusTooManyRequests, "cluster quota exhausted")
        return
    }
    writeError(w, http.StatusServiceUnavailable, "cannot connect to tenant database")
    return
}
```

The existing `slog.ErrorContext` log line is preserved (same message, same fields).
The `classified_reason` field is additive — no existing log queries break. When a
blacklisted cluster hits quota, the log still fires at ERROR level with full context;
the HTTP response is 429 instead of 503.

Normal traffic on a blacklisted cluster is fully unaffected — `pool.Get` is always
attempted. The blacklist only changes the response code when the cluster is both
blacklisted AND returns a spend-limit error.

### 3. `server/cmd/mnemo-server/main.go`

Pass the new field when constructing the middleware:

```go
tenantMW := middleware.ResolveTenant(tenantRepo, tenantPool, encryptor, cfg.ClusterBlacklist)
apiKeyMW := middleware.ResolveApiKey(tenantRepo, tenantPool, encryptor, cfg.ClusterBlacklist)
```

### 4. `server/internal/middleware/auth_test.go`

#### 4a. Pure helper tests (no pool wiring)

```go
func TestIsSpendLimitError(t *testing.T) {
    cases := []struct {
        err  error
        want bool
    }{
        {errors.New("Error 1105 (HY000): Due to the usage quota being exhausted, ..."), true},
        {errors.New("connection refused"), false},
        {errors.New("tenant pool: total limit 200 reached"), false},
        {nil, false},
    }
    for _, c := range cases {
        if got := isSpendLimitError(c.err); got != c.want {
            t.Errorf("isSpendLimitError(%v) = %v, want %v", c.err, got, c.want)
        }
    }
}
```

#### 4b. Middleware tests — stub pool via `tenantDBGetter` interface

Because `pool` is now `tenantDBGetter`, tests inject a `stubPool` that returns
whatever error or `*sql.DB` the test needs — no real driver, no DSN, no ping:

```go
type stubPool struct {
    db  *sql.DB
    err error
}

func (s stubPool) Get(_ context.Context, _ string, _ string) (*sql.DB, error) {
    return s.db, s.err
}

func (s stubPool) Backend() string { return "tidb" }
```

#### 4c. Test cases

- `TestIsSpendLimitError` — pure unit test of the classifier, no pool.
- `TestResolveApiKey_BlacklistedCluster_SpendLimit_Returns429` — stubPool returns
  quota error, cluster in blacklist → 429.
- `TestResolveApiKey_BlacklistedCluster_OtherError_Returns503` — stubPool returns
  non-quota error, cluster in blacklist → 503.
- `TestResolveApiKey_BlacklistedCluster_Success` — stubPool returns valid `*sql.DB`,
  cluster in blacklist → next handler called normally.
- `TestResolveTenant_BlacklistedCluster_SpendLimit_Returns429` — same as first, for
  the tenantID path.

All existing tests continue to pass `*tenant.TenantPool` directly — it satisfies
`tenantDBGetter` (both `Get` and `Backend` are already methods on `TenantPool`) —
no behaviour change.

## Deployment

The repo uses Kustomize with `k8s/base/` + `k8s/overlays/{dev,prod}/`. The env var
goes into the relevant overlay configmap patch, not the base (to allow per-env
targeting).

**`k8s/overlays/prod/configmap-patch.yaml`** (add one line):

```yaml
MNEMO_CLUSTER_BLACKLIST: "<cluster_id_a>,<cluster_id_b>"
```

**`k8s/overlays/dev/configmap-patch.yaml`** (only if testing in dev):

```yaml
MNEMO_CLUSTER_BLACKLIST: "<cluster_id_a>,<cluster_id_b>"
```

Apply + rollout:

```bash
# prod
kubectl --context mnemos-stack apply -k k8s/overlays/prod
kubectl --context mnemos-stack rollout status deployment/mnemos-server -n mnemos

# dev
kubectl --context dev-mem9-eks-ap-southeast-1 apply -k k8s/overlays/dev
kubectl --context dev-mem9-eks-ap-southeast-1 rollout status deployment/mnemos-server -n mnemos
```

No schema migration. No secret change. To remove a cluster from the blacklist,
delete the entry from the patch and re-apply.

## What This Does Not Do

- **Does not auto-detect.** Operators must identify the cluster ID from the error log
  and add it manually. This is intentional for Option B.
- **Does not expire entries.** Once blacklisted, a cluster stays blacklisted until
  the operator removes it from the ConfigMap and rolls out. This is acceptable because
  quota-exhausted free-tier clusters are unlikely to recover without a user action
  (spend-limit upgrade).
- **Does not block normal traffic.** A blacklisted cluster that is within quota
  continues to serve requests normally. The 429 only fires when `pool.Get` fails
  with a spend-limit error.
- **Does not suppress non-quota failures.** Transient network errors or other
  `pool.Get` failures on blacklisted clusters continue to return 503.

## Effort

~50 LoC across 3 files (`config.go`, `auth.go`, `main.go`) + ~50 LoC new tests.

## Key Code Locations

- 503 site (ResolveTenant): `server/internal/middleware/auth.go:62-66`
- 503 site (ResolveApiKey): `server/internal/middleware/auth.go:119-123`
- Config loading: `server/internal/config/config.go:88-143`
- Middleware wiring: `server/cmd/mnemo-server/main.go:135-136`
- Auth tests + pingOKConnector pattern: `server/internal/middleware/auth_test.go:51-83`
- Kustomize base configmap: `k8s/base/configmap.yaml`
- Dev overlay patch: `k8s/overlays/dev/configmap-patch.yaml`
- Prod overlay patch: `k8s/overlays/prod/configmap-patch.yaml`
