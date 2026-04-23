-- Migration: user_sessions
-- Date: 2026-04-14
-- Description: Track login source (desktop_app vs web) per user session.

-- ============================================================
-- user_sessions: Record each login with client type
-- ============================================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_type TEXT NOT NULL CHECK (client_type IN ('desktop_app', 'web')),
  client_version TEXT,
  user_agent TEXT,
  logged_in_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================

-- Fast lookup: latest session per user
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id_logged_in
  ON user_sessions (user_id, logged_in_at DESC);

-- Stats: sessions by client type
CREATE INDEX IF NOT EXISTS idx_user_sessions_client_type
  ON user_sessions (client_type);

-- ============================================================
-- RLS: Users can only see/insert their own sessions
-- ============================================================

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions"
  ON user_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
  ON user_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON TABLE user_sessions IS 'Tracks login events with client type (desktop_app or web)';
COMMENT ON COLUMN user_sessions.client_type IS 'Login source: desktop_app (Tauri) or web (Next.js)';
COMMENT ON COLUMN user_sessions.client_version IS 'App version, e.g. 0.1.0 from Cargo.toml or package.json';
