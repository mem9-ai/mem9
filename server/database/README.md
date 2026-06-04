# Server Database Schemas and Migrations

This directory keeps the manual database schema files and one-off operational
migration commands for the Go server.

## Schema Files

- `schema.sql`: TiDB/MySQL control-plane schema plus tenant data-plane reference
  DDL.
- `schema_pg.sql`: PostgreSQL-compatible control-plane schema.
- `schema_db9.sql`: db9/PostgreSQL-compatible manual schema with native
  auto-embedding examples.

Runtime tenant provisioning still uses Go schema builders under
`server/internal/tenant/`. Keep these SQL files aligned with the runtime schema
when public manual setup or operations depend on them.

## appId Tenant Migration

`migration/app_id_tenant_schema_migration.go` updates active tenant TiDB/MySQL
databases for app-scoped memories and raw sessions.

Run a dry-run from `server/`:

```bash
cd server
MNEMO_DSN='user:pass@tcp(host:4000)/metadb?parseTime=true' \
  go run ./database/migration/app_id_tenant_schema_migration.go --dry-run
```

Run from `server/`:

```bash
MNEMO_DSN='user:pass@tcp(host:4000)/metadb?parseTime=true' \
  go run ./database/migration/app_id_tenant_schema_migration.go
```

The script reads tenant passwords with the same encryption settings as the
server:

```bash
MNEMO_ENCRYPT_TYPE=plain
MNEMO_ENCRYPT_KEY=''
```

By default it processes `status='active'` tenants in batches of 100, sleeps one
minute between batches, and writes progress files under
`database/migration/app_id_state/` when run from `server/` (repository path:
`server/database/migration/app_id_state/`). The state directory is gitignored
because it can contain tenant IDs and production operation details.

State files:

- `success.tsv`: tenants that completed.
- `failed.tsv`: tenants that failed, including an error message.
- `skipped.tsv`: tenants skipped because they already appeared in a previous
  success or failure file.

Re-runs skip both successful and failed tenants. Pass `--retry-failed=true` to
retry failed tenants while still skipping successful tenants.
