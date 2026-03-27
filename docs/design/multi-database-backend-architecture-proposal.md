---
title: Multi-Database Backend Architecture (MySQL/PostgreSQL-Compatible)
status: partially-implemented
created: 2026-03-11
last_updated: 2026-03-25
open_questions: 7
blocked_by: ""
---

> **STATUS: PARTIALLY IMPLEMENTED**
> Concrete adapter packages `repository/tidb/`, `repository/postgres/`, and
> `repository/db9/` exist with per-backend SQL. `repository/factory.go`
> selects the adapter at startup. The `ftsAvailable` capability flag is
> present inside each concrete repo struct.
>
> Not yet implemented: the formal `Capabilities` registry from the proposal
> (no exported capability constants or struct), the shared conformance test
> suite (Phase C), and the standardised startup diagnostics (Phase D).
> Open questions from the proposal remain unresolved.

## Summary

Evolve mnemos from a backend-specific implementation into a capability-driven,
MySQL-compatible or PostgreSQL-compatible multi-backend architecture that can onboard new databases
incrementally without changing API semantics. The immediate objective is not to
ship another one-off backend, but to make future backend integrations routine,
predictable, and testable.

This proposal explicitly scopes to MySQL-compatible or PostgreSQL-compatible
backends (for example TiDB, PostgreSQL, db9, and future engines compatible with
those dialect families). Non-relational stores are out of scope in this phase.

## Context

Issue #33 introduced the core product requirement: support PostgreSQL as an
additive backend while preserving TiDB as the default and keeping existing
users stable.

This proposal therefore focuses on: a durable architecture for adding more
MySQL-compatible or PostgreSQL-compatible backends with less risk and less
duplication.

## Goals

1. **Backend-extensible architecture**: Add new MySQL-compatible or
   PostgreSQL-compatible backends by implementing a well-defined adapter
   contract, not by scattering conditionals across handlers/services.
2. **Incremental refactor path**: Improve structure in small, low-risk steps
   that preserve current behavior and allow partial rollout.
3. **Capability-driven behavior**: Drive runtime behavior from explicit backend
   capabilities (vector, FTS, JSON ops, provisioning), not backend-name checks.
4. **Stable API contracts**: Keep external API semantics unchanged across
   backends, including tenant-scoped behavior and `X-Mnemo-Agent-Id` handling.
5. **Conformance-first quality bar**: Require backend conformance checks before
   marking a backend as production-ready.

## Non-Goals

- Do not redesign product-level APIs for backend-specific features.
- Do not introduce non-MySQL/PostgreSQL backend families (MongoDB, Redis,
  object stores) in this phase.
- Do not force parity on every optional optimization from day one.
- Do not migrate existing users across backends automatically.

## Architecture Blueprint

### 1) Layering and ownership

Keep strict architecture boundaries:

`handler -> service -> repository`

- `handler`: protocol and auth only; no backend branching.
- `service`: business policy and fallback strategy only; backend-agnostic.
- `repository`: backend-specific SQL and error translation.

### 2) Backend adapter model

Each backend package provides concrete implementations for repository
interfaces. A factory selects adapters at startup.

```
repository/
  factory.go
  tidb/
  postgres/
  db9/
  <future-backend>/
```

### 3) Capability registry

Introduce explicit capabilities per backend (declared once, consumed
everywhere):

- `vector_search`
- `auto_embedding`
- `full_text_search`
- `json_contains`
- `skip_locked`
- `upsert`
- `tenant_auto_provision`

Services decide execution paths from capabilities, for example:

- Vector + FTS + RRF when available
- Vector + keyword fallback
- FTS-only
- Keyword-only

### 4) Error contract normalization

Repository adapters map backend-specific SQL/driver errors into domain sentinel
errors. Handlers continue centralized HTTP/domain mapping without exposing raw
SQL errors.

## Backend Capability Contract

Every backend integration must declare and satisfy a minimal contract:

1. **Connection and health**: driver init, pool config, ping behavior.
2. **Schema lifecycle**: schema init and version migration behavior.
3. **Memory CRUD semantics**: create/get/update/delete and optimistic update
   consistency.
4. **Search semantics**: vector/FTS/keyword behavior and fallback paths.
5. **Worker semantics**: pending-task fetch and lock behavior under concurrency.
6. **Error mapping**: deterministic translation to domain errors.

Backends may differ in implementation details, but must not violate service/API
semantics.

## Support Levels

To avoid binary "supported vs unsupported" ambiguity, each backend should be
labeled across two dimensions:

1. **Tier**
   - **Core**: CRUD, tenant isolation, and baseline keyword search.
   - **Extended**: Core + vector/FTS and auto-embedding integration.
   - **Full**: Extended + operational capabilities such as auto-provisioning.

2. **Maturity**
   - **GA**: production-ready with full conformance gates.
   - **Beta**: functionally complete but still under tighter release controls.
   - **Experimental**: development-stage backend, not for production traffic.

This labeling is orthogonal to backend family and provides a clearer release
contract to operators and contributors.

## Compatibility and API Invariants

The following behavior must remain invariant across supported backends:

- Existing API routes and payload contracts.
- Tenant-scoped execution model.
- `X-Mnemo-Agent-Id` identity semantics.
- Graceful degradation when optional capabilities are unavailable.
- No backend-specific branches in handlers.

Capability differences are allowed only in execution path, not in externally
observable API meaning.

## Cross-Backend Challenges (and Why They Matter)

Adding more MySQL-compatible or PostgreSQL-compatible backends introduces
systematic risks beyond syntax translation:

1. **Feature parity drift**
   - Risk: search quality and behavior diverge by backend.
   - Impact: user-visible inconsistency for identical requests.

2. **Transaction and lock model mismatch**
   - Risk: worker polling correctness differs (`FOR UPDATE SKIP LOCKED`, retry,
     isolation semantics).
   - Impact: duplicate processing, starvation, or stuck tasks.

3. **SQL dialect fragmentation**
   - Risk: branching logic expands and becomes unmaintainable.
   - Impact: slower onboarding of new backends and higher regression risk.

4. **Ranking inconsistency in hybrid search**
   - Risk: vector/FTS score distributions differ by engine.
   - Impact: unstable relevance and difficult debugging.

5. **Migration portability limits**
   - Risk: DDL/index operations have different online/offline behavior.
   - Impact: rollout failures and operational surprise.

6. **Error-model divergence**
   - Risk: incomplete SQLSTATE/driver error mapping.
   - Impact: incorrect HTTP status codes and poor operator diagnostics.

7. **Provisioning and operations variance**
   - Risk: backend-specific bootstrapping and credentials differ.
   - Impact: non-uniform tenant lifecycle and runbook complexity.

8. **Test matrix explosion**
   - Risk: each backend multiplies integration and regression coverage cost.
   - Impact: slower CI and lower confidence if coverage is reduced.

## Incremental Refactor Plan (Architecture-Level)

This plan is intentionally backend-agnostic.

### Phase A: Contract hardening

- Freeze repository interface contracts and domain error surface.
- Add backend capability declaration and validation at startup.
- Document invariants and fallback matrix in code-level docs.

### Phase B: Capability-driven service paths

- Replace backend-name branching with capability checks in service layer.
- Centralize search-path selection and fallback behavior.
- Ensure no backend-specific behavior leaks into handlers.

### Phase C: Adapter conformance suite

- Create reusable backend conformance tests (contract tests).
- Run same suite against each backend package.
- Promote backend readiness based on contract pass criteria.

### Phase D: Operational standardization

- Standardize startup diagnostics (backend, capabilities, degraded modes).
- Standardize migration and rollback runbook template for each backend.
- Add backend health checks to smoke/e2e scripts.
- Add schema/feature drift detection checks so backend capabilities cannot
  silently diverge from declared contracts over time.

## Conformance Testing Strategy

Each backend must pass four levels:

1. **Static and build checks**
   - Build and vet pass for backend-selected runtime.

2. **Contract tests (shared suite)**
   - CRUD semantics
   - Search behavior and fallback
   - Upload task concurrency semantics
   - Error mapping consistency

3. **Integration smoke**
   - Schema init/migration
   - Server startup with selected backend
   - End-to-end memory create/query path

4. **Behavioral consistency checks**
   - Same test fixtures across backends with expected parity windows
   - Explicitly documented tolerated deltas where unavoidable

Conformance implementation priority should be:

1. Tenant isolation (highest security and data-boundary risk)
2. CRUD idempotency and correctness
3. Search ordering and result consistency
4. Concurrency and lease semantics (including `FOR UPDATE SKIP LOCKED` paths)

## Risks and Mitigations

1. **Risk: duplication between adapters**
   - Mitigation: accept short-term duplication, then extract shared builders only
     after behavior stabilizes.

2. **Risk: accidental API behavior drift**
   - Mitigation: encode invariants as contract tests and gate merges on them.

3. **Risk: incomplete fallback behavior**
   - Mitigation: enforce capability matrix tests per backend before rollout.

4. **Risk: CI cost growth**
   - Mitigation: tiered pipeline (fast contract subset on PR, full matrix on
     scheduled/nightly).

5. **Risk: operational complexity**
   - Mitigation: backend-specific runbooks with a shared template and explicit
      rollback steps.

6. **Risk: connection pool behavior divergence**
   - Mitigation: define backend-specific pool defaults and monitor exhaustion,
     wait latency, and connection churn with consistent telemetry.

7. **Risk: transaction isolation variance**
   - Mitigation: document required isolation assumptions per critical path and
     validate them in backend conformance and integration tests.

8. **Risk: timestamp precision differences**
   - Mitigation: avoid correctness logic that depends on fine-grained timestamp
     ordering; use deterministic ordering keys where precision can differ.

## Open Questions

1. Should all MySQL-compatible/PostgreSQL-compatible backends satisfy full
   feature parity before GA, or do we allow tiered support levels
   (Core/Extended)?
2. Which capabilities are mandatory for a backend to be officially supported?
3. How should we define relevance parity thresholds for hybrid search across
   different engines?
4. Should provisioning be represented as a generic capability contract, or
   remain backend-specific operational logic?
5. What is the long-term strategy for shared SQL abstractions without violating
   the current raw-SQL convention?
6. What is the CI matrix policy that balances confidence and runtime cost as
   backend count grows?
7. What is the migration/rollback compatibility policy across backend upgrades
   (for example, required compatibility window, fallback guarantees, and
   rollback preconditions)?

## Decision Log

- Scope is limited to MySQL-compatible or PostgreSQL-compatible backends.
- Future backend onboarding will follow capability contract + conformance-first
  gating.
