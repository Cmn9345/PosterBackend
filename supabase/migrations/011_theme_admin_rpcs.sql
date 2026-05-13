-- Migration: theme admin RPCs (rename + delete with cascade)
-- Date: 2026-05-13
-- Description:
--   vocabulary_themes.name 是真正的 join key（poster_files.themes text[] 直接
--   存 name 字串）。Admin 想 rename 或 delete 必須同步更新 poster_files
--   陣列才不會出現孤兒歸類。本 migration 提供兩支 SECURITY DEFINER 函式：
--     - admin_rename_theme: 改任意欄位 + 若 name 變動 → cascade array_replace
--     - admin_delete_theme: array_remove from poster_files → DELETE row
--   兩支都先檢查呼叫者 app_role='系統管理員'，未授權回 42501。

-- ============================================================
-- 1) admin_rename_theme
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_rename_theme(uuid, text, text, text, text, text, text, text, int, bool);

CREATE FUNCTION public.admin_rename_theme(
  p_id uuid,
  p_new_name text,
  p_code text DEFAULT NULL,
  p_icon text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_bg_color text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_cover_image text DEFAULT NULL,
  p_sort_order int DEFAULT NULL,
  p_is_active bool DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_name text;
BEGIN
  IF (SELECT app_role FROM public.users WHERE id = auth.uid()) != '系統管理員' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_new_name IS NULL OR length(trim(p_new_name)) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '23514';
  END IF;

  SELECT name INTO old_name FROM public.vocabulary_themes WHERE id = p_id;
  IF old_name IS NULL THEN
    RAISE EXCEPTION 'theme not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.vocabulary_themes
  SET name        = p_new_name,
      code        = COALESCE(p_code,        code),
      icon        = COALESCE(p_icon,        icon),
      color       = COALESCE(p_color,       color),
      bg_color    = COALESCE(p_bg_color,    bg_color),
      description = COALESCE(p_description, description),
      cover_image = COALESCE(p_cover_image, cover_image),
      sort_order  = COALESCE(p_sort_order,  sort_order),
      is_active   = COALESCE(p_is_active,   is_active),
      updated_at  = NOW()
  WHERE id = p_id;

  IF old_name IS DISTINCT FROM p_new_name THEN
    UPDATE public.poster_files
    SET themes = array_replace(themes, old_name, p_new_name)
    WHERE old_name = ANY(themes);
  END IF;
END
$$;

COMMENT ON FUNCTION public.admin_rename_theme IS
  '⚠️ 重跑 migration 006 會把改過名的主題（用舊 seed name）重新塞回，造成同義雙列。Admin 改名後請勿重跑 006。';

GRANT EXECUTE ON FUNCTION public.admin_rename_theme(uuid, text, text, text, text, text, text, text, int, bool) TO authenticated;

-- ============================================================
-- 2) admin_delete_theme
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_delete_theme(uuid);

CREATE FUNCTION public.admin_delete_theme(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  theme_name text;
BEGIN
  IF (SELECT app_role FROM public.users WHERE id = auth.uid()) != '系統管理員' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- 保護：至少要保留 1 個 active theme，否則 VLM prompt 會空，分析會壞
  IF (SELECT COUNT(*) FROM public.vocabulary_themes WHERE is_active = true) <= 1 THEN
    RAISE EXCEPTION 'cannot delete last active theme' USING ERRCODE = '23514';
  END IF;

  SELECT name INTO theme_name FROM public.vocabulary_themes WHERE id = p_id;
  IF theme_name IS NULL THEN
    RAISE EXCEPTION 'theme not found' USING ERRCODE = 'P0002';
  END IF;

  -- Strip orphan references first; the FK doesn't exist on themes[] so we
  -- handle ref integrity manually inside the same transaction.
  UPDATE public.poster_files
  SET themes = array_remove(themes, theme_name)
  WHERE theme_name = ANY(themes);

  DELETE FROM public.vocabulary_themes WHERE id = p_id;
END
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_theme(uuid) TO authenticated;
