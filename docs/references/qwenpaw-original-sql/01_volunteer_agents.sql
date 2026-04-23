-- =============================================================================
-- volunteer_agents 表 + RLS 政策
-- 目標資料庫：sbegather（共用 Supabase）
-- 專案：3in1media CoPaw WebGPU（desktop_team）
-- 日期：2026-03-11
-- =============================================================================
-- 用途：追蹤志工桌機端 CoPaw Agent 的在線狀態，
--       供路由決策判斷任務應送雲端 AI 或通知桌機端本地處理。
-- =============================================================================

-- 1. volunteer_agents 表
-- =============================================================================

CREATE TABLE IF NOT EXISTS volunteer_agents (
    volunteer_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_status    TEXT NOT NULL DEFAULT 'offline'
                    CHECK (agent_status IN ('online', 'offline')),
    last_heartbeat  TIMESTAMPTZ,
    capabilities    JSONB DEFAULT '{}',
    -- capabilities 範例：
    -- {
    --   "webgpu": true,
    --   "models": ["qwen3.5-0.8b"],
    --   "max_concurrent_tasks": 2,
    --   "browser": "Chrome 131"
    -- }
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE volunteer_agents IS '志工桌機端 CoPaw Agent 在線狀態追蹤（desktop_team 維護）';
COMMENT ON COLUMN volunteer_agents.agent_status IS 'online=CoPaw 正在運行, offline=CoPaw 未運行';
COMMENT ON COLUMN volunteer_agents.last_heartbeat IS 'CoPaw 每 30 秒更新一次心跳';
COMMENT ON COLUMN volunteer_agents.capabilities IS '桌機端硬體與模型能力描述（JSON）';

-- 2. Indexes
-- =============================================================================

-- 狀態查詢（無條件索引，支援管理介面全狀態查詢）
CREATE INDEX IF NOT EXISTS idx_volunteer_agents_status
    ON volunteer_agents (agent_status);

-- 心跳查詢（無條件索引，支援清理過期 + 管理介面排序）
CREATE INDEX IF NOT EXISTS idx_volunteer_agents_heartbeat
    ON volunteer_agents (last_heartbeat);

-- 3. updated_at trigger
-- =============================================================================

CREATE TRIGGER volunteer_agents_updated_at
    BEFORE UPDATE ON volunteer_agents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 4. RLS 政策
-- =============================================================================

ALTER TABLE volunteer_agents ENABLE ROW LEVEL SECURITY;

-- 4.1 SELECT：任何已認證用戶可查詢所有志工的在線狀態
--     （路由決策需查詢目標志工是否在線）
CREATE POLICY "volunteer_agents_select_authenticated"
    ON volunteer_agents
    FOR SELECT
    TO authenticated
    USING (true);

-- 4.1b SELECT：editor/admin 可透過管理介面查看所有志工狀態
--      （符合 sbegather tasks 表 RLS 慣例）
CREATE POLICY "volunteer_agents_select_editors"
    ON volunteer_agents
    FOR SELECT
    TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('editor', 'admin'));

-- 4.2 INSERT：志工只能註冊自己的 agent
CREATE POLICY "volunteer_agents_insert_own"
    ON volunteer_agents
    FOR INSERT
    TO authenticated
    WITH CHECK (volunteer_id = auth.uid());

-- 4.3 UPDATE：志工只能更新自己的 agent 狀態
CREATE POLICY "volunteer_agents_update_own"
    ON volunteer_agents
    FOR UPDATE
    TO authenticated
    USING (volunteer_id = auth.uid())
    WITH CHECK (volunteer_id = auth.uid());

-- 4.4 DELETE：志工只能刪除自己的 agent 記錄
CREATE POLICY "volunteer_agents_delete_own"
    ON volunteer_agents
    FOR DELETE
    TO authenticated
    USING (volunteer_id = auth.uid());

-- 4.5 service_role 可完整操作（CoPaw 後端用 service_role_key）
CREATE POLICY "volunteer_agents_service_role_all"
    ON volunteer_agents
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 5. RPC 函數：心跳註冊/更新
-- =============================================================================

CREATE OR REPLACE FUNCTION register_agent_heartbeat(
    p_capabilities JSONB DEFAULT '{}'
)
RETURNS volunteer_agents
LANGUAGE plpgsql
SECURITY DEFINER  -- 以函數擁有者權限執行，繞過 RLS
AS $$
DECLARE
    v_result volunteer_agents%ROWTYPE;
BEGIN
    INSERT INTO volunteer_agents (volunteer_id, agent_status, last_heartbeat, capabilities)
    VALUES (auth.uid(), 'online', NOW(), p_capabilities)
    ON CONFLICT (volunteer_id)
    DO UPDATE SET
        agent_status = 'online',
        last_heartbeat = NOW(),
        capabilities = COALESCE(EXCLUDED.capabilities, volunteer_agents.capabilities)
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION register_agent_heartbeat IS 'CoPaw 每 30 秒呼叫一次，UPSERT 心跳 + 在線狀態';

-- 6. RPC 函數：下線登出
-- =============================================================================

CREATE OR REPLACE FUNCTION deregister_agent()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE volunteer_agents
    SET agent_status = 'offline',
        last_heartbeat = NOW()
    WHERE volunteer_id = auth.uid();

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION deregister_agent IS 'CoPaw 關閉時呼叫，標記為 offline';

-- 7. RPC 函數：清理過期心跳（由 CoPaw 定期呼叫或 pg_cron）
-- =============================================================================

CREATE OR REPLACE FUNCTION cleanup_stale_agents(
    p_timeout INTERVAL DEFAULT '2 minutes'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cleaned INTEGER;
BEGIN
    UPDATE volunteer_agents
    SET agent_status = 'offline'
    WHERE agent_status = 'online'
      AND last_heartbeat < NOW() - p_timeout;

    GET DIAGNOSTICS v_cleaned = ROW_COUNT;
    RETURN v_cleaned;
END;
$$;

COMMENT ON FUNCTION cleanup_stale_agents IS '清理超過 2 分鐘未心跳的 agent，標記為 offline';

-- 8. RPC 函數：查詢指定志工是否在線（路由決策用）
-- =============================================================================

CREATE OR REPLACE FUNCTION is_agent_online(
    p_volunteer_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM volunteer_agents
        WHERE volunteer_id = p_volunteer_id
          AND agent_status = 'online'
          AND last_heartbeat > NOW() - INTERVAL '2 minutes'
    );
END;
$$;

COMMENT ON FUNCTION is_agent_online IS '查詢指定志工的 CoPaw 是否在線（心跳+狀態雙重檢查）';

-- 9. 權限授予
-- =============================================================================

-- anon 角色需要呼叫 is_agent_online（路由決策可能在未完全認證時使用）
GRANT EXECUTE ON FUNCTION is_agent_online(UUID) TO anon;
GRANT EXECUTE ON FUNCTION is_agent_online(UUID) TO authenticated;

-- authenticated 角色需要呼叫心跳相關函數
GRANT EXECUTE ON FUNCTION register_agent_heartbeat(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION deregister_agent() TO authenticated;

-- service_role 需要呼叫清理函數
GRANT EXECUTE ON FUNCTION cleanup_stale_agents(INTERVAL) TO service_role;
