-- Durable, owner-scoped conversation history. Never store raw audio/video or live socket state here.
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES account_users(user_id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 4000),
  task_progress_json TEXT NOT NULL DEFAULT '{}'
    CHECK (length(task_progress_json) <= 12000 AND json_valid(task_progress_json) AND json_type(task_progress_json) = 'object'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  next_turn_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_turn_sequence >= 1),
  UNIQUE (conversation_id, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_owner_activity
  ON conversations(owner_id, status, last_activity_at DESC, conversation_id DESC);

CREATE TABLE IF NOT EXISTS conversation_turns (
  turn_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 20000),
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, owner_id, sequence),
  UNIQUE (conversation_id, owner_id, idempotency_key),
  FOREIGN KEY (conversation_id, owner_id)
    REFERENCES conversations(conversation_id, owner_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_turns_owner_order
  ON conversation_turns(owner_id, conversation_id, sequence);
