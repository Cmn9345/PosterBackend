-- Migration: vocabulary_themes
-- Date: 2026-04-23
-- Description: 建立主題權威表 + 塞入慈濟 12 主題 seed 資料。
--              主題名稱與 posterfrontend (localhost:3000) /themes 頁面、
--              poster-admin-app VLM 分類 (src-tauri/src/services/qwenpaw/analysis.rs)
--              一致,共 12 類:朔源、慈善、醫療、教育、人文、環保、茹素護生、
--              國際賑災、靜思語、大事記、法華坡道、年度主題。

-- ============================================================
-- vocabulary_themes 主題權威表
-- ============================================================
CREATE TABLE IF NOT EXISTS vocabulary_themes (
  id TEXT PRIMARY KEY,                          -- 英文 slug,跟前台 mock-data 一致
  code TEXT UNIQUE NOT NULL,                    -- 同 id,給通用權威表介面用
  name TEXT NOT NULL,                           -- 中文主題名
  description TEXT,
  icon TEXT,                                    -- emoji 圖示
  color TEXT,                                   -- 主色 hex
  bg_color TEXT,                                -- 背景色 hex
  cover_image TEXT,                             -- 代表圖路徑
  sort_order SMALLINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  poster_count INTEGER NOT NULL DEFAULT 0,      -- 冗餘欄位,聚合計算用
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_themes_active_sort
  ON vocabulary_themes(is_active, sort_order);

-- ============================================================
-- Seed: 12 主題 (upsert — 已存在就更新 name/desc/sort_order)
-- ============================================================
INSERT INTO vocabulary_themes
  (id, code, name, description, icon, color, bg_color, cover_image, sort_order) VALUES
  ('origin',        'origin',        '朔源',      '追溯慈濟的起源與發展歷程,見證從竹筒歲月到全球慈善的蛻變之路。',         '🏛️', '#78716c', '#f5f5f4', '/tzu-chi-history-origin-temple.jpg',     1),
  ('charity',       'charity',       '慈善',      '記錄慈濟慈善志業的足跡,從急難救助到長期關懷,展現大愛無疆的精神。',     '❤️', '#dc2626', '#fee2e2', '/charity-helping-hands-giving-love.jpg', 2),
  ('medical',       'medical',       '醫療',      '展現慈濟醫療體系以病為師、守護生命的人文精神與專業服務。',             '🏥', '#2563eb', '#dbeafe', '/medical-healthcare-hospital-service.jpg', 3),
  ('education',     'education',     '教育',      '從幼兒到大學,完整呈現慈濟教育志業的全人教育理念與實踐。',             '📚', '#ca8a04', '#fef9c3', '/education-learning-books-wisdom.jpg',   4),
  ('humanities',    'humanities',    '人文',      '透過大愛電視與人文出版,傳遞善的力量與美的感動,淨化人心。',           '🎭', '#9333ea', '#f3e8ff', '/humanities-culture-arts-traditional.jpg', 5),
  ('environment',   'environment',   '環保',      '從回收到再生,見證慈濟環保志業三十年的綠色奇蹟與永續實踐。',           '🌱', '#16a34a', '#dcfce7', '/environmental-protection-green-nature.jpg', 6),
  ('vegetarian',    'vegetarian',    '茹素護生',  '推廣素食文化與護生理念,以慈悲心對待一切生命,愛護地球。',             '🥬', '#65a30d', '#ecfccb', '/vegetarian-healthy-food-plants.jpg',     7),
  ('international', 'international', '國際賑災',  '記錄慈濟在全球各地的人道援助足跡,展現跨越國界的大愛精神。',           '🌍', '#0284c7', '#e0f2fe', '/international-disaster-relief-aid.jpg',  8),
  ('jingsi',        'jingsi',        '靜思語',    '收錄證嚴上人的智慧法語,以簡潔文字傳遞深刻人生哲理。',                 '🪷', '#0891b2', '#cffafe', '/lotus-zen-peaceful-wisdom-quotes.jpg',   9),
  ('events',        'events',        '大事記',    '記錄慈濟發展歷程中的重要里程碑與關鍵時刻。',                         '📅', '#ea580c', '#ffedd5', '/calendar-milestone-events-timeline.jpg', 10),
  ('lotus',         'lotus',         '法華坡道',  '以《法華經》為依歸,展現慈濟的宗教精神與修行理念。',                   '☸️', '#7c3aed', '#ede9fe', '/buddhist-dharma-wheel-lotus-sutra.jpg',  11),
  ('annual',        'annual',        '年度主題',  '每年度的重點推動主題,凝聚全球慈濟人的共同願力與行動。',               '🎯', '#be185d', '#fce7f3', '/annual-theme-target-focus-goal.jpg',     12)
ON CONFLICT (id) DO UPDATE SET
  name         = EXCLUDED.name,
  description  = EXCLUDED.description,
  icon         = EXCLUDED.icon,
  color        = EXCLUDED.color,
  bg_color     = EXCLUDED.bg_color,
  cover_image  = EXCLUDED.cover_image,
  sort_order   = EXCLUDED.sort_order,
  updated_at   = NOW();

-- ============================================================
-- RLS:公開讀取,僅 service_role 寫入
-- ============================================================
ALTER TABLE vocabulary_themes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vocabulary_themes public read" ON vocabulary_themes;
CREATE POLICY "vocabulary_themes public read"
  ON vocabulary_themes FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "vocabulary_themes service write" ON vocabulary_themes;
CREATE POLICY "vocabulary_themes service write"
  ON vocabulary_themes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
