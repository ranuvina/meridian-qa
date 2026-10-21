-- A1: tenant rate-limit override (NULL = use plan default)
ALTER TABLE tenants ADD COLUMN rate_limit_override INTEGER
  CHECK (rate_limit_override IS NULL OR rate_limit_override > 0);

-- A2: key scopes. Existing keys keep full access ("existing keys must continue to work").
ALTER TABLE api_keys ADD COLUMN scopes TEXT[] NOT NULL DEFAULT ARRAY['read','write']::TEXT[]
  CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['read','write']::TEXT[]);

-- A2: rotation. One previous secret may authenticate until previous_secret_expires_at.
ALTER TABLE api_keys ADD COLUMN previous_secret_hash TEXT;
ALTER TABLE api_keys ADD COLUMN previous_secret_expires_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN rotated_at TIMESTAMPTZ;
CREATE UNIQUE INDEX idx_api_keys_prefix_unique ON api_keys(prefix);
