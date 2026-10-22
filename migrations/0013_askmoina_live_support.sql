-- Anonymous live presence and verified AskMoina support totals.
-- These tables never store IP addresses, page content, voice audio, or transcripts.
CREATE TABLE IF NOT EXISTS askmoina_public_presence (
  visitor_token TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_askmoina_public_presence_last_seen
  ON askmoina_public_presence(last_seen_at);

-- Only contributions verified by an administrator are included in the public total.
CREATE TABLE IF NOT EXISTS askmoina_support_donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_reference TEXT NOT NULL UNIQUE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  donor_label TEXT,
  verified_at INTEGER NOT NULL,
  verified_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_askmoina_support_donations_verified_at
  ON askmoina_support_donations(verified_at);
