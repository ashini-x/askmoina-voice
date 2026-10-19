-- Veda-owned infrastructure schema. Live audio/video and raw transcripts
-- are intentionally not represented as durable columns in this database.
CREATE TABLE IF NOT EXISTS veda_system_metadata (
  meta_key TEXT PRIMARY KEY,
  meta_value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO veda_system_metadata (meta_key, meta_value_json)
VALUES ('schema_version', '"1"')
ON CONFLICT(meta_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS veda_runtime_sessions (
  session_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (
    state IN ('created', 'armed', 'starting', 'listening', 'stopping', 'stopped', 'failed')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  ended_at TEXT,
  runtime_version TEXT,
  last_error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_veda_runtime_sessions_updated_at
  ON veda_runtime_sessions(updated_at);
