-- =============================================================================
-- complete_task() v2 — 支援 review_result 原子寫入
-- 目標資料庫：sbegather（共用 Supabase）
-- 專案：3in1media CoPaw WebGPU（desktop_team）
-- 日期：2026-03-11
-- =============================================================================
-- 變更說明：
--   POC-2 原版 complete_task() 僅寫入 result（AI 原始推理結果）
--   v2 新增支援 review_result（志工審核後最終結果），做為下游唯一真相欄位
--   向後相容：若不傳 review_result 參數，行為與原版完全一致
-- =============================================================================

-- 1. tasks 表擴充欄位（整合方案已定案的 6 個新欄位）
-- =============================================================================
-- 注意：這些 ALTER TABLE 是冪等的（IF NOT EXISTS），可安全重複執行

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
    processing_engine TEXT DEFAULT 'cloud';
    -- 'cloud' = 雲端 AI Worker 處理
    -- 'local_webgpu' = 桌機端 WebGPU 本地推理

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
    routing_decision TEXT;
    -- 'auto_local' = CoPaw 在線，自動走本地
    -- 'user_cloud' = 志工選擇送雲端
    -- 'user_pending' = 志工選擇等待桌機上線

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
    local_result JSONB;
    -- 地端 AI 推理原始結果（WebGPU 輸出）

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
    review_result JSONB;
    -- 志工審核後最終結果（唯一真相欄位）
    -- 下游系統（media_source Worker）一律讀此欄位

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
    reviewed_at TIMESTAMPTZ;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
    reviewed_by UUID;

COMMENT ON COLUMN tasks.processing_engine IS '處理引擎：cloud（雲端 AI）或 local_webgpu（桌機端）';
COMMENT ON COLUMN tasks.routing_decision IS '路由決策：auto_local / user_cloud / user_pending';
COMMENT ON COLUMN tasks.local_result IS '地端 AI 推理原始結果（WebGPU 輸出）';
COMMENT ON COLUMN tasks.review_result IS '志工審核後最終結果，下游系統唯一真相欄位';
COMMENT ON COLUMN tasks.reviewed_at IS '審核完成時間';
COMMENT ON COLUMN tasks.reviewed_by IS '審核者 UUID（auth.users.id）';

-- 新欄位索引
CREATE INDEX IF NOT EXISTS idx_tasks_processing_engine
    ON tasks (processing_engine)
    WHERE processing_engine IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_routing_decision
    ON tasks (routing_decision)
    WHERE routing_decision IS NOT NULL;

-- 2. complete_task() v2 — 原子操作寫入審核結果
-- =============================================================================
-- 取代 POC-2 原版，新增 review_result 相關參數
-- 向後相容：p_review_result / p_processing_engine 皆有預設值

CREATE OR REPLACE FUNCTION complete_task(
    p_task_id UUID,
    p_volunteer_id TEXT,
    p_result JSONB,
    p_review_result JSONB DEFAULT NULL,
    p_processing_engine TEXT DEFAULT 'cloud'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated INTEGER;
    v_volunteer_uuid UUID;
BEGIN
    -- 嘗試將 volunteer_id 轉為 UUID（桌機端傳入 auth.uid()）
    BEGIN
        v_volunteer_uuid := p_volunteer_id::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_volunteer_uuid := NULL;
    END;

    UPDATE tasks
    SET
        status = 'done',
        result = p_result,
        local_result = CASE
            WHEN p_processing_engine = 'local_webgpu' THEN p_result
            ELSE local_result
        END,
        review_result = COALESCE(p_review_result, p_result),
        processing_engine = p_processing_engine,
        reviewed_at = CASE
            WHEN p_review_result IS NOT NULL THEN NOW()
            ELSE reviewed_at
        END,
        reviewed_by = CASE
            WHEN p_review_result IS NOT NULL THEN v_volunteer_uuid
            ELSE reviewed_by
        END,
        lease_expires_at = NULL
    WHERE id = p_task_id
      AND lease_owner = p_volunteer_id
      AND status IN ('leased', 'running');

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION complete_task IS
'完成任務並寫入結果。v2 支援 review_result（唯一真相欄位）+ processing_engine。
向後相容：不傳新參數時行為與 POC-2 原版一致。
桌機端呼叫：complete_task(task_id, volunteer_id, ai_result, review_result, ''local_webgpu'')
雲端呼叫：  complete_task(task_id, worker_id, ai_result)';

-- 3. submit_review() — 獨立審核提交函數（桌機端專用）
-- =============================================================================
-- 適用場景：AI 推理已完成（status=done），志工事後修改審核結果
-- 與 complete_task 的差異：不要求 lease 擁有權，僅檢查 status=done

CREATE OR REPLACE FUNCTION submit_review(
    p_task_id UUID,
    p_review_result JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE tasks
    SET
        review_result = p_review_result,
        reviewed_at = NOW(),
        reviewed_by = auth.uid()
    WHERE id = p_task_id
      AND status = 'done';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION submit_review IS
'志工事後修改審核結果（任務已完成後的修正）。SECURITY DEFINER 確保 reviewed_by 為當前登入者。';

-- 4. 權限授予
-- =============================================================================

GRANT EXECUTE ON FUNCTION complete_task(UUID, TEXT, JSONB, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_task(UUID, TEXT, JSONB, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION submit_review(UUID, JSONB) TO authenticated;
