# Dependencies & Services Map

盤點所有相關服務、依賴、AI 執行位置。

## 架構大圖

```
┌────────────────────────────────────────────────────────────────┐
│  海報資料庫後台 (Tauri Desktop App — 本 repo)                   │
│  ┌─────────────────┐          ┌────────────────────────────┐   │
│  │  Frontend       │  Tauri   │  Rust Backend              │   │
│  │  React 19 + TS  │◄─invoke─►│  (src-tauri/)              │   │
│  └─────────────────┘          └──────────┬─────────────────┘   │
│                                          ▼                     │
│              ┌──────────────────────────────────────────────┐  │
│              │  Bundled llama-server sidecar (本機 AI)     │  │
│              │  127.0.0.1:18755                            │  │
│              └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
            │                     │                     │
            ▼                     ▼                     ▼
   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
   │ Supabase        │   │ Immich          │   │ CoPaw WS (舊)   │
   │ ptsupabase      │   │ localhost:2283  │   │ localhost:8775  │
   │ .tzuchi-org.tw  │   │ (核准後同步)    │   │ (通知通道)      │
   └─────────────────┘   └─────────────────┘   └─────────────────┘
```

## Frontend 依賴 (`package.json`)

| 類別 | 套件 | 版本 | 用途 |
|---|---|---|---|
| UI 框架 | `react` / `react-dom` | ^19.2.4 | 渲染 |
| 路由 | `@tanstack/react-router` | ^1.168.10 | SPA 路由 |
| 狀態 | `zustand` | ^5.0.12 | authStore / posterStore |
| 表單 | `react-hook-form` + `zod` | - | 表單驗證 |
| 樣式 | `tailwindcss` | ^4.2.2 | CSS |
| 圖示 | `lucide-react` | ^1.7.0 | Icon |
| Tauri | `@tauri-apps/api` + plugins | ^2.x | Rust 橋接 |
| 資料庫 | `@supabase/supabase-js` | ^2.101.1 | Auth + Postgres + Storage |
| 建構 | `vite` + `typescript` | ^8 / ^6 | Dev server + bundler |

## Rust Backend 依賴 (`src-tauri/Cargo.toml`)

| 類別 | Crate | 用途 |
|---|---|---|
| Tauri 核心 | `tauri` 2 + plugins (log/notification/dialog/fs/shell/http) | App 框架 |
| HTTP | `reqwest` | 呼叫 Supabase / Immich / llama-server |
| WebSocket | `tokio-tungstenite` + `futures-util` | CoPaw WS client |
| 非同步 | `tokio` | runtime |
| 本地 DB | `rusqlite` (bundled) | 斷點續傳狀態 |
| 序列化 | `serde` + `serde_json` | JSON |
| 影像處理 | `image` (jpeg/png/webp/gif/bmp/tiff) + `webp` + `kamadak-exif` | 縮圖、EXIF |
| 其他 | `uuid`、`chrono`、`base64`、`sha2`、`dirs`、`dotenvy`、`urlencoding`、`open` | - |

## AI 執行位置

| 環節 | 位置 | 說明 |
|---|---|---|
| 推論引擎 | `src-tauri/resources/llama-server/` | 26 MB,54 檔,含 Metal 加速 |
| 啟動方式 | `src-tauri/src/services/qwenpaw/llama_sidecar.rs` | App 啟動時 spawn subprocess |
| 通訊 | 127.0.0.1:18755,OpenAI-compat `/v1/chat/completions` | HTTP |
| 模型檔 | `<app_local_data_dir>/models/` | **首次啟動需手動放入** |
|  | `qwen2-vl-2b-instruct-q4_k_m.gguf` | 主模型(2B,4-bit 量化) |
|  | `mmproj-Qwen2-VL-2B-Instruct-f16.gguf` | 多模態 projector |
| 呼叫端 | `src-tauri/src/services/qwenpaw/vlm_local.rs` | Rust HTTP client |
| 限制 | 最長邊 1536 px,JPEG q=88,timeout 180s | `analysis.rs` 內設定 |
| 觸發 | `task_queue.rs` — 每次上傳完序列處理 | 單使用者、單 thread |

### AI 輸出

每張海報產生結構化 JSON (`poster_files.ai_analysis`):
- `ocr_text`:逐字抄錄海報文字
- `themes`:從 12 主題選 1–3(朔源/慈善/醫療/教育/人文/環保/茹素護生/國際賑災/靜思語/大事記/法華坡道/年度主題)
- `description`:150–300 字典藏描述
- `language` / `has_logo` / `has_person`
- `scores`:construction/clarity/design_quality/content_completeness/typography(0–100)
- `suggestions`:給審核員的改善建議

## 外部服務

| 服務 | URL | 用途 | 設定來源 |
|---|---|---|---|
| **Supabase** | `https://ptsupabase.tzuchi-org.tw` | Auth + Postgres + Storage (`poster-files`, `poster-thumbnails` buckets) | `.env` POSTER_SUPABASE_URL / POSTER_SUPABASE_ANON_KEY |
| **Immich** | `http://localhost:2283` 預設 | 審核通過後同步原檔到永久照片庫 | `IMMICH_URL` / `IMMICH_API_KEY` |
| **CoPaw WS** | `ws://localhost:8775` 預設 | Legacy 通知通道(可能待廢) | `COPAW_WS_URL` |

## 打包 (`tauri.conf.json`)

```
bundle.resources: ["resources/llama-server"]   ← 26 MB llama.cpp 一起打包
bundle.targets: "all"                          ← 產 .dmg / .msi / .deb / .AppImage
identifier: "org.tzuchi.poster-admin"
version: "0.1.0"
```

## 注意事項

1. **Windows 版打包** — 目前 `resources/llama-server/` 只有 macOS 二進位(.dylib + Metal)。Windows 版要另外放 `.dll` + CUDA/Vulkan/CPU 版本。
2. **模型檔未打包** — 2 GB 太大,由使用者首次啟動時手動放入。可以另寫一個 command 做自動下載。
3. **CoPaw WS client 可能殘留** — QwenPaw 已經 port 到 Rust in-process,WS 通道僅為通知管道。
4. **AI 分類結果要跟 `vocabulary_themes` 一致** — 詳見 `supabase/migrations/006_vocabulary_themes.sql` 與 `007_cleanup_ai_analysis_themes.sql`。
