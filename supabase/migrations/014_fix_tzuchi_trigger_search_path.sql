-- Migration: fix tzuchi trigger SECURITY DEFINER search_path
-- Date: 2026-05-18
-- Description:
--   008 / 013 兩條 trigger function 都是 SECURITY DEFINER 但沒設 search_path。
--   plpgsql 在執行 type cast（例如 'admin'::user_role）時用的是函式自身的
--   search_path，不是呼叫端的。沒設 → 預設只看得到 pg_catalog → 找不到
--   public.user_role → 42704。
--
--   現象：tzuchi 同仁第一次 Google OAuth 登入，GoTrue 回
--     500: Database error saving new user
--   GoTrue log：
--     ERROR: type "user_role" does not exist (SQLSTATE 42704)
--   走的鏈：auth.users INSERT → (auth.users mirror trigger) →
--           public.users INSERT → trg_tzuchi_default_user_roles fires →
--           'admin'::user_role cast fails → 整個 tx rollback。
--
--   修法：給兩條 function 都加 SET search_path = public, pg_temp。同時
--   把 013 body 內的 type cast 加 schema 前綴當 belt-and-suspenders，
--   未來誰再改 search_path 也不會壞。

-- ============================================================
-- 1) Pin search_path on the two existing trigger functions
-- ============================================================

ALTER FUNCTION public.tzuchi_default_user_roles() SET search_path = public, pg_temp;
ALTER FUNCTION public.tzuchi_default_admin_role()  SET search_path = public, pg_temp;

-- ============================================================
-- 2) Rewrite 013's function with schema-qualified type cast
--    (defensive — survives anyone resetting search_path later)
-- ============================================================

CREATE OR REPLACE FUNCTION public.tzuchi_default_user_roles()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email ILIKE '%@tzuchi.org.tw' THEN
    INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, 'admin'::public.user_role)
      ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, 'handler'::public.user_role)
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.tzuchi_default_user_roles IS
  'Domain whitelist: 任何 @tzuchi.org.tw 使用者首次寫入 public.users 自動補上 user_roles {admin, handler}. search_path 鎖 public + type cast 加前綴避免 42704.';
