PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gyanshala_users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL UNIQUE,
  email_verified_at TEXT NOT NULL,
  phone_verified_at TEXT NOT NULL,
  full_name TEXT,
  branch TEXT,
  year_of_study TEXT,
  residence TEXT,
  profile_complete INTEGER NOT NULL DEFAULT 0 CHECK (profile_complete IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gyanshala_signup_challenges (
  challenge_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('signup','signin')),
  user_id TEXT,
  email TEXT NOT NULL COLLATE NOCASE,
  phone TEXT NOT NULL,
  email_code_hash TEXT NOT NULL,
  email_expires_at TEXT NOT NULL,
  email_verified_at TEXT,
  phone_verified_at TEXT,
  email_sent_at TEXT NOT NULL,
  phone_sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gyanshala_challenges_email_phone
  ON gyanshala_signup_challenges(email, phone, created_at);

CREATE TABLE IF NOT EXISTS gyanshala_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES gyanshala_users(user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gyanshala_sessions_expiry
  ON gyanshala_sessions(expires_at);

CREATE TABLE IF NOT EXISTS gyanshala_rate_limits (
  contact_hash TEXT PRIMARY KEY,
  last_sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gyanshala_rate_limits_sent
  ON gyanshala_rate_limits(last_sent_at);
