-- Apply explicitly before MNEMO_API_KEYS_ENABLED; no data migration on startup.
ALTER TABLE tenants ADD COLUMN legacy_key_auth BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(36) PRIMARY KEY,
  hash_version VARCHAR(32) NOT NULL,
  key_hash VARBINARY(32) NOT NULL,
  encrypted_key TEXT NOT NULL,
  credential_type VARCHAR(16) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  binding_id VARCHAR(36) NULL,
  migrating BOOLEAN NOT NULL DEFAULT FALSE,
  new_tenant_id VARCHAR(36) NULL,
  migration_phase VARCHAR(16) NOT NULL DEFAULT '',
  UNIQUE KEY idx_api_keys_hash (hash_version,key_hash),
  UNIQUE KEY idx_api_keys_tenant (tenant_id),
  UNIQUE KEY idx_api_keys_binding (binding_id)
);
CREATE TABLE IF NOT EXISTS api_key_readers (
  id VARCHAR(36) PRIMARY KEY,
  api_key_id VARCHAR(36) NOT NULL,
  instance_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_api_key_readers_key (api_key_id),
  INDEX idx_api_key_readers_instance (instance_id)
);
CREATE TABLE IF NOT EXISTS api_key_instances (
  id VARCHAR(36) PRIMARY KEY,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS api_key_file_moves (
  api_key_id VARCHAR(36) NOT NULL,
  instance_id VARCHAR(36) NOT NULL,
  PRIMARY KEY (api_key_id,instance_id)
);
