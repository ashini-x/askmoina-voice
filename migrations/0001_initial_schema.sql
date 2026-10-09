CREATE TABLE IF NOT EXISTS user_preferences (user_id TEXT PRIMARY KEY, preferred_language TEXT, memory_enabled INTEGER NOT NULL DEFAULT 0 CHECK(memory_enabled IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS usage_events (id TEXT PRIMARY KEY, user_id TEXT, event_type TEXT NOT NULL, duration_seconds INTEGER, estimated_cost_usd REAL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_id ON usage_events(user_id);
