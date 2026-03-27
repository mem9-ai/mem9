---
title: Multi-Tenant Provisioning — Token Auth & Dedicated TiDB Clusters
status: implemented
created: 2026-03-06
last_updated: 2026-03-25
---

> **STATUS: IMPLEMENTED**
> `Provisioner` interface, `ZeroProvisioner`, `TiDBCloudProvisioner`,
> `TenantPool`, `TenantService`, and the `tenants`/`tenant_tokens` control-plane
> schema are all implemented. Auth middleware resolves tenant tokens.
> Connection pool with lazy init and idle eviction is in `internal/tenant/`.

# Proposal: Multi-Tenant Provisioning — Token Auth & Dedicated TiDB Clusters

**Date**: 2026-03-06
**Purpose**: Design the tenant isolation layer for mnemos-server — each OpenClaw instance gets a dedicated TiDB Serverless cluster, with token-based authentication and automatic provisioning.

**Companion doc**: `smart-memory-pipeline-proposal.md` (defines the pipeline that runs _inside_ each tenant's cluster)

---

## 1. Architecture Overview

mnemos-server operates as a **two-plane** system:

```
┌──────────────────────────────────────────────────────────────┐
│                        CONTROL PLANE                          │
│         mnemo-server's own DB (MNEMO_DSN)                     │
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐  │
│  │ tenants      │  │ tenant_     │  │ (existing tables)    │  │
│  │              │  │ tokens      │  │ user_tokens          │  │
│  │ id           │  │             │  │ space_tokens         │  │
│  │ dsn (enc)    │  │ token →     │  └──────────────────────┘  │
│  │ host/user/.. │  │ tenant_id   │                            │
│  │ status       │  │             │                            │
│  └─────────────┘  └─────────────┘                            │
└──────────────────────┬───────────────────────────────────────┘
                       │
          token lookup │ → resolve tenant → get DSN
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                        DATA PLANE                             │
│         Per-tenant TiDB Serverless clusters                   │
│                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐  │
│  │ Tenant A        │  │ Tenant B        │  │ Tenant C     │  │
│  │ TiDB Cluster    │  │ TiDB Cluster    │  │ TiDB Cluster │  │
│  │                 │  │                 │  │              │  │
│  │ memories table  │  │ memories table  │  │ memories     │  │
│  │ (full schema)   │  │ (full schema)   │  │ table        │  │
│  └─────────────────┘  └─────────────────┘  └──────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Key insight**: The control plane DB only stores tenant metadata and tokens. All memory data lives in the tenant's own TiDB cluster. This provides:

- **Hard isolation**: No cross-tenant data leakage — physically separate databases
- **Independent scaling**: Each tenant's cluster scales independently
- **Data sovereignty**: Tenant data can be in different regions
- **Simple cleanup**: Delete tenant = drop cluster

---

## 2. Control Plane Schema

Two new tables in the control plane database (`MNEMO_DSN`):

### 2.1 `tenants` Table

```sql
CREATE TABLE IF NOT EXISTS tenants (
  id              VARCHAR(36)   PRIMARY KEY,
  name            VARCHAR(255)  NOT NULL     COMMENT 'Human-readable tenant name (e.g., "alice-workspace")',
  
  -- TiDB cluster connection info
  db_host         VARCHAR(255)  NOT NULL     COMMENT 'TiDB Serverless host',
  db_port         INT           NOT NULL DEFAULT 4000,
  db_user         VARCHAR(255)  NOT NULL     COMMENT 'TiDB username',
  db_password     VARCHAR(500)  NOT NULL     COMMENT 'TiDB password (encrypted at rest)',
  db_name         VARCHAR(100)  NOT NULL DEFAULT 'test' COMMENT 'Database name',
  db_tls          TINYINT(1)    NOT NULL DEFAULT 1 COMMENT 'Require TLS connection',
  
  -- Provisioning metadata
  provider        VARCHAR(50)   NOT NULL DEFAULT 'tidb_zero' COMMENT 'tidb_zero | tidb_starter | custom',
  cluster_id      VARCHAR(100)  NULL     COMMENT 'TiDB Cloud cluster ID (if provisioned)',
  claim_url       VARCHAR(500)  NULL     COMMENT 'TiDB Zero claim URL',
  
  -- Lifecycle
  status          VARCHAR(20)   NOT NULL DEFAULT 'provisioning'
                  COMMENT 'provisioning | active | suspended | deleted',
  schema_version  INT           NOT NULL DEFAULT 0 COMMENT 'Last applied migration version',
  created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP     NULL,
  
  INDEX idx_status   (status),
  INDEX idx_name     (name)
);
```

### 2.2 `tenant_tokens` Table

```sql
CREATE TABLE IF NOT EXISTS tenant_tokens (
  api_token       VARCHAR(64)   PRIMARY KEY,
  tenant_id       VARCHAR(36)   NOT NULL,
  agent_name      VARCHAR(100)  NOT NULL     COMMENT 'Agent identifier within this tenant',
  agent_type      VARCHAR(50)   NULL         COMMENT 'openclaw | opencode | claude_code',
  
  created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_tenant (tenant_id),
  CONSTRAINT fk_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

**Why separate from existing `space_tokens`?**

The existing `space_tokens` and `user_tokens` tables are designed for the current shared-database model (space isolation within one DB). The new `tenants` + `tenant_tokens` tables represent a fundamentally different isolation model (cluster-per-tenant). Keeping them separate avoids complicating the existing code and allows both models to coexist during migration.

---

## 3. Provisioning Flow

### 3.1 Registration: OpenClaw → mnemo-server → TiDB Zero

```
OpenClaw (first launch)
    │
    │  POST /api/tenants/register
    │  { "name": "alice-workspace", "agent_name": "alice-openclaw" }
    │
    ▼
mnemo-server
    │
    ├── 1. Generate tenant_id (UUID)
    │
    ├── 2. Call TiDB Cloud Zero API:
    │       POST https://zero.tidbapi.com/v1alpha1/instances
    │       { "tag": "mnemos-<tenant_id>" }
    │       
    │       → Response:
    │       {
    │         "instance": {
    │           "id": "cluster-xxx",
    │           "connection": {
    │             "host": "gateway01.us-east-1.prod.aws.tidbcloud.com",
    │             "port": 4000,
    │             "username": "3F2x...",
    │             "password": "abc..."
    │           },
    │           "claimInfo": { "claimUrl": "https://..." }
    │         }
    │       }
    │
    ├── 3. Store tenant record:
    │       INSERT INTO tenants (id, name, db_host, db_user, db_password, ...)
    │
    ├── 4. Initialize data plane schema:
    │       Connect to new cluster → CREATE TABLE memories (...)
    │       Update tenant: schema_version = 1, status = 'active'
    │
    ├── 5. Generate token:
    │       INSERT INTO tenant_tokens (api_token, tenant_id, agent_name, ...)
    │
    └── 6. Return:
          {
            "ok": true,
            "token": "mnemo_abc...",
            "tenant_id": "...",
            "claim_url": "https://..."
          }
```

### 3.2 Subsequent Requests: Token → Tenant → DSN

```
OpenClaw (any memory operation)
    │
    │  POST /api/memories
    │  Authorization: Bearer mnemo_abc...
    │
    ▼
Auth Middleware
    │
    ├── 1. Look up token in tenant_tokens
    │       → tenant_id, agent_name
    │
    ├── 2. Look up tenant in tenants
    │       → db_host, db_user, db_password, db_name, status
    │
    ├── 3. Check status == 'active'
    │
    ├── 4. Get/create connection from pool
    │       connPool.Get(tenant_id) → *sql.DB
    │
    └── 5. Inject into request context:
          ctx = context.WithValue(ctx, tenantDBKey, db)
          ctx = context.WithValue(ctx, tenantInfoKey, tenantInfo)
```

### 3.3 Adding Agents to Existing Tenant

```
POST /api/tenants/{tenant_id}/tokens
Authorization: Bearer <existing_tenant_token>

{ "agent_name": "bob-opencode", "agent_type": "opencode" }

→ { "ok": true, "token": "mnemo_def..." }
```

Multiple agents within the same tenant share the same TiDB cluster. This is the team collaboration model.

---

## 4. Authentication Flow (Revised)

The current auth system (user_tokens, space_tokens) is for the shared-DB model. The new system adds a **tenant token** path:

```
Bearer token arrives
    │
    ├── Try tenant_tokens table    ← NEW
    │   Found? → Resolve tenant → Get dedicated DB connection
    │
    ├── Try space_tokens table     ← EXISTING  
    │   Found? → Use shared DB (MNEMO_DSN) with space_id isolation
    │
    └── Try user_tokens table      ← EXISTING
        Found? → User-level auth (for provisioning endpoints)
```

This means **both models coexist**. Existing space-based users keep working. New tenants get dedicated clusters.

### AuthInfo Extension

```go
type AuthInfo struct {
    // Existing fields (shared-DB model)
    SpaceID   string
    AgentName string
    UserID    string
    
    // New fields (dedicated-cluster model)
    TenantID  string   // Non-empty when using tenant token
    TenantDB  *sql.DB  // Pre-resolved DB connection for this tenant
}
```

The handler/service layer checks: if `TenantID != ""`, use `TenantDB` for all operations. Otherwise, use the default shared `MNEMO_DSN` connection (existing behavior).

---

## 5. Connection Pool Management

Each tenant has its own `*sql.DB`. These are expensive to create (TLS handshake, TCP connection), so we cache them:

```go
// TenantPool manages per-tenant database connections.
type TenantPool struct {
    mu       sync.RWMutex
    conns    map[string]*tenantConn  // tenant_id → connection
    maxIdle  int                      // per-tenant max idle connections
    maxOpen  int                      // per-tenant max open connections
    lifetime time.Duration            // connection max lifetime
}

type tenantConn struct {
    db       *sql.DB
    lastUsed time.Time
    tenant   *Tenant    // cached tenant metadata
}
```

### Pool behavior:

| Aspect | Policy |
|--------|--------|
| **Creation** | Lazy — first request to a tenant opens the connection |
| **Idle timeout** | Connections unused for 10 minutes are closed |
| **Max per tenant** | 5 idle, 10 max open (TiDB Serverless handles the rest) |
| **Eviction** | Background goroutine sweeps idle connections every 60s |
| **Health check** | `db.Ping()` on get-from-cache; reconnect on failure |
| **Total limit** | Server-wide cap of 200 connections across all tenants |

### Why not open all connections at startup?

- Tenants may be inactive for days
- TiDB Serverless clusters auto-sleep when idle → TCP connection drops anyway
- Lazy init + idle eviction keeps resource usage proportional to active tenants

---

## 6. Data Plane Schema Initialization

When a new tenant is provisioned, the server creates the `memories` table in their cluster:

```go
func (p *TenantPool) InitSchema(ctx context.Context, tenant *Tenant) error {
    db, err := p.connect(tenant)
    if err != nil {
        return fmt.Errorf("connect to tenant %s: %w", tenant.ID, err)
    }
    
    // Apply schema based on current version
    migrations := []string{
        // v1: base memories table
        `CREATE TABLE IF NOT EXISTS memories (
            id            VARCHAR(36)     PRIMARY KEY,
            content       TEXT            NOT NULL,
            key_name      VARCHAR(255),
            memory_type   VARCHAR(20)     NOT NULL DEFAULT 'pinned',
            source        VARCHAR(100),
            tags          JSON,
            metadata      JSON,
            embedding     VECTOR(1536)    NULL,
            agent_id      VARCHAR(100)    NULL,
            session_id    VARCHAR(100)    NULL,
            state         VARCHAR(20)     NOT NULL DEFAULT 'active',
            version       INT             DEFAULT 1,
            updated_by    VARCHAR(100),
            superseded_by VARCHAR(36)     NULL,
            created_at    TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
            updated_at    TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            archived_at   TIMESTAMP       NULL,
            deleted_at    TIMESTAMP       NULL,
            INDEX idx_memory_type (memory_type),
            INDEX idx_state       (state),
            INDEX idx_agent       (agent_id),
            INDEX idx_session     (session_id),
            INDEX idx_updated     (updated_at)
        )`,
    }
    
    for i, ddl := range migrations {
        if i < tenant.SchemaVersion {
            continue // already applied
        }
        if _, err := db.ExecContext(ctx, ddl); err != nil {
            return fmt.Errorf("migration v%d: %w", i+1, err)
        }
    }
    
    // Update schema_version in control plane
    return p.updateSchemaVersion(ctx, tenant.ID, len(migrations))
}
```

**Key difference from existing schema**: No `space_id` column. In the dedicated-cluster model, the entire database belongs to one tenant — no need for space isolation within the DB. This simplifies queries and indexes.

---

## 7. API Endpoints

### New Endpoints (Tenant Management)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/tenants/register` | None | Bootstrap: provision new tenant + TiDB cluster |
| `POST` | `/api/tenants/{id}/tokens` | Tenant token | Add agent to existing tenant |
| `GET`  | `/api/tenants/{id}/info` | Tenant token | Tenant metadata (cluster status, agent count) |
| `POST` | `/api/tenants/{id}/claim` | Tenant token | Store TiDB claim info after user claims Zero instance |

### Existing Endpoints (Now Tenant-Aware)

All existing memory endpoints (`/api/memories/*`) work unchanged. The auth middleware resolves the token type and injects either:
- Shared DB + space_id (existing space tokens)
- Tenant DB (new tenant tokens)

The handler/service layer is **DB-agnostic** — it receives a `*sql.DB` and operates on it, regardless of whether it's the shared DB or a tenant-specific DB.

---

## 8. Registration Endpoint Detail

### `POST /api/tenants/register`

**Request:**
```json
{
  "name": "alice-workspace",
  "agent_name": "alice-openclaw",
  "agent_type": "openclaw"
}
```

**Response (success):**
```json
{
  "ok": true,
  "tenant_id": "t_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "token": "mnemo_abc123...",
  "claim_url": "https://tidbcloud.com/claim/xxx",
  "status": "active"
}
```

**Response (TiDB Zero provisioning failed):**
```json
{
  "ok": false,
  "error": "cluster provisioning failed",
  "tenant_id": "t_xxx...",
  "status": "provisioning"
}
```

When provisioning fails, the tenant record is created with `status=provisioning`. The client can retry by calling `POST /api/tenants/{id}/retry-provision`.

### Idempotency

If a client registers with the same `name`, the server returns the existing tenant and token instead of creating a duplicate. This is safe because:
- The `name` serves as a natural key for idempotent registration
- The client may crash between receiving the response and persisting the token

---

## 9. Configuration

### New Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_TIDB_ZERO_ENABLED` | No | `true` | Enable auto-provisioning via TiDB Cloud Zero |
| `MNEMO_TIDB_ZERO_API_URL` | No | `https://zero.tidbapi.com/v1alpha1` | TiDB Cloud Zero API base URL |
| `MNEMO_TENANT_POOL_MAX_IDLE` | No | `5` | Per-tenant max idle connections |
| `MNEMO_TENANT_POOL_MAX_OPEN` | No | `10` | Per-tenant max open connections |
| `MNEMO_TENANT_POOL_IDLE_TIMEOUT` | No | `10m` | Idle connection eviction interval |
| `MNEMO_TENANT_POOL_TOTAL_LIMIT` | No | `200` | Server-wide connection cap |

### Backward Compatibility

- `MNEMO_DSN` remains the **control plane** database connection
- Existing space-based flow keeps working unchanged
- New tenant flow runs in parallel — no migration needed for existing users

---

## 10. Security Considerations

### 10.1 Credential Storage

Tenant database passwords are stored in the `tenants` table. Protection layers:

1. **Encryption at rest**: TiDB Cloud encrypts storage at rest (AES-256)
2. **Application-level encryption** (optional, Phase 2): Encrypt `db_password` with a server-side key before storing. Decrypt on connection creation. Env var: `MNEMO_ENCRYPTION_KEY`
3. **Minimal exposure**: Password is never returned in API responses. Only used internally for connection creation.

### 10.2 Token Security

- Tokens use `crypto/rand` (existing `GenerateToken()`) — 128 bits of entropy
- Tokens are hashed in transit via TLS (HTTPS)
- Token → tenant mapping is O(1) lookup (primary key)

### 10.3 Tenant Isolation

- **Database-level**: Each tenant has a separate TiDB cluster — no shared tables, no shared connections
- **Connection-level**: Each `*sql.DB` in the pool is bound to exactly one tenant
- **Query-level**: No `space_id` filtering needed — the entire DB is single-tenant
- **Network-level**: TiDB Serverless enforces TLS and IP allowlists

---

## 11. Go Domain Types

```go
// Tenant represents a provisioned customer with a dedicated TiDB cluster.
type Tenant struct {
    ID            string    `json:"id"`
    Name          string    `json:"name"`
    
    // Connection info (never exposed in API responses)
    DBHost        string    `json:"-"`
    DBPort        int       `json:"-"`
    DBUser        string    `json:"-"`
    DBPassword    string    `json:"-"`
    DBName        string    `json:"-"`
    DBTLS         bool      `json:"-"`
    
    // Provisioning metadata
    Provider      string    `json:"provider"`      // tidb_zero | tidb_starter | custom
    ClusterID     string    `json:"cluster_id,omitempty"`
    ClaimURL      string    `json:"claim_url,omitempty"`
    
    // Lifecycle
    Status        string    `json:"status"`        // provisioning | active | suspended | deleted
    SchemaVersion int       `json:"schema_version"`
    CreatedAt     time.Time `json:"created_at"`
    UpdatedAt     time.Time `json:"updated_at"`
}

// TenantToken represents an API token bound to a tenant.
type TenantToken struct {
    APIToken  string    `json:"api_token"`
    TenantID  string    `json:"tenant_id"`
    AgentName string    `json:"agent_name"`
    AgentType string    `json:"agent_type,omitempty"`
    CreatedAt time.Time `json:"created_at"`
}

// TenantInfo is the response for GET /api/tenants/{id}/info.
type TenantInfo struct {
    TenantID    string      `json:"tenant_id"`
    Name        string      `json:"name"`
    Status      string      `json:"status"`
    Provider    string      `json:"provider"`
    ClaimURL    string      `json:"claim_url,omitempty"`
    AgentCount  int         `json:"agent_count"`
    MemoryCount int         `json:"memory_count"`
    CreatedAt   time.Time   `json:"created_at"`
}
```

---

## 12. Repository Interfaces

```go
// TenantRepo manages tenant records in the control plane DB.
type TenantRepo interface {
    Create(ctx context.Context, t *Tenant) error
    GetByID(ctx context.Context, id string) (*Tenant, error)
    GetByName(ctx context.Context, name string) (*Tenant, error)
    UpdateStatus(ctx context.Context, id, status string) error
    UpdateSchemaVersion(ctx context.Context, id string, version int) error
}

// TenantTokenRepo manages tenant API tokens.
type TenantTokenRepo interface {
    CreateToken(ctx context.Context, tt *TenantToken) error
    GetByToken(ctx context.Context, token string) (*TenantToken, error)
    ListByTenant(ctx context.Context, tenantID string) ([]TenantToken, error)
}
```

---

## 13. Request Flow Diagram (Complete)

```
OpenClaw agent starts
    │
    │ Has token?
    ├── NO → POST /api/tenants/register
    │        → Get token + tenant provisioned
    │        → Store token in openclaw.json config
    │
    └── YES → Use existing token
    
OpenClaw agent_end fires
    │
    │ POST /api/memories/ingest
    │ Authorization: Bearer mnemo_xxx
    │
    ▼
mnemo-server auth middleware
    │
    ├── Lookup token in tenant_tokens → found
    │   ├── Get tenant from tenants table
    │   ├── Check status == 'active'
    │   ├── Get *sql.DB from connection pool
    │   └── Inject into context: tenant_db, agent_name
    │
    ▼
mnemo-server ingest handler
    │
    │ Uses tenant_db (NOT the control plane DB)
    │
    ├── Phase 1a: Extract insights (LLM)
    ├── Phase 1b: Generate digest (LLM)
    ├── Phase 2: Reconcile with existing memories
    │            (all queries run against tenant's TiDB cluster)
    └── Store results in tenant's memories table

before_prompt_build fires
    │
    │ GET /api/memories?q=...
    │ Authorization: Bearer mnemo_xxx
    │
    ▼
mnemo-server (same auth flow)
    │
    └── Vector + keyword search against tenant's memories table
        → Return ranked results
```

---

## 14. Implementation Phases

### Phase A: Control Plane Schema + Domain Types
1. Create `tenants` and `tenant_tokens` tables in schema.sql
2. Add `Tenant`, `TenantToken`, `TenantInfo` domain types
3. Implement `TenantRepo` and `TenantTokenRepo` (TiDB SQL)
4. Add new config env vars

### Phase B: Connection Pool
1. Implement `TenantPool` with lazy init, idle eviction, health check
2. Add `DSN()` method to `Tenant` for building connection strings
3. Wire pool into main.go DI

### Phase C: Auth Middleware Extension
1. Extend auth middleware to try `tenant_tokens` first
2. Extend `AuthInfo` with `TenantID` and `TenantDB`
3. Handler layer: use `TenantDB` when present, else default DB

### Phase D: Registration Endpoint
1. Implement `POST /api/tenants/register` handler
2. Integrate TiDB Cloud Zero API client
3. Schema initialization on new tenant cluster
4. Idempotent registration (by name)

### Phase E: Tenant-Aware Memory Operations
1. Repository layer: accept `*sql.DB` parameter (or use from context)
2. Remove `space_id` requirement when operating on tenant DB
3. Test: full CRUD flow through tenant token

### Phase F: Plugin Update
1. OpenClaw plugin: on first launch, call `/api/tenants/register`
2. Persist returned token in plugin config
3. Use token for all subsequent memory operations

---

## 15. Design Principles

1. **Two models coexist**: Shared-DB (space isolation) and dedicated-DB (tenant isolation) work side by side. No migration forced on existing users.
2. **Lazy everything**: Connections opened on first use, schema applied on first use, clusters provisioned on first registration.
3. **Control plane is lightweight**: Only metadata and tokens. No memory data ever touches the control plane DB.
4. **Credentials never leak**: DB passwords are `json:"-"`, never in API responses, encrypted at rest.
5. **Idempotent registration**: Safe to call multiple times — returns existing tenant if name matches.
6. **Graceful degradation**: If TiDB Zero API is down, registration fails gracefully with `status=provisioning`. Retry endpoint available.
7. **Schema versioning**: Each tenant tracks its applied schema version. Future migrations roll forward safely.
