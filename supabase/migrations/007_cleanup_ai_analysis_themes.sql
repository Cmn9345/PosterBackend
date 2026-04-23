-- Migration: cleanup_themes_array
-- Date: 2026-04-23
-- Description: 把 poster_files.themes (TEXT[]) 裡舊版 VLM 會輸出的 3 個過期
--              主題字串映射到新版 12 主題。VLM 其他輸出(OCR / scores /
--              suggestions 等)只存本機 SQLite 不進 Supabase,所以本清洗
--              只針對 Postgres 的 themes TEXT[] 欄位。
--
-- 映射:
--   骨髓捐贈 → 醫療      (骨髓捐贈是醫療志業子計畫)
--   歲末祝福 → 年度主題  (歲末祝福是每年度的重點活動)
--   浴佛節   → 法華坡道  (浴佛是《法華經》佛教行儀)

-- ============================================================
-- 執行清洗:對每個陣列元素做 CASE 替換,去重,寫回 themes
-- ============================================================
UPDATE poster_files
SET
  themes = ARRAY(
    SELECT DISTINCT
      CASE x
        WHEN '骨髓捐贈' THEN '醫療'
        WHEN '歲末祝福' THEN '年度主題'
        WHEN '浴佛節'   THEN '法華坡道'
        ELSE x
      END
    FROM unnest(themes) AS x
  ),
  updated_at = NOW()
WHERE themes && ARRAY['骨髓捐贈', '歲末祝福', '浴佛節']::text[];

-- ============================================================
-- 驗證:列出剩下的 themes 值分布
-- ============================================================
DO $$
DECLARE
  affected_cnt INTEGER;
  histogram TEXT;
BEGIN
  SELECT count(*) INTO affected_cnt
  FROM poster_files
  WHERE themes IS NOT NULL AND array_length(themes, 1) > 0;

  SELECT string_agg(format('%s:%s', theme_name, cnt), ', ' ORDER BY cnt DESC) INTO histogram
  FROM (
    SELECT x AS theme_name, count(*) AS cnt
    FROM poster_files, unnest(themes) AS x
    GROUP BY x
  ) t;

  RAISE NOTICE '[007] poster_files 有主題的檔案數=%  主題分布=%',
               affected_cnt, COALESCE(histogram, '(empty)');
END $$;
