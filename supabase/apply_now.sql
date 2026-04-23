-- ============================================================
-- 一次性套用:003_user_profiles + 006_vocabulary_themes
-- 產生時間:2026-04-23
-- 確認現況:
--   ✅ user_sessions 已存在(002 已套用)
--   ❌ user_profiles 缺 → 003 需補
--   ✅ application_posters / application_timeline 存在(004 已套用)
--   ✅ applications.theme_id 存在(005 已套用)
--   待新建 vocabulary_themes(006)
--   poster_files.themes 無「骨髓捐贈/歲末祝福/浴佛節」→ 007 跳過
--
-- 本檔已把 003 和 006 合併,可直接貼到 Supabase Studio SQL Editor 執行。
-- 兩段中間留 section 分隔,執行失敗請從失敗段往下重跑。
-- ============================================================


-- ============================================================
-- ============  003: user_profiles (onboarding)  =============
-- ============================================================

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Step 1: Personal info
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  birth_year SMALLINT NOT NULL CHECK (birth_year BETWEEN 1900 AND 2100),
  birth_month SMALLINT NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
  birth_day SMALLINT NOT NULL CHECK (birth_day BETWEEN 1 AND 31),
  gender TEXT NOT NULL CHECK (gender IN ('男', '女')),
  phone TEXT NOT NULL,
  phone_country_code TEXT NOT NULL DEFAULT '+886',
  phone_verified_at TIMESTAMPTZ DEFAULT NULL,

  -- Step 2: Tzu Chi organization
  role_type TEXT NOT NULL CHECK (role_type IN (
    '真善美志工', '慈濟志工', '職工', '其它志業體同仁'
  )),
  continent TEXT,
  country TEXT,
  hexin_area TEXT,
  heqi_area TEXT,

  -- Step 3: Copyright agreement
  copyright_agreed_at TIMESTAMPTZ NOT NULL,

  -- Lifecycle
  onboarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role_type
  ON user_profiles (role_type);

CREATE INDEX IF NOT EXISTS idx_user_profiles_hexin_heqi
  ON user_profiles (hexin_area, heqi_area);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE user_profiles IS 'Onboarding profile per user';
COMMENT ON COLUMN user_profiles.phone_verified_at IS 'Set when OTP is verified (phase 2)';
COMMENT ON COLUMN user_profiles.onboarded_at IS 'When all 3 onboarding steps completed';


-- ============================================================
-- ==========  006: vocabulary_themes + 12 主題 seed ==========
-- ============================================================

CREATE TABLE IF NOT EXISTS vocabulary_themes (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  bg_color TEXT,
  cover_image TEXT,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  poster_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_themes_active_sort
  ON vocabulary_themes(is_active, sort_order);

INSERT INTO vocabulary_themes
  (id, code, name, description, icon, color, bg_color, cover_image, sort_order) VALUES
  ('origin',        'origin',        '朔源',      '追溯慈濟的起源與發展歷程,見證從竹筒歲月到全球慈善的蛻變之路。',         '🏛️', '#78716c', '#f5f5f4', '/tzu-chi-history-origin-temple.jpg',         1),
  ('charity',       'charity',       '慈善',      '記錄慈濟慈善志業的足跡,從急難救助到長期關懷,展現大愛無疆的精神。',     '❤️', '#dc2626', '#fee2e2', '/charity-helping-hands-giving-love.jpg',     2),
  ('medical',       'medical',       '醫療',      '展現慈濟醫療體系以病為師、守護生命的人文精神與專業服務。',             '🏥', '#2563eb', '#dbeafe', '/medical-healthcare-hospital-service.jpg',   3),
  ('education',     'education',     '教育',      '從幼兒到大學,完整呈現慈濟教育志業的全人教育理念與實踐。',             '📚', '#ca8a04', '#fef9c3', '/education-learning-books-wisdom.jpg',       4),
  ('humanities',    'humanities',    '人文',      '透過大愛電視與人文出版,傳遞善的力量與美的感動,淨化人心。',           '🎭', '#9333ea', '#f3e8ff', '/humanities-culture-arts-traditional.jpg',   5),
  ('environment',   'environment',   '環保',      '從回收到再生,見證慈濟環保志業三十年的綠色奇蹟與永續實踐。',           '🌱', '#16a34a', '#dcfce7', '/environmental-protection-green-nature.jpg', 6),
  ('vegetarian',    'vegetarian',    '茹素護生',  '推廣素食文化與護生理念,以慈悲心對待一切生命,愛護地球。',             '🥬', '#65a30d', '#ecfccb', '/vegetarian-healthy-food-plants.jpg',         7),
  ('international', 'international', '國際賑災',  '記錄慈濟在全球各地的人道援助足跡,展現跨越國界的大愛精神。',           '🌍', '#0284c7', '#e0f2fe', '/international-disaster-relief-aid.jpg',      8),
  ('jingsi',        'jingsi',        '靜思語',    '收錄證嚴上人的智慧法語,以簡潔文字傳遞深刻人生哲理。',                 '🪷', '#0891b2', '#cffafe', '/lotus-zen-peaceful-wisdom-quotes.jpg',       9),
  ('events',        'events',        '大事記',    '記錄慈濟發展歷程中的重要里程碑與關鍵時刻。',                         '📅', '#ea580c', '#ffedd5', '/calendar-milestone-events-timeline.jpg',    10),
  ('lotus',         'lotus',         '法華坡道',  '以《法華經》為依歸,展現慈濟的宗教精神與修行理念。',                   '☸️', '#7c3aed', '#ede9fe', '/buddhist-dharma-wheel-lotus-sutra.jpg',     11),
  ('annual',        'annual',        '年度主題',  '每年度的重點推動主題,凝聚全球慈濟人的共同願力與行動。',               '🎯', '#be185d', '#fce7f3', '/annual-theme-target-focus-goal.jpg',        12)
ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon,
  color       = EXCLUDED.color,
  bg_color    = EXCLUDED.bg_color,
  cover_image = EXCLUDED.cover_image,
  sort_order  = EXCLUDED.sort_order,
  updated_at  = NOW();

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


-- ============================================================
-- 驗證:跑完看這兩筆是否對得上
-- ============================================================

-- 應該回一筆
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema='public' AND table_name='user_profiles';

-- 應該回 12 筆
-- SELECT id, name, icon FROM vocabulary_themes ORDER BY sort_order;
