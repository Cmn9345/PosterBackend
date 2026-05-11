-- Migration: exhibitions (修正版 v2)
-- Date: 2026-05-12
-- Description: 對應 production 既有 schema:
--   public.exhibitions (id, name, cover_image_path, description, status,
--                       sort_order, created_at, updated_at)
--   public.exhibition_status enum: planning / ongoing / finished
--
-- 本支只做 **可加值的部分**，不動既有欄位也不動既有資料：
--   1) 回滾 v1 migration 可能留下的半套副作用（RLS 開了但沒 policy / 多餘 index）
--   2) updated_at 自動 trigger
--   3) 補有用的 index（依 status, sort_order 排序）
--   4) RLS 上鎖：前台讀 ongoing+finished，admin（系統管理員）可讀寫所有 status
--
-- 為什麼：v1 假設了 cover_text/cover_gradient/poster_count/creator_id 與
--        draft/published enum，跟 production schema 不一致；
--        執行到 policy 時撞上 enum 不認得 'published' 而中斷。
--
-- 連動點：
--   - 前端：src/routes/exhibition-structure.tsx（展覽管理頁）
--   - Rust：src-tauri/src/services/supabase.rs::{insert,update,delete}_exhibition
--   - Tauri commands：src-tauri/src/lib.rs (create/patch/delete_exhibition)

-- ============================================================
-- 1) 回滾 v1 可能留下的副作用
-- ============================================================

-- 先關 RLS 再清 policy，避免目前讀取被擋住
ALTER TABLE public.exhibitions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exhibitions read published"   ON public.exhibitions;
DROP POLICY IF EXISTS "exhibitions admin read all"   ON public.exhibitions;
DROP POLICY IF EXISTS "exhibitions admin insert"     ON public.exhibitions;
DROP POLICY IF EXISTS "exhibitions admin update"     ON public.exhibitions;
DROP POLICY IF EXISTS "exhibitions admin delete"     ON public.exhibitions;
DROP POLICY IF EXISTS "exhibitions public read live" ON public.exhibitions;

DROP INDEX IF EXISTS public.exhibitions_name_key;
DROP INDEX IF EXISTS public.exhibitions_status_created_idx;

-- ============================================================
-- 2) updated_at 自動維護 trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.exhibitions_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exhibitions_touch_updated_at ON public.exhibitions;
CREATE TRIGGER trg_exhibitions_touch_updated_at
  BEFORE UPDATE ON public.exhibitions
  FOR EACH ROW
  EXECUTE FUNCTION public.exhibitions_touch_updated_at();

-- ============================================================
-- 3) 列表排序 / 篩選用 index
-- ============================================================
CREATE INDEX IF NOT EXISTS exhibitions_status_sort_idx
  ON public.exhibitions(status, sort_order);
CREATE INDEX IF NOT EXISTS exhibitions_created_idx
  ON public.exhibitions(created_at DESC);

-- ============================================================
-- 4) RLS
--    - 前台（anon / 一般 authenticated）：只能讀 ongoing + finished
--    - 系統管理員：所有 status 都能讀，並可 INSERT/UPDATE/DELETE
-- ============================================================
ALTER TABLE public.exhibitions ENABLE ROW LEVEL SECURITY;

-- 前台公開讀（含登入但非管理員的同仁）
CREATE POLICY "exhibitions public read live"
  ON public.exhibitions FOR SELECT
  USING (status IN ('ongoing', 'finished'));

-- 系統管理員：讀所有（包含 planning）
CREATE POLICY "exhibitions admin read all"
  ON public.exhibitions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
       WHERE id = auth.uid() AND app_role = '系統管理員'
    )
  );

-- 系統管理員：INSERT
CREATE POLICY "exhibitions admin insert"
  ON public.exhibitions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
       WHERE id = auth.uid() AND app_role = '系統管理員'
    )
  );

-- 系統管理員：UPDATE
CREATE POLICY "exhibitions admin update"
  ON public.exhibitions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
       WHERE id = auth.uid() AND app_role = '系統管理員'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
       WHERE id = auth.uid() AND app_role = '系統管理員'
    )
  );

-- 系統管理員：DELETE
CREATE POLICY "exhibitions admin delete"
  ON public.exhibitions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
       WHERE id = auth.uid() AND app_role = '系統管理員'
    )
  );

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON COLUMN public.exhibitions.status IS
  '時間軸狀態：planning=籌備中（內部草稿，前台不顯示）/ ongoing=進行中 / finished=已結束（前台仍可見歷史）';
COMMENT ON COLUMN public.exhibitions.cover_image_path IS
  '封面圖在 Supabase Storage 的路徑或對外完整 URL；前台直接拿來顯示';
COMMENT ON COLUMN public.exhibitions.sort_order IS
  '前台列表排序，數字越小越前面';
