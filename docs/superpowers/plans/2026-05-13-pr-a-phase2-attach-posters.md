# PR-A: Phase 2 展覽掛海報 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補上 admin 把現有海報 attach/detach/reorder 到展覽的 UI 與 Tauri commands，讓 workers.dev 前台的展覽詳細頁能顯示掛上的海報。

**Architecture:** 新增獨立詳細頁 `/exhibitions/$id/edit`（左：既有基本資料表單；右：可拖曳排序的已掛海報清單 + 「從海報庫新增」selector），背後 5 個新 Tauri commands 走 PostgREST 操作 `exhibition_posters` join table。`exhibition-structure.tsx` 卡片的「編輯」按鈕改成 router navigate 到新頁；新增展覽仍走 modal。

**Tech Stack:** Tauri 2 + React 19 + TanStack Router (file-based) + Supabase PostgREST + `@dnd-kit` (v6 core / v9 sortable / v3 utilities)

**Verification approach:** 此 codebase 目前無 vitest/cargo test 基礎設施。本 plan 採務實路線：每個 Rust task 用 `cargo check`；每個 TS task 用 `npm run build`（含 `tsc`）；最後 Task 13 跑手動 E2E。

---

## File Structure

**New files:**
- `src/routes/exhibitions/$id.edit.tsx` — 展覽詳細編輯頁（左基本資料 / 右掛海報）
- `src/components/SortablePosterCard.tsx` — 單張已掛海報卡（拖曳 + 縮圖 + 移除）
- `src/components/PosterPickerModal.tsx` — 海報選擇器（搜尋 + status filter + 多選）

**Modified files:**
- `src-tauri/src/services/supabase.rs` — 加 5 個 method（接 `exhibition_posters` 與 `posters` 表）
- `src-tauri/src/lib.rs` — 加 5 個 `#[tauri::command]` + 註冊到 `invoke_handler!`
- `src/lib/api.ts` — 加 5 個 TS wrapper + AttachedPoster/PickerPoster type
- `src/routes/exhibition-structure.tsx` — 卡片「編輯」按鈕改 router navigate
- `package.json` — `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`

---

## Task 1: 安裝 @dnd-kit 依賴

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安裝三個 dnd-kit 套件**

Run:
```bash
npm install @dnd-kit/core@^6 @dnd-kit/sortable@^9 @dnd-kit/utilities@^3
```

Expected: `package.json` 新增三個 deps，`package-lock.json` 更新，無 vulnerability 警告。

- [ ] **Step 2: 驗證 import 可解析**

Run:
```bash
node -e "console.log(require.resolve('@dnd-kit/core'))"
node -e "console.log(require.resolve('@dnd-kit/sortable'))"
node -e "console.log(require.resolve('@dnd-kit/utilities'))"
```

Expected: 三條都印出 `node_modules/@dnd-kit/*/dist/...` 路徑。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: 加 @dnd-kit/{core,sortable,utilities} 給展覽掛海報拖曳排序

PR-A Phase 2 用到的拖曳套件。gzip 後 ~12kb，目前只在
/exhibitions/\$id/edit 用到，未來若 bundle 太肥可改 lazy import。"
```

---

## Task 2: Backend — `list_exhibition_posters` 與型別

**Files:**
- Modify: `src-tauri/src/services/supabase.rs` (append at end of `impl SupabaseClient`)
- Modify: `src-tauri/src/lib.rs` (add command after `delete_exhibition` at line 156)

- [ ] **Step 1: 在 `services/supabase.rs` 加 method**

在 `impl SupabaseClient` 末尾（`delete_exhibition` 之後、`download_from_storage` 之前，約 line 937 後）插入：

```rust
    /// List posters attached to an exhibition with sort_order, joined with
    /// `posters.project_name/status` and the first `poster_files.thumbnail_path`.
    /// Returns raw JSON text so the Tauri command can pipe it through unchanged.
    ///
    /// PostgREST request:
    ///   GET /rest/v1/exhibition_posters
    ///     ?exhibition_id=eq.{id}
    ///     &select=poster_id,sort_order,posters(id,project_name,status,poster_files(thumbnail_path))
    ///     &order=sort_order.asc
    pub async fn list_exhibition_posters(
        &self,
        exhibition_id: &str,
    ) -> Result<String, String> {
        let url = format!(
            "{}/rest/v1/exhibition_posters?exhibition_id=eq.{}\
             &select=poster_id,sort_order,posters(id,project_name,status,poster_files(thumbnail_path))\
             &order=sort_order.asc",
            self.url, exhibition_id
        );
        let key = self.bearer_key().await;
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("List exhibition_posters failed: {}", e))?;

        if resp.status().is_success() {
            resp.text()
                .await
                .map_err(|e| format!("Read list_exhibition_posters body failed: {}", e))
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("List exhibition_posters failed ({}): {}", status, text))
        }
    }
```

- [ ] **Step 2: 在 `lib.rs` 加 Tauri command**

在 `delete_exhibition`（line 151–156）之後插入：

```rust
/// List posters attached to an exhibition, sorted by sort_order ascending.
/// Returns raw JSON string of `[{poster_id, sort_order, posters: {...}}, ...]`.
#[tauri::command]
async fn list_exhibition_posters(
    state: tauri::State<'_, upload::UploadState>,
    exhibition_id: String,
) -> Result<String, String> {
    state
        .supabase_client
        .list_exhibition_posters(&exhibition_id)
        .await
}
```

- [ ] **Step 3: 註冊到 `invoke_handler!`**

在 `lib.rs` line 334 後（`delete_exhibition,` 那行下面）加：

```rust
            // Exhibition posters join table (Phase 2)
            list_exhibition_posters,
```

- [ ] **Step 4: `cargo check`**

Run:
```bash
cd src-tauri && cargo check 2>&1 | tail -20
```

Expected: `Finished \`dev\` profile [unoptimized + debuginfo] target(s)`，無 error；warning 容忍但不引入新的。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/supabase.rs src-tauri/src/lib.rs
git commit -m "feat(backend): list_exhibition_posters command (Phase 2)

回傳該展覽掛的所有海報，含 sort_order、project_name、status、
第一張 file 的 thumbnail_path。前端 /exhibitions/\$id/edit
讀這支來列已掛海報。"
```

---

## Task 3: Backend — `list_posters_for_picker`

**Files:**
- Modify: `src-tauri/src/services/supabase.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 加 method**

在 `list_exhibition_posters` 之後插入：

```rust
    /// List posters available for attaching to an exhibition. Filtered by
    /// status (typically `published` and `approved`). Optionally narrowed by
    /// project_name substring search. Returns at most 200 rows.
    ///
    /// PostgREST request:
    ///   GET /rest/v1/posters
    ///     ?status=in.(published,approved)
    ///     &select=id,project_name,status,poster_files(thumbnail_path)
    ///     &order=updated_at.desc
    ///     &limit=200
    ///   (+ project_name=ilike.*search* when search provided)
    pub async fn list_posters_for_picker(
        &self,
        status_filter: &[String],
        search: Option<&str>,
    ) -> Result<String, String> {
        let statuses = if status_filter.is_empty() {
            "published,approved".to_string()
        } else {
            status_filter.join(",")
        };
        let mut url = format!(
            "{}/rest/v1/posters?status=in.({})\
             &select=id,project_name,status,poster_files(thumbnail_path)\
             &order=updated_at.desc&limit=200",
            self.url, statuses
        );
        if let Some(q) = search.filter(|s| !s.is_empty()) {
            // PostgREST `ilike` operator with `*` wildcards. URL-encode user input.
            url.push_str(&format!(
                "&project_name=ilike.*{}*",
                urlencoding::encode(q)
            ));
        }
        let key = self.bearer_key().await;
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("List posters for picker failed: {}", e))?;

        if resp.status().is_success() {
            resp.text()
                .await
                .map_err(|e| format!("Read picker body failed: {}", e))
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("List posters for picker failed ({}): {}", status, text))
        }
    }
```

- [ ] **Step 2: 確認 `urlencoding` 已是 deps**

Run:
```bash
grep -n urlencoding src-tauri/Cargo.toml
```

Expected: 至少一個 hit。若無，加：

```bash
cd src-tauri && cargo add urlencoding
```

- [ ] **Step 3: 加 Tauri command**

在 `lib.rs` 的 `list_exhibition_posters` 之後插入：

```rust
/// List posters available for attaching to an exhibition.
/// `status_filter` empty → defaults to published+approved on the backend.
#[tauri::command]
async fn list_posters_for_picker(
    state: tauri::State<'_, upload::UploadState>,
    status_filter: Vec<String>,
    search: Option<String>,
) -> Result<String, String> {
    state
        .supabase_client
        .list_posters_for_picker(&status_filter, search.as_deref())
        .await
}
```

- [ ] **Step 4: 註冊**

在 `invoke_handler!` 的 `list_exhibition_posters,` 下面加：

```rust
            list_posters_for_picker,
```

- [ ] **Step 5: `cargo check` + commit**

```bash
cd src-tauri && cargo check 2>&1 | tail -10
cd ..
git add src-tauri/src/services/supabase.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(backend): list_posters_for_picker command

從海報庫過濾出可掛的海報（預設 published+approved），含縮圖。
PostgREST ilike 搜尋 project_name，limit 200。"
```

---

## Task 4: Backend — `attach_posters_to_exhibition`

**Files:**
- Modify: `src-tauri/src/services/supabase.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 加 method**

```rust
    /// Bulk-attach posters to an exhibition. `sort_order` for new rows starts
    /// from `MAX(existing sort_order) + 1` so they land at the end.
    /// Returns the count of rows actually inserted (already-attached posters
    /// are silently skipped via `Prefer: resolution=ignore-duplicates`).
    pub async fn attach_posters_to_exhibition(
        &self,
        exhibition_id: &str,
        poster_ids: &[String],
    ) -> Result<usize, String> {
        if poster_ids.is_empty() {
            return Ok(0);
        }

        // Step 1: discover current max sort_order for this exhibition.
        let probe_url = format!(
            "{}/rest/v1/exhibition_posters?exhibition_id=eq.{}\
             &select=sort_order&order=sort_order.desc&limit=1",
            self.url, exhibition_id
        );
        let key = self.bearer_key().await;
        let probe = self
            .client
            .get(&probe_url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("Probe sort_order failed: {}", e))?;
        let probe_body = probe.text().await.unwrap_or_default();
        let probe_json: serde_json::Value =
            serde_json::from_str(&probe_body).unwrap_or(json!([]));
        let base: i64 = probe_json
            .as_array()
            .and_then(|a| a.first())
            .and_then(|o| o.get("sort_order"))
            .and_then(|v| v.as_i64())
            .unwrap_or(-1);

        // Step 2: build rows.
        let rows: Vec<serde_json::Value> = poster_ids
            .iter()
            .enumerate()
            .map(|(i, pid)| {
                json!({
                    "exhibition_id": exhibition_id,
                    "poster_id": pid,
                    "sort_order": base + (i as i64) + 1,
                })
            })
            .collect();

        // Step 3: bulk insert with ignore-duplicates so PK conflicts are silent.
        let insert_url = format!("{}/rest/v1/exhibition_posters", self.url);
        let resp = self
            .client
            .post(&insert_url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=ignore-duplicates,return=representation")
            .body(serde_json::Value::Array(rows).to_string())
            .send()
            .await
            .map_err(|e| format!("Attach posters failed: {}", e))?;

        if resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            let arr: serde_json::Value = serde_json::from_str(&text).unwrap_or(json!([]));
            let inserted = arr.as_array().map(|a| a.len()).unwrap_or(0);
            info!(
                "[Supabase] Attached {} posters to exhibition {} ({} skipped as duplicates)",
                inserted,
                exhibition_id,
                poster_ids.len() - inserted
            );
            Ok(inserted)
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Attach posters failed ({}): {}", status, text))
        }
    }
```

- [ ] **Step 2: 加 Tauri command**

```rust
/// Attach posters to an exhibition. Already-attached posters are silently
/// skipped. Returns the number of newly-attached rows.
#[tauri::command]
async fn attach_posters_to_exhibition(
    state: tauri::State<'_, upload::UploadState>,
    exhibition_id: String,
    poster_ids: Vec<String>,
) -> Result<usize, String> {
    if exhibition_id.trim().is_empty() {
        return Err("exhibition_id 不可為空".into());
    }
    state
        .supabase_client
        .attach_posters_to_exhibition(&exhibition_id, &poster_ids)
        .await
}
```

- [ ] **Step 3: 註冊**

```rust
            attach_posters_to_exhibition,
```

- [ ] **Step 4: `cargo check` + commit**

```bash
cd src-tauri && cargo check 2>&1 | tail -10
cd ..
git add src-tauri/src/services/supabase.rs src-tauri/src/lib.rs
git commit -m "feat(backend): attach_posters_to_exhibition

Bulk insert exhibition_posters，新海報 sort_order 從現有 MAX+1
往後接；PK 衝突走 Prefer: resolution=ignore-duplicates 自動 skip，
回傳實際新插入的張數。"
```

---

## Task 5: Backend — `detach_poster_from_exhibition`

**Files:**
- Modify: `src-tauri/src/services/supabase.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 加 method**

```rust
    /// Remove a single poster from an exhibition. Idempotent — deleting a
    /// non-existent (exhibition_id, poster_id) pair returns Ok(()), not an error.
    pub async fn detach_poster_from_exhibition(
        &self,
        exhibition_id: &str,
        poster_id: &str,
    ) -> Result<(), String> {
        let url = format!(
            "{}/rest/v1/exhibition_posters?exhibition_id=eq.{}&poster_id=eq.{}",
            self.url, exhibition_id, poster_id
        );
        let key = self.bearer_key().await;
        let resp = self
            .client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Prefer", "return=minimal")
            .send()
            .await
            .map_err(|e| format!("Detach poster failed: {}", e))?;
        if resp.status().is_success() {
            info!(
                "[Supabase] Detached poster {} from exhibition {}",
                poster_id, exhibition_id
            );
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Detach poster failed ({}): {}", status, text))
        }
    }
```

- [ ] **Step 2: 加 Tauri command**

```rust
/// Remove a poster from an exhibition. Idempotent.
#[tauri::command]
async fn detach_poster_from_exhibition(
    state: tauri::State<'_, upload::UploadState>,
    exhibition_id: String,
    poster_id: String,
) -> Result<(), String> {
    state
        .supabase_client
        .detach_poster_from_exhibition(&exhibition_id, &poster_id)
        .await
}
```

- [ ] **Step 3: 註冊**

```rust
            detach_poster_from_exhibition,
```

- [ ] **Step 4: `cargo check` + commit**

```bash
cd src-tauri && cargo check 2>&1 | tail -10
cd ..
git add src-tauri/src/services/supabase.rs src-tauri/src/lib.rs
git commit -m "feat(backend): detach_poster_from_exhibition

Idempotent 刪除單筆 exhibition_posters。"
```

---

## Task 6: Backend — `reorder_exhibition_posters`

**Files:**
- Modify: `src-tauri/src/services/supabase.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 加 method**

```rust
    /// Rewrite the sort_order of every poster attached to an exhibition.
    /// The input array's index becomes the new sort_order (0-based).
    ///
    /// Validates that the input ids match exactly the currently-attached set —
    /// adding or dropping posters here is rejected with 400 to keep semantics
    /// clean (use attach/detach for that).
    ///
    /// PostgREST UPSERT: POST with `Prefer: resolution=merge-duplicates` on the
    /// composite PK (exhibition_id, poster_id) → existing rows get sort_order
    /// updated, no-op for unchanged rows.
    pub async fn reorder_exhibition_posters(
        &self,
        exhibition_id: &str,
        ordered_poster_ids: &[String],
    ) -> Result<(), String> {
        if ordered_poster_ids.is_empty() {
            return Ok(());
        }

        // Validate: input ids must equal currently-attached set.
        let probe_url = format!(
            "{}/rest/v1/exhibition_posters?exhibition_id=eq.{}&select=poster_id",
            self.url, exhibition_id
        );
        let key = self.bearer_key().await;
        let probe = self
            .client
            .get(&probe_url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("Probe reorder set failed: {}", e))?;
        let probe_text = probe.text().await.unwrap_or_default();
        let existing: Vec<String> = serde_json::from_str::<serde_json::Value>(&probe_text)
            .ok()
            .and_then(|v| v.as_array().cloned())
            .map(|arr| {
                arr.into_iter()
                    .filter_map(|o| o.get("poster_id").and_then(|s| s.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let mut input_sorted: Vec<&String> = ordered_poster_ids.iter().collect();
        input_sorted.sort();
        let mut existing_sorted: Vec<&String> = existing.iter().collect();
        existing_sorted.sort();
        if input_sorted != existing_sorted {
            return Err(format!(
                "Reorder mismatch: input has {} ids, exhibition has {} attached",
                ordered_poster_ids.len(),
                existing.len()
            ));
        }

        // Build upsert payload.
        let rows: Vec<serde_json::Value> = ordered_poster_ids
            .iter()
            .enumerate()
            .map(|(i, pid)| {
                json!({
                    "exhibition_id": exhibition_id,
                    "poster_id": pid,
                    "sort_order": i as i32,
                })
            })
            .collect();

        let url = format!("{}/rest/v1/exhibition_posters", self.url);
        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates,return=minimal")
            .body(serde_json::Value::Array(rows).to_string())
            .send()
            .await
            .map_err(|e| format!("Reorder failed: {}", e))?;

        if resp.status().is_success() {
            info!(
                "[Supabase] Reordered {} posters for exhibition {}",
                ordered_poster_ids.len(),
                exhibition_id
            );
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Reorder failed ({}): {}", status, text))
        }
    }
```

- [ ] **Step 2: 加 Tauri command**

```rust
/// Rewrite sort_order for all posters attached to an exhibition. Input order
/// = new order (0-based). Rejects if input ids differ from currently attached.
#[tauri::command]
async fn reorder_exhibition_posters(
    state: tauri::State<'_, upload::UploadState>,
    exhibition_id: String,
    ordered_poster_ids: Vec<String>,
) -> Result<(), String> {
    state
        .supabase_client
        .reorder_exhibition_posters(&exhibition_id, &ordered_poster_ids)
        .await
}
```

- [ ] **Step 3: 註冊**

```rust
            reorder_exhibition_posters,
```

- [ ] **Step 4: `cargo check` + commit**

```bash
cd src-tauri && cargo check 2>&1 | tail -10
cd ..
git add src-tauri/src/services/supabase.rs src-tauri/src/lib.rs
git commit -m "feat(backend): reorder_exhibition_posters

PostgREST UPSERT merge-duplicates 一次寫入新的 sort_order；
驗證 input ids 集合等於現有 attached set，避免悄悄改變掛海報內容。"
```

---

## Task 7: 前端 — `api.ts` 5 個 wrapper + 型別

**Files:**
- Modify: `src/lib/api.ts` (append after `deleteExhibition` at line 78)

- [ ] **Step 1: 加完整區塊**

在 `deleteExhibition` 之後（line 78 後）追加：

```ts
// ── Exhibition posters (掛海報 — Phase 2) ─────────────────────────────

/** 一張掛在展覽上的海報，含縮圖與狀態（從 list_exhibition_posters 解析）。 */
export interface AttachedPoster {
  poster_id: string;
  sort_order: number;
  posters: {
    id: string;
    project_name: string;
    status: string;
    poster_files?: Array<{ thumbnail_path: string | null }>;
  } | null;
}

/** 海報庫選擇器用的縮表結構。 */
export interface PickerPoster {
  id: string;
  project_name: string;
  status: string;
  poster_files?: Array<{ thumbnail_path: string | null }>;
}

/** List posters attached to an exhibition, ordered by sort_order ascending. */
export async function listExhibitionPosters(
  exhibitionId: string,
): Promise<AttachedPoster[]> {
  const raw = await invoke<string>("list_exhibition_posters", { exhibitionId });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as AttachedPoster[]) : [];
}

/** List candidate posters for the attach picker. `statusFilter` empty = backend default (published+approved). */
export async function listPostersForPicker(
  statusFilter: string[] = [],
  search?: string,
): Promise<PickerPoster[]> {
  const raw = await invoke<string>("list_posters_for_picker", {
    statusFilter,
    search: search ?? null,
  });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as PickerPoster[]) : [];
}

/** Attach posters to an exhibition. Already-attached are skipped silently. */
export async function attachPostersToExhibition(
  exhibitionId: string,
  posterIds: string[],
): Promise<number> {
  return invoke<number>("attach_posters_to_exhibition", {
    exhibitionId,
    posterIds,
  });
}

/** Detach a single poster from an exhibition. Idempotent. */
export async function detachPosterFromExhibition(
  exhibitionId: string,
  posterId: string,
): Promise<void> {
  return invoke<void>("detach_poster_from_exhibition", {
    exhibitionId,
    posterId,
  });
}

/** Rewrite sort_order: input array index = new sort_order. */
export async function reorderExhibitionPosters(
  exhibitionId: string,
  orderedPosterIds: string[],
): Promise<void> {
  return invoke<void>("reorder_exhibition_posters", {
    exhibitionId,
    orderedPosterIds,
  });
}
```

- [ ] **Step 2: `tsc` 檢查**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -20
```

Expected: 無 error。

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(api): 5 wrappers for exhibition_posters CRUD

對應 Task 2-6 的 Tauri commands；AttachedPoster / PickerPoster
型別與 PostgREST select 的 nested join 結構一致。"
```

---

## Task 8: 前端 — `SortablePosterCard` 元件

**Files:**
- Create: `src/components/SortablePosterCard.tsx`

- [ ] **Step 1: 寫元件**

```tsx
// src/components/SortablePosterCard.tsx
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import type { AttachedPoster } from "../lib/api";

const statusPill: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-gray-100 text-gray-600" },
  pending_review: { label: "審核中", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "已通過", cls: "bg-emerald-100 text-emerald-700" },
  published: { label: "已發布", cls: "bg-green-100 text-green-700" },
  rejected: { label: "退件", cls: "bg-red-100 text-red-700" },
};

interface Props {
  attached: AttachedPoster;
  /** Pre-signed (or public) thumbnail URL. `null` shows placeholder. */
  thumbnailUrl: string | null;
  onRemove: () => void;
  removing?: boolean;
}

/**
 * Single attached poster row. The card itself is draggable (whole-card drag),
 * with an explicit grip icon on the left for affordance. Remove button has
 * `data-no-dnd` so clicking it doesn't start a drag (we wire that on the
 * useSortable activator below).
 */
export function SortablePosterCard({ attached, thumbnailUrl, onRemove, removing }: Props) {
  const id = attached.poster_id;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const p = attached.posters;
  const st = p ? (statusPill[p.status] ?? { label: p.status, cls: "bg-gray-100 text-gray-600" }) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-primary/40 transition-colors"
    >
      {/* Drag handle — listeners scoped to icon only */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none"
        aria-label="拖曳排序"
      >
        <GripVertical className="w-5 h-5" />
      </button>

      {/* Thumbnail */}
      <div className="w-12 h-12 rounded bg-gray-100 overflow-hidden flex-shrink-0">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">無預覽</div>
        )}
      </div>

      {/* Name + status */}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-medium text-gray-800 truncate">
          {p?.project_name ?? "（未命名）"}
        </h4>
        {st && (
          <span className={`inline-block mt-0.5 px-1.5 py-0.5 text-[10px] rounded-full ${st.cls}`}>
            {st.label}
          </span>
        )}
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 cursor-pointer disabled:cursor-not-allowed"
        title="從此展覽移除"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `tsc` 檢查**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: 無 error。

- [ ] **Step 3: Commit**

```bash
git add src/components/SortablePosterCard.tsx
git commit -m "feat(ui): SortablePosterCard 元件（拖曳掛海報卡）

用 @dnd-kit/sortable 包單張海報；listener 只接在 GripVertical
icon 上，避免按 X 觸發拖曳。"
```

---

## Task 9: 前端 — `PosterPickerModal` 元件

**Files:**
- Create: `src/components/PosterPickerModal.tsx`

- [ ] **Step 1: 寫元件**

```tsx
// src/components/PosterPickerModal.tsx
import { Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listPostersForPicker, type PickerPoster } from "../lib/api";

interface Props {
  /** poster ids already attached — disabled in the picker. */
  alreadyAttached: Set<string>;
  /** Thumbnail URL resolver (Storage signed URL or public). Returning `null` shows placeholder. */
  resolveThumbnail: (path: string | null | undefined) => string | null;
  onClose: () => void;
  onConfirm: (posterIds: string[]) => void | Promise<void>;
}

const statusOptions: Array<{ value: string; label: string }> = [
  { value: "published", label: "已發布" },
  { value: "approved", label: "已通過" },
  { value: "pending_review", label: "審核中" },
  { value: "draft", label: "草稿" },
];

/**
 * Modal that lists candidate posters with search + status filter and lets
 * the user multi-select to attach. Defaults to status `published+approved`
 * per the spec (workers.dev only renders those anyway).
 */
export function PosterPickerModal({
  alreadyAttached,
  resolveThumbnail,
  onClose,
  onConfirm,
}: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>(["published", "approved"]);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rows, setRows] = useState<PickerPoster[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Debounce search 300ms.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch on filter change.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await listPostersForPicker(statusFilter, debouncedSearch || undefined);
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [statusFilter, debouncedSearch]);

  const toggleStatus = (v: string) => {
    setStatusFilter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedCount = selected.size;

  const sortedRows = useMemo(() => rows, [rows]);

  const handleConfirm = async () => {
    if (selectedCount === 0) return;
    setSubmitting(true);
    try {
      await onConfirm(Array.from(selected));
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold">從海報庫新增</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 cursor-pointer"
            aria-label="關閉"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Search + filters */}
        <div className="px-6 py-3 border-b border-gray-100 space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜尋海報名稱..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {statusOptions.map((opt) => {
              const active = statusFilter.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleStatus(opt.value)}
                  className={`px-3 py-1 text-xs rounded-full border cursor-pointer transition ${
                    active
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-gray-600 border-gray-200 hover:border-primary/40"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          )}
          {error && <p className="text-sm text-red-500">載入失敗：{error}</p>}
          {!loading && !error && sortedRows.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-12">無符合的海報</p>
          )}
          {!loading && !error && sortedRows.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {sortedRows.map((p) => {
                const attached = alreadyAttached.has(p.id);
                const isSelected = selected.has(p.id);
                const thumb = resolveThumbnail(p.poster_files?.[0]?.thumbnail_path);
                return (
                  <label
                    key={p.id}
                    className={`block rounded-lg border overflow-hidden cursor-pointer transition ${
                      attached
                        ? "border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed"
                        : isSelected
                          ? "border-primary ring-2 ring-primary/30"
                          : "border-gray-200 hover:border-primary/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={isSelected}
                      disabled={attached}
                      onChange={() => toggleSelect(p.id)}
                    />
                    <div className="aspect-square bg-gray-100">
                      {thumb ? (
                        <img src={thumb} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">
                          無預覽
                        </div>
                      )}
                    </div>
                    <div className="px-2 py-2">
                      <p className="text-xs font-medium text-gray-800 truncate">{p.project_name}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {attached ? "已掛" : p.status}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
          <p className="text-sm text-gray-500">已選 {selectedCount} 張</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selectedCount === 0 || submitting}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              新增 {selectedCount} 張
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `tsc` 檢查**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: 無 error。

- [ ] **Step 3: Commit**

```bash
git add src/components/PosterPickerModal.tsx
git commit -m "feat(ui): PosterPickerModal 海報選擇器（搜尋 + status filter + 多選）

預設 filter published+approved；已掛海報 disabled 並顯示「已掛」
標籤；確認按鈕呼叫者 prop onConfirm 傳已選的 poster ids。"
```

---

## Task 10: 前端 — `/exhibitions/$id/edit` 詳細編輯頁

**Files:**
- Create: `src/routes/exhibitions/$id.edit.tsx`

- [ ] **Step 1: 寫頁面**

```tsx
// src/routes/exhibitions/$id.edit.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  attachPostersToExhibition,
  deleteExhibition,
  detachPosterFromExhibition,
  listExhibitionPosters,
  patchExhibition,
  querySupabase,
  reorderExhibitionPosters,
  type AttachedPoster,
  type ExhibitionStatus,
} from "../../lib/api";
import { PosterPickerModal } from "../../components/PosterPickerModal";
import { SortablePosterCard } from "../../components/SortablePosterCard";

export const Route = createFileRoute("/exhibitions/$id/edit")({
  component: ExhibitionEditPage,
});

interface ExhibitionRow {
  id: string;
  name: string;
  description: string | null;
  cover_image_path: string | null;
  sort_order: number | null;
  status: ExhibitionStatus;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
}

function ExhibitionEditPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  // ── State ──
  const [exhibition, setExhibition] = useState<ExhibitionRow | null>(null);
  const [attached, setAttached] = useState<AttachedPoster[]>([]);
  const [thumbCache, setThumbCache] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // ── Load ──
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, posters] = await Promise.all([
        querySupabase<ExhibitionRow>("exhibitions", `id=eq.${id}&limit=1`),
        listExhibitionPosters(id),
      ]);
      if (rows.length === 0) {
        setError("展覽不存在");
        return;
      }
      setExhibition(rows[0]);
      setAttached(posters);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ── Thumbnail signing (lazy + memoized) ──
  // poster_files.thumbnail_path is a Storage object key, not a URL. We pre-sign
  // each one once and cache.
  useEffect(() => {
    const missing = attached
      .map((a) => a.posters?.poster_files?.[0]?.thumbnail_path)
      .filter((p): p is string => !!p && thumbCache[p] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (path) => {
          try {
            const url = await invoke<string>("sign_thumbnail_url", { path });
            return [path, url] as const;
          } catch {
            return [path, null] as const;
          }
        }),
      );
      if (!cancelled) {
        setThumbCache((prev) => {
          const next = { ...prev };
          for (const [k, v] of entries) next[k] = v;
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attached, thumbCache]);

  const resolveThumb = useCallback(
    (path: string | null | undefined) => {
      if (!path) return null;
      return thumbCache[path] ?? null;
    },
    [thumbCache],
  );

  // ── DnD ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = attached.findIndex((a) => a.poster_id === active.id);
    const newIdx = attached.findIndex((a) => a.poster_id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(attached, oldIdx, newIdx);
    const snapshot = attached;
    setAttached(next); // optimistic
    try {
      await reorderExhibitionPosters(
        id,
        next.map((a) => a.poster_id),
      );
    } catch (err) {
      console.error("Reorder failed, rolling back:", err);
      setAttached(snapshot);
      alert(`排序失敗：${err}`);
    }
  };

  // ── Form handlers ──
  const updateField = <K extends keyof ExhibitionRow>(key: K, value: ExhibitionRow[K]) => {
    setExhibition((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!exhibition) return;
    if (!exhibition.name.trim()) {
      alert("展覽名稱不可為空");
      return;
    }
    setSaving(true);
    try {
      await patchExhibition(id, {
        name: exhibition.name.trim(),
        description: exhibition.description ?? "",
        coverImagePath: exhibition.cover_image_path ?? "",
        sortOrder: exhibition.sort_order ?? undefined,
        status: exhibition.status,
        startDate: exhibition.start_date ?? "",
        endDate: exhibition.end_date ?? "",
        location: exhibition.location ?? "",
      });
    } catch (err) {
      alert(`儲存失敗：${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!exhibition) return;
    if (!confirm(`確認刪除展覽「${exhibition.name}」？此操作無法復原。`)) return;
    try {
      await deleteExhibition(id);
      navigate({ to: "/exhibition-structure" });
    } catch (err) {
      alert(`刪除失敗：${err}`);
    }
  };

  const handleRemoveAttached = async (posterId: string) => {
    setRemovingId(posterId);
    const snapshot = attached;
    setAttached((prev) => prev.filter((a) => a.poster_id !== posterId)); // optimistic
    try {
      await detachPosterFromExhibition(id, posterId);
    } catch (err) {
      setAttached(snapshot);
      alert(`移除失敗：${err}`);
    } finally {
      setRemovingId(null);
    }
  };

  const handleAttachConfirm = async (posterIds: string[]) => {
    try {
      await attachPostersToExhibition(id, posterIds);
      await reload();
    } catch (err) {
      alert(`掛海報失敗：${err}`);
    }
  };

  // ── Render ──
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </div>
    );
  }
  if (error || !exhibition) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate({ to: "/exhibition-structure" })}
          className="text-sm text-gray-500 hover:text-primary inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> 返回展覽列表
        </button>
        <p className="mt-6 text-red-500">{error ?? "展覽載入失敗"}</p>
      </div>
    );
  }

  const alreadyAttached = new Set(attached.map((a) => a.poster_id));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigate({ to: "/exhibition-structure" })}
          className="text-sm text-gray-500 hover:text-primary inline-flex items-center gap-1 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> 返回展覽列表
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" /> 刪除展覽
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            儲存
          </button>
        </div>
      </div>

      <h1 className="text-2xl font-bold text-primary mb-6">{exhibition.name || "（未命名展覽）"}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: basic fields */}
        <section className="card-box p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">基本資料</h2>

          <Field label="名稱 *">
            <input
              type="text"
              value={exhibition.name}
              onChange={(e) => updateField("name", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="起始日">
              <input
                type="date"
                value={exhibition.start_date ?? ""}
                onChange={(e) => updateField("start_date", e.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </Field>
            <Field label="結束日">
              <input
                type="date"
                value={exhibition.end_date ?? ""}
                onChange={(e) => updateField("end_date", e.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </Field>
          </div>

          <Field label="地點">
            <input
              type="text"
              value={exhibition.location ?? ""}
              onChange={(e) => updateField("location", e.target.value || null)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              placeholder="例如：台北靜思堂"
            />
          </Field>

          <Field label="狀態">
            <select
              value={exhibition.status}
              onChange={(e) => updateField("status", e.target.value as ExhibitionStatus)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            >
              <option value="planning">籌備中 (planning)</option>
              <option value="ongoing">進行中 (ongoing)</option>
              <option value="finished">已結束 (finished)</option>
            </select>
          </Field>

          <Field label="封面圖路徑">
            <input
              type="text"
              value={exhibition.cover_image_path ?? ""}
              onChange={(e) => updateField("cover_image_path", e.target.value || null)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              placeholder="Storage path 或公開 URL"
            />
          </Field>

          <Field label="排序">
            <input
              type="number"
              value={exhibition.sort_order ?? 0}
              onChange={(e) => updateField("sort_order", Number(e.target.value) || 0)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </Field>

          <Field label="描述">
            <textarea
              rows={3}
              value={exhibition.description ?? ""}
              onChange={(e) => updateField("description", e.target.value || null)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </Field>
        </section>

        {/* Right: attached posters */}
        <section className="card-box p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">
              掛海報 ({attached.length})
            </h2>
            <button
              onClick={() => setPickerOpen(true)}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white font-medium hover:bg-primary/90 inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> 從海報庫新增
            </button>
          </div>

          {attached.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">
              尚未掛任何海報。點「從海報庫新增」開始。
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={attached.map((a) => a.poster_id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {attached.map((a) => (
                    <SortablePosterCard
                      key={a.poster_id}
                      attached={a}
                      thumbnailUrl={resolveThumb(a.posters?.poster_files?.[0]?.thumbnail_path)}
                      onRemove={() => handleRemoveAttached(a.poster_id)}
                      removing={removingId === a.poster_id}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </section>
      </div>

      {pickerOpen && (
        <PosterPickerModal
          alreadyAttached={alreadyAttached}
          resolveThumbnail={resolveThumb}
          onClose={() => setPickerOpen(false)}
          onConfirm={handleAttachConfirm}
        />
      )}
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

- [ ] **Step 2: 確認 router 自動產生新 route**

TanStack Router 用 Vite plugin watch file system；新檔會自動 regenerate `routeTree.gen.ts`。

Run:
```bash
npm run build 2>&1 | tail -20
```

Expected: build 成功；`src/routeTree.gen.ts` 應已新增 `/exhibitions/$id/edit` 對應。若 build 失敗看 error；常見原因是 import path 拼錯。

- [ ] **Step 3: Commit**

```bash
git add src/routes/exhibitions/\$id.edit.tsx src/routeTree.gen.ts
git commit -m "feat(ui): /exhibitions/\$id/edit 詳細編輯頁

左：複用基本資料表單欄位（與既有 modal 一致）。
右：dnd-kit 拖曳排序的已掛海報清單 + 海報選擇器入口。
縮圖用 sign_thumbnail_url 預簽快取。"
```

---

## Task 11: 前端 — `exhibition-structure.tsx` 編輯按鈕改 router navigate

**Files:**
- Modify: `src/routes/exhibition-structure.tsx` (line 366-372)

- [ ] **Step 1: 把卡片「編輯」按鈕改成跳轉新頁**

找到 `src/routes/exhibition-structure.tsx:366-372`，目前是：

```tsx
<button
  onClick={() => setModal({ kind: "edit", exhibition: t })}
  className="text-sm font-medium text-primary hover:underline cursor-pointer"
>
  編輯
</button>
```

改成：

```tsx
<button
  onClick={() => navigate({ to: "/exhibitions/$id/edit", params: { id: t.id } })}
  className="text-sm font-medium text-primary hover:underline cursor-pointer"
>
  編輯
</button>
```

- [ ] **Step 2: 在 component 頂部取得 `navigate`**

找到 `function ExhibitionManagement()`（line 153），在 hooks 區塊新增（與既有 `useState` 並列）：

```tsx
import { useNavigate } from "@tanstack/react-router";
// ... (既有 imports)
```

並在 `function ExhibitionManagement()` 內：

```tsx
const navigate = useNavigate();
```

- [ ] **Step 3: 確認 `ExhibitionModal` 的 `edit` 分支保留但變孤兒**

因為 `setModal({ kind: "edit", ... })` 不再被呼叫，`ExhibitionModal` 內處理 `edit` 的程式碼會變成 dead code。本 PR 不刪（避免 git diff 過大），標記 TODO 在 PR-B 收尾時清理。

於檔案頂部 `function ExhibitionModal` 上方加：

```tsx
// TODO(PR-B): ExhibitionModal `edit` 分支已遷至 /exhibitions/$id/edit，
//             此 Modal 之後只用於 create。PR-A 暫留以縮小 diff。
```

- [ ] **Step 4: `npm run build` 檢查**

```bash
npm run build 2>&1 | tail -15
```

Expected: build 成功。

- [ ] **Step 5: Commit**

```bash
git add src/routes/exhibition-structure.tsx
git commit -m "feat(ui): 展覽卡「編輯」改跳 /exhibitions/\$id/edit

新增展覽仍走 modal；既有展覽的編輯入口轉到 Phase 2 詳細頁，
讓 admin 同時改基本資料與掛海報。"
```

---

## Task 12: 手動 E2E 驗證

**Files:** N/A — verification only

- [ ] **Step 1: 啟動 dev server**

```bash
npm run tauri dev
```

Wait until Vite ready + Tauri window opens.

- [ ] **Step 2: 驗證 1 — 新展覽 + 掛海報**

操作：
1. 登入（既有 admin 帳號）
2. 進「展覽管理」(`/exhibition-structure`)
3. 按「新增展覽」→ 填名稱「測試展覽 A」→ 狀態 `ongoing` → 儲存
4. 點剛建立的卡片「編輯」→ 應跳到 `/exhibitions/<uuid>/edit`
5. 右側「掛海報」應為空
6. 按「+ 從海報庫新增」→ Modal 開啟，預設 filter `published+approved`
7. 勾 3 張海報 → 按「新增 3 張」
8. Modal 關閉後右側列表顯示 3 張海報

預期：流程通暢，無 error toast / alert。

- [ ] **Step 3: 驗證 2 — 拖曳排序**

操作：
1. 抓海報 #3 的 GripVertical icon 拖到最上面
2. 放開後順序立即變化（optimistic）
3. F5 reload 頁面
4. 順序仍是新順序（已存到 DB）

預期：reload 後順序保留。若 reload 後順序回到原狀，代表 reorder API 沒成功 — 看 Tauri devtools console log。

- [ ] **Step 4: 驗證 3 — 移除單張**

操作：
1. 點任一海報右側 X
2. 該海報從清單消失（optimistic）
3. F5 reload
4. 該海報仍不在清單中

- [ ] **Step 5: 驗證 4 — workers.dev 前台對應**

操作：
1. 打開 `https://tzuchi-poster-platform.tzuchi-webit.workers.dev/`
2. 找到「測試展覽 A」
3. 點進展覽詳細頁
4. 應顯示步驟 2 掛上的 3 張海報（且順序與步驟 3 一致）

預期：前台順序與 admin 端一致。

- [ ] **Step 6: 驗證 5 — 已掛海報在 picker 中 disabled**

操作：
1. 回到 `/exhibitions/<uuid>/edit`
2. 再開「+ 從海報庫新增」
3. 已掛的 3 張海報應該灰色 + 標籤「已掛」 + checkbox 不可勾

- [ ] **Step 7: 清理測試資料**

操作：
1. 回到 `/exhibition-structure`
2. 刪除「測試展覽 A」（按卡片垃圾桶 icon）
3. 確認 `exhibition_posters` join table 對應 row 也被 cascade 刪除（DB 設定 ON DELETE CASCADE）

驗證：到 Supabase Studio 跑 `SELECT * FROM exhibition_posters WHERE exhibition_id = '<uuid>'` → 0 rows。

- [ ] **Step 8: 開 PR**

```bash
gh pr create --base main --title "feat(exhibitions): Phase 2 — 展覽掛海報 UI + 5 個 Tauri commands" --body "$(cat <<'EOF'
## What

補上昨天 commit 97c1ef9 留下的 Phase 2 — admin 把現有海報 attach 到展覽的端到端路徑。

## Why

`exhibition_posters` join table 已建（migration 010），workers.dev 前端也已改讀 join table，但 admin 沒有任何 UI 寫入這個表 → 結果就是 workers.dev 上的展覽詳細頁永遠是空的。本 PR 補上這個缺口。

## How

- 5 個新 Tauri command：`list_exhibition_posters` / `list_posters_for_picker` / `attach_posters_to_exhibition` / `detach_poster_from_exhibition` / `reorder_exhibition_posters`
- 新詳細頁 `/exhibitions/\$id/edit`：左 = 基本資料表單；右 = `@dnd-kit` 拖曳排序的已掛海報清單
- 新 `PosterPickerModal`：搜尋 + status filter，預設只列 `published+approved`
- `exhibition-structure.tsx` 卡片「編輯」按鈕改跳新頁

## Verification

見 plan Task 12 五個手動 E2E 驗證步驟 — 含 workers.dev 前台對應。

## Follow-up

PR-B：vocabulary_themes CRUD + 手動歸類 + VLM 動態讀表（另一份 plan）。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

Plan 涵蓋 spec §4 完整內容：
- §4.1 dnd-kit 依賴 → Task 1
- §4.2 三個新檔案 → Task 8, 9, 10
- §4.3 四個修改檔 → Task 2-7 (Rust)、Task 7 (api.ts)、Task 11 (exhibition-structure.tsx)
- §4.4 五個 Tauri commands → Task 2, 3, 4, 5, 6
- §4.5 AttachedPoster / PickerPoster 型別 → Task 7
- §4.6 UI 佈局 → Task 10
- §4.7 picker filter → Task 9
- §4.8 錯誤處理 → 散落各 task（attach ignore-duplicates、detach idempotent、reorder validate、optimistic rollback、無縮圖 placeholder）

未涵蓋（轉 PR-B）：spec §5 全部、§6 部分（PR-A 沒有自動測試 — 改成 Task 12 手動 E2E）

未來改進（不在本 PR）：
- 撕掉 `ExhibitionModal` 內 `edit` 分支 dead code（PR-B 收尾）
- 加 `@dnd-kit` 的 lazy import 縮 main bundle
- 縮圖 cache TTL（目前頁面 reload 才重簽）
