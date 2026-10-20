CREATE TABLE IF NOT EXISTS gyanshala_users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email_verified_at TEXT NOT NULL,
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
  email_code_hash TEXT NOT NULL,
  email_expires_at TEXT NOT NULL,
  email_verified_at TEXT,
  email_sent_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gyanshala_challenges_email
  ON gyanshala_signup_challenges(email, created_at);

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


CREATE TABLE IF NOT EXISTS gyanshala_resources (
  resource_id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES gyanshala_users(user_id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  item_condition TEXT NOT NULL DEFAULT 'Good',
  lending_type TEXT NOT NULL DEFAULT 'lend' CHECK (lending_type IN ('lend','sell','free')),
  price_amount INTEGER NOT NULL DEFAULT 0 CHECK (price_amount >= 0),
  pickup_location TEXT NOT NULL,
  distance_label TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL,
  owner_branch TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '📦',
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','unavailable','removed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gyanshala_resources_browse
  ON gyanshala_resources(status, category, created_at);

CREATE TABLE IF NOT EXISTS gyanshala_resource_requests (
  request_id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES gyanshala_resources(resource_id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES gyanshala_users(user_id) ON DELETE CASCADE,
  owner_id TEXT REFERENCES gyanshala_users(user_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','active','completed','cancelled')),
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(resource_id, requester_id)
);

CREATE INDEX IF NOT EXISTS idx_gyanshala_requests_requester
  ON gyanshala_resource_requests(requester_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_gyanshala_requests_owner
  ON gyanshala_resource_requests(owner_id, status, created_at);


CREATE TABLE IF NOT EXISTS gyanshala_messages (
  message_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES gyanshala_resource_requests(request_id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES gyanshala_users(user_id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES gyanshala_users(user_id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1200),
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gyanshala_messages_thread
  ON gyanshala_messages(request_id, created_at);

CREATE INDEX IF NOT EXISTS idx_gyanshala_messages_recipient
  ON gyanshala_messages(recipient_id, read_at, created_at);


CREATE TABLE IF NOT EXISTS gyanshala_pickup_points (
  pickup_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  area TEXT NOT NULL,
  description TEXT NOT NULL,
  map_x INTEGER NOT NULL CHECK (map_x BETWEEN 5 AND 95),
  map_y INTEGER NOT NULL CHECK (map_y BETWEEN 5 AND 95),
  latitude REAL NOT NULL DEFAULT 24.7551,
  longitude REAL NOT NULL DEFAULT 92.78682,
  coordinate_source TEXT NOT NULL DEFAULT 'OpenStreetMap',
  walk_minutes INTEGER NOT NULL DEFAULT 5 CHECK (walk_minutes BETWEEN 1 AND 60),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gyanshala_community_posts (
  post_id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES gyanshala_users(user_id) ON DELETE SET NULL,
  post_type TEXT NOT NULL CHECK (post_type IN ('offer','need')),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  pickup_location TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL,
  owner_branch TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','fulfilled','removed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gyanshala_community_posts
  ON gyanshala_community_posts(status, post_type, created_at);

CREATE INDEX IF NOT EXISTS idx_gyanshala_community_owner
  ON gyanshala_community_posts(owner_id, status, created_at);

CREATE TABLE IF NOT EXISTS gyanshala_community_interests (
  post_id TEXT NOT NULL REFERENCES gyanshala_community_posts(post_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES gyanshala_users(user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_gyanshala_community_interests_user
  ON gyanshala_community_interests(user_id, created_at);
