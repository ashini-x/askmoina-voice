-- AskMoina Wealth: user-scoped historical paper-investment simulations.
-- No brokerage credentials, live orders, actual holdings, or financial-account data are stored here.
CREATE TABLE IF NOT EXISTS wealth_simulations (
  simulation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES account_users(user_id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  simulation_type TEXT NOT NULL CHECK(simulation_type = 'paper_sip'),
  created_at TEXT NOT NULL,
  as_of_date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wealth_simulations_user_created
  ON wealth_simulations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wealth_sip_plans (
  plan_id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES wealth_simulations(simulation_id) ON DELETE CASCADE,
  scheme_code INTEGER NOT NULL CHECK(scheme_code > 0),
  scheme_name TEXT NOT NULL,
  monthly_amount_paise INTEGER NOT NULL CHECK(monthly_amount_paise >= 10000),
  sip_day INTEGER NOT NULL CHECK(sip_day BETWEEN 1 AND 28),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(start_date <= end_date)
);
CREATE INDEX IF NOT EXISTS idx_wealth_sip_plans_simulation
  ON wealth_sip_plans(simulation_id);

CREATE TABLE IF NOT EXISTS wealth_sip_purchases (
  purchase_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES wealth_sip_plans(plan_id) ON DELETE CASCADE,
  scheduled_date TEXT NOT NULL,
  nav_date TEXT NOT NULL,
  invested_paise INTEGER NOT NULL CHECK(invested_paise > 0),
  nav REAL NOT NULL CHECK(nav > 0),
  units REAL NOT NULL CHECK(units > 0),
  UNIQUE(plan_id, scheduled_date)
);
CREATE INDEX IF NOT EXISTS idx_wealth_sip_purchases_plan_date
  ON wealth_sip_purchases(plan_id, scheduled_date);
