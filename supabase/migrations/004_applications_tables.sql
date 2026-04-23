-- Migration: Create application related tables
-- Created at: 2026-01-22
-- Description: 新增 application_posters 和 application_timeline 表
-- 注意：使用現有的 applications 表，不做任何修改

-- ============================================
-- 1. 清理（僅清理新建的表）
-- ============================================
DROP POLICY IF EXISTS "Allow public read on application_posters" ON application_posters;
DROP POLICY IF EXISTS "Allow public insert on application_posters" ON application_posters;
DROP POLICY IF EXISTS "Allow public read on application_timeline" ON application_timeline;
DROP POLICY IF EXISTS "Allow public insert on application_timeline" ON application_timeline;
DROP POLICY IF EXISTS "Allow public update on application_timeline" ON application_timeline;

DROP TABLE IF EXISTS application_timeline;
DROP TABLE IF EXISTS application_posters;

-- ============================================
-- 2. application_posters table (申請-海報關聯表)
-- ============================================
CREATE TABLE application_posters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  poster_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(application_id, poster_id)
);

CREATE INDEX idx_application_posters_application_id ON application_posters(application_id);
CREATE INDEX idx_application_posters_poster_id ON application_posters(poster_id);

-- ============================================
-- 3. application_timeline table (申請進度追蹤表)
-- ============================================
CREATE TABLE application_timeline (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  step_order INT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_application_timeline_application_id ON application_timeline(application_id);

-- ============================================
-- 4. RLS Policies
-- ============================================
ALTER TABLE application_posters ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on application_posters" ON application_posters
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert on application_posters" ON application_posters
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read on application_timeline" ON application_timeline
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert on application_timeline" ON application_timeline
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on application_timeline" ON application_timeline
  FOR UPDATE USING (true);

-- ============================================
-- 5. 註解
-- ============================================
COMMENT ON TABLE application_posters IS '申請與海報的關聯表';
COMMENT ON TABLE application_timeline IS '申請進度追蹤表';
