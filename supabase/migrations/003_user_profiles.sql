-- Migration: user_profiles
-- Date: 2026-04-20
-- Description: Store volunteer/staff onboarding profile — personal info, tzuchi organization,
--              copyright agreement. Required to complete before accessing main app.

-- ============================================================
-- user_profiles: One row per auth.users entry, created after onboarding
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
  phone_verified_at TIMESTAMPTZ DEFAULT NULL,  -- Phase 2: filled after OTP

  -- Step 2: Tzu Chi organization
  role_type TEXT NOT NULL CHECK (role_type IN (
    '真善美志工', '慈濟志工', '職工', '其它志業體同仁'
  )),
  continent TEXT,              -- 洲/本會
  country TEXT,                -- 國家/地區
  hexin_area TEXT,             -- 合心區
  heqi_area TEXT,              -- 和氣區

  -- Step 3: Copyright agreement
  copyright_agreed_at TIMESTAMPTZ NOT NULL,

  -- Lifecycle
  onboarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_user_profiles_role_type
  ON user_profiles (role_type);

CREATE INDEX IF NOT EXISTS idx_user_profiles_hexin_heqi
  ON user_profiles (hexin_area, heqi_area);

-- ============================================================
-- RLS: Users can view/update their own profile
-- ============================================================

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

-- ============================================================
-- updated_at auto-update trigger
-- ============================================================

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

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON TABLE user_profiles IS 'Onboarding profile per user — required before accessing main app';
COMMENT ON COLUMN user_profiles.phone_verified_at IS 'Set when OTP is verified (phase 2)';
COMMENT ON COLUMN user_profiles.onboarded_at IS 'When all 3 onboarding steps completed';
