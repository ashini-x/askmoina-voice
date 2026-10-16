-- Account-owned interaction preferences used by every future AskMoina session.
-- Raw audio/video and sensitive credentials are never stored in this table.
CREATE TABLE IF NOT EXISTS user_memory_settings (
  owner_id TEXT PRIMARY KEY REFERENCES account_users(user_id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_memories (
  memory_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES account_users(user_id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'preference'
    CHECK (kind IN ('communication', 'language', 'accessibility', 'interest', 'preference')),
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 2 AND 240),
  preference_key TEXT NOT NULL CHECK (length(trim(preference_key)) BETWEEN 2 AND 240),
  source TEXT NOT NULL DEFAULT 'automatic' CHECK (source IN ('automatic', 'manual')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, preference_key)
);

CREATE INDEX IF NOT EXISTS idx_user_memories_owner_updated
  ON user_memories(owner_id, updated_at DESC, memory_id);
