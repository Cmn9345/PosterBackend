# 展覽 / 主題管理 三件功能 — Design Spec

- **Date**: 2026-05-13
- **Branch**: `feat/exhibitions-themes-management`
- **Base commit**: `97c1ef9` (feat(exhibitions): 補日期/地點欄位 + exhibition_posters join table — Phase 1)
- **Owner**: webit
- **Status**: Approved (brainstorming phase complete)

## 0. 背景與目標

昨天兩個 commit (`45cfc46`、`97c1ef9`) 把展覽管理基礎搭好，但留下三個 admin 寫入路徑缺口，讓 `https://tzuchi-poster-platform.tzuchi-webit.workers.dev/` 前台無法看到完整資料：

1. **缺：展覽掛海報** — admin 沒有 UI 把海報 attach 到展覽（`exhibition_posters` join table 已存在但無寫入路徑）
2. **缺：主題管理** — `vocabulary_themes` 只能從 Supabase Studio 改，admin app 沒入口
3. **缺：手動歸類** — `poster_files.themes` 完全靠 VLM 自動產生，admin 不能矯正錯判

本 spec 一次性設計三件功能，分兩個 PR 上線。

## 1. 範圍與 PR 切分

| PR | 內容 | 風險 | 預估工作量 |
|---|---|---|---|
| **PR-A** | Phase 2：展覽掛海報（`/exhibitions/$id/edit` + 5 個 Tauri command + `@dnd-kit` 拖曳） | 中：新依賴 + 新詳細頁 | ~1 天 |
| **PR-B** | 主題 CRUD + 手動歸類 + VLM 動態讀表（共享 dynamic-theme 基礎設施） | 高：VLM 行為改變 + cascade rename/delete | ~1.5 天 |

PR-A、PR-B 互相不依賴，但 PR-B 內部三件工作有依賴：必須先 ship `admin_rename_theme` / `admin_delete_theme` RPC（migration 011），再上前端，避免不一致狀態。

## 2. 關鍵 schema 約束（必讀）

`vocabulary_themes.name` 是真正的 join key，**三處同步綁死**：

| 位置 | 用法 |
|---|---|
| `vocabulary_themes.name` | UNIQUE 索引；migration 006 用 `ON CONFLICT (name)` upsert |
| `poster_files.themes` (`text[]`) | 存 name 字串陣列，**非 FK**，無 referential integrity |
| `src-tauri/src/services/qwenpaw/analysis.rs:27` | `const THEME_LIST = "朔源、慈善、..."` 寫死進 VLM prompt |

**設計後果**：
- 改 name → 必須 cascade update `poster_files.themes` 所有陣列
- 新增主題 → VLM 看不到，需要動態讀表
- 刪除主題 → 既有歸類變孤兒，需要主動 strip

## 3. 架構總圖

```
┌─ Tauri Admin (Tauri 2 + React + TanStack Router) ──────────────────┐
│                                                                    │
│   /exhibition-structure  (展覽列表卡 + 新增 modal)                 │
│        │  「編輯」icon  ← 新增                                       │
│        ▼                                                            │
│   /exhibitions/$id/edit  (左：基本資料；右：掛海報 dnd 排序)  ← 新   │
│                                                                     │
│   /exhibitions           (12 主題卡)                                │
│        │  右上「編輯主題」toggle  ← 新                              │
│        ▼  進入管理模式：卡片變可編輯 + 新增/刪除                    │
│                                                                     │
│   /posters/$id/edit      (現有頁加 themes 12-chip 勾選區)  ← 新     │
└─────────────┬──────────────────────────────────────────────────────┘
              │ invoke (Tauri command)
              ▼
┌─ src-tauri / commands & services ──────────────────────────────────┐
│  exhibition_posters:                                                │
│    list_exhibition_posters / attach / detach / reorder              │
│    list_posters_for_picker (status filter)                          │
│  vocabulary_themes:                                                 │
│    list_vocabulary_themes_admin / create / update / delete          │
│  poster_files:                                                      │
│    update_poster_file_themes                                        │
└─────────────┬──────────────────────────────────────────────────────┘
              │ HTTPS + JWT (anon role, RLS gates by app_role)
              ▼
┌─ Supabase (production) ────────────────────────────────────────────┐
│  migration 011:                                                     │
│    - RPC admin_rename_theme(...)  SECURITY DEFINER                  │
│      → cascade update poster_files.themes                           │
│    - RPC admin_delete_theme(id)   SECURITY DEFINER                  │
│      → strip from poster_files.themes then DELETE                   │
└────────────────────────────────────────────────────────────────────┘

┌─ VLM analysis (qwenpaw/analysis.rs) ───────────────────────────────┐
│  改 const THEME_LIST → async fn fetch_theme_list(&SupabaseClient)   │
│  每次分析前 HTTP GET vocabulary_themes?is_active=eq.true             │
│  失敗時 fallback 硬碼 12 主題 (resilience)                          │
└────────────────────────────────────────────────────────────────────┘
```

## 4. PR-A：Phase 2 — 展覽掛海報

### 4.1 新增依賴

```json
"@dnd-kit/core": "^6.x",
"@dnd-kit/sortable": "^9.x",
"@dnd-kit/utilities": "^3.x"
```

Gzip ~12kb。`/exhibitions/$id/edit` 之外不用 → 可考慮 lazy import 進一步省。

### 4.2 新檔案

| 路徑 | 角色 |
|---|---|
| `src/routes/exhibitions/$id.edit.tsx` | 詳細編輯頁，左基本資料/右掛海報 |
| `src/components/PosterPickerModal.tsx` | 海報選擇器（搜尋 + 多選） |
| `src/components/SortablePosterCard.tsx` | 單張海報拖曳卡 |

### 4.3 修改檔案

| 路徑 | 修改 |
|---|---|
| `src/routes/exhibition-structure.tsx` | 卡片右上加「✎ 編輯」icon，點 → `navigate({ to: '/exhibitions/$id/edit' })` |
| `src/lib/api.ts` | 加 5 個 wrapper |
| `src-tauri/src/services/supabase.rs` | 加 5 個 method |
| `src-tauri/src/lib.rs` | 註冊 5 個新 `#[tauri::command]` |

### 4.4 Tauri Commands

| Command | 參數 | 回傳 | Supabase 動作 |
|---|---|---|---|
| `list_exhibition_posters` | `exhibition_id: String` | `Vec<AttachedPoster>` | GET `exhibition_posters?exhibition_id=eq.X&select=*,posters(id,project_name,status,poster_files(thumbnail_path))&order=sort_order.asc` |
| `list_posters_for_picker` | `status_filter: Vec<String>`, `search: Option<String>` | `Vec<PickerPoster>` | GET `posters?status=in.(published,approved)&select=id,project_name,status,poster_files(thumbnail_path)` |
| `attach_posters_to_exhibition` | `exhibition_id`, `poster_ids: Vec<String>` | `attached_count: usize` | (1) `SELECT COALESCE(MAX(sort_order), -1) FROM exhibition_posters WHERE exhibition_id=X` → `base`<br>(2) bulk POST `exhibition_posters` rows，第 i 個 `sort_order = base + i + 1`<br>已存在 (PK conflict) 用 `Prefer: resolution=ignore-duplicates` 跳過 |
| `detach_poster_from_exhibition` | `exhibition_id`, `poster_id` | `()` | DELETE 一列；不存在也回 200 (idempotent) |
| `reorder_exhibition_posters` | `exhibition_id`, `ordered_poster_ids: Vec<String>` | `()` | 用 PostgREST UPSERT (POST + `Prefer: resolution=merge-duplicates`)：對 `ordered_poster_ids[i]` 寫回 `sort_order = i`。傳入 ids 必須剛好等於該展覽現有海報集合，否則 400 |

### 4.5 資料型別

```ts
interface AttachedPoster {
  poster_id: string;
  project_name: string;
  status: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected';
  thumbnail_url: string | null;
  sort_order: number;
}

interface PickerPoster {
  id: string;
  project_name: string;
  status: string;
  thumbnail_url: string | null;
}
```

### 4.6 UI 佈局

```
/exhibitions/2026-anniversary/edit
┌─ ← 返回展覽列表 ─────────────────────────────────────────────────┐
│  2026 慈濟周年慶                              [儲存][刪除展覽]    │
├─────────────────────────────────────────────────────────────────┤
│  ┌─基本資料─────────┐  ┌─掛海報 (12)─────────────────────────┐ │
│  │ 名稱 [_________] │  │ [🔍 搜尋已掛...] [+ 從海報庫新增]    │ │
│  │ 起 [____] 迄 [_] │  │ ┌──┐ 慈濟50周年回顧展板        │📌X│ │
│  │ 地點 [▼________] │  │ │縮│ status: published         │   │ │
│  │ 狀態 [▼ongoing _]│  │ └──┘ (drag handle ⋮⋮)         │   │ │
│  │ 封面 [選圖____]  │  │ ┌──┐ 醫療志業30年              │📌X│ │
│  │ 排序 [___]       │  │ │縮│ status: approved          │   │ │
│  │ 描述 [_______]   │  │ └──┘                            │   │ │
│  └──────────────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 4.7 海報選擇器 Modal

- 搜尋框（debounced 300ms，filter project_name）
- Status filter chips：`[全部][已發布][已通過]` 預設 `已發布+已通過`
- 卡片網格 4 cols：縮圖 + 名稱 + status pill + checkbox
- 底部「新增 N 張」按鈕（N = 已勾選數）
- 已 attach 過的海報 → checkbox disabled 並顯示「已掛」灰色標籤

### 4.8 錯誤處理

| 情境 | 行為 |
|---|---|
| attach 時其中一張已存在 (PK conflict) | silently skip；回傳實際插入數 |
| detach 不存在 | 視為成功（idempotent） |
| reorder 傳入海報非該展覽 | 後端 400 `ordered_poster_ids contains foreign ids` |
| 拖曳中網路失敗 | optimistic UI + 自動回滾 + toast 顯示原因 |
| 海報無縮圖（poster_files 空） | placeholder 灰圖 + 「無預覽」 |

## 5. PR-B：主題 CRUD + 手動歸類 + 動態 VLM

### 5.1 Migration 011

`supabase/migrations/011_theme_admin_rpcs.sql`：

```sql
-- (a) admin_rename_theme: rename + cascade update poster_files.themes
CREATE OR REPLACE FUNCTION public.admin_rename_theme(
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
  IF (SELECT app_role FROM users WHERE id = auth.uid()) != '系統管理員' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO old_name FROM vocabulary_themes WHERE id = p_id;
  IF old_name IS NULL THEN
    RAISE EXCEPTION 'theme not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE vocabulary_themes
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
    UPDATE poster_files
    SET themes = array_replace(themes, old_name, p_new_name)
    WHERE old_name = ANY(themes);
  END IF;
END
$$;

-- (b) admin_delete_theme: strip from poster_files.themes then DELETE
CREATE OR REPLACE FUNCTION public.admin_delete_theme(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  theme_name text;
BEGIN
  IF (SELECT app_role FROM users WHERE id = auth.uid()) != '系統管理員' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF (SELECT COUNT(*) FROM vocabulary_themes WHERE is_active = true) <= 1 THEN
    RAISE EXCEPTION 'cannot delete last active theme' USING ERRCODE = '23514';
  END IF;

  SELECT name INTO theme_name FROM vocabulary_themes WHERE id = p_id;

  UPDATE poster_files
  SET themes = array_remove(themes, theme_name)
  WHERE theme_name = ANY(themes);

  DELETE FROM vocabulary_themes WHERE id = p_id;
END
$$;

COMMENT ON FUNCTION public.admin_rename_theme IS
  '⚠️ 重跑 migration 006 會把改過名的主題重新塞回 → admin 改名後請勿重跑 006';
```

### 5.2 analysis.rs 動態主題

```rust
// 改前：const THEME_LIST: &str = "朔源、慈善、...";
// 改後：
const FALLBACK_THEMES: &str =
    "朔源、慈善、醫療、教育、人文、環保、茹素護生、國際賑災、靜思語、大事記、法華坡道、年度主題";

async fn fetch_theme_list(sb: &SupabaseClient) -> String {
    match sb.list_active_theme_names().await {
        Ok(names) if !names.is_empty() => names.join("、"),
        _ => FALLBACK_THEMES.to_string(),
    }
}
```

`SupabaseClient::list_active_theme_names()` 新增：`GET vocabulary_themes?is_active=eq.true&select=name&order=sort_order.asc` → `Vec<String>`。

**Trade-off**：
- 每次 VLM 分析多一次 HTTP（~50ms）→ VLM 本身就 1-15s，比例可忽略
- DB 不可達不會卡死分析（fallback 保底）

### 5.3 主題管理 UI（在 `/exhibitions` 加 edit mode）

#### 5.3.1 切換邏輯

```
標題列：
  正常模式：  主題海報                        [✎ 編輯主題]
  管理模式：  主題海報 · 管理模式             [+ 新增主題] [完成]

卡片變化：
  正常模式：點卡 → 抽屜列海報（既有行為）
  管理模式：卡 hover 出現 [✎ 編輯] [🗑 刪除] overlay；按 → 開 modal
           最後一張卡是「+ 新增主題」虛線卡
```

#### 5.3.2 新增/編輯 Modal

```
新增/編輯主題
  名稱*       [_________]   ⚠️ 改名警告：將同步更新 N 張海報的歸類
  代號        [_________]   (英文 slug, optional)
  Icon        [____]         emoji（1 字）
  主色        [#______]      取色器
  底色        [#______]
  描述        [_________]    textarea
  封面圖路徑  [_________]
  排序        [__]
  啟用        [☑]
  [取消]                                              [儲存]
```

#### 5.3.3 刪除 Confirm

```
即將刪除「茹素護生」
此主題目前歸類了 87 張海報，刪除後將從這些海報移除此歸類
（海報本身不會被刪，其他主題保留）
⚠️ VLM prompt 會在下次分析時自動排除此主題
[取消]  [確認刪除]
```

### 5.4 手動歸類 UI（在 `/posters/$id/edit` 每個 file 區塊）

把目前 `src/routes/posters/$projectId.edit.tsx:813-821` 的 read-only pills 換成可點 chips：

```
AI 主題（可手動調整）
[✓ 慈善] [✓ 醫療] [ 朔源] [ 教育] [ 人文] [ 環保]
[ 茹素護生] [ 國際賑災] [ 靜思語] [ 大事記] [ 法華坡道] [ 年度主題]
        儲存中…
```

- 點 chip 立即 invoke `update_poster_file_themes(file_id, new_themes)`
- Optimistic UI + 失敗 toast + 回滾
- 12 chips 來自 `vocabulary_themes` 動態（`is_active=true`，按 `sort_order` 排）
- 管理模式新增的主題自動出現

### 5.5 Tauri Commands（PR-B）

| Command | 動作 |
|---|---|
| `list_vocabulary_themes_admin` | GET 全部（含 `is_active=false`），供管理頁用 |
| `create_vocabulary_theme(payload)` | POST insert |
| `update_vocabulary_theme(id, payload)` | RPC `admin_rename_theme` |
| `delete_vocabulary_theme(id)` | RPC `admin_delete_theme` |
| `update_poster_file_themes(file_id, themes)` | PATCH `poster_files`.themes |

## 6. 測試策略

### 6.1 自動測試

| 層級 | 測試 |
|---|---|
| SQL | `admin_rename_theme` RPC：建測試主題 → rename → 驗 `poster_files.themes` 已 cascade |
| SQL | `admin_delete_theme`：擋最後一個 active theme；正常刪會 strip 陣列 |
| Rust unit | `attach_posters_to_exhibition` 重複 attach 不爆 PK conflict |
| Rust unit | `reorder_exhibition_posters` foreign id 回 400 |
| Frontend | dnd reorder 斷網時自動回滾 |

### 6.2 手動驗收（E2E）

1. **展覽掛海報**：建展覽 → 掛 3 張 → 拖曳排序 → 開 workers.dev 看順序正確
2. **改主題名**：「慈善」→「慈善志業」→ 上傳新海報 → VLM 用新名歸類；舊海報 `poster_files.themes` 也已更新
3. **刪主題**：刪「年度主題」→ 已歸該類的海報 themes 陣列被剔除「年度主題」、其他主題保留
4. **新增主題**：新增「青年志工」→ 不重啟 Tauri，馬上上傳新海報 → VLM prompt 含「青年志工」
5. **手動歸類**：海報編輯頁勾掉誤判主題 + 補真實主題 → workers.dev 主題頁立即反映

## 7. 風險與緩解

| 風險 | 緩解 |
|---|---|
| 拖曳 race condition（多 admin 同時拖） | first-write-wins；admin 場景 1-3 人，可接受不擋；前端依據 reorder API 回傳 re-sync |
| VLM 抓 themes 失敗 → prompt 空 | fallback 硬碼 12 主題保底；`tracing::warn!` |
| Admin 改 name 後重跑 migration 006 | RPC comment 警告 + README 註明；無自動擋 |
| `@dnd-kit` bundle size | gzip 後 ~12kb，可接受；可 dynamic import |
| 刪光所有 active theme | RPC 內擋 `is_active <= 1` 不能刪；前端 UI 也 disable |
| `SECURITY DEFINER` 漏權限檢查 | 函式開頭先 check `app_role`；測試覆蓋未授權 user → 401 |

## 8. 不在範圍內（YAGNI）

明確排除，避免 scope creep：

- ❌ 海報 ↔ 主題反向關係的 admin 操作（已有 poster 編輯頁手動歸類就夠）
- ❌ 展覽的封面圖上傳到 Supabase Storage（沿用現有 path 輸入欄位）
- ❌ 海報 picker 的進階 filter（日期、上傳者、品質分數）— 只有 status filter
- ❌ 主題的 i18n（目前只有中文）
- ❌ Audit log（誰改了主題/掛了海報）
- ❌ Undo / version history

## 9. 上線檢查清單

PR-A：
- [ ] `cargo build --release` 無 warning
- [ ] `npm run build` 無 TS error
- [ ] `/exhibitions/$id/edit` 拖曳順序儲存後 reload 仍正確
- [ ] workers.dev 前台展覽詳細頁顯示掛上的海報
- [ ] 沒掛海報的展覽顯示 empty state（不 crash）

PR-B：
- [ ] `supabase/migrations/011` 在 dev 套用無錯
- [ ] RPC `admin_rename_theme` 從 SQL Editor 直接呼可運作
- [ ] 非 admin user 呼叫 RPC 回 42501
- [ ] 動態 `fetch_theme_list` Supabase 斷線時 fallback 啟動
- [ ] 主題管理新增 → 不重啟 app，下次上傳海報 VLM 看到
- [ ] 海報編輯頁勾選變化即時存到 DB

## 10. 接下來

本 spec 通過後：
1. 跑 `writing-plans` skill 產生 implementation plan（含 task ordering、TDD 起點、subagent 切分）
2. 依 plan 進實作
