# Design: Migrate from TiDB Zero to TiDB Cloud Starter Pool API

## Summary

Migrate the tenant provisioning mechanism from **TiDB Zero API** to **TiDB Cloud Starter Pool API**, with support for fallback to Zero mode via feature toggle.

## Motivation

- **TiDB Zero** provides free temporary clusters with expiration and requires user claim
- **TiDB Cloud Starter Pool** provides permanent pre-provisioned clusters ready for immediate use
- Pool API uses HTTP Digest Authentication and allows setting custom root password
- Pre-configured schema in Pool clusters eliminates the need for application-level schema initialization

## API Comparison

| Aspect | TiDB Zero | TiDB Cloud Pool |
|--------|-----------|-----------------|
| Endpoint | `https://zero.tidbapi.com/v1alpha1/instances` | `https://serverless.tidbapi.com/v1beta1/clusters:takeoverFromPool` |
| Authentication | None | HTTP Digest Auth (`--user 'PUBLIC_KEY:PRIVATE_KEY'`) |
| Request Body | `{"tag": "..."}` | `{"pool_id": "...", "root_password": "..."}` |
| Response | `{"instance": {...}}` | Direct cluster object |
| Cluster Type | Temporary (requires claim) | Permanent Starter |
| Schema | Application creates | Pre-configured |
| `initSchema` | Execute DDL | Return nil (no-op) |

## Environment Variables

### New Variables (Pool Mode)

```bash
# Required for Pool mode (has priority over Zero mode)
TIDBCLOUD_API_KEY         # Digest Auth App Key (Public Key)
TIDBCLOUD_API_SECRET      # Digest Auth App Secret (Private Key)

# Optional (with defaults)
TIDBCLOUD_API_URL   # Default: https://serverless.tidbapi.com
TIDBCLOUD_POOL_ID   # Default: "2" (configurable per environment)
```

### Existing Variables (Zero Mode - for fallback)

```bash
MNEMO_TIDB_ZERO_ENABLED   # Default: true
MNEMO_TIDB_ZERO_API_URL   # Default: https://zero.tidbapi.com/v1alpha1
```

## Configuration Changes

### Config Structure

```go
type Config struct {
    // ... existing configs ...
    
    // TiDB Cloud Pool configuration
    TiDBCloudAPIURL    string  // env: TIDBCLOUD_API_URL
    TiDBCloudPoolID    string  // env: TIDBCLOUD_POOL_ID, default "2"
    
    // TiDB Zero configuration (backward compatible)
    TiDBZeroEnabled    bool    // env: MNEMO_TIDB_ZERO_ENABLED
    TiDBZeroAPIURL     string  // env: MNEMO_TIDB_ZERO_API_URL
}
```

## Architecture: Provisioner Interface

Introduce a `Provisioner` interface to abstract both Zero and Pool implementations:

```go
// server/internal/tenant/provisioner.go
type Provisioner interface {
    // Provision acquires a new cluster from the provider
    Provision(ctx context.Context) (*ClusterInfo, error)
    
    // InitSchema initializes the database schema
    // ZeroProvisioner: executes DDL (CREATE TABLE, CREATE INDEX)
    // TiDBCloudProvisioner: returns nil (schema pre-configured)
    InitSchema(ctx context.Context, db *sql.DB) error
}

type ClusterInfo struct {
    ID       string
    Host     string
    Port     int
    Username string
    Password string
    DBName   string  // "test" for both providers
}
```

### Implementations

```go
// server/internal/tenant/zero.go
// ZeroProvisioner implements Provisioner for TiDB Zero API
type ZeroProvisioner struct { ... }

// server/internal/tenant/starter.go
// TiDBCloudProvisioner implements Provisioner for TiDB Cloud Pool API
type TiDBCloudProvisioner struct {
    apiURL    string
    apiKey    string      // from TIDBCLOUD_API_KEY env
    apiSecret string      // from TIDBCLOUD_API_SECRET env
    poolID    string
}
```

## Implementation Plan

### 1. Create TiDBCloudProvisioner

New file: `server/internal/tenant/starter.go`

```go
type TiDBCloudProvisioner struct {
    apiURL    string
    apiKey    string
    apiSecret string
    poolID    string
    httpClient *http.Client
}

func NewTiDBCloudProvisioner(apiURL, apiKey, apiSecret, poolID string) *TiDBCloudProvisioner

func (c *TiDBCloudProvisioner) Provision(ctx context.Context) (*ClusterInfo, error) {
    // 1. Generate random password (16 chars)
    password := generateRandomPassword(16)
    
    // 2. Call Pool API with Digest Auth
    // curl --digest --user 'PUBLIC_KEY:PRIVATE_KEY' \
    //   -X POST https://serverless.tidbapi.com/v1beta1/clusters:takeoverFromPool \
    //   -d '{"pool_id":"2","root_password":"xxx"}'
    
    // 3. Parse response and return ClusterInfo
}

func (c *TiDBCloudProvisioner) InitSchema(ctx context.Context, db *sql.DB) error {
    // Pool clusters have pre-configured schema, no-op
    return nil
}
```

### 2. HTTP Digest Authentication

```go
// Implement RFC 7616 Digest Auth
// 1. Initial request (no auth) -> 401 with nonce
// 2. Compute HA1 = MD5(username:realm:password)
// 3. Compute HA2 = MD5(method:uri)
// 4. Compute response = MD5(HA1:nonce:nc:cnonce:qop:HA2)
// 5. Send authenticated request with Authorization header
```

**Command equivalent:**
```bash
curl --digest --user 'TIDBCLOUD_API_KEY:TIDBCLOUD_API_SECRET' \
  -X POST https://serverless.tidbapi.com/v1beta1/clusters:takeoverFromPool \
  -H 'Content-Type: application/json' \
  -d '{"pool_id":"2","root_password":"xxx"}'
```

### 3. Update TenantService

```go
type TenantService struct {
    tenants     repository.TenantRepo
    provisioner tenant.Provisioner  // Abstract interface
    pool        *tenant.TenantPool
    logger      *slog.Logger
    autoModel   string
    autoDims    int
    ftsEnabled  bool
}

func (s *TenantService) Provision(ctx context.Context) (*ProvisionResult, error) {
    // 1. Call Provisioner.Provision() to acquire cluster
    info, err := s.provisioner.Provision(ctx)
    
    // 2. Create tenant record with Status: "provisioning"
    tenant := &domain.Tenant{
        ID:        info.ID,
        Provider:  getProviderType(s.provisioner), // "tidb_zero" or "tidb_cloud_starter"
        Status:    domain.TenantProvisioning,
        // ... other fields
    }
    s.tenants.Create(ctx, tenant)
    
    // 3. Get DB connection from pool
    db, err := s.pool.Get(ctx, tenant.ID, tenant.DSN())
    
    // 4. Call Provisioner.InitSchema() (Zero: DDL, Pool: no-op)
    if err := s.provisioner.InitSchema(ctx, db); err != nil {
        // Handle failure - tenant stays in "provisioning" for recovery
        return nil, err
    }
    
    // 5. Update status to "active"
    s.tenants.UpdateStatus(ctx, tenant.ID, domain.TenantActive)
    s.tenants.UpdateSchemaVersion(ctx, tenant.ID, 1)
    
    return &ProvisionResult{ID: tenant.ID}, nil
}
```

### 4. Mode Selection Logic

**Priority: Explicit Zero toggle > Pool auto-detection**

```go
// main.go
var provisioner tenant.Provisioner

if cfg.TiDBZeroEnabled {
    // Zero mode (explicit toggle takes precedence)
    provisioner = tenant.NewZeroProvisioner(cfg.TiDBZeroAPIURL)
} else if os.Getenv("TIDBCLOUD_API_KEY") != "" {
    // Pool mode
    provisioner = tenant.NewTiDBCloudProvisioner(
        cfg.TiDBCloudAPIURL,
        os.Getenv("TIDBCLOUD_API_KEY"),
        os.Getenv("TIDBCLOUD_API_SECRET"),
        cfg.TiDBCloudPoolID,
    )
} else {
    log.Fatal("provisioning not configured: set MNEMO_TIDB_ZERO_ENABLED=true or TIDBCLOUD_API_KEY")
}

tenantSvc := service.NewTenantService(tenantRepo, provisioner, tenantPool, ...)
```

## Pool API Response Contract

### Request

```bash
POST https://serverless.tidbapi.com/v1beta1/clusters:takeoverFromPool
Content-Type: application/json
Authorization: Digest ...

{
  "pool_id": "2",
  "root_password": "<randomly-generated-16-chars>"
}
```

### Response Fields Mapping

| Response Field | JSON Path | Tenant Field | Notes |
|----------------|-----------|--------------|-------|
| Cluster ID | `clusterId` | `ID`, `ClusterID` | Same value for both fields |
| Host | `endpoints.public.host` | `DBHost` | e.g., `gateway03.us-west-2.prod.aws.tidbcloud.com` |
| Port | `endpoints.public.port` | `DBPort` | Always `4000` |
| User Prefix | `userPrefix` | `DBUser` | Concatenate: `userPrefix + ".root"` |
| Password | (request body) | `DBPassword` | Code-generated random password |
| DB Name | (hardcoded) | `DBName` | Always `"test"` (same as Zero) |

### Example Response

```json
{
  "clusterId": "10449015781701631901",
  "displayName": "shadow-2-10008634579807343179",
  "endpoints": {
    "public": {
      "host": "gateway03.us-west-2.prod.aws.tidbcloud.com",
      "port": 4000
    }
  },
  "userPrefix": "3UWpLbuKjdXufEe",
  "state": "ACTIVE",
  "servicePlan": "Starter"
}
```

## Domain Model Changes

### Tenant Struct (Keep Existing Fields)

```go
type Tenant struct {
    ID             string
    Name           string
    DBHost         string
    DBPort         int
    DBUser         string
    DBPassword     string
    DBName         string
    DBTLS          bool
    Provider       string     // "tidb_zero" | "tidb_cloud_starter"
    ClusterID      string
    ClaimURL       string     // Keep for Zero compatibility, empty for Pool
    ClaimExpiresAt *time.Time // Keep for Zero compatibility, nil for Pool
    Status         TenantStatus
    SchemaVersion  int
    CreatedAt      time.Time
    UpdatedAt      time.Time
}
```

**Note:** `ClaimURL` and `ClaimExpiresAt` are kept for backward compatibility with existing Zero tenants. Pool tenants will have empty values. Code using these fields must check `Provider` first.

## Migration Path

1. **Phase 1**: Deploy code with both provisioners supported
2. **Phase 2**: Configure `TIDBCLOUD_API_KEY` to switch to Pool mode
3. **Phase 3**: (Optional) Disable Zero mode by setting `MNEMO_TIDB_ZERO_ENABLED=false`
4. **Phase 4**: (Future) Remove Zero mode support entirely

## Error Handling & Recovery

| Scenario | Behavior |
|----------|----------|
| Pool API returns error | Return error, no tenant record created, caller gets HTTP 503 |
| Cluster acquired but `tenants.Create` fails | Cluster consumed but unregistered - logged for manual cleanup |
| `InitSchema` fails | Tenant stays in `"provisioning"` status for retry/compensation |

## Security Considerations

1. **API Credentials**: `TIDBCLOUD_API_KEY` and `TIDBCLOUD_API_SECRET` are sensitive and must be injected via environment variables only
2. **Password Generation**: Root password is randomly generated (16 characters, crypto/rand) for each cluster acquisition
3. **TLS**: All connections use TLS (port 4000 with TLS enabled)
4. **Digest Auth**: Never log or expose the Authorization header

## Testing Strategy

1. **Unit tests** for Digest Auth implementation (required)
2. **Mock tests** for TiDBCloudProvisioner with fake Pool API server
3. **Integration tests** for ZeroProvisioner (existing)
4. **Fallback tests** (Pool unavailable -> error, not Zero fallback)
5. **End-to-end provisioning test** with real credentials in staging

## Related Files to Modify

- `server/internal/config/config.go` - Add new config fields
- `server/internal/tenant/provisioner.go` - New interface definition
- `server/internal/tenant/starter.go` - New TiDBCloudProvisioner implementation
- `server/internal/tenant/zero.go` - Refactor to ZeroProvisioner
- `server/internal/service/tenant.go` - Use Provisioner interface
- `server/internal/domain/types.go` - No changes (keep existing fields)
- `server/cmd/mnemo-server/main.go` - Wire up provisioner selection logic
