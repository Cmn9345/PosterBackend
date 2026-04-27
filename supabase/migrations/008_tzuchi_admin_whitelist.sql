-- Migration: tzuchi_admin_whitelist
-- Date: 2026-04-27
-- Description: 把所有 @tzuchi.org.tw 的使用者預設為「系統管理員」，
--              讓任何用慈濟組織帳號登入的同仁都能直接看到上架審核清單、
--              授權管理等管理員功能。新登入者也會在第一次寫入 public.users
--              時自動取得管理員身份（透過 BEFORE INSERT trigger）。
--
-- 為什麼：原本 public.users.app_role 預設只給 DEFAULT_MEMBERS 名單上 10 人；
--        其他 tzuchi.org.tw 同仁登入後拿到 NULL / 建檔者，被 RLS 擋在審核清單
--        之外。改成 domain 白名單後，任何 tzuchi.org.tw 內部帳號皆可直接使用。

-- ============================================================
-- 1) Backfill：把現有 @tzuchi.org.tw 但還不是系統管理員的列升級
-- ============================================================

UPDATE public.users
   SET app_role = '系統管理員',
       updated_at = NOW()
 WHERE email ILIKE '%@tzuchi.org.tw'
   AND (app_role IS NULL OR app_role <> '系統管理員');

-- ============================================================
-- 2) Trigger：新使用者首次寫入 public.users 時自動補上管理員身份
-- ============================================================

CREATE OR REPLACE FUNCTION public.tzuchi_default_admin_role()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND NEW.email ILIKE '%@tzuchi.org.tw'
     AND (NEW.app_role IS NULL OR NEW.app_role = '建檔者')
  THEN
    NEW.app_role := '系統管理員';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_tzuchi_default_admin_role ON public.users;
CREATE TRIGGER trg_tzuchi_default_admin_role
  BEFORE INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.tzuchi_default_admin_role();

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON FUNCTION public.tzuchi_default_admin_role IS
  'Domain whitelist: 任何 @tzuchi.org.tw 使用者首次寫入 public.users 自動成為系統管理員';
