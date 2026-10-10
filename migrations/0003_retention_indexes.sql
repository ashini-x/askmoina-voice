-- Supports bounded cleanup of expired pseudonymous admin login attempt records.
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_updated_at
  ON admin_login_attempts(updated_at);
