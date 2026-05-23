-- NDT Tutor — shared classroom feed schema.
-- Idempotent: safe to run on every server start.

CREATE TABLE IF NOT EXISTS threads (
  id          SERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  asker_name  TEXT,                          -- NULL = anonymous
  title       TEXT NOT NULL                  -- first question, truncated client-side
);

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  thread_id   INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  author_name TEXT,                          -- NULL for assistant or anonymous user
  content     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_thread     ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_threads_updated     ON threads(updated_at DESC);
