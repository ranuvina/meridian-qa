-- DEF-014 / SUP-1062: usage_events had no index beyond its primary key, so every report
-- and every per-request quota check was a sequential scan.
CREATE INDEX idx_usage_events_tenant_created ON usage_events(tenant_id, created_at);
CREATE INDEX idx_usage_events_key_created ON usage_events(api_key_id, created_at);
