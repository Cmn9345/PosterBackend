-- =============================================================================
-- review_result JSON Schema 定義 + 驗證函數
-- 目標資料庫：sbegather（共用 Supabase）
-- 專案：3in1media CoPaw WebGPU（desktop_team）
-- 日期：2026-03-11
-- =============================================================================
-- review_result 是下游系統的唯一真相欄位，
-- media_source Worker 一律讀此欄位取得最終結果。
-- =============================================================================

-- ┌─────────────────────────────────────────────────────────────┐
-- │              review_result JSON Schema 規範                  │
-- ├─────────────────────────────────────────────────────────────┤
-- │                                                             │
-- │  {                                                          │
-- │    "task_type": "vlm",                                      │
-- │    "processing_engine": "local_webgpu",                     │
-- │    "scores": {                         -- 五維評分（圖片用） │
-- │      "composition": 90,                -- 構圖 0-100        │
-- │      "lighting": 80,                   -- 光影 0-100        │
-- │      "clarity": 88,                    -- 清晰度 0-100      │
-- │      "narrative": 95,                  -- 敘事性 0-100      │
-- │      "event_relevance": 95,            -- 事件符合度 0-100   │
-- │      "total": 95,                      -- 總分 0-100        │
-- │      "recommendation": "推薦收藏"       -- 建議分類           │
-- │    },                                                       │
-- │    "feedback": {                       -- 專業評分理由        │
-- │      "composition": "構圖極為出色...",                        │
-- │      "lighting": "光線運用真實且具功能性...",                  │
-- │      "clarity": "清晰度良好...",                              │
-- │      "narrative": "敘事性極強...",                            │
-- │      "event_relevance": "符合度極高...",                      │
-- │      "special_bonus": "此照片符合特殊情境加分標準..."          │
-- │    },                                                       │
-- │    "caption": "2023年3月19日，慈濟人醫會...",  -- 圖說        │
-- │    "volunteer_notes": "志工的審核備註",    -- 選填             │
-- │    "reviewed": true,                       -- 是否經人工審核   │
-- │    "version": "1.0"                        -- Schema 版本     │
-- │  }                                                          │
-- │                                                             │
-- └─────────────────────────────────────────────────────────────┘

-- 1. 驗證函數：檢查 review_result 基本結構
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_review_result(
    p_review_result JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    -- 基本欄位檢查
    IF p_review_result IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 必須有 task_type
    IF NOT (p_review_result ? 'task_type') THEN
        RETURN FALSE;
    END IF;

    -- 必須有 version
    IF NOT (p_review_result ? 'version') THEN
        RETURN FALSE;
    END IF;

    -- 必須有 reviewed 標記
    IF NOT (p_review_result ? 'reviewed') THEN
        RETURN FALSE;
    END IF;

    -- VLM 類型必須有 scores
    IF p_review_result->>'task_type' = 'vlm' THEN
        IF NOT (p_review_result ? 'scores') THEN
            RETURN FALSE;
        END IF;
        -- scores.total 必須是 0-100 的數字
        IF (p_review_result->'scores'->>'total')::INTEGER NOT BETWEEN 0 AND 100 THEN
            RETURN FALSE;
        END IF;
    END IF;

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION validate_review_result IS
'驗證 review_result JSON 基本結構。可用於 CHECK 約束或應用層驗證。';

-- 2. 查詢輔助函數：取得任務最終結果
-- =============================================================================
-- 下游系統統一使用此函數讀取結果，不直接讀欄位

CREATE OR REPLACE FUNCTION get_task_result(
    p_task_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_review_result JSONB;
    v_ai_results JSONB;
    v_local_result JSONB;
    v_result JSONB;
BEGIN
    SELECT review_result, ai_results, local_result, result
    INTO v_review_result, v_ai_results, v_local_result, v_result
    FROM tasks
    WHERE id = p_task_id;

    -- Fallback 順序（與 cloud_team 對齊）：
    -- 1. review_result — 志工審核後最終結果（唯一真相）
    -- 2. ai_results   — 雲端 AI 推理結果（cloud_team v1.5.0+）
    -- 3. local_result  — 桌機端 WebGPU 推理結果
    -- 4. result        — 歷史相容（舊任務可能僅有此欄位）
    RETURN COALESCE(v_review_result, v_ai_results, v_local_result, v_result);
END;
$$;

COMMENT ON FUNCTION get_task_result IS
'取得任務最終結果。Fallback: review_result → ai_results → local_result → result → NULL。';

GRANT EXECUTE ON FUNCTION validate_review_result(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION validate_review_result(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION get_task_result(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_task_result(UUID) TO service_role;

-- =============================================================================
-- review_result JSON Schema（JSON Schema Draft-07 格式，供應用層驗證）
-- =============================================================================
-- 以下為 JSON Schema 定義，非 SQL，供前端/後端驗證使用
-- 存放位置建議：sql/review_result_schema.json
-- =============================================================================

/*
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ReviewResult",
  "description": "志工審核後最終結果，下游系統唯一真相欄位",
  "type": "object",
  "required": ["task_type", "version", "reviewed"],
  "properties": {
    "task_type": {
      "type": "string",
      "enum": ["vlm", "stt", "embedding"],
      "description": "任務類型"
    },
    "processing_engine": {
      "type": "string",
      "enum": ["cloud", "local_webgpu"],
      "description": "處理引擎"
    },
    "scores": {
      "type": "object",
      "description": "五維評分（VLM 圖片分析用）",
      "properties": {
        "composition":     { "type": "integer", "minimum": 0, "maximum": 100 },
        "lighting":        { "type": "integer", "minimum": 0, "maximum": 100 },
        "clarity":         { "type": "integer", "minimum": 0, "maximum": 100 },
        "narrative":       { "type": "integer", "minimum": 0, "maximum": 100 },
        "event_relevance": { "type": "integer", "minimum": 0, "maximum": 100 },
        "total":           { "type": "integer", "minimum": 0, "maximum": 100 },
        "recommendation":  { "type": "string" }
      },
      "required": ["composition", "lighting", "clarity", "narrative", "event_relevance", "total"]
    },
    "feedback": {
      "type": "object",
      "description": "專業評分理由",
      "properties": {
        "composition":     { "type": "string" },
        "lighting":        { "type": "string" },
        "clarity":         { "type": "string" },
        "narrative":        { "type": "string" },
        "event_relevance": { "type": "string" },
        "special_bonus":   { "type": "string" }
      }
    },
    "caption": {
      "type": "string",
      "description": "圖說文字"
    },
    "volunteer_notes": {
      "type": "string",
      "description": "志工審核備註（選填）"
    },
    "reviewed": {
      "type": "boolean",
      "description": "是否經志工人工審核"
    },
    "version": {
      "type": "string",
      "description": "Schema 版本號",
      "enum": ["1.0"]
    }
  },
  "if": {
    "properties": { "task_type": { "const": "vlm" } }
  },
  "then": {
    "required": ["scores", "caption"]
  }
}
*/
