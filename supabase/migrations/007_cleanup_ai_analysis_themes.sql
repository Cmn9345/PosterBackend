-- Migration: cleanup_ai_analysis_themes
-- Date: 2026-04-23
-- Description: 把舊版 VLM 使用的 9 主題字串(骨髓捐贈/歲末祝福/浴佛節)
--              映射到新版 12 主題;其他 (環保/慈善/醫療/教育/人文/國際賑災) 維持不變。
--              詳見 analysis.rs THEME_LIST 改版紀錄。
--
-- 映射策略:
--   骨髓捐贈  → 醫療       (骨髓捐贈是醫療志業子計畫)
--   歲末祝福  → 年度主題   (歲末祝福是每年度的重點主題活動)
--   浴佛節    → 法華坡道   (浴佛是《法華經》佛教行儀)

-- ============================================================
-- 實際執行清洗:針對 poster_files.ai_analysis.themes 陣列做元素替換
-- ============================================================
UPDATE poster_files
SET ai_analysis = jsonb_set(
  ai_analysis,
  '{themes}',
  COALESCE(
    (
      SELECT jsonb_agg(DISTINCT
        CASE x
          WHEN '骨髓捐贈' THEN '醫療'
          WHEN '歲末祝福' THEN '年度主題'
          WHEN '浴佛節'   THEN '法華坡道'
          ELSE x
        END
      )
      FROM jsonb_array_elements_text(ai_analysis->'themes') AS x
    ),
    '[]'::jsonb
  )
)
WHERE ai_analysis IS NOT NULL
  AND jsonb_typeof(ai_analysis->'themes') = 'array'
  AND (
       ai_analysis->'themes' ? '骨髓捐贈'
    OR ai_analysis->'themes' ? '歲末祝福'
    OR ai_analysis->'themes' ? '浴佛節'
  );

-- ============================================================
-- 驗證:列出這次實際被改到的 poster_files 數量與剩下的主題分布
-- (只是查詢,不影響資料;若在 psql 外執行可忽略 NOTICE)
-- ============================================================
DO $$
DECLARE
  total_posters INTEGER;
  themes_histogram TEXT;
BEGIN
  SELECT count(*) INTO total_posters FROM poster_files WHERE ai_analysis IS NOT NULL;

  SELECT string_agg(format('%s: %s', theme_name, cnt), ', ') INTO themes_histogram
  FROM (
    SELECT x AS theme_name, count(*) AS cnt
    FROM poster_files,
         jsonb_array_elements_text(ai_analysis->'themes') AS x
    WHERE ai_analysis IS NOT NULL
    GROUP BY x
    ORDER BY cnt DESC
  ) t;

  RAISE NOTICE '[007] ai_analysis 總數=%, 主題分布=%', total_posters, COALESCE(themes_histogram, '(empty)');
END $$;
