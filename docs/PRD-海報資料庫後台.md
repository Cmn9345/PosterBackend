# PRD v2.1：慈濟海報資料庫後台 — Tauri App + CoPaw Agent 整合

**版本：** 2.1
**日期：** 2026-04-12
**狀態：** Draft
**關聯專案：** 3in1media CoPaw WebGPU (v0.11.0)、海報資料庫前台 (poster-frontend v0.3.0)
**前版：** v2.0 (2026-03-17) — 缺少 AI 處理流程（EXIF/OCR/檔型分類）
**變更依據：** 補充完整建檔 5 步驟工作流程（模仿 3in1media），新增 MetadataSkill、PosterAnalysisSkill（OCR + 圖說 + 分類）

---

## 1. 產品概述

### 1.1 一句話描述

一套基於 **Tauri 桌面 App + CoPaw Agent 調度 + Supabase + Immich** 的海報資料庫後台系統，支援建檔者上傳海報原始檔（PSD/AI/PDF/TIFF，最大 200MB+），CoPaw 自動處理**縮圖生成、EXIF 提取、AI 圖說/OCR 辨識、檔型分類**並同步至 Immich，審核者於桌面 App 審核申請單，審核結果透過 **CoPaw tunnel App 內推送 + Gmail API** 通知申請者。

### 1.2 問題陳述

- 海報建檔目前為**人工作業**，建檔者需手動上傳、產生縮圖、填寫 metadata
- 申請審核透過紙本或 Email，流程不透明、無法追蹤
- 海報素材散落各處，缺乏統一管理與存取控制
- 前台（poster-frontend）已完成 UI 骨架，但後台管理功能完全缺失
- 後台需處理大檔上傳（200MB+），桌面 App 比瀏覽器更穩定可靠

### 1.3 解決方案

**Tauri 桌面 App（Rust + React）+ CoPaw Agent 調度 + Supabase + Immich**

```
建檔者於桌面 App 上傳海報原檔
    ↓
Tauri Rust 後端 → Supabase Storage（原生 HTTP，大檔穩定上傳）
    ↓
CoPaw Agent 調度（任務推送）
    ├─ 生成縮圖 Skill（多尺寸）
    ├─ Immich 同步 Skill（asset 建立 + album 歸類）
    └─ DB 狀態更新（posters.status → pending_review）
    ↓
審核者於桌面 App 審核上架
    ↓
CoPaw Agent 調度（通知推送）
    ├─ CoPaw tunnel → App 內即時通知（OS 原生通知）
    └─ Gmail API → 以審核者身份 Email 通知申請者
    ↓
前台志工/同仁瀏覽、申請、下載
```

### 1.4 目標用戶

| 使用者 | 說明 | 操作 | 平台 |
|:---|:---|:---|:---|
| 建檔者 | 慈濟設計部門同仁 | 上傳海報原檔 + 填寫 metadata | **桌面 App** |
| 審核者 | 承辦者 / 宗教處 / 主管 / 師父 | 審核申請單（核可/駁回/轉呈） | **桌面 App** |
| 承辦者 | 海報業務負責人 | 接單、結案、回覆申請者 | **桌面 App** |
| 系統管理員 | IT 人員 | 使用者權限、系統設定 | **桌面 App** |
| 志工/同仁 | 海報申請者 | 瀏覽、申請、下載 | 前台 Web |

### 1.5 與前台的關係

| 系統 | 形式 | 負責範圍 |
|:---|:---|:---|
| **前台** (poster-frontend) | Web（React） | 瀏覽、申請、進度追蹤、**下載**（PRD 2.10） |
| **後台**（本文件） | **Tauri 桌面 App**（Mac + Windows） | **上傳**、建檔、**審核**、上架管理、展覽管理、統計 |

兩者共用同一個 Supabase 實例 + Immich 服務。

---

## 2. 系統架構

### 2.1 整體架構

```
┌──────────────────────────────────────────────────────────────────┐
│                    Tauri 桌面 App (Mac + Windows)                  │
│                                                                    │
│  ┌────────────────────────────────────────────────────────┐       │
│  │  WebView 前端 (React)                                   │       │
│  │  React 19 + Vite 7 + TanStack Router + shadcn/ui       │       │
│  │  ├─ 上傳 UI：拖拽上傳 + 多檔進度條                       │       │
│  │  ├─ 審核 UI：申請單列表 + 詳情 + 核可/駁回/轉呈          │       │
│  │  └─ 管理 UI：海報、展覽、主題、使用者、權威表、設定        │       │
│  └───────────────────────┬────────────────────────────────┘       │
│                          │ Tauri IPC (invoke)                      │
│  ┌───────────────────────▼────────────────────────────────┐       │
│  │  Rust 後端                                              │       │
│  │  ├─ 大檔上傳（原生 HTTP + 分片 + 斷點續傳）              │       │
│  │  ├─ CoPaw tunnel（WebSocket 長連線，比瀏覽器穩定）       │       │
│  │  ├─ OS 原生通知（macOS Notification Center / Windows）   │       │
│  │  ├─ 檔案系統存取（拖拽 + 本地暫存）                      │       │
│  │  └─ 自動更新（Tauri Updater）                           │       │
│  └────────────────────────────────────────────────────────┘       │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│                    CoPaw Agent (Python)                            │
│                                                                    │
│  【任務推送】                                                       │
│  ├─ BrowserChannel (WebSocket 通訊 → Tauri Rust 端)               │
│  ├─ TaskManager (任務佇列 + 租約)                                  │
│  ├─ ThumbnailSkill (原檔 → 多尺寸縮圖)                            │
│  ├─ ImmichSyncSkill (縮圖/原檔 → Immich API)                      │
│  └─ StatusUpdateSkill (DB 狀態機更新)                              │
│                                                                    │
│  【通知推送】                                                       │
│  ├─ AppNotifySkill (CoPaw tunnel → App 內即時通知)                 │
│  └─ GmailSkill (Gmail API + OAuth → 審核結果 Email 通知申請者)     │
│                                                                    │
└───────────────────────────┬──────────────────────────────────────┘
                            │
     ┌──────────────┬───────┼───────────────┬───────────────┐
     ▼              ▼       ▼               ▼               ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Supabase │ │ Supabase │ │  Immich  │ │  Gmail   │ │  OS 原生  │
│ Postgres │ │ Storage  │ │  Server  │ │   API    │ │  通知中心  │
│(metadata)│ │(原檔+縮圖)│ │(圖片管理)│ │(OAuth2.0)│ │(Mac/Win) │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### 2.2 為什麼選 Tauri（v1.1 → v2.0 變更理由）

| 比較項 | v1.1 純 React Web | v2.0 Tauri App |
|:---|:---|:---|
| 大檔上傳 200MB+ | 瀏覽器 tus，受限於瀏覽器 | **Rust 原生 HTTP，更穩定** |
| CoPaw 連線 | 瀏覽器 WebSocket，頁籤關閉就斷 | **Rust 背景 WebSocket，App 開著就連著** |
| 通知 | 需要瀏覽器 Push 權限 | **OS 原生通知，無需額外權限** |
| 拖拽上傳 | 瀏覽器 File API | **OS 原生拖拽，支援資料夾** |
| 檔案系統 | 受限 | **完整存取（暫存、快取）** |
| App 大小 | 0（瀏覽器） | **~3-10MB**（比 Electron 150MB+ 輕量） |
| 自動更新 | Service Worker | **Tauri Updater（OS 原生）** |
| 離線能力 | 有限 | **可暫存上傳佇列** |

### 2.3 CoPaw 整合（借用 3in1media 架構）

| 3in1media 模組 | 海報系統對應 | 改動幅度 |
|:---|:---|:---|
| `server.py` | CoPaw 主伺服器 | 改路由，移除 VLM/STT 相關 |
| `browser_channel.py` | WebSocket 通訊（連 Tauri Rust 端） | 直接複用 |
| `task_manager.py` | 任務佇列 | 直接複用 |
| `sbegather_client.py` | → `supabase_client.py` | 改連線目標為海報 Supabase |
| `media_processor/skill.py` | → `thumbnail_skill.py` | 改為縮圖生成邏輯 |
| （新增） | `immich_sync_skill.py` | Immich API 整合 |
| （新增） | `app_notify_skill.py` | CoPaw tunnel → App 內通知 |
| （新增） | `gmail_skill.py` | Gmail API 發信（審核結果通知） |

### 2.4 建檔工作流程（5 步驟，模仿 3in1media）

```
                    建檔 5 步驟（3in1media 模式）→ metadata
                    ═══════════════════════════════════════

Step 1：拉檔 → 桌面 CoPaw App
─────────────────────────────────
建檔者拖拽檔案到 Tauri App
    ↓
[1a] React UI → Tauri IPC invoke('upload_file')
    ↓
[1b] Rust 後端 → Supabase Storage（TUS 分片上傳，6MB/chunk，200MB+ 穩定）
    ↓
[1c] Rust 後端 → Supabase DB INSERT poster_files (processing_status='uploaded')
    ↓
[1d] Rust 後端 → CoPaw tunnel WebSocket 通知 "new_upload"
    ↓
[1e] CoPaw TaskManager claim_task → 啟動處理管線

Step 2：AI Worker 處理（CoPaw Skills 管線）
─────────────────────────────────────────────
[2a] ThumbnailSkill：縮圖生成
     ├─ 從 Storage 下載原檔
     ├─ 依檔型專屬處理（見 Step 3 分類）
     ├─ 生成 S(200px) / M(600px) / L(1200px) WebP 85%
     └─ 上傳至 Storage poster-thumbnails bucket
    ↓
[2b] MetadataSkill：EXIF 提取（模仿 3in1media poster_metadata）
     ├─ 圖片：Pillow getexif() → 拍攝日期/相機/GPS/DPI/色彩模式
     ├─ PSD：psd_tools → 寬高/色彩模式/圖層數
     ├─ PDF/AI：PyMuPDF → 頁數/尺寸/文件 metadata
     └─ 寫入 poster_files.metadata (JSONB)
    ↓
[2c] PosterAnalysisSkill：AI 圖說 + OCR（模仿 3in1media poster_analysis）
     ├─ 透過 BrowserChannel WebSocket 派發 inference_request
     ├─ 瀏覽器 Qwen3.5 VLM (WebGPU) 處理 → 回傳 JSON：
     │   ├─ ocr_text：海報上所有可見文字（標題/副標/日期/地點）
     │   ├─ themes：1-3 主題分類（環保/慈善/醫療/教育/人文...）
     │   ├─ description：50-100 字圖說描述（供前端展示）
     │   ├─ language：主要語言
     │   ├─ has_logo / has_person：布林值
     │   └─ resolution_info：W×H 解析度描述
     └─ 寫入 poster_files.ai_analysis (JSONB)

Step 3：專案歸類 + 檔型分類
────────────────────────────
[3a] 檔型分類（依副檔名 + MIME）：
     ├─ image：PNG/JPG/WEBP/TIFF → Pillow 直接處理
     ├─ psd：PSD → psd_tools 合成所有圖層為平面圖
     ├─ pdf：PDF → PyMuPDF 渲染首頁 (2x scale)
     ├─ ai：AI (Illustrator) → PyMuPDF 渲染
     └─ unknown：不支援類型 → 標記錯誤
    ↓
[3b] 依 AI 辨識結果自動建議專案歸類 + 主題標籤
    ↓
[3c] 建檔者確認/修改 metadata、專案、主題

Step 4：審核
────────────
[4a] 所有檔案處理完成 → posters.status = 'pending_review'
    ↓
[4b] AppNotifySkill → 通知審核者有新的待審項目
    ↓
[4c] 審核者檢視：原檔預覽 + 縮圖 + AI 圖說 + OCR 文字 + metadata
    ↓
[4d] 審核決定：
     ├─ ✅ OK → 上傳縮圖正式化，狀態 → 'approved'
     └─ ❌ NO → 返還建檔者修改，狀態 → 'rejected'，附駁回原因

Step 5：Supabase（中台）←同步→ Immich → 前端
──────────────────────────────────────────────
[5a] ImmichSyncSkill：上傳原檔至 Immich API → 取得 asset_id
    ↓
[5b] Immich Album 歸類（依主題/展覽）
    ↓
[5c] StatusUpdateSkill：更新 DB
     ├─ poster_files.immich_asset_id = asset_id
     ├─ poster_files.immich_sync_status = 'synced'
     ├─ poster_files.processing_status = 'completed'
     └─ posters.status = 'published'
    ↓
[5d] 前端（poster-frontend）可查詢並展示海報
```

#### 任務管線時序圖

```
建檔者          Tauri App (Rust)         CoPaw Agent              AI Worker (瀏覽器)       Supabase        Immich
  │                  │                      │                         │                    │              │
  │─拖拽檔案────────▶│                      │                         │                    │              │
  │                  │─TUS 分片上傳──────────────────────────────────────────────────────▶│              │
  │                  │─DB INSERT─────────────────────────────────────────────────────────▶│              │
  │                  │─WebSocket notify────▶│                         │                    │              │
  │                  │                      │─claim_task              │                    │              │
  │                  │                      │─[2a] 縮圖生成───────────────────下載原檔──▶│              │
  │                  │                      │─────────────────────────────────上傳縮圖──▶│              │
  │                  │                      │─[2b] EXIF 提取──────────────────寫入 DB──▶│              │
  │                  │                      │─[2c] inference_request─▶│                    │              │
  │                  │                      │                         │─VLM OCR+圖說       │              │
  │                  │                      │◀─inference_result───────│                    │              │
  │                  │                      │───────────────────────────────AI結果寫DB──▶│              │
  │                  │                      │─[3] 檔型分類+專案建議                       │              │
  │◀─通知確認────────│◀─AppNotify───────────│                         │                    │              │
  │─確認 metadata───▶│                      │                         │                    │              │
  │                  │                      │─[4] 更新 pending_review─────────────────▶│              │
  │                  │                      │  (審核者審核...)         │                    │              │
  │                  │                      │─[5a] Immich 同步────────────────────────────────────────▶│
  │                  │                      │─[5c] 更新 published────────────────────────▶│              │
```

---

## 3. 技術棧

### 3.1 確認的技術選型

| 層級 | 技術 | 版本 | 角色 | 驗證狀態 |
|:---|:---|:---|:---|:---|
| **桌面框架** | **Tauri** | 2.x | Mac + Windows 桌面 App | 待 POC |
| **App 前端** | React + Vite + TanStack Router | React 19 / Vite 7 | WebView UI | poster-frontend 已驗證 |
| **App 後端** | Rust (Tauri backend) | — | 大檔上傳 / WebSocket / OS 通知 | 待 POC |
| **UI 元件** | shadcn/ui + Radix UI | 最新 | 表單、Modal、Table | poster-frontend 已有 |
| **狀態管理** | Zustand | 5.x | 篩選/編輯狀態 | poster-frontend 已有 |
| **表單驗證** | React Hook Form + Zod | RHF 7.x / Zod 4.x | 上傳/審核表單 | poster-frontend 已有 |
| **樣式** | Tailwind CSS | 4.x | Utility-first | 已有 |
| **Agent 調度** | CoPaw (Python 3.10+) | — | 任務編排 + Skill 系統 | 3in1media 已驗證 |
| **後端資料** | Supabase (PostgreSQL + Storage + Realtime) | 2.x | DB + 檔案儲存 | 待確認環境 |
| **圖片管理** | Immich | — | 縮圖 + Album + 搜尋 | 前台已整合 |
| **CoPaw 通訊** | WebSocket (Rust ↔ CoPaw) | — | tunnel 長連線 | 3in1media RTT 0.20ms |
| **大檔上傳** | Rust 原生 HTTP + 分片 | — | 200MB+ 斷點續傳 | 待 POC |
| **App 內通知** | Tauri Notification API → OS 原生 | — | macOS / Windows 通知中心 | Tauri 內建 |
| **Email 通知** | Gmail API + Google OAuth 2.0 | — | 審核結果 Email（以審核者身份） | 待驗證 scope |
| **認證** | Google OAuth 2.0 | — | 登入 + Gmail send 授權 | 前台已有 OAuth 基礎 |
| **自動更新** | Tauri Updater | — | App 版本更新推送 | Tauri 內建 |

### 3.2 Tauri App 結構

```
poster-admin-app/
├── src-tauri/                    # Rust 後端
│   ├── Cargo.toml
│   ├── tauri.conf.json           # Tauri 配置（App 名稱、窗口、權限）
│   ├── src/
│   │   ├── main.rs               # Tauri 入口
│   │   ├── commands/              # Tauri IPC commands
│   │   │   ├── upload.rs          # 大檔上傳（分片 + 斷點續傳）
│   │   │   ├── copaw.rs           # CoPaw tunnel WebSocket 管理
│   │   │   ├── notify.rs          # OS 原生通知
│   │   │   └── auth.rs            # Google OAuth + token 管理
│   │   ├── services/
│   │   │   ├── supabase.rs        # Supabase REST + Storage client
│   │   │   └── gmail.rs           # Gmail API client
│   │   └── lib.rs
│   └── icons/                    # App 圖示（Mac + Win）
├── src/                          # React 前端（WebView）
│   ├── main.tsx
│   ├── routes/                   # TanStack Router 頁面
│   │   ├── __root.tsx            # Layout（導航 + 通知面板）
│   │   ├── login.tsx
│   │   ├── index.tsx             # 儀表盤
│   │   ├── posters/              # 海報管理 + 上傳
│   │   ├── applications/         # 申請單審核
│   │   ├── exhibitions/          # 主題策展
│   │   ├── exhibition-structure.tsx
│   │   ├── vocabulary.tsx
│   │   ├── users.tsx
│   │   ├── statistics.tsx
│   │   └── settings/             # 通知/徵詢/轉呈設定
│   ├── components/ui/            # shadcn/ui
│   ├── hooks/                    # Tauri IPC hooks
│   │   ├── useTauriUpload.ts     # invoke('upload_file') 封裝
│   │   ├── useCoPawTunnel.ts     # CoPaw WebSocket 狀態
│   │   └── useNotification.ts    # OS 通知 hook
│   ├── stores/
│   ├── types/                    # 共用型別（從 poster-frontend 同步）
│   └── lib/
│       └── supabase.ts           # Supabase client（WebView 側查詢用）
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### 3.3 共用資源（與 poster-frontend 共用）

| 資源 | 路徑/位置 | 說明 |
|:---|:---|:---|
| TypeScript 型別定義 | `poster-frontend/src/types/index.ts` | 19 個 ENUM + 30+ interface |
| Supabase 實例 | `ptsupabase.tzuchi-org.tw`（遷移中） | 共用 DB + Storage |
| Immich 實例 | 待提供 API endpoint | 共用圖片管理 |
| 設計系統 | Tailwind + 慈濟色系 | 共用 `--color-tzu-*` tokens |
| shadcn/ui 元件 | 共用 | 後台 App WebView 與前台 Web 共用元件 |

---

## 4. 功能需求

### 4.1 上傳與建檔（posters.html 設計）

#### 功能說明

建檔者於桌面 App 上傳海報原始檔（PSD/AI/PDF/PNG/JPG），Tauri Rust 後端處理大檔上傳，CoPaw 自動處理縮圖並同步至 Immich。

#### 多步驟建檔表單

| 步驟 | 欄位 | 說明 |
|:---|:---|:---|
| Step 1：基本資訊 | 上架編號（自動產生）、專案名稱、品項分類、展覽時間、展覽地點、公開說明、內部備註 | 對齊 `Poster` 型別 |
| Step 2：檔案上傳 | **OS 原生拖拽/選擇**（多檔+資料夾）、每檔可設定：尺寸、存取等級、描述 | 對齊 `PosterFile` 型別 |
| Step 3：主題關聯 | 多選主題 checkbox | 對齊 `poster_themes` 表 |

#### 上傳規格

| 項目 | 規格 |
|:---|:---|
| 支援格式 | PSD, AI, PDF, PNG, JPG |
| 單檔上限 | 待確認（目標 ≥ 200MB） |
| 上傳方式 | **Tauri Rust 原生 HTTP**（分片 + 斷點續傳） |
| Storage bucket | `poster-files` |
| 路徑格式 | `poster-files/{poster_id}/{system_filename}` |
| 並發上傳 | 支援多檔並行（Rust async） |
| 進度顯示 | 每檔獨立進度條 + 整體進度（Tauri IPC event 推送至 React） |
| 離線暫存 | 上傳失敗暫存本地，網路恢復自動重試 |

#### 上傳後自動處理（CoPaw）

| 處理 | Skill | 輸出 |
|:---|:---|:---|
| 生成縮圖 250px | ThumbnailSkill | `poster-thumbnails/{poster_id}/{filename}_thumb.jpg` |
| 生成預覽圖 1440px | ThumbnailSkill | `poster-thumbnails/{poster_id}/{filename}_preview.jpg` |
| 同步至 Immich | ImmichSyncSkill | `poster_files.immich_asset_id` |
| Album 歸類 | ImmichSyncSkill | Immich Album（依主題） |
| 更新狀態 | StatusUpdateSkill | `posters.status = 'pending_review'` |

---

### 4.2 申請單審核（applications.html 設計）

#### 功能說明

審核者於桌面 App 檢視申請單、預覽海報素材、進行核可/駁回/轉呈操作。

#### 審核流程（對齊前台 PRD 4.2）

```
申請提交 (pending)
    ↓
承辦者接單 (in_review)
    ↓ ─────────────────────────────┐
    │ 短流程                       │ 長流程
    │ (同仁+none/logo)             │ (restricted_image/special_person)
    ↓                              ↓
承辦者(handler)               承辦者(handler)
    ↓                              ↓
[志工] 宗教處(religious)      宗教處(religious)
    ↓                              ↓
結案 (awaiting_closure)       主管(supervisor)
    ↓                              ↓
已核可 (approved)             師父(master)
                                   ↓
                              結案 (awaiting_closure)
                                   ↓
                              已核可 (approved)
```

#### 審核頁面元素

| 區塊 | 內容 |
|:---|:---|
| 申請單列表 | 表格：編號/申請人/日期/狀態/海報數/操作 |
| 狀態篩選 Tab | 待審核 / 審核中 / 已核可 / 已駁回 |
| 審核詳情 Modal | 申請人資訊 + 展覽資訊 + 海報清單（含縮圖預覽） |
| 審核操作 | 核可/駁回按鈕 + 審核意見 textarea |
| 轉呈操作 | 選擇轉呈對象 + 備註 |
| 審核歷程 | 時間軸顯示各階段審核人/動作/時間 |

#### 審核後通知

```
審核者按下「核可」/「駁回」
    ↓
[1] React → Tauri IPC invoke('submit_review', { ... })
    ↓
[2] Rust → Supabase RPC review_application()
    ↓
[3] Rust → CoPaw tunnel 通知 "review_completed"
    ↓
[4] CoPaw GmailSkill → Gmail API → 以審核者身份 Email 通知申請者
    ↓
[5] CoPaw AppNotifySkill → tunnel → 其他在線 App 收到通知
```

---

### 4.3 通知系統

#### 通知管道

| 管道 | 技術 | 用途 |
|:---|:---|:---|
| **App 內通知** | CoPaw tunnel → Tauri Rust → OS 原生通知 | 即時通知後台使用者（新任務/處理完成/轉呈） |
| **Gmail Email** | Gmail API + 審核者 OAuth token | 審核結果通知前台申請者（核可/駁回/結案） |

#### 通知觸發時機

| 事件 | App 內通知 | Gmail Email |
|:---|:---|:---|
| 新申請單（通知承辦者） | ✅ OS 通知 | ❌ |
| 海報處理完成（通知建檔者） | ✅ OS 通知 | ❌ |
| 轉呈/徵詢（通知被轉呈者） | ✅ OS 通知 | ❌ |
| 申請單核可/駁回（通知申請者） | ❌（申請者在前台） | ✅ 以審核者身份發信 |
| 結案（通知申請者） | ❌（申請者在前台） | ✅ 以承辦者身份發信（含下載連結） |

#### Gmail OAuth 整合

- 登入時 Google OAuth scope 包含 `https://www.googleapis.com/auth/gmail.send`
- 審核者的 `access_token` + `refresh_token` 由 Tauri Rust 端安全儲存（OS Keychain）
- CoPaw 發信前向 Rust 端請求有效 token

---

### 4.4 海報管理

| 功能 | 說明 |
|:---|:---|
| 上架單列表 | 表格：編號/名稱/檔案數/狀態/操作 |
| 狀態管理 | draft → pending_review → published / rejected / archived |
| 編輯上架單 | 修改 metadata、新增/移除檔案 |
| 下架/重新上架 | published ↔ archived |

### 4.5 其他管理頁面（已有 HTML 設計）

| 頁面 | 功能 | 對應 HTML |
|:---|:---|:---|
| 儀表盤 | 統計卡片 + 近期動態 + 趨勢 | `dashboard.html` |
| 主題策展 | 主題 CRUD + 收錄海報管理 | `exhibitions.html` |
| 展覽結構 | 展覽 → 展區 → 子區層級管理 | `exhibition-structure.html` |
| 權威表 | 主題/地點字典維護 | `vocabulary.html` |
| 使用者管理 | 帳號/角色/權限 | `users.html` |
| 統計報表 | 上傳/下載/申請趨勢 + 匯出 | `statistics.html` |
| 通知設定 | 登入聲明 + 系統公告 | `notification-settings.html` |
| 徵詢對象 | 審核流程人員配置 | `consult-settings.html` |
| 轉呈人員 | 轉呈流程人員配置 | `transfer-settings.html` |

---

## 5. CoPaw Agent 設計

### 5.1 Skills 定義

> **設計原則：** 完全模仿 3in1media CoPaw 架構，每個 Skill 對應一個獨立的處理步驟，由 CoPaw TaskManager 按序調度。

#### ThumbnailSkill（縮圖生成）— 對應 3in1media `poster_thumbnail/skill.py`

```python
class ThumbnailSkill:
    """從 Supabase Storage 下載原檔，生成多尺寸縮圖（WebP）"""

    SIZES = {
        's': 200,   # 列表縮圖
        'm': 600,   # 卡片預覽
        'l': 1200,  # 詳情頁大圖
    }
    QUALITY = 85  # WebP 壓縮品質

    async def process(self, poster_id: str, file_id: str, file_path: str) -> dict:
        # 1. 從 Storage signed URL 下載原檔
        # 2. 依據檔案類型處理：
        #    - PNG/JPG/WEBP/TIFF: Pillow 直接開啟
        #    - PSD: psd_tools.PSDImage → composite() 合成所有圖層
        #    - PDF/AI: PyMuPDF (fitz) → 渲染首頁 (2x scale)
        #    - CMYK/P/LA/PA → 轉換為 RGBA
        # 3. 生成 S/M/L 三種尺寸 WebP
        # 4. 上傳至 Storage: poster-thumbnails/{poster_id}/{file_id}_{s|m|l}.webp
        # 5. 回傳 { 's': path, 'm': path, 'l': path }
```

#### MetadataSkill（EXIF/技術 metadata 提取）— 對應 3in1media `poster_metadata/skill.py`

```python
class MetadataSkill:
    """提取檔案技術 metadata：EXIF、尺寸、色彩模式、DPI、圖層等"""

    async def process(self, poster_id: str, file_id: str, file_path: str) -> dict:
        file_type = self._classify_file(file_path)
        metadata = {}

        if file_type == 'image':
            # Pillow: getexif() → EXIF tags (拍攝日期/相機/GPS)
            # + width, height, format, color_mode, dpi
            img = Image.open(file_path)
            exif = img.getexif()
            metadata = {tag_name: val for tag_id, val in exif.items()
                       if (tag_name := ExifTags.TAGS.get(tag_id))
                       and isinstance(val, (str, int, float))}
            metadata.update({'width': img.width, 'height': img.height,
                           'format': img.format, 'color_mode': img.mode,
                           'dpi': img.info.get('dpi')})

        elif file_type == 'psd':
            # psd_tools: width, height, color_mode, layer_count
            psd = PSDImage.open(file_path)
            metadata = {'width': psd.width, 'height': psd.height,
                       'color_mode': psd.color_mode.name,
                       'layer_count': len(list(psd.descendants()))}

        elif file_type in ('pdf', 'ai'):
            # PyMuPDF: page_count, page_dimensions, doc_metadata
            doc = fitz.open(file_path)
            page = doc[0]
            metadata = {'page_count': len(doc),
                       'width': page.rect.width, 'height': page.rect.height,
                       **doc.metadata}

        # 寫入 poster_files.metadata (JSONB)
        await self.supabase.update_file_metadata(file_id, metadata=metadata)
        return metadata

    def _classify_file(self, path: str) -> str:
        """檔型分類"""
        ext = Path(path).suffix.lower()
        IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.tiff', '.tif'}
        PSD_EXTS = {'.psd', '.psb'}
        PDF_EXTS = {'.pdf'}
        AI_EXTS = {'.ai'}
        if ext in IMAGE_EXTS: return 'image'
        if ext in PSD_EXTS: return 'psd'
        if ext in PDF_EXTS: return 'pdf'
        if ext in AI_EXTS: return 'ai'
        return 'unknown'
```

#### PosterAnalysisSkill（AI 圖說 + OCR + 分類）— 對應 3in1media `poster_analysis/skill.py`

```python
class PosterAnalysisSkill:
    """透過 WebGPU VLM 進行海報 OCR、圖說生成、主題分類"""

    ANALYSIS_PROMPT = """
    分析這張海報圖片，以 JSON 格式回傳：
    {
        "ocr_text": "海報上所有可見文字（含標題、副標、日期、地點等）",
        "themes": ["從以下選擇 1-3 個：環保, 慈善, 醫療, 教育, 人文, 國際賑災, 社區志工, 骨髓捐贈, 書軒, 大愛電視"],
        "description": "50-100 字描述，供前端展示用",
        "language": "主要語言（繁體中文/英文/日文等）",
        "has_logo": true/false,
        "has_person": true/false
    }
    """

    async def analyze(self, poster_id: str, file_id: str, file_path: str) -> dict:
        # 1. 取得 Supabase Storage signed URL
        url = await self.supabase.get_signed_url(file_path)
        # 2. 建構 inference_request（含圖片 URL + 結構化 prompt）
        request = {
            'type': 'inference_request',
            'request_id': f'poster-{file_id}',
            'model': 'vlm',
            'messages': [{'role': 'user', 'content': [
                {'type': 'image_url', 'image_url': url},
                {'type': 'text', 'text': self.ANALYSIS_PROMPT}
            ]}]
        }
        # 3. 透過 BrowserChannel 派發給已連線的瀏覽器 AI Worker
        result = await self.browser_channel.send_and_wait(request, timeout=60)
        # 4. 解析 VLM 回傳的 JSON
        analysis = json.loads(result['content'])
        # 5. 寫入 poster_files.ai_analysis (JSONB)
        await self.supabase.update_file_metadata(file_id, ai_analysis=analysis)
        return analysis
```

#### ImmichSyncSkill（Immich 同步）— 對應 3in1media `poster_immich/skill.py`

```python
class ImmichSyncSkill:
    """將海報檔案同步至 Immich，建立 asset + album 歸類"""

    async def process(self, poster_id: str, file_id: str,
                     file_path: str, themes: list[str]) -> dict:
        # 1. 從 Supabase Storage 下載原檔
        # 2. POST {POSTER_IMMICH_URL}/api/assets (multipart)
        #    - deviceAssetId: poster-{file_id}
        #    - deviceId: copaw-poster-agent
        #    - x-api-key: {POSTER_IMMICH_API_KEY}
        # 3. 取得 asset_id
        # 4. 依主題找到或建立 Immich Album
        # 5. 將 asset 加入 Album
        # 6. 寫入 poster_files: immich_asset_id, immich_sync_status='synced'
        # 7. 回傳 { immich_asset_id, album_id }
```

#### StatusUpdateSkill（狀態更新）

```python
class StatusUpdateSkill:
    """更新 Supabase DB 中的處理狀態，檢查完成度"""

    async def process(self, poster_id: str, file_id: str, results: dict) -> None:
        # 1. 更新 poster_files 狀態 → processing_status = 'completed'
        # 2. 檢查該 poster 所有檔案是否處理完成
        # 3. 若全部完成 → posters.status = 'pending_review'
        # 4. AppNotifySkill → 通知建檔者「處理完成，請確認 metadata」
        # 5. 建檔者確認後 → 通知審核者有新的待審項目
```

#### AppNotifySkill（App 內通知）

```python
class AppNotifySkill:
    """透過 CoPaw tunnel 推送通知至 Tauri App"""

    async def notify(self, user_id: str, title: str, body: str, action_url: str = '') -> bool:
        # 1. 透過 BrowserChannel 找到該 user 的 WebSocket 連線
        # 2. 發送 { type: 'notification', title, body, action_url }
        # 3. Tauri Rust 端收到 → 呼叫 OS Notification API
        # 4. 使用者點擊通知 → App 導航至 action_url
```

#### GmailSkill（Gmail 發信 — 僅審核結果）

```python
class GmailSkill:
    """使用審核者的 Google OAuth token 透過 Gmail API 發送審核結果通知"""

    async def send_review_email(
        self, reviewer_oauth_token: str, to_email: str,
        application_number: str, action: str, comment: str
    ) -> bool:
        # 1. 使用審核者的 OAuth access_token 呼叫 Gmail API
        # 2. 組建 HTML Email（慈濟模板 + 審核結果 + 下載連結）
        # 3. 發送
        # 4. 記錄至 DB（audit trail）
```

### 5.2 處理管線（Pipeline 順序）

```
CoPaw TaskManager claim_task
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2a: ThumbnailSkill       → 生成 S/M/L 縮圖               │
│ Step 2b: MetadataSkill        → 提取 EXIF/技術 metadata        │  ← 可並行
│ Step 2c: PosterAnalysisSkill  → AI OCR + 圖說 + 主題分類       │
└─────────────────────────────────────────────────────────────────┘
    ↓
Step 3: 建檔者確認 metadata + 專案歸類
    ↓
Step 4: 審核（OK/NO）
    ↓
Step 5a: ImmichSyncSkill  → 同步至 Immich
Step 5c: StatusUpdateSkill → 更新狀態 → published
```

> **注意：** Step 2a/2b/2c 可以並行執行（3in1media 中是按序，但海報系統可優化為並行）。
> Step 5 的 Immich 同步在審核通過後才執行，避免未審核的內容進入 Immich。

### 5.3 任務狀態機

```
uploaded → processing → metadata_ready → pending_review → approved → syncing → published
              ↓              ↓                 ↓                        ↓
           failed      建檔者修改中         rejected                 sync_failed
                                               ↓
                                           archived
```

### 5.4 3in1media 模組對照表

| 3in1media 模組 | 海報系統對應 | 修改程度 |
|:---|:---|:---|
| `server.py` | CoPaw 主伺服器 | 改路由，移除 VLM/STT 直接處理 |
| `browser_channel.py` | WebSocket（連 Tauri Rust 端） | 直接複用 |
| `task_manager.py` | 任務佇列 | 直接複用 |
| `poster_metadata/skill.py` | MetadataSkill（EXIF 提取） | **直接複用**（已存在） |
| `poster_analysis/skill.py` | PosterAnalysisSkill（AI OCR + 圖說） | **直接複用**（已存在） |
| `poster_thumbnail/skill.py` | ThumbnailSkill（縮圖生成） | **直接複用**（已存在） |
| `poster_immich/skill.py` | ImmichSyncSkill（Immich 同步） | **直接複用**（已存在） |
| `sbegather_client.py` | → poster_supabase.py | 改連海報 Supabase |
| （新增） | AppNotifySkill | CoPaw tunnel → App 內通知 |
| （新增） | GmailSkill | Gmail API（僅審核結果 Email） |

---

## 6. 安全需求

### 6.1 認證與授權

| 項目 | 方案 |
|:---|:---|
| 登入方式 | Google OAuth 2.0（慈濟 Google Workspace 帳號） |
| OAuth Scope | `openid profile email` + `https://www.googleapis.com/auth/gmail.send` |
| Token 儲存 | Tauri Rust 端 → **OS Keychain**（macOS Keychain / Windows Credential Manager） |
| 角色控制 | RBAC：建檔者/審核者/承辦者/管理員 |
| RLS 政策 | 建檔者只能管理自己的上架單；審核者只能看到待審核項目 |

### 6.2 檔案安全

| 風險 | 緩解策略 |
|:---|:---|
| 上傳惡意檔案 | Rust 端檢查副檔名 + MIME type + CoPaw Skill 二次驗證 |
| 路徑穿越 | Storage 路徑由 Rust 端生成，不接受使用者輸入路徑 |
| 未授權下載 | Storage RLS + signed URL（前台下載用） |
| Immich API Key 洩漏 | Key 只存在 CoPaw 後端，App 和前端都不接觸 |
| OAuth token 洩漏 | 儲存在 OS Keychain，非明文 |

---

## 7. 開發階段

### Phase 1：Tauri 骨架 + 上傳功能（3-4 週）

- [ ] Tauri 2.x + React 19 + Vite 7 專案初始化
- [ ] 從 poster-frontend 複製共用型別定義 + shadcn/ui 元件
- [ ] Tauri Rust 端基礎建設
  - [ ] Google OAuth 登入（OS 預設瀏覽器 callback）
  - [ ] OS Keychain token 儲存
  - [ ] CoPaw tunnel WebSocket 連線管理
  - [ ] OS 原生通知
- [ ] 登入頁面（login.html → React）
- [ ] 導航框架（common.js → React Layout）
- [ ] 海報上傳頁面（posters.html → React）
  - [ ] 多步驟表單（基本資訊 → 檔案上傳 → 主題關聯）
  - [ ] Rust 大檔上傳（分片 + 斷點續傳 + 進度 IPC event）
  - [ ] OS 原生拖拽
- [ ] CoPaw 海報處理 Agent 搭建
  - [ ] ThumbnailSkill / ImmichSyncSkill / StatusUpdateSkill
  - [ ] AppNotifySkill（tunnel → OS 通知）
- [ ] 確認 Supabase 環境 + Storage FILE_SIZE_LIMIT
- [ ] **POC：Tauri + 大檔上傳 + CoPaw tunnel 端到端驗證**

### Phase 2：審核功能 + Gmail 通知（3-4 週）

- [ ] 申請單列表頁面（applications.html → React）
- [ ] 申請單審核 Modal（詳情 + 海報預覽 + 審核操作）
- [ ] 審核 RPC 開發（review_application / close_application）
- [ ] 審核歷程時間軸
- [ ] 轉呈/徵詢流程
- [ ] GmailSkill（Gmail API + OAuth token，僅審核結果 Email）
- [ ] 儀表盤（dashboard.html → React）

### Phase 3：管理功能（2-3 週）

- [ ] 主題策展管理（exhibitions.html → React）
- [ ] 展覽結構管理（exhibition-structure.html → React）
- [ ] 權威表維護（vocabulary.html → React）
- [ ] 使用者管理（users.html → React）
- [ ] 統計報表（statistics.html → React）

### Phase 4：設定 + 打包 + 整合測試（2-3 週）

- [ ] 通知設定 / 徵詢 / 轉呈人員設定
- [ ] Tauri App 打包（Mac .dmg + Windows .msi）
- [ ] Tauri Updater 自動更新配置
- [ ] 前台下載功能串接（poster-frontend PRD 2.10）
- [ ] 前後台整合測試
- [ ] CoPaw ↔ Supabase ↔ Immich 端到端測試

**預估總工期：10-14 週**

---

## 8. 待確認事項

| # | 項目 | 詢問對象 | 狀態 |
|:---|:---|:---|:---|
| 1 | Supabase 是自建還是 Cloud？方案等級？ | 後端 | ⏳ 待回覆（遷移中） |
| 2 | Storage FILE_SIZE_LIMIT 設定值 | 後端 | ⏳ 待回覆 |
| 3 | Storage bucket name + 路徑格式規範 | 後端 | ⏳ 待回覆 |
| 4 | Supabase 遷移時程 + 新環境連線資訊 | 後端 | ⏳ 待回覆 |
| 5 | Immich API endpoint + API Key | 主管 | ⏳ 待提供 |
| 6 | CoPaw 部署機器（獨立於 3in1media） | 主管 | ⏳ 待確認 |
| 7 | Google OAuth scope 是否已包含 `gmail.send`？ | 後端 | ⏳ 待確認 |
| 8 | Google Cloud Console 專案 OAuth 2.0 Client ID | 後端/主管 | ⏳ 待確認 |
| 9 | App 簽章憑證（Mac Developer ID + Windows Code Signing） | 主管/IT | ⏳ 待確認 |
| 10 | App 更新伺服器（Tauri Updater endpoint）部署位置 | IT | ⏳ 待確認 |
| 11 | PSD/AI 轉圖需求：用 Python Pillow 還是需要更專業工具？ | 評估中 | — |
| 12 | Email 通知模板需要設計嗎？慈濟有統一 Email 範本？ | 主管 | ⏳ 待確認 |

---

## 9. 風險與緩解

| 風險 | 嚴重度 | 緩解策略 |
|:---|:---|:---|
| Supabase 遷移期間 Storage 不可用 | 高 | 等遷移完成再開始上傳功能開發 |
| Tauri 2.x 學習曲線（Rust） | 中 | Phase 1 先做 POC 驗證核心功能 |
| 200MB+ 檔案上傳在辦公室網路慢/斷線 | 中 | Rust 原生分片 + 斷點續傳 + 離線暫存佇列 |
| PSD/AI 縮圖品質不佳 | 中 | POC 驗證 Pillow + psd-tools 效果 |
| Immich API 不穩定 | 低 | CoPaw 重試機制 + 失敗任務佇列 |
| Mac/Windows 跨平台差異 | 中 | Tauri 已抽象化，但需兩平台測試 |
| App 簽章/公證（Mac Notarization） | 中 | 需 Apple Developer 帳號，提前申請 |
| Gmail OAuth token 過期 | 中 | refresh_token 自動更新；失敗時降級為系統通知 |
| 前後台型別不同步 | 中 | 共用 types/index.ts，版本控制 |

---

## 10. 成功指標

| 指標 | 目標值 | 測量方式 |
|:---|:---|:---|
| 海報上傳成功率（200MB 以下） | ≥ 99% | 上傳完成數 / 上傳嘗試數 |
| 縮圖自動生成成功率 | ≥ 95% | CoPaw 處理完成 / 總上傳數 |
| Immich 同步成功率 | ≥ 95% | 同步完成 / 總上傳數 |
| 上傳 → 縮圖完成延遲 | < 2 分鐘（單檔 200MB） | CoPaw 任務計時 |
| App 內通知延遲 | < 3 秒 | CoPaw tunnel → OS 通知計時 |
| Gmail 發信成功率 | ≥ 98% | Gmail API 200 回應 / 總發送數 |
| App 啟動時間 | < 3 秒 | 冷啟動計時 |
| App 安裝包大小 | < 15MB | 打包後測量 |

---

## 11. 現有 UI 設計資產

所有後台頁面已有完整的 HTML 模擬設計，位於：

`C:\Users\lianz\Downloads\網頁模擬-後台\網頁模擬-後台\`

| HTML | 功能 | 轉換優先級 |
|:---|:---|:---|
| `login.html` | 登入（玻璃擬態風格） | P0 |
| `dashboard.html` | 儀表盤（統計 + 動態 + 趨勢圖） | P1 |
| `posters.html` | 海報管理（多步驟上傳 + 狀態管理） | P0 |
| `applications.html` | 申請單審核（表格 + 詳情 Modal） | P0 |
| `exhibitions.html` | 主題策展管理 | P2 |
| `exhibition-structure.html` | 展覽結構（樹狀層級） | P2 |
| `vocabulary.html` | 權威表維護 | P2 |
| `users.html` | 使用者管理（RBAC 四角色） | P1 |
| `statistics.html` | 統計報表 + 匯出 | P2 |
| `notification-settings.html` | 通知設定 | P3 |
| `consult-settings.html` | 徵詢對象 | P3 |
| `transfer-settings.html` | 轉呈人員 | P3 |

設計框架：Tailwind CSS v3 + Vanilla JS → 轉換為 Tauri App 內 React + Tailwind CSS v4 + shadcn/ui

---

## 變更記錄

| 版本 | 日期 | 變更內容 |
|:---|:---|:---|
| v1.0 | 2026-03-17 | 初版 — 純 React Web App + CoPaw 架構 |
| v1.1 | 2026-03-17 | 新增通知推送：PWA Web Push + Gmail API |
| v2.0 | 2026-03-17 | **重大變更** — 改為 Tauri 桌面 App（Mac + Windows）；通知改為 CoPaw tunnel App 內推送 + OS 原生通知；Gmail 僅用於審核結果 Email；新增 Tauri Rust 後端架構；新增 App 打包/簽章/自動更新需求 |
| v2.1 | 2026-04-12 | **補充建檔工作流程** — 新增完整 5 步驟建檔流程（模仿 3in1media）；新增 MetadataSkill（EXIF 提取）、PosterAnalysisSkill（AI OCR + 圖說 + 主題分類）；更新 ThumbnailSkill 為 S/M/L 三尺寸 WebP；新增處理管線並行設計；新增任務時序圖；更新任務狀態機（新增 metadata_ready、syncing 狀態）；更新 3in1media 模組對照表（4 個模組可直接複用） |
