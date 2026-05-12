-- Migration: exhibitions 日期/地點欄位 + exhibition_posters join table
-- Date: 2026-05-12
-- Description:
--   1) exhibitions 補三個 nullable 欄位：start_date / end_date / location
--      → 前端列表/詳細頁靠這三個欄位顯示「2026/05/12 — 2026/06/30 ・ 台北靜思堂」
--      → 並依 start_date/end_date 自動算「進行中 / 即將推出 / 已結束」
--   2) 新增 exhibition_posters join table（多對多）：一份海報可掛多個展覽
--      → 配套 RLS：前台只能讀「展覽屬 ongoing/finished」的連結；管理員全寫
--
-- 連動點：
--   - 前端：src/routes/exhibition-structure.tsx（modal form 多三欄）
--   - Rust：src-tauri/src/services/supabase.rs::insert/update_exhibition 加參數
--   - Tauri commands：src-tauri/src/lib.rs::create/patch_exhibition 加參數
--   - Next.js 前端：app/api/exhibitions/[id]/route.ts 改走 join table

-- ============================================================
-- 1) exhibitions 補欄位（全部 nullable，舊資料安全）
-- ============================================================
ALTER TABLE public.exhibitions
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date   date,
  ADD COLUMN IF NOT EXISTS location   text;

COMMENT ON COLUMN public.exhibitions.start_date IS '展期起日（前台依此算狀態：今日 < start_date → upcoming）';
COMMENT ON COLUMN public.exhibitions.end_date   IS '展期迄日；NULL = 常設展（前台顯示「常設」）';
COMMENT ON COLUMN public.exhibitions.location   IS '展出地點純文字，例如「台北靜思堂 / 花蓮靜思精舍」';

-- 給依日期排序的列表查詢一個 index（option：列表很常用日期排）
CREATE INDEX IF NOT EXISTS exhibitions_start_date_idx
  ON public.exhibitions(start_date DESC NULLS LAST);

-- ============================================================
-- 2) exhibition_posters join table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.exhibition_posters (
  exhibition_id uuid        NOT NULL REFERENCES public.exhibitions(id) ON DELETE CASCADE,
  poster_id     uuid        NOT NULL REFERENCES public.posters(id)     ON DELETE CASCADE,
  sort_order    int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (exhibition_id, poster_id)
);

-- 反查索引：「這份海報屬於哪些展覽」會用到
CREATE INDEX IF NOT EXISTS exhibition_posters_poster_idx
  ON public.exhibition_posters(poster_id);

-- 列表排序索引
CREATE INDEX IF NOT EXISTS exhibition_posters_sort_idx
  ON public.exhibition_posters(exhibition_id, sort_order);

COMMENT ON TABLE public.exhibition_posters IS
  '展覽 ↔ 海報 多對多關聯。Tauri 後台「展覽編輯」頁負責掛/卸，前端詳細頁讀。';
COMMENT ON COLUMN public.exhibition_posters.sort_order IS
  '同一展覽內的海報排序，數字越小越前面（每場展覽各自獨立排）';

-- ============================================================
-- 3) RLS
--    - 前台公開讀（含未登入）：但只能看到 ongoing/finished 展覽下的連結
--      → 跟 exhibitions 本身的 RLS 一致；planning 不外流
--    - 系統管理員：所有 status 都能讀、可 INSERT/UPDATE/DELETE
-- ============================================================
ALTER TABLE public.exhibition_posters ENABLE ROW LEVEL SECURITY;

-- 防呆：重跑此 migration 時先清舊 policy
DROP POLICY IF EXISTS "ep public read live" ON public.exhibition_posters;
DROP POLICY IF EXISTS "ep admin all"        ON public.exhibition_posters;

-- 為什麼用 IN 子查詢而不是 EXISTS + alias：Supabase SQL Editor 在 policy 內
-- 用 `EXISTS(SELECT … FROM tbl e WHERE e.id = exhibition_id)` 會回
-- syntax error at or near "WHERE"（42601）；IN 子查詢能避開這個解析問題，
-- 且語意完全相同（poster 連結只在展覽是 ongoing/finished 時能被讀到）。
CREATE POLICY "ep public read live"
ON public.exhibition_posters
FOR SELECT
USING (
  exhibition_id IN (
    SELECT id FROM public.exhibitions
    WHERE status IN ('ongoing', 'finished')
  )
);

CREATE POLICY "ep admin all"
ON public.exhibition_posters
FOR ALL
TO authenticated
USING (
  (SELECT app_role FROM public.users WHERE id = auth.uid()) = '系統管理員'
)
WITH CHECK (
  (SELECT app_role FROM public.users WHERE id = auth.uid()) = '系統管理員'
);
