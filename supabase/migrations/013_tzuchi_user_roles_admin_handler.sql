-- Migration: tzuchi domain → user_roles admin + handler
-- Date: 2026-05-14
-- Description:
--   008 已經把 @tzuchi.org.tw 升級為 public.users.app_role='系統管理員'，但 RLS
--   policies（applications / poster_reviews / 等）走的是另一個 role 系統：
--   public.user_roles + is_admin() / has_role() function（這兩個 function 從
--   user_roles 表 lookup）。所以 app_role 是系統管理員 ≠ user_roles 有 admin row。
--
--   結果：tzuchi 同仁登入後，applications 表的 admins_can_manage_applications +
--   handlers_can_manage_applications policies 永遠擋（is_admin() = false），點
--   申請單審核的「接單處理 / 核可 / 駁回 / 結案」全部 0 rows updated（看 PR debug
--   過程：debug-application-review-rls）。
--
--   本 migration mirror 008 的 trigger pattern，把所有 @tzuchi.org.tw 帳號自動補
--   admin + handler 兩個 user_roles row：
--   1. Backfill 既存 tzuchi 使用者
--   2. AFTER INSERT trigger 處理未來新登入的 tester
--
--   為什麼兩個 role 都給：admins_can_manage / handlers_can_manage 兩條 policy
--   都會用到（admin 可看全部 + 改全部、handler 是承辦者也能改）。給雙重 role
--   讓 tzuchi 同仁不管走 admin 或 handler 流程都過。

-- ============================================================
-- 1) Backfill：把現有 @tzuchi.org.tw 使用者補上 admin + handler role
-- ============================================================

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::user_role
  FROM public.users u
 WHERE u.email ILIKE '%@tzuchi.org.tw'
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'handler'::user_role
  FROM public.users u
 WHERE u.email ILIKE '%@tzuchi.org.tw'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2) Trigger：新使用者首次寫入 public.users 自動拿 admin + handler
-- ============================================================

CREATE OR REPLACE FUNCTION public.tzuchi_default_user_roles()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email ILIKE '%@tzuchi.org.tw' THEN
    INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, 'admin'::user_role)
      ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, 'handler'::user_role)
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_tzuchi_default_user_roles ON public.users;
CREATE TRIGGER trg_tzuchi_default_user_roles
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.tzuchi_default_user_roles();

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON FUNCTION public.tzuchi_default_user_roles IS
  'Domain whitelist: 任何 @tzuchi.org.tw 使用者首次寫入 public.users 自動補上 user_roles {admin, handler}';
