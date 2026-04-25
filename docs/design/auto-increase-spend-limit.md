# Auto-Increase TiDB Cloud Starter Spend Limit

## TL;DR

> **Quick Summary**: When a mem9-managed TiDB Cloud Starter cluster exhausts its monthly spend limit, mem9 automatically bumps the limit via the TiDB Cloud API (within configured bounds), turning a manual-ops-only failure mode into bounded self-healing.
>
> **Deliverables**:
> - Config fields (`MNEMO_AUTO_SPEND_LIMIT_*`) with startup validation
> - `SpendLimitAdjuster` interface + `TiDBCloudProvisioner` implementation (GET current limit + PATCH new limit)
> - Atomic `SpendLimitCooldown` with in-flight guard (TryStartRaise/RecordSuccess/RecordFailure) — prevents concurrent duplicate PATCH and retry storms on API errors
> - Auto-increase hooks in both `ResolveTenant` and `ResolveApiKey` auth middleware
> - Unit tests for config validation, provisioner methods, and middleware behavior
>
> **Estimated Effort**: Medium (~150-200 LoC net)
> **Parallel Execution**: YES — 3 parallel in Wave 1, 2 parallel in Wave 2, 3 parallel in Wave 3
> **Critical Path**: Task 2 → Task 4 → Task 7 (interface → middleware hook → integration test)

---

## Context

### Original Request
[GitHub issue #271](https://github.com/mem9-ai/mem9/issues/271): When a TiDB Cloud Starter cluster exhausts its usage quota/spend limit, recovery requires a human to manually raise the limit in TiDB Cloud console. mem9 should auto-increase the limit within a configured cap.

### Interview Summary
**Key Discussions**:
- **Trigger**: Reactive only — fired when `isSpendLimitError("usage quota being exhausted")` detects the error in auth middleware
- **Scope**: ALL mem9-managed Starter clusters (not just blacklisted)
- **Increment**: $5 per raise (500 cents), **Max Cap**: $100/month (10000 cents), **Cooldown**: 1h between raises
- **Enabled**: Off by default (`MNEMO_AUTO_SPEND_LIMIT_ENABLED=false`)
- **Test strategy**: Tests-after (implementation first, then tests)

**Research Findings**:
- `doDigestAuthRequest` in `starter.go:113` handles the two-step HTTP Digest auth — can be reused for PATCH calls
- `isSpendLimitError` at `auth.go:32` checks for `"usage quota being exhausted"` string in MySQL errors
- Both `ResolveTenant` and `ResolveApiKey` middleware detect the error but currently only change HTTP status via blacklist
- `TiDBCloudProvisioner` is accessible in `main.go` but not currently threaded to middleware
- `Tenant.Provider` field (`auth.go:70`) already discriminates Starter (`"tidb_cloud_starter"`) from Zero (`"tidb_zero"`)

### Metis Review
**Identified Gaps** (addressed):
- **How to know current spend limit**: GET cluster first via `GET /v1beta1/clusters/{clusterId}`, read `cluster.spendingLimit.monthly`, then PATCH with `current + increment` (capped at max). This is authoritative and handles manual changes + server restarts.
- **In-flight request behavior**: Return existing error (503/429). Do NOT retry `pool.Get()` after increase — next request succeeds naturally after limit propagates.
- **Cooldown persistence**: In-memory `sync.Map[string]time.Time` for MVP. Lost on restart (acceptable — cooldown is only 1h).
- **During provisioning**: NOT during provisioning flow. Only in auth middleware paths.
- **API errors**: All non-2xx PATCH responses are logged and the original spend-limit error is returned. No retry on PATCH failure.
- **Thread safety**: Cooldown check + PATCH call runs in a goroutine with a 10s timeout. Middleware does NOT block on the API call.

---

## Work Objectives

### Core Objective
Allow mem9 to self-heal TiDB Cloud Starter spend-limit exhaustion by automatically calling the TiDB Cloud API to raise the monthly limit, bounded by configurable increment, max cap, and cooldown.

### Concrete Deliverables
- `server/internal/config/config.go` — 4 new config fields + startup validation
- `server/internal/tenant/provisioner.go` — `SpendLimitAdjuster` interface
- `server/internal/tenant/starter.go` — `GetSpendLimit()`, `IncreaseSpendLimit()` methods
- `server/internal/middleware/cooldown.go` — in-memory cooldown tracker (new file)
- `server/internal/middleware/auth.go` — auto-increase hooks in both `ResolveTenant` and `ResolveApiKey`
- `server/cmd/mnemo-server/main.go` — wire `SpendLimitAdjuster` to middleware
- `server/internal/config/config_test.go` — config validation tests (extend)
- `server/internal/tenant/starter_test.go` — PATCH/GET method tests (new file)
- `server/internal/middleware/auth_test.go` — spend-limit behavior tests (extend)

### Definition of Done
- [ ] `MNEMO_AUTO_SPEND_LIMIT_ENABLED=true` + Starter cluster spend-limit error → TiDB Cloud API PATCH call fires
- [ ] `MNEMO_AUTO_SPEND_LIMIT_ENABLED=false` → no PATCH call, existing behavior preserved
- [ ] Non-Starter tenant (Zero, manual) → no PATCH call regardless of config
- [ ] Two rapid exhaustions within cooldown → exactly ONE PATCH call (TryStartRaise atomicity)
- [ ] PATCH failure (403/rate-limit) → deferred RecordFailure clears in-flight + engages cooldown, preventing retry storm
- [ ] GetSpendLimit failure or context deadline → deferred RecordFailure clears in-flight (prevents stuck in-flight marker)
- [ ] Repeated exhaustions do NOT exceed configured max cap
- [ ] TiDB Cloud API returns error → middleware still returns 503 (graceful degradation)
- [ ] Goroutine uses `context.Background()` with 10s timeout, never `r.Context()`
- [ ] Invalid config (zero increment) → server fails to start with clear error
- [ ] Existing Starter tenants in Zero-provisioner deployments still get auto-increase (adjuster created independently)
- [ ] `make test` passes all new and existing tests

### Must Have
- Config guard (`MNEMO_AUTO_SPEND_LIMIT_ENABLED`) as first gate before any auto-increase logic
- `t.Provider == "tidb_cloud_starter"` check before firing PATCH
- GET current spend limit before computing new target (authoritative, handles manual changes)
- Atomic cooldown enforcement via `TryStartRaise` — prevents concurrent duplicate PATCH from racing requests
- `RecordFailure()` on PATCH errors — rate-limits retries to prevent hammering TiDB Cloud API on 403/rate-limit responses
- Max cap enforcement preventing unlimited increases
- Graceful degradation: PATCH failures do NOT break the existing error response path
- Structured logging for every increase attempt (cluster_id, from_amount, to_amount, result, duration)
- Goroutine MUST use `context.Background()` with 10s timeout, never `r.Context()` (cancelled on response write)

### Must NOT Have (Guardrails)
- MUST NOT auto-increase for non-Starter clusters (TiDB Zero, manual bootstrap, postgres, db9)
- MUST NOT block the middleware goroutine waiting for the PATCH response (fire-and-forget with 10s timeout)
- MUST NOT use `r.Context()` for the goroutine — MUST use `context.Background()` with explicit timeout
- MUST NOT change existing blacklist 429 behavior — feature is additive
- MUST NOT change `isSpendLimitError` matching logic
- MUST NOT retry `pool.Get()` after a successful increase
- MUST NOT add a database migration or new table for cooldown tracking
- MUST NOT add a new API endpoint for manual spend limit management
- MUST NOT add metering events for spend limit increases
- MUST NOT add periodic/preemptive checking of cluster usage
- MUST NOT refactor `doDigestAuthRequest` to be exported — add wrapper methods instead
- MUST NOT retry the PATCH call on failure (no exponential backoff for MVP)
- MUST NOT gate SpendLimitAdjuster on active provisioner type — create from credentials independently so existing Starter tenants in Zero-provisioner deployments still get auto-increase

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (`go test` with `testing` stdlib)
- **Automated tests**: Tests-after (implementation first, then tests)
- **Framework**: `go test -race -count=1`
- **Test files**: Extend `auth_test.go` and `config_test.go`, create new `starter_test.go`

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Backend/API**: Use Bash (curl or go test) — run tests, assert pass/fail, capture output
- **Integration**: Use `httptest.NewServer` to mock TiDB Cloud API with digest challenge responses

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation, 3 parallel):
├── Task 1: Config fields + validation [quick]
├── Task 2: SpendLimitAdjuster interface + TiDBCloudProvisioner implementation [quick]
└── Task 3: Cooldown tracker [quick]

Wave 2 (After Wave 1 — integration, 2 parallel):
├── Task 4: Auth middleware auto-increase hooks [unspecified-low]
└── Task 5: Wire adjuster in main.go [quick]

Wave 3 (After Wave 2 — tests, 3 parallel):
├── Task 6: Config validation tests [quick]
├── Task 7: Starter provisioner tests [quick]
└── Task 8: Auth middleware tests [quick]
```

```
Wave FINAL (After ALL tasks):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay
```

**Critical Path**: Task 2 → Task 4 → Task 7
**Parallel Speedup**: ~50% faster than sequential (Wave 1 saves 2 sequential steps)

### Dependency Matrix

- **1**: - - 4,5 | 6
- **2**: - - 4 | 7
- **3**: - - 4 | -
- **4**: 1,2,3 - - | 8
- **5**: 2 - - | 8
- **6**: 1 - - | -
- **7**: 2 - - | -
- **8**: 4,5 - - | -

### Agent Dispatch Summary
- **Wave 1**: **3** tasks — T1→`quick`, T2→`quick`, T3→`quick`
- **Wave 2**: **2** tasks — T4→`unspecified-low`, T5→`quick`
- **Wave 3**: **3** tasks — T6→`quick`, T7→`quick`, T8→`quick`
- **FINAL**: **4** tasks — F1→`oracle`, F2→`unspecified-high`, F3→`unspecified-high`, F4→`deep`

---

## TODOs

- [x] 1. Config fields + validation in `server/internal/config/config.go`

  **What to do**:
  - Add 4 new fields to the `Config` struct:
    - `AutoSpendLimitEnabled bool` (env: `MNEMO_AUTO_SPEND_LIMIT_ENABLED`, default: `false`)
    - `AutoSpendLimitIncrement int` (env: `MNEMO_AUTO_SPEND_LIMIT_INCREMENT`, default: `500` — USD cents, i.e. $5)
    - `AutoSpendLimitMax int` (env: `MNEMO_AUTO_SPEND_LIMIT_MAX`, default: `10000` — USD cents, i.e. $100)
    - `AutoSpendLimitCooldown time.Duration` (env: `MNEMO_AUTO_SPEND_LIMIT_COOLDOWN`, default: `1h`)
  - Parse them in `Load()` following the existing pattern (`envBool`, `envInt`, `envDuration`)
  - Add startup validation after parsing: `AutoSpendLimitIncrement > 0`, `AutoSpendLimitMax > AutoSpendLimitIncrement`, `AutoSpendLimitCooldown > 0`
  - Return a descriptive error on invalid config (e.g., `"MNEMO_AUTO_SPEND_LIMIT_INCREMENT must be positive"`)
  - Follow existing field ordering convention in `Config` struct (cluster-related config goes near `ClusterBlacklist`)

  **Must NOT do**:
  - Do NOT add validation for enabled/disabled state interplay (disabled with valid fields is OK)
  - Do NOT add config hot-reload support
  - Do NOT log config values at startup beyond the existing `LogValue()` pattern

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file enum/config change following existing boilerplate pattern
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None — straightforward config addition

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 4, Task 5
  - **Blocked By**: None

  **References**:
  - `server/internal/config/config.go:95-98` — `ClusterBlacklist` field + comment pattern to follow for new fields
  - `server/internal/config/config.go:119-156` — `Load()` function body, follow `envBool`/`envInt`/`envDuration` pattern
  - `server/internal/config/config.go:158-163` — existing `IngestMode` validation pattern to follow for startup validation

  **Acceptance Criteria**:
  - [ ] `Config` struct has 4 new fields with correct types and env var names
  - [ ] `MNEMO_AUTO_SPEND_LIMIT_INCREMENT=0` → `config.Load()` returns error containing `"increment must be positive"`
  - [ ] `MNEMO_AUTO_SPEND_LIMIT_MAX=100` with `MNEMO_AUTO_SPEND_LIMIT_INCREMENT=500` → `config.Load()` returns error containing `"max must be greater than increment"`
  - [ ] `MNEMO_AUTO_SPEND_LIMIT_COOLDOWN=0` → `config.Load()` returns error containing `"cooldown must be positive"`
  - [ ] Valid config with all defaults → `config.Load()` succeeds, fields have correct default values

  **QA Scenarios**:

  ```
  Scenario: Valid config loads with defaults
    Tool: Bash (go test)
    Preconditions: No env vars set for auto-spend-limit
    Steps:
      1. cd server && go test -race -count=1 -run TestAutoSpendLimitConfig_Defaults ./internal/config/
      2. Assert: test passes, AutoSpendLimitEnabled=false, AutoSpendLimitIncrement=500, AutoSpendLimitMax=10000, AutoSpendLimitCooldown=1h
    Expected Result: All default values match specification
    Failure Indicators: Test failure, wrong default values, panic during Load()
    Evidence: .sisyphus/evidence/task-1-defaults.txt

  Scenario: Invalid increment (zero) causes startup error
    Tool: Bash (go test)
    Preconditions: Environment set to MNEMO_AUTO_SPEND_LIMIT_INCREMENT=0
    Steps:
      1. cd server && MNEMO_AUTO_SPEND_LIMIT_INCREMENT=0 go test -race -count=1 -run TestAutoSpendLimitConfig_InvalidIncrement ./internal/config/
      2. Assert: config.Load() returns non-nil error
      3. Assert: error message contains "increment must be positive"
    Expected Result: Clear error message, no panic
    Failure Indicators: Test passes (Load succeeds), wrong error text, panic
    Evidence: .sisyphus/evidence/task-1-invalid-increment.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-1-defaults.txt` — test output showing default values
  - [ ] `task-1-invalid-increment.txt` — test output showing validation error

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(config): add auto-spend-limit config fields`
  - Files: `server/internal/config/config.go`

- [x] 2. `SpendLimitAdjuster` interface + `TiDBCloudProvisioner` implementation

  **What to do**:
  - Define a new `SpendLimitAdjuster` interface in `server/internal/tenant/provisioner.go`:
    ```go
    type SpendLimitAdjuster interface {
        GetSpendLimit(ctx context.Context, clusterID string) (monthlyCents int, err error)
        IncreaseSpendLimit(ctx context.Context, clusterID string, monthlyCents int) error
    }
    ```
  - Implement `GetSpendLimit` on `*TiDBCloudProvisioner` in `starter.go`:
    - Call `GET {apiURL}/v1beta1/clusters/{clusterId}` using `doDigestAuthRequest`
    - Parse the response JSON to extract `cluster.spendingLimit.monthly` (int, USD cents)
    - Return the monthly spend limit in cents
  - Implement `IncreaseSpendLimit` on `*TiDBCloudProvisioner` in `starter.go`:
    - Call `PATCH {apiURL}/v1beta1/clusters/{clusterId}` using `doDigestAuthRequest`
    - Request body: `{"updateMask":"spendingLimit","cluster":{"spendingLimit":{"monthly":<value>}}}`
    - Return nil on 2xx success, return error on non-2xx (include status code in error)
  - Add a `doSpendLimitRequest` helper or reuse `doDigestAuthRequest` directly
  - Ensure the digest-auth flow handles PATCH correctly (same as POST, just different HTTP method)

  **Must NOT do**:
  - Do NOT export `doDigestAuthRequest` — it remains unexported
  - Do NOT modify the existing `Provisioner` interface (add as separate interface)
  - Do NOT add the `SpendLimitAdjuster` methods to the `Provisioner` interface
  - Do NOT handle config guard or cooldown in this layer — that belongs in middleware

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Two straightforward HTTP methods on an existing struct, following the existing `Provision` pattern
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None — well-understood REST API pattern

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 4, Task 5, Task 7
  - **Blocked By**: None

  **References**:
  - `server/internal/tenant/starter.go:44-95` — `Provision()` method pattern: endpoint construction, `doDigestAuthRequest`, JSON marshal/unmarshal, error handling
  - `server/internal/tenant/starter.go:113-157` — `doDigestAuthRequest()` method: two-step digest auth, 401 handling, header parsing
  - `server/internal/tenant/provisioner.go:10-14` — existing `Provisioner` interface pattern to follow for new interface
  - `server/internal/tenant/starter.go:66-69` — error response reading pattern: `io.ReadAll(resp.Body)`, status code check
  - GitHub issue #271 body — PATCH payload format with `updateMask=spendingLimit` and `cluster.spendingLimit.monthly`
  - `server/internal/tenant/starter.go:71-80` — response struct parsing pattern

  **Acceptance Criteria**:
  - [ ] `SpendLimitAdjuster` interface defined in `provisioner.go` with `GetSpendLimit` and `IncreaseSpendLimit` methods
  - [ ] `*TiDBCloudProvisioner` implements `SpendLimitAdjuster` (compile-time check: `var _ SpendLimitAdjuster = (*TiDBCloudProvisioner)(nil)`)
  - [ ] `GetSpendLimit` sends GET with digest auth, parses `cluster.spendingLimit.monthly` from response
  - [ ] `IncreaseSpendLimit` sends PATCH with correct JSON body, handles 2xx as success
  - [ ] Non-2xx responses from PATCH return errors with status code and body in error message
  - [ ] `doDigestAuthRequest` works correctly with PATCH method (not just POST)

  **QA Scenarios**:

  ```
  Scenario: GetSpendLimit returns current monthly spend limit
    Tool: Bash (go test)
    Preconditions: Mock TiDB Cloud API returns 401 then 200 with spendingLimit.monthly=500
    Steps:
      1. cd server && go test -race -count=1 -run TestTiDBCloudProvisioner_GetSpendLimit ./internal/tenant/
      2. Assert: GetSpendLimit returns (500, nil)
    Expected Result: Monthly spend limit correctly parsed from API response
    Failure Indicators: Return 0, wrong value, error returned, test panic
    Evidence: .sisyphus/evidence/task-2-getspendlimit.txt

  Scenario: IncreaseSpendLimit sends correct PATCH request
    Tool: Bash (go test)
    Preconditions: Mock TiDB Cloud API expects PATCH with updateMask=spendingLimit and monthly=1000
    Steps:
      1. cd server && go test -race -count=1 -run TestTiDBCloudProvisioner_IncreaseSpendLimit ./internal/tenant/
      2. Assert: mock server receives correct PATCH body
      3. Assert: IncreaseSpendLimit returns nil (success)
    Expected Result: Correct PATCH body sent, no error returned
    Failure Indicators: Wrong HTTP method, wrong body, digest auth failure, error returned
    Evidence: .sisyphus/evidence/task-2-increasespendlimit.txt

  Scenario: PATCH returns 403 → IncreaseSpendLimit returns error
    Tool: Bash (go test)
    Preconditions: Mock TiDB Cloud API returns 403 Forbidden for PATCH
    Steps:
      1. cd server && go test -race -count=1 -run TestTiDBCloudProvisioner_IncreaseSpendLimit_403 ./internal/tenant/
      2. Assert: IncreaseSpendLimit returns non-nil error containing "403"
    Expected Result: Non-nil error with status code context
    Failure Indicators: nil error returned, wrong status code, panic
    Evidence: .sisyphus/evidence/task-2-patch-403.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-2-getspendlimit.txt` — test output
  - [ ] `task-2-increasespendlimit.txt` — test output
  - [ ] `task-2-patch-403.txt` — test output

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(config): add auto-spend-limit config fields`
  - Files: `server/internal/tenant/provisioner.go`, `server/internal/tenant/starter.go`

- [x] 3. Cooldown tracker in `server/internal/middleware/cooldown.go`

  **What to do**:
  - Create new file `server/internal/middleware/cooldown.go`
  - Implement an exported `SpendLimitCooldown` struct:
    ```go
    type SpendLimitCooldown struct {
        mu         sync.Mutex
        lastRaise  map[string]time.Time // clusterID → last raise time
        inFlight   map[string]struct{}  // clusterID → in-flight marker
        interval   time.Duration
    }
    ```
  - Constructor `NewSpendLimitCooldown(interval time.Duration) *SpendLimitCooldown`
  - Method `TryStartRaise(clusterID string) bool` — atomic check-and-set: returns false if either (a) last raise is within interval OR (b) an in-flight raise exists for this cluster. On success, sets in-flight marker and returns true.
  - Method `RecordSuccess(clusterID string)` — clears in-flight marker, records current time as last raise
  - Method `RecordFailure(clusterID string)` — clears in-flight marker, records current time as last raise (prevents retry storm on PATCH failures like 403/rate-limit)
  - Thread-safe via `sync.Mutex`. `TryStartRaise` + `RecordSuccess`/`RecordFailure` together enforce exactly-one-PATCH-in-flight per cluster.
  - Clean up stale entries (optional for MVP): periodically delete entries older than 2× interval to prevent memory leak
  - Package it in `middleware` package since it's only used by the middleware layer

  **Must NOT do**:
  - Do NOT use a database-backed cooldown (in-memory only for MVP)
  - Do NOT export `mu`, `lastRaise`, or `inFlight` fields
  - Do NOT make the cooldown aware of config or env vars (receives `interval` via constructor)
  - Do NOT implement CanRaise/RecordRaise as separate methods — MUST use atomic TryStartRaise

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single new file with a mutex-guarded map, straightforward data structure
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `server/internal/middleware/auth.go:20-31` — package conventions, import style, context key pattern
  - Go standard library `sync.Mutex` — for thread safety
  - Go standard library `time.Time` and `time.Duration` — for time tracking

  **Acceptance Criteria**:
  - [ ] `NewSpendLimitCooldown(1 * time.Hour)` creates a cooldown tracker with 1h interval
  - [ ] `TryStartRaise("cluster-1")` returns true for a never-seen cluster, and sets in-flight marker
  - [ ] `TryStartRaise("cluster-1")` returns false immediately after first call (in-flight blocks)
  - [ ] `RecordSuccess("cluster-1")` clears in-flight marker and records last raise time
  - [ ] `TryStartRaise("cluster-1")` after `RecordSuccess` returns false (cooldown cap blocks)
  - [ ] `RecordFailure("cluster-1")` clears in-flight marker and records last raise time (same as success — prevents retry storm)
  - [ ] Two concurrent goroutines calling `TryStartRaise("c1")` simultaneously → exactly ONE succeeds, the other gets false
  - [ ] After interval elapses, `TryStartRaise("cluster-1")` returns true again
  - [ ] Race detector passing under concurrent `TryStartRaise`/`RecordSuccess`/`RecordFailure` calls

  **QA Scenarios**:

  ```
  Scenario: First TryStartRaise succeeds
    Tool: Bash (go test)
    Preconditions: New SpendLimitCooldown(1h)
    Steps:
      1. cd server && go test -race -count=1 -run TestSpendLimitCooldown_TryStartRaise ./internal/middleware/
      2. Assert: TryStartRaise("c1") == true
      3. Assert: TryStartRaise("c1") == false (in-flight blocks second call)
    Expected Result: First call succeeds, second fails due to in-flight
    Failure Indicators: Both return true, panic
    Evidence: .sisyphus/evidence/task-3-try-start-raise.txt

  Scenario: RecordSuccess then cooldown blocks
    Tool: Bash (go test)
    Preconditions: Fresh 1h cooldown, TryStartRaise("c1") succeeded
    Steps:
      1. RecordSuccess("c1")
      2. Assert: TryStartRaise("c1") == false (cooldown cap)
    Expected Result: Returns false after recording success
    Failure Indicators: Returns true (cooldown not enforced), panics
    Evidence: .sisyphus/evidence/task-3-cooldown-block.txt

  Scenario: RecordFailure prevents retry storm
    Tool: Bash (go test)
    Preconditions: TryStartRaise("c1") succeeded
    Steps:
      1. RecordFailure("c1")
      2. Assert: TryStartRaise("c1") == false (cooldown cap active)
    Expected Result: Failure also records cooldown to prevent hammering TiDB Cloud API
    Failure Indicators: Returns true (no cooldown after failure), panic
    Evidence: .sisyphus/evidence/task-3-failure-cap.txt

  Scenario: Concurrent TryStartRaise is atomic
    Tool: Bash (go test)
    Preconditions: New SpendLimitCooldown(1h)
    Steps:
      1. cd server && go test -race -count=1 -run TestSpendLimitCooldown_ConcurrentAtomic ./internal/middleware/
      2. Launch 10 goroutines simultaneously calling TryStartRaise("c1")
      3. Assert: exactly ONE returns true, nine return false
    Expected Result: Exactly one raise admitted under contention
    Failure Indicators: Multiple goroutines return true, race detected, test timeout
    Evidence: .sisyphus/evidence/task-3-concurrent-atomic.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-3-try-start-raise.txt` — test output
  - [ ] `task-3-cooldown-block.txt` — test output
  - [ ] `task-3-failure-cap.txt` — test output
  - [ ] `task-3-concurrent-atomic.txt` — test output

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(config): add auto-spend-limit config fields`
  - Files: `server/internal/middleware/cooldown.go`

- [x] 4. Auth middleware auto-increase hooks in `server/internal/middleware/auth.go`

  **What to do**:
  - Add a `SpendLimitAdjuster` field to both middleware closure structs (the ones captured in `ResolveTenant` and `ResolveApiKey` closures)
  - Add functional options to both middleware constructors:
    - `ResolveTenant(...)` gains `WithSpendLimitAdjuster(adjuster tenant.SpendLimitAdjuster, cooldown *SpendLimitCooldown, cfg AutoSpendLimitConfig)` option
    - `ResolveApiKey(...)` gains same option
  - Define a lightweight `AutoSpendLimitConfig` struct in the middleware package:
    ```go
    type AutoSpendLimitConfig struct {
        Enabled   bool   // maps to cfg.Enabled in middleware scope (from MNEMO_AUTO_SPEND_LIMIT_ENABLED)
        Increment int    // USD cents
        Max       int    // USD cents
    }
    ```
  - In both `ResolveTenant` and `ResolveApiKey`, after detecting `isSpendLimitError(err)` (currently at lines 89-96 and 165-172):
    1. **Gate 1**: Check `cfg.Enabled` (the `AutoSpendLimitConfig.Enabled` field, not the global `config.Config.AutoSpendLimitEnabled`) → skip if false
    2. **Gate 2**: Check `t.Provider == tenant.StarterProvisionerType` → skip if not Starter
    3. **Gate 3**: Check cooldown `TryStartRaise(t.ClusterID)` → skip if false (in-flight or within cooldown window)
    4. Launch goroutine with 10s timeout context — **MUST use `context.Background()` NOT `r.Context()`** (r.Context() is cancelled when response is written, which would abort the GET/PATCH calls):
       - **MUST use a conditional defer with a `succeeded` flag** immediately after `TryStartRaise` succeeds:
         ```go
         succeeded := false
         defer func() {
             if !succeeded {
                 cooldown.RecordFailure(t.ClusterID) // clears in-flight, applies cooldown
             }
         }()
         ```
         This ensures the in-flight marker is always cleared — whether `GetSpendLimit` fails, context deadline fires, or a panic occurs. On success, `succeeded` is set to `true` and the defer is a no-op; `RecordSuccess` is called explicitly instead.
       - Call `adjuster.GetSpendLimit(ctx, t.ClusterID)` to get current limit
       - Compute `newLimit = min(currentLimit + increment, max)`
       - If `newLimit <= currentLimit` (at max cap), log and return (deferred `RecordFailure` runs via `succeeded=false`, clearing in-flight + applying cooldown)
       - Call `adjuster.IncreaseSpendLimit(ctx, t.ClusterID, newLimit)`
       - On success: set `succeeded = true`, call `cooldown.RecordSuccess(t.ClusterID)` (clears in-flight, records last raise time), log info with from_amount / to_amount
       - On PATCH failure: log error with status code (deferred `RecordFailure` runs via `succeeded=false`, clearing in-flight + applying cooldown)
    5. **Return original error** to client (503 or 429 as before) — do NOT retry `pool.Get()`
  - The goroutine must NOT access the response writer or modify the in-flight request
  - Add a compile-time check that `*TiDBCloudProvisioner` satisfies `SpendLimitAdjuster`
  - The existing `classifyConnError` and blacklist 429 path remain unchanged

  **Must NOT do**:
  - Do NOT change the existing `classifyConnError` function or blacklist behavior
  - Do NOT change `isSpendLimitError` matching logic
  - Do NOT retry `pool.Get()` after increase
  - Do NOT access `w http.ResponseWriter` from the goroutine
  - Do NOT block the middleware goroutine on the PATCH call
  - Do NOT use `r.Context()` for the goroutine — MUST use `context.Background()` with explicit timeout
  - Do NOT fire auto-increase for the `v1alpha2` (API key) path's active-check bypass — the `v1alpha1` path at line 70 is the only active-status bypass; the auto-increase check is independent of active status

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Modifications to an existing middleware function with clear insertion points — low complexity but requires careful integration
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 5)
  - **Blocks**: Task 8
  - **Blocked By**: Task 1, Task 2, Task 3

  **References**:
  - `server/internal/middleware/auth.go:46-119` — `ResolveTenant` full function: error detection at L88-96, tenant type check at L70
  - `server/internal/middleware/auth.go:124-195` — `ResolveApiKey` full function: error detection at L164-172
  - `server/internal/middleware/auth.go:32-41` — `isSpendLimitError` and `classifyConnError`
  - `server/internal/middleware/auth.go:20-30` — package level constants and context key pattern
  - `server/internal/tenant/starter.go:97` — `StarterProvisionerType = "tidb_cloud_starter"` constant
  - `server/internal/middleware/auth.go:106-110` — `AuthInfo` construction pattern for ClusterID access

  **Acceptance Criteria**:
  - [ ] Both `ResolveTenant` and `ResolveApiKey` accept `WithSpendLimitAdjuster(...)` option
  - [ ] When `AutoSpendLimitConfig.Enabled=false`, no adjuster is called (skipped at Gate 1)
  - [ ] When tenant provider is NOT `"tidb_cloud_starter"`, no adjuster is called (skipped at Gate 2)
  - [ ] When TryStartRaise returns false (in-flight or cooldown), no adjuster is called (skipped at Gate 3)
  - [ ] When all gates pass, goroutine uses `context.Background()` with 10s timeout, `defer cooldown.RecordFailure()` ensures in-flight marker is always cleared
  - [ ] On successful increase, `cooldown.RecordSuccess()` supersedes deferred `RecordFailure` and info log emitted
  - [ ] On `GetSpendLimit` failure or context deadline, deferred `RecordFailure` runs — in-flight cleared, cooldown applied, original 503/429 returned
  - [ ] On PATCH failure, `RecordFailure` runs via defer — cooldown applied to prevent retry storm, original 503/429 returned
  - [ ] Goroutine has 10s timeout, does not block middleware
  - [ ] `go vet` and `go build` pass with no errors

  **QA Scenarios**:

  ```
  Scenario: Auto-increase fires for Starter cluster with spend-limit error
    Tool: Bash (go test)
    Preconditions: Mock tenant is Starter, spend-limit error detected, adjuster configured
    Steps:
      1. cd server && go test -race -count=1 -run TestAutoSpendLimit_StarterCluster_Increases ./internal/middleware/
      2. Assert: GetSpendLimit called, IncreaseSpendLimit called with correct new amount
      3. Assert: cooldown.RecordSuccess called after success
    Expected Result: Full increase flow executes in goroutine with context.Background()
    Failure Indicators: Adjuster not called, wrong amount, cooldown not recorded
    Evidence: .sisyphus/evidence/task-4-starter-increase.txt

  Scenario: Non-Starter tenant skips auto-increase
    Tool: Bash (go test)
    Preconditions: Mock tenant is Zero (Provider="tidb_zero"), spend-limit error detected
    Steps:
      1. cd server && go test -race -count=1 -run TestAutoSpendLimit_NonStarter_Skips ./internal/middleware/
      2. Assert: GetSpendLimit is NEVER called
    Expected Result: Auto-increase skipped at Gate 2
    Failure Indicators: Adjuster called for non-Starter tenant
    Evidence: .sisyphus/evidence/task-4-non-starter-skip.txt

  Scenario: Cooldown blocks duplicate increase
    Tool: Bash (go test)
    Preconditions: cooldown.TryStartRaise returns false for this cluster
    Steps:
      1. cd server && go test -race -count=1 -run TestAutoSpendLimit_Cooldown_Blocks ./internal/middleware/
      2. Assert: GetSpendLimit is NEVER called
    Expected Result: Auto-increase skipped at Gate 3
    Failure Indicators: Adjuster called despite TryStartRaise returning false
    Evidence: .sisyphus/evidence/task-4-cooldown-blocks.txt

  Scenario: API error does not crash middleware
    Tool: Bash (go test)
    Preconditions: Mock adjuster.IncreaseSpendLimit returns error
    Steps:
      1. cd server && go test -race -count=1 -run TestAutoSpendLimit_APIError_Graceful ./internal/middleware/
      2. Assert: middleware still returns 503 (or 429 if blacklisted)
      3. Assert: no panic, no nil pointer dereference
      4. Assert: cooldown.RecordFailure called via defer (prevents retry storm)
    Expected Result: Graceful degradation — error logged, RecordFailure clears in-flight + applies cooldown, original response preserved
    Failure Indicators: Panic, wrong status code, nil adjuster crash, RecordFailure not called
    Evidence: .sisyphus/evidence/task-4-api-error-graceful.txt

  Scenario: GetSpendLimit error clears in-flight marker
    Tool: Bash (go test)
    Preconditions: Mock adjuster.GetSpendLimit returns error (e.g., network timeout)
    Steps:
      1. cd server && go test -race -count=1 -run TestAutoSpendLimit_GetSpendLimitError_ClearsInFlight ./internal/middleware/
      2. Assert: middleware still returns 503
      3. Assert: cooldown.RecordFailure called (deferred → in-flight cleared, cooldown applied)
      4. Assert: a subsequent TryStartRaise for same cluster returns false (cooldown now active)
    Expected Result: GetSpendLimit failure does NOT leave in-flight marker stuck; cooldown prevents immediate retry
    Failure Indicators: RecordFailure not called, TryStartRaise returns true immediately after (stuck in-flight)
    Evidence: .sisyphus/evidence/task-4-getsplimit-error.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-4-starter-increase.txt` — test output
  - [ ] `task-4-non-starter-skip.txt` — test output
  - [ ] `task-4-cooldown-blocks.txt` — test output
  - [ ] `task-4-api-error-graceful.txt` — test output
  - [ ] `task-4-getsplimit-error.txt` — test output

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(middleware): auto-increase spend limit on quota exhaustion`
  - Files: `server/internal/middleware/auth.go`

- [x] 5. Wire `SpendLimitAdjuster` into `server/cmd/mnemo-server/main.go`

  **What to do**:
  - After provisioner type selection (around line 143-163), check if auto-spend-limit is enabled (`cfg.AutoSpendLimitEnabled`)
  - If enabled, ALWAYS attempt to create the `SpendLimitAdjuster`:
    1. Check if `os.Getenv("MNEMO_TIDBCLOUD_API_KEY")` and `os.Getenv("MNEMO_TIDBCLOUD_API_SECRET")` are set
    2. If yes, create a `*tenant.TiDBCloudProvisioner` for spend-limit adjustment (even if Zero is the active provisioner — existing Starter tenants in mixed deployments need auto-increase)
    3. If no, log a warning: `"auto spend limit enabled but TiDB Cloud credentials missing; disabled"`
  - If adjuster created:
    - Create a `SpendLimitCooldown` with `cfg.AutoSpendLimitCooldown`
    - Construct `AutoSpendLimitConfig{Enabled: true, Increment: cfg.AutoSpendLimitIncrement, Max: cfg.AutoSpendLimitMax}`
    - Pass adjuster + cooldown + config to both middleware constructors via `WithSpendLimitAdjuster(...)`
    - Log startup message: `"auto spend limit enabled"` with increment, max, cooldown values
  - If adjuster not created:
    - Do NOT pass the option (middleware handles nil adjuster gracefully)
  - Follow existing wiring patterns (tenantMW, apiKeyMW construction at lines 171-172)

  **Must NOT do**:
  - Do NOT gate adjuster creation on the active provisioner type — check credentials independently
  - Do NOT pass the adjuster if `AutoSpendLimitEnabled=false`
  - Do NOT log sensitive API credentials in the startup message
  - Do NOT type-assert provisioner to `*TiDBCloudProvisioner` — create the adjuster directly from credentials

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple wiring in main.go following existing patterns — few lines of code
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 8
  - **Blocked By**: Task 2

  **References**:
  - `server/cmd/mnemo-server/main.go:143-158` — provisioner creation + type selection pattern
  - `server/cmd/mnemo-server/main.go:171-172` — middleware construction with `cfg.ClusterBlacklist` pattern
  - `server/cmd/mnemo-server/main.go:139` — existing logging pattern: `logger.Info("metering writer initialized", ...)`
  - `server/internal/middleware/auth.go:46-51` — current middleware constructor signatures

  **Acceptance Criteria**:
  - [ ] When `AutoSpendLimitEnabled=true` and TiDB Cloud credentials are set, both middlewares receive adjuster + cooldown + config (regardless of which provisioner is active)
  - [ ] When `AutoSpendLimitEnabled=true` but TiDB Cloud credentials are missing, a warning is logged and adjuster is nil
  - [ ] When `AutoSpendLimitEnabled=false`, middlewares receive nothing (nil adjuster) regardless of credentials
  - [ ] Startup log shows `"auto spend limit enabled"` with increment, max, cooldown values
  - [ ] `go build ./cmd/mnemo-server` succeeds

  **QA Scenarios**:

  ```
  Scenario: Server starts with auto-spend-limit enabled
    Tool: Bash (go build + go vet)
    Preconditions: MNEMO_AUTO_SPEND_LIMIT_ENABLED=true, MNEMO_TIDBCLOUD_API_KEY set
    Steps:
      1. cd server && go build ./cmd/mnemo-server
      2. Assert: build succeeds with no errors
    Expected Result: Clean build, no compilation errors
    Failure Indicators: Build failure, undefined reference, type mismatch
    Evidence: .sisyphus/evidence/task-5-build.txt

  Scenario: Server starts with auto-spend-limit enabled (Zero provisioner + credentials)
    Tool: Bash (go build)
    Preconditions: MNEMO_TIDB_ZERO_ENABLED=true, MNEMO_AUTO_SPEND_LIMIT_ENABLED=true, MNEMO_TIDBCLOUD_API_KEY and MNEMO_TIDBCLOUD_API_SECRET set
    Steps:
      1. cd server && go build ./cmd/mnemo-server
      2. Assert: build succeeds (adjuster created independently, passed to middleware)
    Expected Result: Clean build — adjuster passed even though Zero is the active provisioner
    Failure Indicators: Build failure, nil pointer in middleware
    Evidence: .sisyphus/evidence/task-5-build-zero.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-5-build.txt` — build output
  - [ ] `task-5-build-zero.txt` — build output

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(middleware): auto-increase spend limit on quota exhaustion`
  - Files: `server/cmd/mnemo-server/main.go`

- [x] 6. Config validation tests (extend `server/internal/config/config_test.go`)

  **What to do**:
  - Add test cases to the existing `config_test.go` (or create new if none exists) for auto-spend-limit config validation
  - Test cases:
    - Default values when no env vars set
    - Custom values for all 4 fields
    - `MNEMO_AUTO_SPEND_LIMIT_INCREMENT=0` → error
    - `MNEMO_AUTO_SPEND_LIMIT_INCREMENT` negative → error
    - `MNEMO_AUTO_SPEND_LIMIT_MAX` <= `MNEMO_AUTO_SPEND_LIMIT_INCREMENT` → error
    - `MNEMO_AUTO_SPEND_LIMIT_COOLDOWN=0` → error
    - `MNEMO_AUTO_SPEND_LIMIT_COOLDOWN` negative → error
    - `MNEMO_AUTO_SPEND_LIMIT_ENABLED=true` with invalid increment → error (validation runs regardless of enabled status)
  - Use `t.Setenv()` for each test case to avoid env pollution
  - Follow existing test style in the file

  **Must NOT do**:
  - Do NOT remove or modify existing test cases
  - Do NOT test middleware or provisioner behavior — config tests only

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Table-driven Go tests following existing patterns, straightforward assertions
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 8)
  - **Blocks**: None
  - **Blocked By**: Task 1

  **References**:
  - `server/internal/config/config.go:103-173` — `Load()` function, all env vars and their defaults
  - `server/internal/config/config.go:201-208` — `envBool` helper
  - `server/internal/config/config.go:192-199` — `envInt` helper
  - `server/internal/config/config.go:210-217` — `envDuration` helper
  - `server/internal/middleware/auth_test.go` — test style reference (table-driven tests with `t.Run`)

  **Acceptance Criteria**:
  - [ ] All validation error cases covered with table-driven tests
  - [ ] Default values test passes
  - [ ] `cd server && go test -race -count=1 -run TestAutoSpendLimit ./internal/config/` passes

  **QA Scenarios**:

  ```
  Scenario: All validation error cases pass
    Tool: Bash (go test)
    Preconditions: Clean test environment
    Steps:
      1. cd server && go test -race -count=1 -run "TestAutoSpendLimit" ./internal/config/ -v
      2. Assert: all subtests pass (PASS)
      3. Assert: no test is skipped
    Expected Result: All validation cases produce expected errors, default case produces expected values
    Failure Indicators: Any FAIL or SKIP, panic during test
    Evidence: .sisyphus/evidence/task-6-config-tests.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-6-config-tests.txt` — full test output

  **Commit**: YES (groups with Wave 3)
  - Message: `test: add tests for auto-spend-limit feature`
  - Files: `server/internal/config/config_test.go`

- [x] 7. Starter provisioner tests (new file `server/internal/tenant/starter_test.go`)

  **What to do**:
  - Create `server/internal/tenant/starter_test.go`
  - Use `httptest.NewServer` to mock the TiDB Cloud API with digest auth challenge:
    - First request returns 401 with WWW-Authenticate header
    - Second request validates Authorization header and returns appropriate response
  - Test `GetSpendLimit`:
    - Success: mock returns 200 with `{"cluster":{"spendingLimit":{"monthly":500}}}`
    - Parse failure: mock returns 200 with malformed JSON → error returned
    - API error: mock returns 500 → error returned
  - Test `IncreaseSpendLimit`:
    - Success: mock returns 200, verify correct PATCH body (updateMask + spendingLimit)
    - API error: mock returns 403, 404, 429 → error returned with status code
    - Verify that the correct monthly value is sent in USD cents (e.g., 1000 = $10)
  - Test compile-time interface satisfaction: `var _ SpendLimitAdjuster = (*TiDBCloudProvisioner)(nil)`

  **Must NOT do**:
  - Do NOT create real HTTP calls to TiDB Cloud API
  - Do NOT test middleware behavior — provisioner-level tests only
  - Do NOT modify existing test files

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Standard Go httptest-based unit tests following established patterns
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 6, 8)
  - **Blocks**: None
  - **Blocked By**: Task 2

  **References**:
  - `server/internal/tenant/starter.go:113-157` — `doDigestAuthRequest` implementation for understanding mock setup
  - `server/internal/tenant/starter.go:44-95` — `Provision()` for response parsing patterns
  - `server/internal/tenant/starter.go:97` — `StarterProvisionerType` constant
  - `server/internal/tenant/provisioner.go:10-27` — interface and `ClusterInfo` struct
  - Go stdlib `net/http/httptest` — for mock HTTP server

  **Acceptance Criteria**:
  - [ ] `GetSpendLimit` test: parses monthly spend limit from valid response
  - [ ] `GetSpendLimit` test: handles API error gracefully
  - [ ] `IncreaseSpendLimit` test: sends correct PATCH body with updateMask
  - [ ] `IncreaseSpendLimit` test: handles 403, 404, 429 API errors
  - [ ] `IncreaseSpendLimit` test: handles JSON marshal errors gracefully
  - [ ] Compile-time interface check passes
  - [ ] `cd server && go test -race -count=1 -run TestTiDBCloudProvisioner_SpendLimit ./internal/tenant/` passes

  **QA Scenarios**:

  ```
  Scenario: All starter provisioner spend-limit tests pass
    Tool: Bash (go test)
    Preconditions: Clean test environment, mock HTTP server
    Steps:
      1. cd server && go test -race -count=1 -run "TestTiDBCloudProvisioner.*SpendLimit" ./internal/tenant/ -v
      2. Assert: all subtests PASS
    Expected Result: GetSpendLimit and IncreaseSpendLimit both tested with success and error cases
    Failure Indicators: Any FAIL or SKIP, test timeout
    Evidence: .sisyphus/evidence/task-7-starter-tests.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-7-starter-tests.txt` — full test output

  **Commit**: YES (groups with Wave 3)
  - Message: `test: add tests for auto-spend-limit feature`
  - Files: `server/internal/tenant/starter_test.go`

- [x] 8. Auth middleware spend-limit behavior tests (extend `server/internal/middleware/auth_test.go`)

  **What to do**:
  - Extend `server/internal/middleware/auth_test.go` with auto-spend-limit test cases
  - Use a mock `SpendLimitAdjuster` implementation (struct with `GetSpendLimitFn` and `IncreaseSpendLimitFn` fields)
  - Test cases for both `ResolveTenant` and `ResolveApiKey` middleware paths:
    - Config disabled → no PATCH call, returns 503 as before
    - Config enabled + Starter tenant + spend-limit error → PATCH fires in goroutine
    - Config enabled + Zero tenant + spend-limit error → no PATCH call (skipped at Gate 2)
    - Config enabled + Starter tenant + non-spend-limit error → no PATCH call
    - Cooldown active → no PATCH call (skipped at Gate 3)
    - Max cap reached (current = max) → no PATCH call
    - Adjuster.GetSpendLimit returns error → PATCH skipped, error logged
    - Adjuster.IncreaseSpendLimit returns error → PATCH skipped, error logged, 503 returned
    - Nil adjuster passed (config disabled) → no panic, no PATCH call
  - Follow existing test patterns in `auth_test.go` (table-driven tests with `t.Run`, stdlib `testing` assertions)
  - Use `httptest.NewServer` for the tenant API server in integration-style tests

  **Must NOT do**:
  - Do NOT remove or modify any existing test cases
  - Do NOT define a separate cooldown interface just for testing — use the real `*SpendLimitCooldown` with short intervals for test time control
  - Do NOT run real HTTP calls to TiDB Cloud API

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Extending existing test file with additional test cases using established patterns
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 6, 7)
  - **Blocks**: None
  - **Blocked By**: Task 4, Task 5

  **References**:
  - `server/internal/middleware/auth_test.go:445-461` — `TestIsSpendLimitError` pattern (table-driven)
  - `server/internal/middleware/auth_test.go:462-564` — `TestResolveApiKey_BlacklistedCluster_SpendLimit_Returns429` (integration test pattern)
  - `server/internal/middleware/auth_test.go:565-` — `TestResolveTenant_BlacklistedCluster_SpendLimit_Returns429` (integration test pattern)
  - `server/internal/middleware/auth.go:32-33` — `isSpendLimitError` function
  - `server/internal/middleware/auth.go:46-119` — `ResolveTenant` middleware
  - `server/internal/middleware/auth.go:124-195` — `ResolveApiKey` middleware
  - `server/internal/tenant/starter.go:97` — `StarterProvisionerType = "tidb_cloud_starter"`

  **Acceptance Criteria**:
  - [ ] Config disabled test: no adjuster methods called, 503 returned
  - [ ] Starter tenant test: TryStartRaise succeeds → goroutine fires with deferred RecordFailure, GetSpendLimit + IncreaseSpendLimit called, RecordSuccess supersedes defer
  - [ ] Non-Starter tenant test: adjuster methods NOT called
  - [ ] TryStartRaise returns false test: adjuster methods NOT called
  - [ ] Max cap test: GetSpendLimit called, IncreaseSpendLimit NOT called (newLimit == currentLimit), deferred RecordFailure runs (cooldown applied)
  - [ ] GetSpendLimit error test: deferred RecordFailure runs, in-flight cleared, cooldown active, 503 returned
  - [ ] PATCH error test: IncreaseSpendLimit error → 503 returned, deferred RecordFailure runs, no panic
  - [ ] Nil adjuster test: no panic, no PATCH call
  - [ ] `cd server && go test -race -count=1 -run TestAutoSpendLimit ./internal/middleware/` passes

  **QA Scenarios**:

  ```
  Scenario: All auto-spend-limit middleware tests pass
    Tool: Bash (go test)
    Preconditions: Clean test environment
    Steps:
      1. cd server && go test -race -count=1 -run "TestAutoSpendLimit" ./internal/middleware/ -v
      2. Assert: all subtests PASS
    Expected Result: All gates (config, provider, TryStartRaise, max cap, RecordFailure on error) tested
    Failure Indicators: Any FAIL or SKIP, panic, nil pointer dereference
    Evidence: .sisyphus/evidence/task-8-middleware-tests.txt

  Scenario: Existing middleware tests still pass
    Tool: Bash (go test)
    Preconditions: Clean test environment
    Steps:
      1. cd server && go test -race -count=1 ./internal/middleware/ -v
      2. Assert: all existing tests PASS (no regression)
      3. Assert: TestResolveApiKey_BlacklistedCluster_SpendLimit_Returns429 PASS
      4. Assert: TestResolveTenant_BlacklistedCluster_SpendLimit_Returns429 PASS
    Expected Result: No regression in existing test suite
    Failure Indicators: Previously passing tests now fail
    Evidence: .sisyphus/evidence/task-8-regression.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-8-middleware-tests.txt` — new test output
  - [ ] `task-8-regression.txt` — full middleware test suite output

  **Commit**: YES (groups with Wave 3)
  - Message: `test: add tests for auto-spend-limit feature`
  - Files: `server/internal/middleware/auth_test.go`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run test). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `cd server && go vet ./...` + `cd server && go test -race ./...`. Review all changed files for: `panic()` in non-init code, empty catch-all error handling, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Vet [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration: config disabled → no PATCH, Starter tenant → PATCH fires, non-Starter → skipped, cooldown enforced, max cap enforced, API error → graceful degradation. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  Minor notes: 2 cosmetic refactoring (SplitSeq, range loop — functionally equivalent, tests pass); missing negative cooldown test + 429 PATCH test (nice-to-have); unaccounted build binary.
  For each task: read "What to do", read actual diff (`git diff`). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

> **Hard gate**: All commits require explicit user approval ("commit it"). No auto-commit. Execution agent must present changes for review before committing.

- **Wave 1**: `feat(config): add auto-spend-limit config fields` -- config.go, provisioner.go, starter.go, cooldown.go
- **Wave 2**: `feat(middleware): auto-increase spend limit on quota exhaustion` -- auth.go, main.go
- **Wave 3**: `test: add tests for auto-spend-limit feature` -- config_test.go, starter_test.go, auth_test.go

---

## Success Criteria

### Verification Commands
```bash
cd server && go vet ./...  # Expected: no errors
cd server && go test -race -count=1 ./internal/config/      # Expected: PASS
cd server && go test -race -count=1 ./internal/tenant/      # Expected: PASS
cd server && go test -race -count=1 ./internal/middleware/  # Expected: PASS
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Zero new `go vet` warnings
