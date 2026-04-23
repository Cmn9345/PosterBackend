-- Migration: Add missing columns to applications table
-- Created at: 2026-01-22

-- 新增缺少的欄位（如果不存在）
ALTER TABLE applications ADD COLUMN IF NOT EXISTS project_name TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS theme_id TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS exhibition_date_mode TEXT DEFAULT 'single';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS exhibition_date_start DATE;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS exhibition_date_end DATE;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS location_org TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS location_general TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS location_other TEXT;

-- 將現有資料的 exhibition_date 複製到 exhibition_date_start
UPDATE applications
SET exhibition_date_start = exhibition_date
WHERE exhibition_date_start IS NULL AND exhibition_date IS NOT NULL;

-- 將現有資料的 exhibition_location 複製到 location_other
UPDATE applications
SET location_other = exhibition_location
WHERE location_other IS NULL AND exhibition_location IS NOT NULL;
