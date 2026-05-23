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

-- Method scope: one shared knowledge feed per week of the 10-week curriculum.
-- Threads persist across cohorts so each new class inherits prior cohorts'
-- questions in their week. Cohort is metadata for attribution
-- (e.g. "day-fall-2025"), not a filter.
ALTER TABLE threads  ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'rt1';
ALTER TABLE threads  ADD COLUMN IF NOT EXISTS cohort TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS cohort TEXT;

-- Update default for fresh column additions and migrate older deployments
-- that used the prior 'rt'/'ut' codes into the new per-week scheme.
ALTER TABLE threads  ALTER COLUMN method SET DEFAULT 'rt1';
UPDATE threads SET method = 'rt1' WHERE method = 'rt';
UPDATE threads SET method = 'ut1' WHERE method = 'ut';

CREATE INDEX IF NOT EXISTS idx_messages_thread          ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_threads_updated          ON threads(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_method_updated   ON threads(method, updated_at DESC);
