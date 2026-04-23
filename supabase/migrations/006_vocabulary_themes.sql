-- Migration: vocabulary_themes
-- Date: 2026-04-23
-- Description: 相容現有 production 表(id UUID, name NOT NULL) — 補缺欄位 +
--              upsert 慈濟 12 主題 seed。主題名稱與 posterfrontend
--              (localhost:3000) /themes 頁面、poster-admin-app VLM 分類
--              (src-tauri/src/services/qwenpaw/analysis.rs) 完全一致。
--
-- 注意:若 vocabulary_themes 表不存在,此 migration 假設有人手動建過
-- 基本 schema (id UUID, name varchar NOT NULL, description text,
-- sort_order int, is_active bool, created_at/updated_at)。若真的從零
-- 開始,請先跑原本的 CREATE TABLE (已移除,以免誤蓋 production)。

-- ============================================================
-- 補缺欄位(IF NOT EXISTS,可重跑)
-- ============================================================
ALTER TABLE vocabulary_themes ADD COLUMN IF NOT EXISTS code         TEXT;
ALTER TABLE vocabulary_themes ADD COLUMN IF NOT EXISTS icon         TEXT;
ALTER TABLE vocabulary_themes ADD COLUMN IF NOT EXISTS color        TEXT;
ALTER TABLE vocabulary_themes ADD COLUMN IF NOT EXISTS bg_color     TEXT;
ALTER TABLE vocabulary_themes ADD COLUMN IF NOT EXISTS cover_image  TEXT;
ALTER TABLE vocabulary_themes ADD COLUMN IF NOT EXISTS poster_count INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 確保 name 有 UNIQUE(用 UNIQUE INDEX,ON CONFLICT 也吃)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS vocabulary_themes_name_key
  ON vocabulary_themes(name);

-- ============================================================
-- 12 主題 seed (upsert by name)
-- ============================================================
INSERT INTO vocabulary_themes
  (id, name, code, description, icon, color, bg_color, cover_image, sort_order, is_active) VALUES
  (gen_random_uuid(), '朔源',      'origin',        '追溯慈濟的起源與發展歷程,見證從竹筒歲月到全球慈善的蛻變之路。',         '🏛️', '#78716c', '#f5f5f4', '/tzu-chi-history-origin-temple.jpg',         1, true),
  (gen_random_uuid(), '慈善',      'charity',       '記錄慈濟慈善志業的足跡,從急難救助到長期關懷,展現大愛無疆的精神。',     '❤️', '#dc2626', '#fee2e2', '/charity-helping-hands-giving-love.jpg',     2, true),
  (gen_random_uuid(), '醫療',      'medical',       '展現慈濟醫療體系以病為師、守護生命的人文精神與專業服務。',             '🏥', '#2563eb', '#dbeafe', '/medical-healthcare-hospital-service.jpg',   3, true),
  (gen_random_uuid(), '教育',      'education',     '從幼兒到大學,完整呈現慈濟教育志業的全人教育理念與實踐。',             '📚', '#ca8a04', '#fef9c3', '/education-learning-books-wisdom.jpg',       4, true),
  (gen_random_uuid(), '人文',      'humanities',    '透過大愛電視與人文出版,傳遞善的力量與美的感動,淨化人心。',           '🎭', '#9333ea', '#f3e8ff', '/humanities-culture-arts-traditional.jpg',   5, true),
  (gen_random_uuid(), '環保',      'environment',   '從回收到再生,見證慈濟環保志業三十年的綠色奇蹟與永續實踐。',           '🌱', '#16a34a', '#dcfce7', '/environmental-protection-green-nature.jpg', 6, true),
  (gen_random_uuid(), '茹素護生',  'vegetarian',    '推廣素食文化與護生理念,以慈悲心對待一切生命,愛護地球。',             '🥬', '#65a30d', '#ecfccb', '/vegetarian-healthy-food-plants.jpg',         7, true),
  (gen_random_uuid(), '國際賑災',  'international', '記錄慈濟在全球各地的人道援助足跡,展現跨越國界的大愛精神。',           '🌍', '#0284c7', '#e0f2fe', '/international-disaster-relief-aid.jpg',      8, true),
  (gen_random_uuid(), '靜思語',    'jingsi',        '收錄證嚴上人的智慧法語,以簡潔文字傳遞深刻人生哲理。',                 '🪷', '#0891b2', '#cffafe', '/lotus-zen-peaceful-wisdom-quotes.jpg',       9, true),
  (gen_random_uuid(), '大事記',    'events',        '記錄慈濟發展歷程中的重要里程碑與關鍵時刻。',                         '📅', '#ea580c', '#ffedd5', '/calendar-milestone-events-timeline.jpg',    10, true),
  (gen_random_uuid(), '法華坡道',  'lotus',         '以《法華經》為依歸,展現慈濟的宗教精神與修行理念。',                   '☸️', '#7c3aed', '#ede9fe', '/buddhist-dharma-wheel-lotus-sutra.jpg',     11, true),
  (gen_random_uuid(), '年度主題',  'annual',        '每年度的重點推動主題,凝聚全球慈濟人的共同願力與行動。',               '🎯', '#be185d', '#fce7f3', '/annual-theme-target-focus-goal.jpg',        12, true)
ON CONFLICT (name) DO UPDATE SET
  code        = EXCLUDED.code,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon,
  color       = EXCLUDED.color,
  bg_color    = EXCLUDED.bg_color,
  cover_image = EXCLUDED.cover_image,
  sort_order  = EXCLUDED.sort_order,
  is_active   = true,
  updated_at  = NOW();

-- ============================================================
-- RLS:開放公開讀取(匿名使用者也能撈主題清單;前台 /api/themes 需要)
-- 若之前表已啟用 RLS 但沒有 policy,讀取會全部被擋。
-- ============================================================
ALTER TABLE vocabulary_themes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vocabulary_themes public read" ON vocabulary_themes;
CREATE POLICY "vocabulary_themes public read"
  ON vocabulary_themes FOR SELECT
  USING (is_active = true);
