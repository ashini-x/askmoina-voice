CREATE TABLE IF NOT EXISTS visitor_profiles (
  visitor_id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_visitor_profiles_last_seen ON visitor_profiles(last_seen_at);

CREATE TABLE IF NOT EXISTS voice_sessions (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  outcome TEXT NOT NULL DEFAULT 'active',
  model TEXT NOT NULL,
  location TEXT NOT NULL,
  setup_completed INTEGER NOT NULL DEFAULT 0 CHECK(setup_completed IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_started ON voice_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_visitor ON voice_sessions(visitor_id, started_at);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_outcome ON voice_sessions(outcome, started_at);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  client_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);

CREATE TABLE IF NOT EXISTS vault_backups (
  vault_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version = 1),
  kdf TEXT NOT NULL CHECK(kdf = 'PBKDF2-SHA-256'),
  iterations INTEGER NOT NULL CHECK(iterations = 600000),
  salt TEXT NOT NULL,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vault_backups_updated ON vault_backups(updated_at);