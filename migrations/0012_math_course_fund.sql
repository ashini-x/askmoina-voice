-- The public Math course goal reflects only donations confirmed by an administrator.
CREATE TABLE IF NOT EXISTS math_course_donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_reference TEXT NOT NULL UNIQUE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  donor_label TEXT,
  verified_at INTEGER NOT NULL,
  verified_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_math_course_donations_verified_at
  ON math_course_donations(verified_at);
