-- =============================================================================
-- 方案 A' — task_leases 表 + 桌機端原子操作函數（適配 sbegather schema）
-- 目標資料庫：sbegather（共用 Supabase）
-- 專案：3in1media CoPaw WebGPU（desktop_team）
-- 日期：2026-03-11
-- =============================================================================
-- 設計原則：
--   1. 不修改 sbegather 現有 status ENUM（draft/uploading/ai_processing/reviewing/completed）
--   2. 新增獨立 task_leases 表實作桌機端 lease 機制
--   3. 使用 processing_engine 欄位區分雲端/桌機
--   4. 完全符合「新增不破壞」原則，cloud Worker 零影響
-- =============================================================================

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  Part 1: task_leases 表 — 桌機端任務租約管理                           │
-- └─────────────────────────────────────────────────────────────────────────┘

CREATE TABLE IF NOT EXISTS task_leases (
    task_id          UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    lease_owner      TEXT NOT NULL,              -- volunteer_id（CoPaw agent ID）
    lease_status     TEXT NOT NULL DEFAULT 'leased'
                     CHECK (lease_status IN ('leased', 'running')),
    lease_expires_at TIMESTAMPTZ NOT NULL,       -- 租約過期時間
    heartbeat_at     TIMESTAMPTZ DEFAULT now(),  -- 最後心跳時間
    attempt          INTEGER NOT NULL DEFAULT 1, -- 當前嘗試次數
    max_attempts     INTEGER NOT NULL DEFAULT 3, -- 最大重試次數
    created_at       TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE task_leases IS
'桌機端任務租約表。實作 FOR UPDATE SKIP LOCKED 原子操作，與 sbegather tasks 表分離。
cloud Worker 不讀取此表，零影響。';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_task_leases_owner
    ON task_leases (lease_owner);

CREATE INDEX IF NOT EXISTS idx_task_leases_expires
    ON task_leases (lease_expires_at ASC)
    WHERE lease_status IN ('leased', 'running');

CREATE INDEX IF NOT EXISTS idx_task_leases_status
    ON task_leases (lease_status);

-- RLS
ALTER TABLE task_leases ENABLE ROW LEVEL SECURITY;

-- 志工只能看到自己的租約
CREATE POLICY "Volunteers can view own leases" ON task_leases
    FOR SELECT USING (
        lease_owner = auth.uid()::TEXT
        OR public.get_user_role(auth.uid()) IN ('editor', 'admin')
    );

-- 僅透過 RPC 函數操作（SECURITY DEFINER），不允許直接 INSERT/UPDATE/DELETE
CREATE POLICY "Service role full access" ON task_leases
    FOR ALL USING (
        current_setting('role', true) = 'service_role'
    );

-- Editor/Admin 可查看所有租約（管理介面用）
CREATE POLICY "Editors can view all leases" ON task_leases
    FOR SELECT USING (
        public.get_user_role(auth.uid()) IN ('editor', 'admin')
    );

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  Part 2: claim_task_local() — 桌機端原子任務領取                        │
-- └─────────────────────────────────────────────────────────────────────────┘
-- 核心設計：
--   1. 在 tasks 表用 FOR UPDATE SKIP LOCKED 原子選取 draft 任務
--   2. 更新 tasks.status = 'ai_processing' + processing_engine = 'local_webgpu'
--   3. 在 task_leases 寫入租約（含過期時間）
--   4. cloud Worker 看到 status='ai_processing' 會正常跳過（已在處理中）

CREATE OR REPLACE FUNCTION claim_task_local(
    p_volunteer_id TEXT,
    p_task_type TEXT DEFAULT NULL,
    p_lease_duration INTERVAL DEFAULT '5 minutes'
)
RETURNS TABLE (
    task_id UUID,
    task_type TEXT,
    file_url TEXT,
    prompt TEXT,
    lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_task_id UUID;
    v_task_type TEXT;
    v_file_url TEXT;
    v_prompt TEXT;
    v_expires TIMESTAMPTZ;
BEGIN
    v_expires := NOW() + p_lease_duration;

    -- Step 1: 原子選取一個 draft 任務並更新狀態
    UPDATE tasks t
    SET
        status = 'ai_processing',
        processing_engine = 'local_webgpu',
        routing_decision = 'auto_local',
        updated_at = NOW()
    WHERE t.id = (
        SELECT t2.id FROM tasks t2
        WHERE t2.status = 'draft'
          AND (p_task_type IS NULL OR t2.category = p_task_type)
          -- 排除已有活躍租約的任務
          AND NOT EXISTS (
              SELECT 1 FROM task_leases tl
              WHERE tl.task_id = t2.id
                AND tl.lease_expires_at > NOW()
          )
        ORDER BY t2.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING t.id, t.category, NULL::TEXT, t.title
    INTO v_task_id, v_task_type, v_file_url, v_prompt;

    -- 沒有可用任務
    IF v_task_id IS NULL THEN
        RETURN;
    END IF;

    -- Step 2: 寫入租約（ON CONFLICT 處理過期租約重新領取）
    INSERT INTO task_leases (task_id, lease_owner, lease_status, lease_expires_at, attempt)
    VALUES (v_task_id, p_volunteer_id, 'leased', v_expires, 1)
    ON CONFLICT (task_id) DO UPDATE
    SET
        lease_owner = p_volunteer_id,
        lease_status = 'leased',
        lease_expires_at = v_expires,
        heartbeat_at = NOW(),
        attempt = task_leases.attempt + 1
    WHERE task_leases.lease_expires_at < NOW();

    -- 回傳任務資訊
    task_id := v_task_id;
    task_type := v_task_type;
    file_url := v_file_url;
    prompt := v_prompt;
    lease_expires_at := v_expires;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION claim_task_local IS
'桌機端原子任務領取。使用 FOR UPDATE SKIP LOCKED 避免並發搶奪。
tasks.status 設為 ai_processing（sbegather 原生 ENUM），processing_engine 設為 local_webgpu。
租約資訊寫入 task_leases 表。';

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  Part 3: extend_lease_local() — 桌機端心跳續約                          │
-- └─────────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION extend_lease_local(
    p_task_id UUID,
    p_volunteer_id TEXT,
    p_extension INTERVAL DEFAULT '5 minutes'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE task_leases
    SET
        lease_expires_at = NOW() + p_extension,
        heartbeat_at = NOW()
    WHERE task_id = p_task_id
      AND lease_owner = p_volunteer_id
      AND lease_status IN ('leased', 'running')
      AND lease_expires_at > NOW();

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION extend_lease_local IS
'桌機端心跳續約。延長 task_leases 的過期時間，更新 heartbeat_at。';

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  Part 4: start_task_local() — 桌機端任務開始推理                        │
-- └─────────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION start_task_local(
    p_task_id UUID,
    p_volunteer_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE task_leases
    SET lease_status = 'running'
    WHERE task_id = p_task_id
      AND lease_owner = p_volunteer_id
      AND lease_status = 'leased'
      AND lease_expires_at > NOW();

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION start_task_local IS
'桌機端標記任務開始推理。lease_status: leased → running。';

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  Part 5: complete_task() v3 — 適配 sbegather 的任務完成函數             │
-- └─────────────────────────────────────────────────────────────────────────┘
-- 取代 v2，修正所有 6 個不相容問題：
--   1. status = 'completed'（非 'done'）
--   2. 寫入 ai_results（非 result）
--   3. 透過 task_leases 驗證 lease_owner（非 tasks 欄位）
--   4. 完成後清除 task_leases 租約
--   5. 同時寫入 local_result 和 review_result

CREATE OR REPLACE FUNCTION complete_task(
    p_task_id UUID,
    p_volunteer_id TEXT,
    p_result JSONB,
    p_review_result JSONB DEFAULT NULL,
    p_processing_engine TEXT DEFAULT 'cloud'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated INTEGER;
    v_volunteer_uuid UUID;
    v_has_lease BOOLEAN;
BEGIN
    -- 桌機端呼叫：驗證 task_leases 租約擁有權
    IF p_processing_engine = 'local_webgpu' THEN
        SELECT EXISTS (
            SELECT 1 FROM task_leases
            WHERE task_id = p_task_id
              AND lease_owner = p_volunteer_id
              AND lease_status IN ('leased', 'running')
        ) INTO v_has_lease;

        IF NOT v_has_lease THEN
            RETURN FALSE;
        END IF;
    END IF;

    -- 嘗試將 volunteer_id 轉為 UUID
    BEGIN
        v_volunteer_uuid := p_volunteer_id::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_volunteer_uuid := NULL;
    END;

    -- 更新 tasks 表（使用 sbegather 原生欄位和狀態值）
    UPDATE tasks
    SET
        status = 'completed',
        ai_results = CASE
            WHEN p_processing_engine = 'cloud' THEN p_result
            ELSE COALESCE(ai_results, p_result)
        END,
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
        updated_at = NOW()
    WHERE id = p_task_id
      AND status = 'ai_processing';

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    -- 清除租約
    IF v_updated > 0 AND p_processing_engine = 'local_webgpu' THEN
        DELETE FROM task_leases WHERE task_id = p_task_id;
    END IF;

    RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION complete_task IS
'完成任務 v3（適配 sbegather schema）。
桌機端：驗證 task_leases 租約 → 寫入 ai_results + local_result + review_result → 清除租約。
雲端：直接寫入 ai_results + review_result。
status: ai_processing → completed（sbegather 原生 ENUM）。';

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  Part 6: submit_review() — 適配版審核提交函數                           │
-- └─────────────────────────────────────────────────────────────────────────┘
-- 修正：status = 'completed'（非 'done'）

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
      AND status = 'completed';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION submit_review IS
'志工事後修改審核結果（任務已完成後的修正）。
SECURITY DEFINER 確保 reviewed_by 為當前登入者。
檢查 status = completed（sbegather 原生 ENUM）。';

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  Part 7: get_task_result() — 修正版（移除 result 欄位引用）              │
-- └─────────────────────────────────────────────────────────────────────────┘
-- Fallback 順序（3 層，移除不存在的 result 欄位）：
--   1. review_result — 志工審核後最終結果（唯一真相）
--   2. ai_results    — 雲端 AI / 桌機端推理結果
--   3. local_result  — 桌機端 WebGPU 推理結果（備援）

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
BEGIN
    SELECT review_result, ai_results, local_result
    INTO v_review_result, v_ai_results, v_local_result
    FROM tasks
    WHERE id = p_task_id;

    -- Fallback 順序：
    -- 1. review_result — 志工審核後最終結果（唯一真相）
    -- 2. ai_results    — 雲端 AI 推理結果（cloud_team v1.5.0+）/ 桌機端結果
    -- 3. local_result  — 桌機端 WebGPU 推理結果（備援）
    RETURN COALESCE(v_review_result, v_ai_results, v_local_result);
END;
$$;

COMMENT ON FUNCTION get_task_result IS
'取得任務最終結果。Fallback: review_result → ai_results → local_result → NULL。
已移除 result 欄位引用（sbegather 不存在此欄位）。';

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  Part 8: release_expired_leases_local() — 過期租約回收                   │
-- └─────────────────────────────────────────────────────────────────────────┘
-- CoPaw 定期呼叫（建議每 60 秒），將過期租約的任務釋放回 draft

CREATE OR REPLACE FUNCTION release_expired_leases_local()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reclaimed INTEGER;
BEGIN
    -- 處理過期租約
    WITH expired_leases AS (
        SELECT tl.task_id, tl.attempt, tl.max_attempts
        FROM task_leases tl
        WHERE tl.lease_expires_at < NOW()
          AND tl.lease_status IN ('leased', 'running')
    ),
    -- 可重試的任務：釋放回 draft
    retryable AS (
        UPDATE tasks
        SET
            status = 'draft',
            processing_engine = DEFAULT,
            routing_decision = NULL,
            updated_at = NOW()
        WHERE id IN (
            SELECT task_id FROM expired_leases
            WHERE attempt < max_attempts
        )
        RETURNING id
    ),
    -- 超過重試次數的租約：直接刪除租約（任務保持 ai_processing 待人工處理）
    failed_leases AS (
        DELETE FROM task_leases
        WHERE task_id IN (
            SELECT task_id FROM expired_leases
            WHERE attempt >= max_attempts
        )
        RETURNING task_id
    ),
    -- 可重試的租約：刪除
    retry_leases AS (
        DELETE FROM task_leases
        WHERE task_id IN (SELECT id FROM retryable)
        RETURNING task_id
    )
    SELECT COUNT(*) INTO v_reclaimed
    FROM retryable;

    RETURN v_reclaimed;
END;
$$;

COMMENT ON FUNCTION release_expired_leases_local IS
'回收過期租約。可重試任務釋放回 draft，超過重試次數的保持 ai_processing 待人工處理。
建議 CoPaw 每 60 秒呼叫一次。';

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  Part 9: 權限授予                                                      │
-- └─────────────────────────────────────────────────────────────────────────┘

-- task_leases 操作函數（全部 SECURITY DEFINER，透過 RPC 呼叫）
GRANT EXECUTE ON FUNCTION claim_task_local(TEXT, TEXT, INTERVAL) TO authenticated;
GRANT EXECUTE ON FUNCTION claim_task_local(TEXT, TEXT, INTERVAL) TO service_role;

GRANT EXECUTE ON FUNCTION extend_lease_local(UUID, TEXT, INTERVAL) TO authenticated;
GRANT EXECUTE ON FUNCTION extend_lease_local(UUID, TEXT, INTERVAL) TO service_role;

GRANT EXECUTE ON FUNCTION start_task_local(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION start_task_local(UUID, TEXT) TO service_role;

-- 適配版函數（覆蓋舊版）
GRANT EXECUTE ON FUNCTION complete_task(UUID, TEXT, JSONB, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_task(UUID, TEXT, JSONB, JSONB, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION submit_review(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_review(UUID, JSONB) TO service_role;

GRANT EXECUTE ON FUNCTION get_task_result(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_task_result(UUID) TO service_role;

GRANT EXECUTE ON FUNCTION release_expired_leases_local() TO service_role;

-- =============================================================================
-- 方案 A' 總覽
-- =============================================================================
-- 新增項目：
--   1. task_leases 表 + RLS + 索引
--   2. claim_task_local() — 原子任務領取
--   3. extend_lease_local() — 心跳續約
--   4. start_task_local() — 開始推理標記
--   5. release_expired_leases_local() — 過期租約回收
--
-- 覆蓋更新項目（修正 6 個不相容）：
--   6. complete_task() v3 — status='completed', ai_results, task_leases 驗證
--   7. submit_review() — status='completed'
--   8. get_task_result() — 移除 result 欄位引用
--
-- sbegather 影響：
--   - 新增 1 張表（task_leases）
--   - 新增 4 個函數（claim/extend/start/release）
--   - 覆蓋 3 個函數（complete_task/submit_review/get_task_result）
--   - 不修改任何現有表結構或 ENUM
--   - cloud Worker 零影響
-- =============================================================================
