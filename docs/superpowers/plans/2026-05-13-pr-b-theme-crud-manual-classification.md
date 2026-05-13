# PR-B: 主題 CRUD + 手動歸類 + VLM 動態讀表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 admin 在 Tauri app 內完整管理 `vocabulary_themes`（新增/改名/刪除）、把 VLM `THEME_LIST` 從硬碼常數改成執行時動態讀表、在海報編輯頁加手動勾選主題的能力。

**Architecture:** 三件功能共享 `vocabulary_themes` 的 admin 寫入路徑。改名與刪除走兩支 `SECURITY DEFINER` Postgres RPC（migration 011），在交易內 cascade 更新所有 `poster_files.themes` 字串陣列，避免應用層 race。VLM `build_prompt` 變參數化吃 themes 字串，`request_analysis` 新增 `&SupabaseClient` 引數於分析前去抓 active themes，失敗時 fallback 硬碼 12 主題。前端 `/exhibitions` 頁加「編輯主題」toggle 切換瀏覽/管理模式；海報編輯頁加 12 個 chip toggle 替代既有 read-only pills。

**Tech Stack:** Postgres 15 + Supabase RPC + Tauri 2 + React 19 + TanStack Router + Ollama (qwen2.5vl:3b)

**Depends on:** PR-A 不需要先 merge，兩個 PR 可平行；但本 PR 若先 merge，PR-A Task 11 的 dead-code TODO 變孤兒（無 impact）。

**Verification approach:** 與 PR-A 一致 — 無 vitest/cargo test，靠 `cargo check` + `npm run build` + Task 13 手動 E2E。Migration 11 多一個 SQL 層 smoke test（Task 2）。

---

## File Structure

**New files:**
- `supabase/migrations/011_theme_admin_rpcs.sql` — 兩支 SECURITY DEFINER 函式 + 註解
- `src/components/ThemeEditModal.tsx` — 主題新增/編輯 modal
- `src/components/ThemeDeleteConfirm.tsx` — 刪主題確認對話框（含影響海報數預覽）

**Modified files:**
- `src-tauri/src/services/supabase.rs` — 加 5 個 method
- `src-tauri/src/services/qwenpaw/analysis.rs` — `THEME_LIST` 改 `FALLBACK_THEMES`、`build_prompt(themes:&str)`、`request_analysis` 加 `supabase` 參數
- `src-tauri/src/services/qwenpaw/task_queue.rs` — `request_analysis` call site 加 supabase
- `src-tauri/src/lib.rs` — 註冊 5 個新 command
- `src/lib/api.ts` — 加 5 個 wrapper + VocabularyTheme type
- `src/routes/exhibitions/index.tsx` — 加「編輯主題」toolbar + edit mode
- `src/routes/posters/$projectId.edit.tsx` — 替換 themes pills 為 chip toggles
- `src/routes/exhibition-structure.tsx` — 收尾：拔掉 PR-A 留下的 ExhibitionModal `edit` dead branch

---

## Task 1: Migration 011 — `admin_rename_theme` + `admin_delete_theme` RPC

**Files:**
- Create: `supabase/migrations/011_theme_admin_rpcs.sql`

- [ ] **Step 1: 寫 migration**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/011_theme_admin_rpcs.sql
git commit -m "feat(supabase): migration 011 主題 rename/delete RPC

兩支 SECURITY DEFINER 函式接住改名/刪除的 cascade 邏輯：
- admin_rename_theme: 改名同步 array_replace poster_files.themes
- admin_delete_theme: array_remove orphans 再 DELETE；
  擋最後一個 active theme 避免 VLM prompt 空。
都先 check app_role='系統管理員'，未授權 42501。"
```

---

## Task 2: SQL 層 smoke test migration 011

**Files:** N/A — verification only

- [ ] **Step 1: 套用到 production Supabase**

操作：登入 Supabase Studio → SQL Editor → 貼整份 `011_theme_admin_rpcs.sql` → Run。

Expected: `Success. No rows returned.`

- [ ] **Step 2: 驗證 admin user 可呼叫**

在 SQL Editor 切換到 admin user session（或在 Tauri app 內呼叫，Task 6 後）。先在 Studio 用 service_role 跑：

```sql
-- Setup：找一個現有主題的 id 與 name
SELECT id, name FROM vocabulary_themes ORDER BY sort_order LIMIT 1;
-- 假設拿到 id = 'aaaa-bbbb...', name = '朔源'

-- Test rename + cascade
SELECT admin_rename_theme(
  'aaaa-bbbb...'::uuid,
  '朔源（測試）'
);

-- 驗證 vocabulary_themes
SELECT name FROM vocabulary_themes WHERE id = 'aaaa-bbbb...';
-- Expected: '朔源（測試）'

-- 驗證 poster_files cascade
SELECT id, themes FROM poster_files WHERE '朔源（測試）' = ANY(themes) LIMIT 3;
-- Expected: 至少 1 row（如果原本有海報歸 '朔源'）

SELECT id, themes FROM poster_files WHERE '朔源' = ANY(themes) LIMIT 3;
-- Expected: 0 rows

-- 還原
SELECT admin_rename_theme(
  'aaaa-bbbb...'::uuid,
  '朔源'
);
```

- [ ] **Step 3: 驗證 delete 擋 last-active**

```sql
BEGIN;
UPDATE vocabulary_themes SET is_active = false WHERE name != '朔源';
SELECT admin_delete_theme(id) FROM vocabulary_themes WHERE name = '朔源';
-- Expected: ERROR cannot delete last active theme (23514)
ROLLBACK;
```

- [ ] **Step 4: 驗證未授權 user 被拒**

切換到 anon role session（或從前台無 JWT 呼叫）：

```sql
-- 直接從 anon role 試
SELECT admin_rename_theme('aaaa-bbbb...'::uuid, 'X');
-- Expected: ERROR forbidden (42501)
```

- [ ] **Step 5: 紀錄結果**

把實際看到的 success / error 訊息貼進 PR description（之後 Task 13 之後一起貼）。

---

## Task 3: Rust — `list_active_theme_names` + `list_vocabulary_themes_admin`

**Files:**
- Modify: `src-tauri/src/services/supabase.rs`

- [ ] **Step 1: 加兩個 method**

在 `impl SupabaseClient` 區塊內（建議放在 `delete_exhibition` 之後，與 PR-A 的方法為鄰），插入：

```rust
    /// Fetch the active theme names (ordered by `sort_order`) for VLM prompt
    /// injection. Returns `Err` on any HTTP / parsing failure so the caller can
    /// fall back to a hardcoded list.
    pub async fn list_active_theme_names(&self) -> Result<Vec<String>, String> {
        let url = format!(
            "{}/rest/v1/vocabulary_themes?is_active=eq.true&select=name&order=sort_order.asc",
            self.url
        );
        let key = self.bearer_key().await;
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("list_active_theme_names HTTP failed: {}", e))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("list_active_theme_names ({}): {}", status, text));
        }
        let body = resp
            .text()
            .await
            .map_err(|e| format!("read body failed: {}", e))?;
        #[derive(serde::Deserialize)]
        struct Row {
            name: String,
        }
        let rows: Vec<Row> = serde_json::from_str(&body)
            .map_err(|e| format!("parse failed: {}", e))?;
        Ok(rows.into_iter().map(|r| r.name).collect())
    }

    /// List all vocabulary_themes including inactive ones — for the admin
    /// management page. Returns raw JSON to keep the Tauri command thin.
    pub async fn list_vocabulary_themes_admin(&self) -> Result<String, String> {
        let url = format!(
            "{}/rest/v1/vocabulary_themes?select=*&order=sort_order.asc",
            self.url
        );
        let key = self.bearer_key().await;
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("list_vocabulary_themes_admin failed: {}", e))?;
        if resp.status().is_success() {
            resp.text()
                .await
                .map_err(|e| format!("read body failed: {}", e))
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("list_vocabulary_themes_admin ({}): {}", status, text))
        }
    }
```

- [ ] **Step 2: `cargo check`**

```bash
cd src-tauri && cargo check 2>&1 | tail -10
```

Expected: 無 error。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/services/supabase.rs
git commit -m "feat(backend): list_active_theme_names + list_vocabulary_themes_admin

前者給 VLM 動態讀（active+sorted name list）；後者給管理頁
撈完整 row 列表（含 inactive）。"
```

---

## Task 4: Rust — analysis.rs `THEME_LIST` 改 fallback、`build_prompt` 參數化、`request_analysis` 注入 supabase

**Files:**
- Modify: `src-tauri/src/services/qwenpaw/analysis.rs`
- Modify: `src-tauri/src/services/qwenpaw/task_queue.rs`

- [ ] **Step 1: 改 analysis.rs `THEME_LIST` 與 `build_prompt`**

找到 `src-tauri/src/services/qwenpaw/analysis.rs:26-27`：

```rust
const THEME_LIST: &str =
    "朔源、慈善、醫療、教育、人文、環保、茹素護生、國際賑災、靜思語、大事記、法華坡道、年度主題";
```

改為：

```rust
/// Used when Supabase is unreachable at analysis time — keeps the VLM
/// classification operational with the original 12 themes. Kept in sync with
/// migration 006 seed; if admin renames/adds/removes themes via the management
/// UI, the dynamic fetch will pick up the changes — fallback only kicks in
/// when the network is down.
const FALLBACK_THEMES: &str =
    "朔源、慈善、醫療、教育、人文、環保、茹素護生、國際賑災、靜思語、大事記、法華坡道、年度主題";
```

然後 `build_prompt` (`analysis.rs:29-60`)：

```rust
pub fn build_prompt() -> String {
    format!(
        r#"你是海報資料庫的 AI 分析員...
"#,
        themes = THEME_LIST
    )
}
```

改為：

```rust
pub fn build_prompt(themes: &str) -> String {
    format!(
        r#"你是海報資料庫的 AI 分析員，請仔細觀察這張海報圖片並產生結構化分析，以 JSON 回傳。

Schema：
{{
  "ocr_text": <string: 逐字抄錄海報上所有可見文字 — 含主標題、副標題、日期、時間、地點、主辦/協辦單位、聯絡資訊、口號、腳註。依照海報上的閱讀順序排列，用全形頓號或換行分隔。**重要:總長請限制在 600 字以內;若海報文字非常多(像網頁截圖),優先保留主標題、時間、地點、主辦單位、關鍵口號,次要的長段落用「⋯」省略**>,
  "themes": <array of string: 從 [{themes}] 中選 1-3 個最相關主題>,
  "description": <string: 150-300 字的完整敘述。必須涵蓋以下面向（用自然語言整段寫，不要列點）：(1) 主視覺與核心訴求；(2) 主標題與重要文案；(3) 如果是活動海報，寫出活動名稱、時間、地點、主辦單位；(4) 人物、logo、插畫、背景等視覺元素；(5) 色彩基調與設計風格（例如「以藍綠為主調的扁平插畫風」）；(6) 推測的目標受眾與海報用途。整段文字要像專業的典藏描述，讓沒看到圖的人能清楚想像這張海報>,
  "language": <string: 海報使用的主要語言，例如「繁體中文」/「英文」/「中英雙語」/「繁體中文、英文」>,
  "has_logo": <bool: 是否含有清楚可辨識的組織標誌 / logo>,
  "has_person": <bool: 是否有人物照片或人物插圖出現在海報上>,
  "scores": {{
    "composition": <int 0-100: 構圖平衡、留白、視覺動線>,
    "clarity": <int 0-100: 文字易讀性、重點層級是否清楚>,
    "design_quality": <int 0-100: 字體 / 配色 / 插圖品質整體表現>,
    "content_completeness": <int 0-100: 活動資訊是否完整（時間、地點、聯絡方式）>,
    "typography": <int 0-100: 字體搭配、字級層次、排版節奏>
  }},
  "suggestions": <string: 80-150 字給審核員的改善或補充建議。若設計良好就寫出亮點；若有缺失就具體指出（例如「日期與地點字級偏小，建議放大 1.5 倍」「配色太跳，可將紅色降到 60% 飽和度」）>
}}

規則：
- 必須根據實際圖片內容填入真實資訊，不得照抄 schema 描述文字。
- 抓不到的欄位填空字串 "" 或空陣列 []；scores 仍須給數字（無法判斷時填 60）。
- description 至少 150 字；若資訊非常豐富可寫到 300 字。
- OCR 文字必須逐字保留，不要意譯或省略。
- scores 五個維度都要有數字，0-100。
- 只回傳 JSON，不要加任何 markdown 或註解。"#,
        themes = themes
    )
}

/// Fetch the current active theme list from Supabase, with hardcoded fallback
/// so an outage doesn't break poster analysis.
async fn resolve_theme_list(supabase: &crate::services::supabase::SupabaseClient) -> String {
    match supabase.list_active_theme_names().await {
        Ok(names) if !names.is_empty() => names.join("、"),
        Ok(_) => {
            warn!("[Analysis] vocabulary_themes returned empty; using fallback");
            FALLBACK_THEMES.to_string()
        }
        Err(e) => {
            warn!("[Analysis] fetch themes failed ({}); using fallback", e);
            FALLBACK_THEMES.to_string()
        }
    }
}
```

- [ ] **Step 2: 改 `request_analysis` 簽名**

找到 `analysis.rs:129-134`：

```rust
pub async fn request_analysis(
    file_id: &str,
    image_bytes: &[u8],
    filename: &str,
    vlm_base_url: Option<&str>,
) -> AiAnalysis {
```

改為：

```rust
pub async fn request_analysis(
    file_id: &str,
    image_bytes: &[u8],
    filename: &str,
    vlm_base_url: Option<&str>,
    supabase: &crate::services::supabase::SupabaseClient,
) -> AiAnalysis {
```

然後找 `analysis.rs:173` 那行 `let prompt = build_prompt();` 改為：

```rust
    let themes = resolve_theme_list(supabase).await;
    let prompt = build_prompt(&themes);
```

- [ ] **Step 3: 改 task_queue.rs call site**

找到 `src-tauri/src/services/qwenpaw/task_queue.rs:214-220`：

```rust
let ai = analysis::request_analysis(
    &task.file_id,
    &bytes,
    &task.original_filename,
    vlm_base_url,
)
.await;
```

改為：

```rust
let ai = analysis::request_analysis(
    &task.file_id,
    &bytes,
    &task.original_filename,
    vlm_base_url,
    supabase,
)
.await;
```

(`supabase: &SupabaseClient` 在 `process_one` scope 已可用，line 111。)

- [ ] **Step 4: `cargo check`**

```bash
cd src-tauri && cargo check 2>&1 | tail -15
```

Expected: 無 error。如果有 `use crate::services::supabase::SupabaseClient` 缺失 warning，在 analysis.rs 頂部加 import：

```rust
use crate::services::supabase::SupabaseClient;
```

並把 `resolve_theme_list` / `request_analysis` 的型別 fully-qualified 路徑改 short form。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/qwenpaw/analysis.rs src-tauri/src/services/qwenpaw/task_queue.rs
git commit -m "feat(VLM): 動態讀 vocabulary_themes 拼 prompt（fallback 保底）

const THEME_LIST 改成 FALLBACK_THEMES；build_prompt 接 themes 參數；
request_analysis 多收 supabase ref，分析前 list_active_theme_names →
join '、'；網路/RLS 任一失敗就 fallback 硬碼 12 主題。

VLM 多一次 ~50ms HTTP；分析本身 1-15s，可忽略。"
```

---

## Task 5: Rust — vocabulary_themes CRUD methods + commands

**Files:**
- Modify: `src-tauri/src/services/supabase.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 加 method (insert + RPC wrappers)**

在 `services/supabase.rs` 內、`list_vocabulary_themes_admin` 之後插入：

```rust
    /// Insert a new vocabulary_themes row. Returns the inserted row JSON so
    /// frontend can splice without re-fetch.
    pub async fn insert_vocabulary_theme(
        &self,
        name: &str,
        code: Option<&str>,
        icon: Option<&str>,
        color: Option<&str>,
        bg_color: Option<&str>,
        description: Option<&str>,
        cover_image: Option<&str>,
        sort_order: Option<i32>,
        is_active: bool,
    ) -> Result<String, String> {
        let mut body = json!({
            "name": name,
            "is_active": is_active,
        });
        if let Some(v) = code.filter(|s| !s.is_empty())        { body["code"]        = json!(v); }
        if let Some(v) = icon.filter(|s| !s.is_empty())        { body["icon"]        = json!(v); }
        if let Some(v) = color.filter(|s| !s.is_empty())       { body["color"]       = json!(v); }
        if let Some(v) = bg_color.filter(|s| !s.is_empty())    { body["bg_color"]    = json!(v); }
        if let Some(v) = description.filter(|s| !s.is_empty()) { body["description"] = json!(v); }
        if let Some(v) = cover_image.filter(|s| !s.is_empty()) { body["cover_image"] = json!(v); }
        if let Some(o) = sort_order { body["sort_order"] = json!(o); }

        let url = format!("{}/rest/v1/vocabulary_themes", self.url);
        let key = self.bearer_key().await;
        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=representation")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Insert vocabulary_theme failed: {}", e))?;
        if resp.status().is_success() || resp.status().as_u16() == 201 {
            resp.text().await.map_err(|e| format!("read body: {}", e))
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Insert vocabulary_theme ({}): {}", status, text))
        }
    }

    /// Call admin_rename_theme RPC. Pass through all editable fields; the SQL
    /// function uses COALESCE so `None` keeps existing values.
    #[allow(clippy::too_many_arguments)]
    pub async fn rpc_admin_rename_theme(
        &self,
        id: &str,
        new_name: &str,
        code: Option<&str>,
        icon: Option<&str>,
        color: Option<&str>,
        bg_color: Option<&str>,
        description: Option<&str>,
        cover_image: Option<&str>,
        sort_order: Option<i32>,
        is_active: Option<bool>,
    ) -> Result<(), String> {
        let mut body = json!({
            "p_id": id,
            "p_new_name": new_name,
        });
        if let Some(v) = code        { body["p_code"]        = json!(v); }
        if let Some(v) = icon        { body["p_icon"]        = json!(v); }
        if let Some(v) = color       { body["p_color"]       = json!(v); }
        if let Some(v) = bg_color    { body["p_bg_color"]    = json!(v); }
        if let Some(v) = description { body["p_description"] = json!(v); }
        if let Some(v) = cover_image { body["p_cover_image"] = json!(v); }
        if let Some(o) = sort_order  { body["p_sort_order"]  = json!(o); }
        if let Some(a) = is_active   { body["p_is_active"]   = json!(a); }

        let url = format!("{}/rest/v1/rpc/admin_rename_theme", self.url);
        let key = self.bearer_key().await;
        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("admin_rename_theme RPC failed: {}", e))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("admin_rename_theme ({}): {}", status, text))
        }
    }

    /// Call admin_delete_theme RPC.
    pub async fn rpc_admin_delete_theme(&self, id: &str) -> Result<(), String> {
        let url = format!("{}/rest/v1/rpc/admin_delete_theme", self.url);
        let key = self.bearer_key().await;
        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .body(json!({ "p_id": id }).to_string())
            .send()
            .await
            .map_err(|e| format!("admin_delete_theme RPC failed: {}", e))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("admin_delete_theme ({}): {}", status, text))
        }
    }
```

- [ ] **Step 2: 加 4 個 Tauri commands**

在 `lib.rs` 內、Phase 2 commands 之後插入：

```rust
/// List all vocabulary_themes including inactive ones.
#[tauri::command]
async fn list_vocabulary_themes_admin(
    state: tauri::State<'_, upload::UploadState>,
) -> Result<String, String> {
    state.supabase_client.list_vocabulary_themes_admin().await
}

/// Create a vocabulary_themes row.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn create_vocabulary_theme(
    state: tauri::State<'_, upload::UploadState>,
    name: String,
    code: Option<String>,
    icon: Option<String>,
    color: Option<String>,
    bg_color: Option<String>,
    description: Option<String>,
    cover_image: Option<String>,
    sort_order: Option<i32>,
    is_active: Option<bool>,
) -> Result<String, String> {
    if name.trim().is_empty() {
        return Err("主題名稱不可為空".into());
    }
    state
        .supabase_client
        .insert_vocabulary_theme(
            name.trim(),
            code.as_deref(),
            icon.as_deref(),
            color.as_deref(),
            bg_color.as_deref(),
            description.as_deref(),
            cover_image.as_deref(),
            sort_order,
            is_active.unwrap_or(true),
        )
        .await
}

/// Update a vocabulary_themes row via admin_rename_theme RPC. The RPC
/// transactionally cascades into poster_files.themes when name changes.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn update_vocabulary_theme(
    state: tauri::State<'_, upload::UploadState>,
    id: String,
    new_name: String,
    code: Option<String>,
    icon: Option<String>,
    color: Option<String>,
    bg_color: Option<String>,
    description: Option<String>,
    cover_image: Option<String>,
    sort_order: Option<i32>,
    is_active: Option<bool>,
) -> Result<(), String> {
    if new_name.trim().is_empty() {
        return Err("主題名稱不可為空".into());
    }
    state
        .supabase_client
        .rpc_admin_rename_theme(
            &id,
            new_name.trim(),
            code.as_deref(),
            icon.as_deref(),
            color.as_deref(),
            bg_color.as_deref(),
            description.as_deref(),
            cover_image.as_deref(),
            sort_order,
            is_active,
        )
        .await
}

/// Delete a vocabulary_themes row via admin_delete_theme RPC.
#[tauri::command]
async fn delete_vocabulary_theme(
    state: tauri::State<'_, upload::UploadState>,
    id: String,
) -> Result<(), String> {
    state.supabase_client.rpc_admin_delete_theme(&id).await
}
```

- [ ] **Step 3: 註冊**

在 `invoke_handler!` 中（PR-A Phase 2 commands 之後）：

```rust
            // Vocabulary themes (PR-B)
            list_vocabulary_themes_admin,
            create_vocabulary_theme,
            update_vocabulary_theme,
            delete_vocabulary_theme,
```

- [ ] **Step 4: `cargo check` + commit**

```bash
cd src-tauri && cargo check 2>&1 | tail -10
cd ..
git add src-tauri/src/services/supabase.rs src-tauri/src/lib.rs
git commit -m "feat(backend): vocabulary_themes CRUD + RPC wrappers

list_vocabulary_themes_admin / create_vocabulary_theme /
update_vocabulary_theme (走 admin_rename_theme RPC) /
delete_vocabulary_theme (走 admin_delete_theme RPC)。
RPC 走 SECURITY DEFINER → RLS 不擋；admin role check 在 SQL 函式內。"
```

---

## Task 6: Rust — `update_poster_file_themes` method + command

**Files:**
- Modify: `src-tauri/src/services/supabase.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 加 method**

```rust
    /// Replace the `poster_files.themes` array for a single file. Used by the
    /// manual classification chips in the poster edit page.
    pub async fn update_poster_file_themes(
        &self,
        file_id: &str,
        themes: &[String],
    ) -> Result<(), String> {
        let url = format!("{}/rest/v1/poster_files?id=eq.{}", self.url, file_id);
        let key = self.bearer_key().await;
        let body = json!({ "themes": themes });
        let resp = self
            .client
            .patch(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("update_poster_file_themes failed: {}", e))?;
        if resp.status().is_success() {
            info!("[Supabase] Updated themes for file {}: {:?}", file_id, themes);
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("update_poster_file_themes ({}): {}", status, text))
        }
    }
```

- [ ] **Step 2: 加 Tauri command**

```rust
/// Replace the themes array for a single poster_files row. Admin manual override.
#[tauri::command]
async fn update_poster_file_themes(
    state: tauri::State<'_, upload::UploadState>,
    file_id: String,
    themes: Vec<String>,
) -> Result<(), String> {
    state
        .supabase_client
        .update_poster_file_themes(&file_id, &themes)
        .await
}
```

- [ ] **Step 3: 註冊**

```rust
            update_poster_file_themes,
```

- [ ] **Step 4: `cargo check` + commit**

```bash
cd src-tauri && cargo check 2>&1 | tail -10
cd ..
git add src-tauri/src/services/supabase.rs src-tauri/src/lib.rs
git commit -m "feat(backend): update_poster_file_themes (手動歸類)

讓海報編輯頁的主題 chip 一勾就存。RLS 依 poster_files 既有 policy
（作者或系統管理員）。"
```

---

## Task 7: 前端 — `api.ts` wrappers + 型別

**Files:**
- Modify: `src/lib/api.ts` (append after PR-A 的 wrappers)

- [ ] **Step 1: 追加區塊**

```ts
// ── Vocabulary themes (主題 CRUD — PR-B) ──────────────────────────────

export interface VocabularyTheme {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  bg_color?: string | null;
  cover_image?: string | null;
  sort_order?: number | null;
  is_active: boolean;
  poster_count?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface ThemePayload {
  name: string;
  code?: string;
  icon?: string;
  color?: string;
  bgColor?: string;
  description?: string;
  coverImage?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export async function listVocabularyThemesAdmin(): Promise<VocabularyTheme[]> {
  const raw = await invoke<string>("list_vocabulary_themes_admin");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as VocabularyTheme[]) : [];
}

export async function createVocabularyTheme(input: ThemePayload): Promise<string> {
  return invoke<string>("create_vocabulary_theme", {
    name: input.name,
    code: input.code ?? null,
    icon: input.icon ?? null,
    color: input.color ?? null,
    bgColor: input.bgColor ?? null,
    description: input.description ?? null,
    coverImage: input.coverImage ?? null,
    sortOrder: input.sortOrder ?? null,
    isActive: input.isActive ?? true,
  });
}

export async function updateVocabularyTheme(
  id: string,
  newName: string,
  patch: Omit<ThemePayload, "name">,
): Promise<void> {
  return invoke<void>("update_vocabulary_theme", {
    id,
    newName,
    code: patch.code ?? null,
    icon: patch.icon ?? null,
    color: patch.color ?? null,
    bgColor: patch.bgColor ?? null,
    description: patch.description ?? null,
    coverImage: patch.coverImage ?? null,
    sortOrder: patch.sortOrder ?? null,
    isActive: patch.isActive ?? null,
  });
}

export async function deleteVocabularyTheme(id: string): Promise<void> {
  return invoke<void>("delete_vocabulary_theme", { id });
}

// ── Manual classification (海報手動歸類) ──────────────────────────────

export async function updatePosterFileThemes(
  fileId: string,
  themes: string[],
): Promise<void> {
  return invoke<void>("update_poster_file_themes", { fileId, themes });
}
```

- [ ] **Step 2: `tsc` + commit**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/lib/api.ts
git commit -m "feat(api): 5 wrappers for theme CRUD + manual classification"
```

---

## Task 8: 前端 — `ThemeEditModal` 元件

**Files:**
- Create: `src/components/ThemeEditModal.tsx`

- [ ] **Step 1: 寫元件**

```tsx
// src/components/ThemeEditModal.tsx
import { Loader2, X } from "lucide-react";
import { useState } from "react";
import {
  createVocabularyTheme,
  updateVocabularyTheme,
  type VocabularyTheme,
} from "../lib/api";

interface Props {
  /** Existing theme to edit, or null for create mode. */
  initial: VocabularyTheme | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Add/edit a vocabulary_theme. The rename-warning surfaces when initial.name
 * differs from the new value, because that triggers a cascade UPDATE across
 * poster_files.themes arrays (server-side, transactional).
 */
export function ThemeEditModal({ initial, onClose, onSaved }: Props) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "");
  const [color, setColor] = useState(initial?.color ?? "");
  const [bgColor, setBgColor] = useState(initial?.bg_color ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [coverImage, setCoverImage] = useState(initial?.cover_image ?? "");
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameChanged = isEdit && name.trim() !== (initial?.name ?? "");

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("主題名稱不可為空");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit && initial) {
        await updateVocabularyTheme(initial.id, name.trim(), {
          code: code || undefined,
          icon: icon || undefined,
          color: color || undefined,
          bgColor: bgColor || undefined,
          description: description || undefined,
          coverImage: coverImage || undefined,
          sortOrder,
          isActive,
        });
      } else {
        await createVocabularyTheme({
          name: name.trim(),
          code: code || undefined,
          icon: icon || undefined,
          color: color || undefined,
          bgColor: bgColor || undefined,
          description: description || undefined,
          coverImage: coverImage || undefined,
          sortOrder,
          isActive,
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {isEdit ? "編輯主題" : "新增主題"}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 cursor-pointer">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          <Field label="名稱 *">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            {nameChanged && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠️ 改名會同步更新所有已歸入此主題的海報（後端交易內處理）
              </p>
            )}
          </Field>

          <Field label="代號 (slug)">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="例如：charity"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Icon (emoji)">
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                maxLength={4}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </Field>
            <Field label="主色">
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#dc2626"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </Field>
            <Field label="底色">
              <input
                type="text"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                placeholder="#fee2e2"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </Field>
          </div>

          <Field label="描述">
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </Field>

          <Field label="封面圖路徑">
            <input
              type="text"
              value={coverImage}
              onChange={(e) => setCoverImage(e.target.value)}
              placeholder="/charity-helping-hands.jpg"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </Field>

          <div className="flex items-center gap-4">
            <Field label="排序">
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                className="w-24 px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </Field>
            <label className="inline-flex items-center gap-2 mt-5">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">啟用</span>
            </label>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 cursor-pointer disabled:opacity-50 inline-flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            儲存
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
```

- [ ] **Step 2: `tsc` + commit**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/components/ThemeEditModal.tsx
git commit -m "feat(ui): ThemeEditModal 主題新增/編輯 modal

含 rename warning（與舊名不同時顯示），與 admin_rename_theme RPC
的 cascade 行為對應。"
```

---

## Task 9: 前端 — `/exhibitions` 加 edit mode toolbar + 卡片 overlay

**Files:**
- Modify: `src/routes/exhibitions/index.tsx`

- [ ] **Step 1: 切換到管理模式的 state + toolbar**

把現有的 `ThemePosterManagement` 整個改寫，新版本同時支援瀏覽模式（既有：點卡開抽屜）與管理模式（點卡 = edit；額外有新增卡）。重寫 `/exhibitions/index.tsx` 為下面內容（注意：保留既有 `ThemePosterDrawer` 區塊原封不動，只改主元件）：

找到 `function ThemePosterManagement()` 主元件（line 46 起），整個 component body 取代為：

```tsx
function ThemePosterManagement() {
  const [themes, setThemes] = useState<VocabularyTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<VocabularyTheme | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingTheme, setEditingTheme] = useState<VocabularyTheme | null>(null);
  const [creatingTheme, setCreatingTheme] = useState(false);
  const [deleting, setDeleting] = useState<VocabularyTheme | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 管理模式撈全部（含 inactive）；瀏覽模式維持舊行為（只撈 active）。
      const data = editMode
        ? await listVocabularyThemesAdmin()
        : await querySupabase<VocabularyTheme>(
            "vocabulary_themes",
            "is_active=eq.true&order=sort_order.asc",
          );
      setThemes(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [editMode]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">
            主題海報{editMode && " · 管理模式"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {editMode
              ? "點任一卡編輯；卡的右下角可刪除。改名與刪除會自動處理已歸類海報。"
              : "依 12 個主題瀏覽底下收錄的海報。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editMode && (
            <button
              onClick={() => setCreatingTheme(true)}
              className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 cursor-pointer inline-flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> 新增主題
            </button>
          )}
          <button
            onClick={() => setEditMode((v) => !v)}
            className={`px-3 py-1.5 text-sm rounded-lg cursor-pointer inline-flex items-center gap-1 ${
              editMode
                ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                : "border border-gray-200 text-gray-700 hover:border-primary/40"
            }`}
          >
            {editMode ? "完成" : (
              <>
                <Pencil className="w-4 h-4" /> 編輯主題
              </>
            )}
          </button>
        </div>
      </div>

      {/* Loading / error 略，沿用既有版本（複製原本 line 86-98） */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}
      {error && (
        <div className="text-center py-12">
          <p className="text-red-500 text-sm mb-2">載入主題失敗</p>
          <p className="text-gray-400 text-xs">{error}</p>
        </div>
      )}

      {/* Theme grid */}
      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {themes.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <p className="text-gray-400 text-sm">
                還沒有任何主題。請先於 Supabase 套用 006_vocabulary_themes.sql migration。
              </p>
            </div>
          ) : (
            themes.map((t) => (
              <div
                key={t.id}
                onClick={() => {
                  if (editMode) setEditingTheme(t);
                  else setSelectedTheme(t);
                }}
                className={`relative card-box p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg cursor-pointer ${
                  !t.is_active ? "opacity-50" : ""
                }`}
                style={{ backgroundColor: t.bg_color || "#f9fafb" }}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-3xl" aria-hidden>
                    {t.icon || "📁"}
                  </span>
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-white/80 text-gray-700">
                    {t.poster_count ?? 0} 張
                  </span>
                </div>
                <h3 className="text-lg font-bold mb-1" style={{ color: t.color || "#1f2937" }}>
                  {t.name}
                </h3>
                <p className="text-xs text-gray-600 line-clamp-3 min-h-[3rem]">
                  {t.description || "—"}
                </p>
                {editMode && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(t);
                    }}
                    className="absolute bottom-3 right-3 p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-white/60 cursor-pointer"
                    title="刪除主題"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Drawer (browse mode only) */}
      {!editMode && selectedTheme && (
        <ThemePosterDrawer theme={selectedTheme} onClose={() => setSelectedTheme(null)} />
      )}

      {/* Edit / create modals */}
      {(editingTheme || creatingTheme) && (
        <ThemeEditModal
          initial={editingTheme}
          onClose={() => {
            setEditingTheme(null);
            setCreatingTheme(false);
          }}
          onSaved={reload}
        />
      )}

      {/* Delete confirm */}
      {deleting && (
        <ThemeDeleteConfirm
          theme={deleting}
          onClose={() => setDeleting(null)}
          onConfirmed={() => {
            setDeleting(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
```

頂部 imports 同步更新：

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, X, Search, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  listVocabularyThemesAdmin,
  querySupabase,
  type VocabularyTheme,
} from "../../lib/api";
import { ThemeEditModal } from "../../components/ThemeEditModal";
import { ThemeDeleteConfirm } from "../../components/ThemeDeleteConfirm";
```

（移除舊的本地 `interface VocabularyTheme` 定義，因為已從 api.ts 匯入。）

- [ ] **Step 2: 寫 `ThemeDeleteConfirm`**

Create `src/components/ThemeDeleteConfirm.tsx`：

```tsx
// src/components/ThemeDeleteConfirm.tsx
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteVocabularyTheme, querySupabase, type VocabularyTheme } from "../lib/api";

interface Props {
  theme: VocabularyTheme;
  onClose: () => void;
  onConfirmed: () => void;
}

/**
 * Delete confirmation that previews how many poster_files contain this theme
 * in their text[] (these get array_remove'd by the admin_delete_theme RPC).
 */
export function ThemeDeleteConfirm({ theme, onClose, onConfirmed }: Props) {
  const [affected, setAffected] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // PostgREST `cs` on text[] — `themes=cs.{name}` with curly braces encoded.
        const encoded = encodeURIComponent(`{${theme.name}}`);
        const rows = await querySupabase<{ id: string }>(
          "poster_files",
          `themes=cs.${encoded}&select=id&limit=10000`,
        );
        if (!cancelled) setAffected(rows.length);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [theme.name]);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteVocabularyTheme(theme.id);
      onConfirmed();
    } catch (e) {
      setError(String(e));
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 space-y-3">
          <h3 className="text-lg font-semibold">即將刪除「{theme.name}」</h3>
          <p className="text-sm text-gray-600">
            {affected === null && "計算影響海報數中…"}
            {affected !== null && (
              <>
                此主題目前歸類了 <strong>{affected}</strong> 張海報，刪除後將從這些海報移除此歸類
                （海報本身不會被刪，其他主題保留）。
              </>
            )}
          </p>
          <p className="text-xs text-amber-600">
            ⚠️ VLM prompt 會在下次分析時自動排除此主題。
          </p>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting || affected === null}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 cursor-pointer disabled:opacity-50 inline-flex items-center gap-2"
          >
            {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
            確認刪除
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `npm run build` + commit**

```bash
npm run build 2>&1 | tail -15
git add src/routes/exhibitions/index.tsx src/components/ThemeDeleteConfirm.tsx
git commit -m "feat(ui): /exhibitions 加編輯主題模式 + delete confirm

右上 toggle 切換瀏覽 / 管理模式：管理模式下點卡 = 開 ThemeEditModal；
卡右下垃圾桶 = 開 ThemeDeleteConfirm（含影響海報數預覽）；
toolbar 多「+ 新增主題」按鈕。inactive 主題卡片半透明顯示。"
```

---

## Task 10: 前端 — `/posters/$projectId/edit` themes chip toggles

**Files:**
- Modify: `src/routes/posters/$projectId.edit.tsx`

- [ ] **Step 1: 看一下要改的區塊**

打開 `src/routes/posters/$projectId.edit.tsx`，找到 line 813-821：

```tsx
<div className="flex flex-wrap items-center gap-1.5">
  {ai.themes?.map((t) => (
    <span
      key={t}
      className="px-2 py-0.5 rounded-full text-xs bg-white border border-indigo-200 text-indigo-700"
    >
      {t}
    </span>
  ))}
  {/* ... 其他 pills */}
</div>
```

- [ ] **Step 2: 改成 chip toggle**

把 `{ai.themes?.map(...)}` 區塊替換為呼叫新元件 `<ThemeChipToggles>`。先把全域可用的主題清單拉到頂層 component。在 `function PosterEdit()` 內最上面（與其他 `useState` 並列）加：

```tsx
const [activeThemes, setActiveThemes] = useState<VocabularyTheme[]>([]);

useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const data = await querySupabase<VocabularyTheme>(
        "vocabulary_themes",
        "is_active=eq.true&order=sort_order.asc",
      );
      if (!cancelled) setActiveThemes(data);
    } catch (e) {
      console.error("Failed to load themes:", e);
    }
  })();
  return () => {
    cancelled = true;
  };
}, []);
```

加 imports：

```tsx
import { querySupabase, updatePosterFileThemes, type VocabularyTheme } from "../../lib/api";
```

接著把 line 813-821 換成：

```tsx
<ThemeChipToggles
  fileId={f.id}
  currentThemes={ai.themes ?? []}
  allActiveThemes={activeThemes}
  onUpdated={(next) => {
    // Mutate local state so the page stays consistent without re-fetch.
    setFiles((prev) =>
      prev.map((file) =>
        file.id === f.id
          ? { ...file, ai_analysis: { ...(file.ai_analysis ?? {}), themes: next } }
          : file,
      ),
    );
  }}
/>
```

- [ ] **Step 3: 在同檔內加 `ThemeChipToggles` sub-component**

放在檔案底部（`function PosterEdit()` 之外）：

```tsx
interface ThemeChipTogglesProps {
  fileId: string;
  currentThemes: string[];
  allActiveThemes: VocabularyTheme[];
  onUpdated: (next: string[]) => void;
}

function ThemeChipToggles({
  fileId,
  currentThemes,
  allActiveThemes,
  onUpdated,
}: ThemeChipTogglesProps) {
  const [saving, setSaving] = useState(false);

  const toggle = async (name: string) => {
    const isOn = currentThemes.includes(name);
    const next = isOn
      ? currentThemes.filter((t) => t !== name)
      : [...currentThemes, name];
    onUpdated(next); // optimistic
    setSaving(true);
    try {
      await updatePosterFileThemes(fileId, next);
    } catch (e) {
      console.error("Update themes failed:", e);
      alert(`儲存主題失敗：${e}`);
      onUpdated(currentThemes); // rollback
    } finally {
      setSaving(false);
    }
  };

  if (allActiveThemes.length === 0) {
    return <p className="text-xs text-gray-400">主題清單尚未載入…</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">AI 主題（可手動調整）</span>
        {saving && <Loader2 className="w-3 h-3 text-gray-400 animate-spin" />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {allActiveThemes.map((theme) => {
          const active = currentThemes.includes(theme.name);
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => toggle(theme.name)}
              className={`px-2 py-0.5 rounded-full text-xs border cursor-pointer transition ${
                active
                  ? "bg-indigo-100 border-indigo-300 text-indigo-700"
                  : "bg-white border-gray-200 text-gray-500 hover:border-indigo-200"
              }`}
            >
              {active ? "✓ " : ""}
              {theme.icon ? `${theme.icon} ` : ""}
              {theme.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `npm run build` + commit**

```bash
npm run build 2>&1 | tail -15
git add src/routes/posters/\$projectId.edit.tsx
git commit -m "feat(ui): 海報編輯頁主題改成可手動勾選 chip

替代既有 read-only pills；點 chip 即時 invoke
update_poster_file_themes，optimistic UI + 失敗回滾。
主題清單從 vocabulary_themes 動態讀（active 且按 sort_order）。"
```

---

## Task 11: 清理 PR-A 留下的 ExhibitionModal `edit` dead branch

**Files:**
- Modify: `src/routes/exhibition-structure.tsx`

- [ ] **Step 1: 拔掉 dead code**

打開 `src/routes/exhibition-structure.tsx`，找到 `function ExhibitionModal({ mode, ... })`（line 415 起）：

(1) 把 PR-A Task 11 留下的 TODO 註解（`TODO(PR-B): ExhibitionModal ...`）整段拔掉。

(2) 找到 `mode` 參數的型別與分支。把 `mode` 由 `"create" | { kind: "edit"; exhibition: Exhibition }` 改為 `"create"` 單一情況；移除所有 `if (mode.kind === "edit") ...` / `mode === "edit"` 的分支與相關 state。

(3) `setModal` 型別也只剩 `{ kind: "create" }`（除非 modal 還有別的用途）。讓 TS 報錯指引必要的修改點，把所有引用一次清掉。

> ⚠️ 因為 ExhibitionModal 程式碼較長（line 415–630），具體修改步驟在實作時依 TS 編譯錯誤 walk 一遍。本 task 的驗收是「`npm run build` 通過且 `setModal({ kind: 'edit', ...` 在 codebase 內 0 hit」。

- [ ] **Step 2: 驗證 dead code 已清除**

Run:
```bash
grep -rn "kind:.*\"edit\"\|mode.kind.*edit" src/
```

Expected: 0 matches。

- [ ] **Step 3: `npm run build` + commit**

```bash
npm run build 2>&1 | tail -15
git add src/routes/exhibition-structure.tsx
git commit -m "refactor(ui): 拔掉 ExhibitionModal edit dead branch

PR-A 已把展覽編輯移到 /exhibitions/\$id/edit，本 PR 清理 modal
的 edit 分支與相關 state，讓 ExhibitionModal 單一職責 = 新增展覽。"
```

---

## Task 12: 手動 E2E 驗證

**Files:** N/A — verification only

- [ ] **Step 1: 啟動 dev**

```bash
npm run tauri dev
```

- [ ] **Step 2: 驗收 1 — 改主題名 cascade**

1. 進 `/exhibitions` → 「編輯主題」
2. 點「慈善」卡 → 改名為「慈善志業」→ 儲存
3. 開 SQL Editor：
   ```sql
   SELECT name FROM vocabulary_themes WHERE id = '<慈善 uuid>';
   -- Expected: 慈善志業
   SELECT COUNT(*) FROM poster_files WHERE '慈善志業' = ANY(themes);
   -- Expected: > 0
   SELECT COUNT(*) FROM poster_files WHERE '慈善' = ANY(themes);
   -- Expected: 0
   ```
4. 開 workers.dev `https://tzuchi-poster-platform.tzuchi-webit.workers.dev/`：原本歸「慈善」的海報已換成「慈善志業」
5. 改回「慈善」以還原

- [ ] **Step 3: 驗收 2 — 新增主題 → VLM 即時看到**

1. 「+ 新增主題」→ 名稱「青年志工」、icon ✊、is_active 勾 → 儲存
2. 不重啟 Tauri，到「海報管理」上傳一張新海報
3. 等 VLM 跑完
4. 進該海報編輯頁，看 `ai.themes` 是否可能含「青年志工」（依圖內容而定）
5. 但 prompt 應已包含 — 確認方法：看 Tauri devtools console 應有 log `[Analysis] running local VLM...`；prompt 內部其實看不到，可進階看 `vlm_local::analyze` 的 trace

替代驗證：在 admin 改完主題後，按一張既有海報的「重新分析」按鈕；分析完查 `poster_files.themes` 該海報的 array 內有沒有新主題的可能性。

- [ ] **Step 4: 驗收 3 — 刪主題 strip orphans**

1. 刪「青年志工」（剛建的）
2. 確認 confirm dialog 顯示影響海報數
3. 確認後查 DB：
   ```sql
   SELECT COUNT(*) FROM poster_files WHERE '青年志工' = ANY(themes);
   -- Expected: 0
   ```

- [ ] **Step 5: 驗收 4 — 手動歸類 chip toggle**

1. 進任一海報的 `/posters/<id>/edit`
2. 對任一檔案找到「AI 主題（可手動調整）」chip 區
3. 勾掉一個 / 補一個
4. 應立即在右下方看 spinner，停後 chip 狀態保留
5. F5 reload → 變化保留

- [ ] **Step 6: 驗收 5 — 擋最後一個 active theme**

1. 進「編輯主題」
2. 把 11 個主題的 is_active 全改 false（透過編輯 modal）
3. 留 1 個 active 的主題 → 嘗試刪 → 確認 dialog 後 RPC 應回 error
4. 前端顯示 `cannot delete last active theme`
5. 把 11 個改回 active 還原

- [ ] **Step 7: 驗收 6 — 未授權 user**

如果方便：用非系統管理員帳號登入嘗試任一管理操作 → 應該被 RLS 或 RPC 內的 app_role check 擋。錯誤訊息含 `forbidden` 或 `42501`。

- [ ] **Step 8: 開 PR**

```bash
gh pr create --base main --title "feat(themes): vocabulary_themes CRUD + 手動歸類 + VLM 動態讀表" --body "$(cat <<'EOF'
## What

補完 admin 對主題分類體系的完整控制 — 在不重啟 Tauri 的狀況下能改名 / 新增 / 刪除主題，且既有歸類自動 cascade；海報編輯頁可手動矯正 VLM 的主題判斷。

## Why

`vocabulary_themes.name` 是 `poster_files.themes` text[] 的真正 join key（無 FK），同時也是 VLM `THEME_LIST` 硬編碼的內容。三處綁死導致 admin 無法在 admin app 內安全地動主題。本 PR 解：

- SQL RPC 處理 rename/delete 的 cascade（交易內、SECURITY DEFINER）
- VLM prompt 改成執行時動態抓表（fallback 硬碼 12 主題保底）
- UI 提供完整 CRUD 與手動歸類

## How

- **migration 011**：`admin_rename_theme` + `admin_delete_theme` 兩支 RPC
- **Rust**：`list_active_theme_names` / `list_vocabulary_themes_admin` / vocabulary_themes CRUD / `update_poster_file_themes`
- **VLM**：`analysis.rs::build_prompt(themes: &str)` + `request_analysis` 收 `&SupabaseClient` 引數
- **前端**：
  - `/exhibitions` 右上「編輯主題」toggle → 管理模式（卡 = 編輯、垃圾桶 = 刪除、+ 新增主題）
  - `ThemeEditModal` 含 rename 警告
  - `ThemeDeleteConfirm` 預覽影響海報數
  - `/posters/\$id/edit` 主題 read-only pills 改 chip toggle

## Verification

見 plan Task 12 六個手動 E2E。SQL 層 smoke test 已在 Task 2 跑過。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

Plan 對應 spec §5 完整內容：
- §5.1 migration 011 → Task 1, 2
- §5.2 analysis.rs 動態主題 → Task 3 (list_active_theme_names), Task 4 (build_prompt + request_analysis)
- §5.3 主題管理 UI → Task 8 (ThemeEditModal), Task 9 (/exhibitions edit mode + ThemeDeleteConfirm)
- §5.4 手動歸類 UI → Task 10
- §5.5 5 個 Tauri commands → Task 3 (list_admin), Task 5 (CRUD), Task 6 (file themes)

額外：
- Task 11 收尾 PR-A 留下的 ExhibitionModal dead `edit` 分支（spec §0 範圍內，PR-A 為了縮 diff 留下的 TODO）

未來改進（不在本 PR）：
- 主題 `poster_count` 欄位目前是 stale；可加 trigger 或定時 reconcile
- 動態 themes fetch 加 in-memory cache 與 TTL（目前每次分析都打）
- `update_poster_file_themes` 在多 file 海報情境是否要批次傳？目前一次一 file，OK
