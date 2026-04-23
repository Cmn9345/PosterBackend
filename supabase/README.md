# Supabase Migrations — 海報資料庫後台

Production DB: `https://ptsupabase.tzuchi-org.tw` (自建 Supabase)

## ⚠️ 重要:實際 production schema ≠ 早期設計

`poster_files` 表實際上用**獨立欄位**存 VLM 結果,**不是 JSONB 整包**:

| 欄位 | 型別 | 從 VLM 的哪裡來 |
|---|---|---|
| `description` | text | `analysis.description` |
| `people_summary` | text | `has_person=true` 時自動填 |
| `themes` | **text[]**(Postgres 陣列) | `analysis.themes` |
| `processing_status` / `processing_error` | varchar / text | pipeline 進度 |
| `immich_asset_id` / `immich_sync_status` / `immich_synced_at` / `immich_sync_error` | - | Immich 同步狀態 |

其他 VLM 輸出(`ocr_text` / `scores` / `suggestions` / `has_logo` / `has_person` / `language` 等)**只存在 app 本機 SQLite**(`src-tauri/src/services/upload_db.rs`),不上 Supabase。

Rust 端的寫入邏輯在 `src-tauri/src/services/supabase.rs::update_file_ai_analysis` (line 661)。

## 執行順序

| # | 檔案 | 用途 | 狀態 |
|---|---|---|---|
| ~~001~~ | `001_DEPRECATED_*.sql.ref` | 舊設計:加 ai_analysis/metadata JSONB 欄位 | ❌ **勿執行** — 歷史參考,production schema 走另一條路 |
| 002 | `002_user_sessions.sql` | 登入來源記錄(desktop_app vs web) | ⚠️ 狀態未確認 |
| 003 | `003_user_profiles.sql` | 志工/同仁 onboarding 資料 | ⚠️ 狀態未確認 |
| 004 | `004_applications_tables.sql` | `application_posters` / `application_timeline` | ⚠️ 狀態未確認 |
| 005 | `005_applications_add_columns.sql` | `applications` 加 project_name/theme_id/日期/地點 | ⚠️ 狀態未確認 |
| **006** | `006_vocabulary_themes.sql` | 主題權威表 + 12 主題 seed | **待套用** |
| **007** | `007_cleanup_ai_analysis_themes.sql` | 清洗 `poster_files.themes` 裡的 3 個舊字串 | **待套用(有資料才需)** |

### 怎麼確認 002–005 是否已套用

```sql
-- 檢查這幾張表 / 欄位是否存在
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('user_sessions', 'user_profiles', 'application_posters', 'application_timeline');

SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'applications'
   AND column_name IN ('project_name', 'theme_id', 'exhibition_date_start', 'location_org');
```

## 006 / 007 使用前的必驗查詢

**006 — 檢查 vocabulary_themes 表是否存在**
```sql
SELECT count(*) FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'vocabulary_themes';
-- 0 → 006 會新建表
-- 1 → 006 只會 upsert 12 筆 seed(已存在的 row 會被更新 name/desc/icon 等)
```

**007 — 檢查有沒有舊字串需要清洗**
```sql
SELECT count(*) FROM poster_files
 WHERE themes && ARRAY['骨髓捐贈', '歲末祝福', '浴佛節']::text[];
-- 0 → 沒舊資料,007 不用跑
-- >0 → 該筆數就是 007 會改到的 row 數
```

## 12 主題清單(與 posterfrontend localhost:3000 `/themes` 一致)

| id (slug) | name | icon | 備註 |
|---|---|---|---|
| origin | 朔源 | 🏛️ | |
| charity | 慈善 | ❤️ | |
| medical | 醫療 | 🏥 | 原「骨髓捐贈」併入此 |
| education | 教育 | 📚 | |
| humanities | 人文 | 🎭 | |
| environment | 環保 | 🌱 | |
| vegetarian | 茹素護生 | 🥬 | |
| international | 國際賑災 | 🌍 | |
| jingsi | 靜思語 | 🪷 | |
| events | 大事記 | 📅 | |
| lotus | 法華坡道 | ☸️ | 原「浴佛節」併入此 |
| annual | 年度主題 | 🎯 | 原「歲末祝福」併入此 |

## 與程式碼的連動點

- `src-tauri/src/services/qwenpaw/analysis.rs` 的 `THEME_LIST` 必須跟本表 `name` 完全一致(VLM prompt 會引用)
- `src/routes/posters/upload.tsx` — 上傳精靈 Step 3 的 12 個 checkbox
- `src-tauri/src/services/supabase.rs::update_file_ai_analysis` — 實際寫入 Supabase 的欄位對應
- `docs/references/qwenpaw-original-sql/` — QwenPaw Python 原始 schema(僅供歷史對照)
