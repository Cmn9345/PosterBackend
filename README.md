# 海報資料庫後台 (PosterBackend)

慈濟海報資料庫 — 志工/同仁端桌面 app,負責海報上傳、AI 分析、審核、同步到 Immich 永久照片庫。

打包目標:macOS `.dmg` + `.app`(Universal),Windows `.msi` + `.exe`。

---

## 架構摘要

```
┌────────────────────────────────────────────────────────────────┐
│  Tauri Desktop App                                              │
│                                                                 │
│  Frontend (React 19 + TanStack Router + Tailwind 4)            │
│       ↕ tauri invoke                                            │
│  Rust Backend (src-tauri/)                                      │
│       ↕ HTTP                                                    │
│  Bundled llama-server sidecar  ← AI 在這裡跑,全部本機          │
│  127.0.0.1:18755  /v1/chat/completions                          │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
       │                    │                       │
       ▼                    ▼                       ▼
  Supabase           Immich (localhost:2283)    (舊) CoPaw WS
  ptsupabase                                    ws://localhost:8775
  .tzuchi-org.tw
```

## AI 執行位置(重要!)

| 環節 | 位置 |
|---|---|
| 推論引擎 | `src-tauri/resources/llama-server/` (26 MB,含 Metal 加速) |
| 模型 | Qwen2-VL 2B GGUF (q4_k_m) + mmproj |
| 模型檔位置 | `<app_local_data_dir>/models/` — **第一次啟動需使用者放入**(不隨 app 打包) |
| Rust 端橋接 | `src-tauri/src/services/qwenpaw/{llama_sidecar,vlm_local,analysis}.rs` |

## 目錄結構

```
posterbackend/
├── src/              前端 (React)
├── src-tauri/        Rust 後端 + llama-server bundle
│   ├── src/
│   │   ├── commands/   Tauri invoke handlers
│   │   └── services/
│   │       ├── qwenpaw/   AI pipeline (由 Python skill 改寫)
│   │       ├── supabase.rs
│   │       ├── immich.rs
│   │       ├── tus.rs
│   │       └── upload_db.rs  (本機 SQLite 斷點續傳)
│   └── resources/llama-server/   bundled llama.cpp binaries
│
├── supabase/         Supabase 資料庫 migrations (production)
│   ├── migrations/
│   └── README.md
│
└── docs/             PRD + 架構分析 + 設計提示詞
    ├── PRD-海報資料庫後台.md
    ├── PRD-海報展示與申請系統-前台.md
    ├── Rust技術架構分析報告.md
    ├── Immich架構分析報告.md
    ├── 設計提示詞-後台全頁面.md
    ├── plans/
    └── references/
        └── qwenpaw-original-sql/   QwenPaw Python 原始 schema(歷史對照)
```

## 開發

```bash
npm install
npm run tauri dev        # 啟動 dev 模式
npm run tauri build      # 產出 .dmg / .msi
```

### 環境變數 (`src-tauri/.env`)

```
POSTER_SUPABASE_URL=https://ptsupabase.tzuchi-org.tw
POSTER_SUPABASE_ANON_KEY=<anon_key>
IMMICH_URL=http://localhost:2283   # optional,預設值
IMMICH_API_KEY=<immich_key>        # optional
COPAW_WS_URL=ws://localhost:8775   # optional
```

### 第一次啟動要手動放模型檔

```
<app_local_data_dir>/models/qwen2-vl-2b-instruct-q4_k_m.gguf
<app_local_data_dir>/models/mmproj-Qwen2-VL-2B-Instruct-f16.gguf
```

## 相關專案

- **posterfrontend** (另一個 repo) — 公開的 Next.js 前台,讓一般志工瀏覽/申請海報,讀同一個 Supabase
- **3in1media-copaw-webgpu** (`phoenix581228/3in1media-copaw-webgpu`) — QwenPaw Python 原始實作,本 repo 的 Rust 端已把 skill 全部 port 過來
