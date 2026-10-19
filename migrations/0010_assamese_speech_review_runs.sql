-- M1: store native-speaker acceptance scores only; never store captured audio or transcripts.
CREATE TABLE IF NOT EXISTS assamese_speech_review_runs (
  review_id TEXT PRIMARY KEY CHECK (length(trim(review_id)) BETWEEN 3 AND 100),
  evaluation_date TEXT NOT NULL CHECK (length(evaluation_date) = 10),
  evaluator_code TEXT NOT NULL CHECK (length(trim(evaluator_code)) BETWEEN 3 AND 80),
  suite_version TEXT NOT NULL CHECK (length(trim(suite_version)) BETWEEN 1 AND 40),
  completed_cases INTEGER NOT NULL CHECK (completed_cases BETWEEN 0 AND 15),
  total_cases INTEGER NOT NULL DEFAULT 15 CHECK (total_cases = 15),
  overall_percent INTEGER CHECK (overall_percent IS NULL OR overall_percent BETWEEN 0 AND 100),
  dimensions_json TEXT NOT NULL CHECK (length(dimensions_json) <= 4000),
  critical_failure_count INTEGER NOT NULL CHECK (critical_failure_count >= 0),
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  results_json TEXT NOT NULL CHECK (length(results_json) <= 30000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assamese_speech_review_runs_created
  ON assamese_speech_review_runs(created_at DESC);

