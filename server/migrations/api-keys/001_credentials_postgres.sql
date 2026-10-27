-- Also used by DB9. Apply explicitly before enabling credentials.
ALTER TABLE tenants ADD COLUMN legacy_key_auth BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(36) PRIMARY KEY,
  hash_version VARCHAR(32) NOT NULL,
  key_hash BYTEA NOT NULL CHECK (octet_length(key_hash)=32),
  encrypted_key TEXT NOT NULL,
  credential_type VARCHAR(16) NOT NULL,
  tenant_id VARCHAR(36) UNIQUE,
  binding_id VARCHAR(36) UNIQUE,
  migrating BOOLEAN NOT NULL DEFAULT FALSE,
  new_tenant_id VARCHAR(36),
  migration_phase VARCHAR(16) NOT NULL DEFAULT '',
  UNIQUE (hash_version,key_hash)
);
CREATE TABLE IF NOT EXISTS api_key_readers (
  id VARCHAR(36) PRIMARY KEY,
  api_key_id VARCHAR(36) NOT NULL,
  instance_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_api_key_readers_key ON api_key_readers(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_readers_instance ON api_key_readers(instance_id);
CREATE TABLE IF NOT EXISTS api_key_instances (
  id VARCHAR(36) PRIMARY KEY,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS api_key_file_moves (
  api_key_id VARCHAR(36) NOT NULL,
  instance_id VARCHAR(36) NOT NULL,
  PRIMARY KEY (api_key_id,instance_id)
);
