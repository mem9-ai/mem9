# Additive API-key mappings

Tenant IDs remain API keys for both existing and newly provisioned Spaces.
This change adds one `api_keys` table; it does not change tenant identities,
Chain authentication, upload directories, webhook payloads or outbox formats.

New provisioning inserts the tenant and its credential mapping in one
transaction. Authentication and key-status reads first resolve the HMAC digest
in `api_keys`. A missing mapping falls back to the existing tenant ID lookup.
Database errors do not fall back, and reads never register or backfill keys.
Tenant status and deletion checks still apply after either lookup path.
The original request key remains `APIKeySubject` for Console and quota calls.

## Setup and deployment

There are no behavior or rollout switches. The schema and keyring are required
before starting this version; missing dependencies fail startup explicitly.

1. Build with `make build build-credentials`.
2. Preview `./server/bin/mnemo-credentials -action schema`, then run it with
   `-apply` using the control-plane `MNEMO_DSN` and `MNEMO_DB_BACKEND`.
   The DDL only creates `api_keys` and can be repeated. No existing table is
   altered and no existing records are updated.
3. Mount the keyring JSON as a read-only secret file and set
   `MNEMO_API_KEYS_SECRET_FILE` to its path on every API instance. Use the same
   keyring across instances. Secret provisioning and workload permissions are
   separate infrastructure changes.
4. Deploy the application. New and old instances can coexist: new instances
   still write the provider-issued ID as the tenant ID/API key, and old instances
   can authenticate it. Tenants created by an old instance work through the
   fallback without a mapping.

No identity migration, request barriers or per-tenant maintenance windows are
part of this change. Credential lookup adds a database read, and provisioning
now depends on the mapping insert committing with the tenant insert. A failed
mapping insert rolls back the tenant insert; it does not silently create an
unmapped tenant. Upstream cluster provisioning still precedes these writes.

To roll application code back, deploy the previous binary and leave `api_keys`
in place. All tenant IDs and historical payloads remain compatible. Remove the
unused table only in a separate reviewed cleanup after all readers have been
rolled back; deleting mappings is not part of this command.

## Keyring and storage contract

The mapping stores a credential UUID, binary HMAC-SHA256 digest/version,
AES-256-GCM envelope and tenant ID. The tenant ID still contains the original
key under the existing product contract; this is redundancy, not removal of
plaintext identities from historical or current data.

HMAC input is the trimmed UTF-8 key. AES-GCM uses a random nonce and AAD
`mem9-api-key:v1:<credential-ID>`. Envelopes contain `v`, `kid`, `nonce` and
`ciphertext`. HMAC keys and encryption keys must be distinct, 32-byte base64
values. Keep existing named keys when changing the active version so previous
records remain readable. Do not reuse the password encryptor or log secrets.

```json
{
  "hash_version": "v1",
  "hmac_keys": {"v1": "<base64-encoded independent 32-byte key>"},
  "encryption_kid": "k1",
  "encryption_keys": {"k1": "<base64-encoded independent 32-byte key>"}
}
```

Do not put real keys or DSNs in commands, logs or committed files.

## Optional existing-key backfill

Old keys work before, during and after backfill. Backfill only adds missing
mapping records, including inactive/deleted tenants without changing their
lifecycle. It does not copy or migrate Chain keys.

Preview `./server/bin/mnemo-credentials -action backfill -limit 100`, then use
`-apply` to write the batch. `records` counts processed candidates, including concurrent duplicate inserts.
Repeat until it is zero. A failed batch can
be retried; previously registered mappings are skipped. Run another pass after
a rolling deployment to include tenants created by old instances.

## Validation

Run `make build build-credentials`, `make vet` and `make test`.
For real database verification, set `MNEMO_CREDENTIAL_TEST_DSN` to a disposable
TiDB instance and run `make test-credentials-integration`. The scenario creates
and removes only its own randomly named database. It checks additive schema,
transactional provisioning, mapping-first/legacy reads, original-key subjects,
unchanged Chain access, lifecycle rules, read-only authentication, backfill and
rollback on mapping-insert failure.
