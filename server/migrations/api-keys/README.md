# Online API-key / tenant-ID migration

One application PR supports three separately operated rollout phases. All
credential switches default off, except the two legacy-reader switches, which
default on. No backfill or tenant-ID migration runs on application startup.

The shared `api_keys` table holds a stable UUID credential record ID, binary
HMAC-SHA256 digest/version, AES-256-GCM envelope, and Space tenant or Chain binding
association. HMAC input is the trimmed UTF-8 key. GCM uses a random nonce and AAD
`mem9-api-key:v1:<credential-ID>`; envelopes contain `v`, `kid`, `nonce`, and
`ciphertext`. Hash keys and encryption keys must be distinct, 32-byte base64
values. Old named versions remain readable while referenced.

## Before rollout

Run commands from the repository root.

- Review control-plane backups and rehearse with synthetic data in TiDB Zero.
  `MNEMO_CREDENTIAL_TEST_DSN` must point at a disposable instance; the integration
  scenario creates and removes its own randomly named database.
- Build with `make build build-credentials`. Run existing checks with `make vet`
  and `make test`, and the real-database scenario with
  `make test-credentials-integration`.
- Store the keyring in Secrets Manager and mount its JSON as a read-only secret
  file. Set `MNEMO_API_KEYS_SECRET_FILE` to that path. Do not reuse password
  encryption, runtime quota secrets or log-fingerprint secrets. Cloud secret
  provisioning, ARNs and workload IAM are separate infrastructure changes.
- Use the target control-plane `MNEMO_DSN`, `MNEMO_DB_BACKEND` and the same
  `MNEMO_UPLOAD_DIR` configuration as the server. Never put real keys or DSNs in
  commands, logs, committed configuration, or PR evidence.

Keyring shape (values below are placeholders, not usable keys):

```json
{
  "hash_version": "v1",
  "hmac_keys": {"v1": "<base64-encoded independent 32-byte key>"},
  "encryption_kid": "k1",
  "encryption_keys": {"k1": "<base64-encoded independent 32-byte key>"}
}
```

## Linear rollout

Environment variable names in the table omit the common `MNEMO_API_KEYS_`
prefix. `ENABLED=true` and the secret file are required throughout the rollout.
Every migration command previews by default; only `-apply` writes data.

| Phase | Settings and operation | Gate before continuing |
| --- | --- | --- |
| 1. Add schema | Preview `./server/bin/mnemo-credentials -action schema`, review the TiDB or Postgres/DB9 DDL, then run it with `-apply`. The schema operation is restartable after partial DDL. | The `legacy_key_auth` column and credential/barrier/file-participant tables exist. Existing binaries still work; no tenant identities have changed. |
| 1. Deploy registration | Roll all API instances and workers with `READ=false`, `OUTBOX_REFERENCES=false`, `INDEPENDENT_TENANTS=false`, `LEGACY_AUTH=true`, `LEGACY_OUTBOX=true`. New provisioning transactionally registers its credential but still returns/uses the legacy key identity. | All writers, including administrative writers, use this binary. Instances log only their safe migration participant UUID. |
| 1. Backfill | Repeat `-action backfill -limit 100 -apply` until it reports zero records. Backfill includes deleted/suspended tenants without changing lifecycle, and registers Chain binding credentials without changing Chain authentication. | `-action audit` reports no missing Space credentials. Recoverable ciphertext and HMAC match. Late old-version provisioning was scanned again. |
| 2. Switch reads/writes | Roll `READ=true`, `OUTBOX_REFERENCES=true`; keep both legacy readers enabled and independent provisioning off. Existing readers support both outbox versions before any writer emits references. | Header/path/status/runtime-state and Chain requests work. Only explicitly marked legacy tenants can use fallback. Lookup errors never fall back; a public internal tenant UUID cannot authenticate or be added to a Chain as a key. |
| 2. Convert outbox | Repeat `-action outbox -limit 100 -all-writers-upgraded -apply` until zero rows change and audit reports `legacy_outbox=0`. The tool CASes the original version/payload, removes root and nested key copies, retains metering business hashes, and preserves unrelated JSON integers/content. | All retained rows, including completed/failed history, are converted. No old writer remains. Missing/undecryptable records leave retries pending and emit an error; no internal-ID billing fallback. |
| 2. Enable new tenants | Roll `LEGACY_OUTBOX=false`, `INDEPENDENT_TENANTS=true`; keep `READ=true`, `OUTBOX_REFERENCES=true`. Startup rejects unconverted historical outbox rows. | Every instance supports independent IDs. New Space credentials are random base64url keys; responses retain the existing field shape. All old client keys still work. |
| 3. Move old identities | Preview `-action migrate -limit 1`, then run with `-all-writers-upgraded -apply`. Expand batch size after verification. The tool prints only stable credential UUIDs, so the same ID can be resumed with `-credential-id`. | Request/background reader barriers drain; every registered instance acknowledges its local upload directory move and pool invalidation. The transaction inserts the independent tenant, moves FK references/tasks/Chain/webhook identities, updates the credential association and removes the old tenant. Credential UUID and business data stay unchanged. |
| 3. Verify and close fallback | Repeat migration until no legacy tenant remains. Run `-action audit`, verify metrics/errors/queue progress, then roll `LEGACY_AUTH=false`. | `legacy_tenants`, `legacy_outbox`, `missing_space_credentials`, `migrating_tenants`, identity/payload residuals and missing file acknowledgements are all zero. `mnemo_api_key_legacy_fallback_total` stops increasing. Old keys, new provisioning, files, Chain and quota/metering pass. |

## Concurrency, files and recovery

The credential row serializes reader registration against migration. Durable
reader tokens cover HTTP operations, detached ingest/finalization, upload work,
and webhook delivery. Metadata-only late outbox writes use the same row lock and
current tenant association in their SQL transaction, so they cannot recreate an
old tenant reference after cutover. Reader registration is short; no database
transaction is held across the HTTP request.

Migration blocks only that tenant's new work (retryable HTTP 503), waits for its
existing readers, and asks each application instance to rename its own upload
directory. Database and filesystem operations are separate recorded phases;
they are not one atomic transaction. Cutover requires acknowledgements from all
registered participants. Measure per-tenant time in rehearsal; there is no
fixed seconds-level guarantee.

Reader tokens and participant registrations deliberately do not expire on a
timer: an unreachable process could still be writing or retain an old local
volume. A crash pauses migration safely. Inspect `-action progress` and the
`api_key_readers` / `api_key_instances` metadata (no raw key output). Fence the
old process and migrate or retire its upload volume, then explicitly remove its
registration with:

```sh
./server/bin/mnemo-credentials -action forget-instance \
  -instance-id <verified-stopped-instance-UUID> -participant-fenced -apply
./server/bin/mnemo-credentials -action migrate \
  -credential-id <same-credential-UUID> -all-writers-upgraded -apply
```

Do not delete a partially moved directory or create a second migration target.
Resume the same credential UUID. A failed tenant stays gated while other tenants
continue. Only roll application code back to a version that understands the new
model. Never overwrite an active database with an old snapshot and lose newer
writes or replay external billing side effects.

The audit scans only application identity fields and generated path components;
it does not rewrite user memory/content. `cluster_id` values equal to a legacy
Space key become credential references. Zero claim URLs also embed the legacy key: migration replaces that occurrence
with the same credential reference, and `ExpandClaimURL` can restore the original
link at an explicit reveal boundary. The rest of the claim token remains in scope
for the separate sensitive-column encryption work. Internal logs/metrics/S3 grouping retain
that reference; only the spend-limit provider adapter decrypts the real upstream
identifier, without propagating provider URLs into errors. Console and quota
calls still receive the original request key as `APIKeySubject`.

Historical logs/backups, rotation and multi-key management, URL-auth retirement,
and full Chain management-key storage/permission changes remain separate work.
Do not erase a credential ciphertext while retained tasks still reference it.
