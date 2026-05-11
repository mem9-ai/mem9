---
title: server/internal/tenant — Tenant provisioning
---

## Purpose

Tenant cluster provisioning and schema initialization. This area abstracts TiDB Serverless provider flows and prepares tenant databases for the API server.

## Commands

```bash
cd server && go test -race -count=1 ./internal/tenant/
cd server && go test -race -count=1 -run TestFunctionName ./internal/tenant/
```

## Where to look

| Task | File |
|------|------|
| Provisioner interface and cluster info | `provisioner.go` |
| Provisioner selection | `starter.go` |
| TiDB Cloud Starter provider | `starter.go` |
| TiDB Zero provider | `zero.go` |
| Tenant DB pool | `pool.go` |
| Schema initialization | `schema.go` |
| DSN helpers | `util.go` |

## Local conventions

- `Provisioner` implementations return tenant-facing IDs separately from provider cluster IDs.
- Keep provider-specific API behavior behind the `Provisioner` interface.
- Initialize tenant schema through `InitSchema()` instead of scattering DDL.
- Preserve claim URL and expiration behavior for TiDB Zero tenants.

## Anti-patterns

- Do NOT leak provider credentials or API payloads into logs.
- Do NOT bypass the tenant DB pool for normal request-time access.
- Do NOT mix control-plane tenant records with tenant database schema setup.
