-- Permanent account identity and passwordless authentication. Never store biometric samples or raw phone/OTP values.
CREATE TABLE IF NOT EXISTS account_users (user_id TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS account_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES account_users(user_id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_account_sessions_user ON account_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_account_sessions_expiry ON account_sessions(expires_at);
CREATE TABLE IF NOT EXISTS account_challenges (challenge_id TEXT PRIMARY KEY, challenge TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('passkey-register-signup','passkey-register-attach','passkey-login','phone-login','phone-attach')), user_id TEXT, phone_hash TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_account_challenges_expiry ON account_challenges(expires_at);
CREATE TABLE IF NOT EXISTS passkey_credentials (credential_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES account_users(user_id), public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]', device_type TEXT, backed_up INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_used_at TEXT);
CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user ON passkey_credentials(user_id);
CREATE TABLE IF NOT EXISTS phone_identities (phone_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES account_users(user_id), verified_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_phone_identities_user ON phone_identities(user_id);
CREATE TABLE IF NOT EXISTS phone_otp_limits (phone_hash TEXT PRIMARY KEY, last_sent_at INTEGER NOT NULL);
