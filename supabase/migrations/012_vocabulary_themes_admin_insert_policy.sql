-- Migration: vocabulary_themes admin INSERT policy
-- Date: 2026-05-13
-- Description:
--   006 開了 RLS 但只設了 public SELECT policy（is_active=true）。INSERT/UPDATE/DELETE
--   都被擋。011 補了 admin_rename_theme + admin_delete_theme 兩支 SECURITY DEFINER RPC
--   繞過 RLS 處理 UPDATE/DELETE 的 cascade 邏輯。
--
--   但 create_vocabulary_theme 走的是直接 PostgREST INSERT（不是 RPC），跑時撞 RLS
--   42501。本 migration 補上 INSERT policy 只開給 app_role='系統管理員' 的 user。
--
--   UPDATE/DELETE 故意不開 policy，強制走帶 cascade 的 RPC。

DROP POLICY IF EXISTS "vocabulary_themes admin insert" ON public.vocabulary_themes;

CREATE POLICY "vocabulary_themes admin insert"
  ON public.vocabulary_themes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT app_role FROM public.users WHERE id = auth.uid()) = '系統管理員'
  );
