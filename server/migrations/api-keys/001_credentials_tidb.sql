-- Additive mapping only: existing tenant IDs and tables remain unchanged.
CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(36) PRIMARY KEY,
  hash_version VARCHAR(32) NOT NULL,
  key_hash VARBINARY(32) NOT NULL,
  encrypted_key TEXT NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  UNIQUE KEY idx_api_keys_hash (hash_version, key_hash),
  UNIQUE KEY idx_api_keys_tenant (tenant_id)
);
