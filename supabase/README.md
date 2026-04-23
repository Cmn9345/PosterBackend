# Supabase Migrations — 海報資料庫後台

Production DB: `https://ptsupabase.tzuchi-org.tw` (自建 Supabase)

## 執行順序

| # | 檔案 | 用途 | 狀態 |
|---|---|---|---|
| 001 | `001_poster_schema_v2.1.sql` | `poster_files` 加 ai_analysis / metadata / Immich 欄位 | 已套用 (2026-04-12) |
| 002 | `002_user_sessions.sql` | 登入來源記錄 (desktop_app vs web) | 已套用 (2026-04-14) |
| 003 | `003_user_profiles.sql` | 志工/同仁 onboarding 資料 + 著作權同意 | 已套用 (2026-04-20) |
| 004 | `004_applications_tables.sql` | `application_posters` / `application_timeline` | 已套用 (2026-01-22) |
| 005 | `005_applications_add_columns.sql` | `applications` 加 project_name/theme_id/日期/地點欄位 | 已套用 (2026-01-22) |
| 006 | `006_vocabulary_themes.sql` | 主題權威表 + 12 主題 seed | **待套用** |
| 007 | `007_cleanup_ai_analysis_themes.sql` | 把舊 VLM 結果裡的 骨髓捐贈/歲末祝福/浴佛節 映射到新版 12 主題 | **待套用** |

> **套用方式**:
> 1. Supabase Studio → SQL Editor 貼上執行,一個一個跑
> 2. 或用 `supabase db push`(需要先把 migrations 日期格式化)

## 主題清單(12 類,跟 localhost:3000 `/themes` 一致)

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

- `src-tauri/src/services/qwenpaw/analysis.rs` — `THEME_LIST` const 必須跟本表 `name` 欄位完全一致(VLM prompt 會引用)
- `src/routes/posters/upload.tsx` — 上傳精靈 Step 3 的 checkbox 清單
- `docs/references/qwenpaw-original-sql/` — QwenPaw Python 原始 schema(僅供歷史對照,Rust 已 port)
