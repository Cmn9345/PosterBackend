# Immich 架構分析報告

**版本**: v1.0
**日期**: 2026-01-15
**用途**: 海報系統圖片儲存整合參考

---

## 目錄

1. [Immich 概覽](#1-immich-概覽)
2. [微服務架構](#2-微服務架構)
3. [核心服務詳解](#3-核心服務詳解)
4. [資料庫設計](#4-資料庫設計)
5. [API 認證機制](#5-api-認證機制)
6. [圖片存取流程](#6-圖片存取流程)
7. [與海報系統整合](#7-與海報系統整合)
8. [效能與擴展考量](#8-效能與擴展考量)

---

## 1. Immich 概覽

### 1.1 什麼是 Immich

Immich 是一個開源、自建的照片與影片管理解決方案，定位為 Google Photos 的自建替代品。

| 項目 | 說明 |
|------|------|
| **類型** | 自建（Self-hosted）照片管理系統 |
| **授權** | AGPL-3.0 開源 |
| **技術棧** | Node.js + Python + PostgreSQL |
| **GitHub Stars** | 50k+ (2025年) |
| **核心功能** | 自動備份、相簿管理、人臉辨識、語意搜尋 |

### 1.2 主要功能

| 功能 | 說明 |
|------|------|
| **自動備份** | 手機 App 自動上傳照片/影片 |
| **相簿管理** | 建立相簿、分享、協作 |
| **人臉辨識** | 自動偵測人臉、分群、命名 |
| **語意搜尋** | 輸入「海灘日落」搜尋相關圖片 |
| **地圖檢視** | 依 EXIF GPS 資訊顯示拍攝地點 |
| **Live Photo** | 支援 iOS Live Photo |
| **多用戶** | 多帳號、權限管理 |

### 1.3 為何選擇 Immich

對於海報系統，選擇 Immich 的原因：

| 優點 | 說明 |
|------|------|
| **開源免費** | 無授權費用 |
| **功能完整** | 縮圖自動生成、相簿管理、API 完整 |
| **自建可控** | 資料完全掌控，符合內部安全規範 |
| **活躍開發** | 2025 年仍持續更新 |
| **Docker 部署** | 容器化部署，易於維護 |

---

## 2. 微服務架構

### 2.1 架構總覽

```
┌─────────────────────────────────────────────────────────────────┐
│                         Immich 微服務架構                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  Immich Web  │  │  Mobile App  │  │  External API Client │   │
│  │   (React)    │  │  (Flutter)   │  │   (海報系統前台)      │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│         └────────────────┬┴──────────────────────┘               │
│                          │                                       │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Immich Server                           │  │
│  │              (Node.js + TypeScript)                        │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐  │  │
│  │  │ Auth    │ │ Assets  │ │ Albums  │ │ Job Dispatcher  │  │  │
│  │  │ Module  │ │ Module  │ │ Module  │ │     Module      │  │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────────┘  │  │
│  └───────────────────────────┬───────────────────────────────┘  │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐              │
│         ▼                    ▼                    ▼              │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────┐    │
│  │ PostgreSQL  │     │    Redis    │     │ Immich ML       │    │
│  │ + pgvector  │     │   (Queue)   │     │ (Python/FastAPI)│    │
│  └─────────────┘     └─────────────┘     └─────────────────┘    │
│         │                                        │               │
│         │           ┌────────────────────────────┘               │
│         ▼           ▼                                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     File Storage                             ││
│  │              (Local / S3 / Network Storage)                  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 服務清單

| 服務 | 技術 | 用途 | Port |
|------|------|------|------|
| **immich-server** | Node.js + NestJS | API 服務、認證、業務邏輯 | 2283 |
| **immich-machine-learning** | Python + FastAPI | AI 推論（人臉、CLIP、物件偵測） | 3003 |
| **immich-web** | React + SvelteKit | 前端 UI | - |
| **postgres** | PostgreSQL 16 + pgvector | 資料庫、向量搜尋 | 5432 |
| **redis** | Redis 7 | 快取、任務佇列 | 6379 |
| **typesense** | TypeSense (選用) | 全文搜尋增強 | 8108 |

### 2.3 Docker Compose 配置

```yaml
# docker-compose.yml (簡化版)
version: '3.8'

services:
  immich-server:
    image: ghcr.io/immich-app/immich-server:release
    volumes:
      - ${UPLOAD_LOCATION}:/usr/src/app/upload
    environment:
      - DB_URL=postgres://...
      - REDIS_URL=redis://redis:6379
    ports:
      - "2283:2283"
    depends_on:
      - postgres
      - redis

  immich-machine-learning:
    image: ghcr.io/immich-app/immich-machine-learning:release
    volumes:
      - model-cache:/cache
    environment:
      - MACHINE_LEARNING_WORKERS=4

  postgres:
    image: tensorchord/pgvecto-rs:pg16-v0.2.0
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_PASSWORD=...
      - POSTGRES_USER=postgres
      - POSTGRES_DB=immich

  redis:
    image: redis:7-alpine
```

---

## 3. 核心服務詳解

### 3.1 Immich Server

主要的 API 服務，處理所有業務邏輯。

| 模組 | 功能 |
|------|------|
| **Auth** | 使用者認證、API Key 管理、OAuth 整合 |
| **Assets** | 圖片/影片上傳、下載、縮圖、元資料 |
| **Albums** | 相簿 CRUD、分享、協作 |
| **Search** | 搜尋（關鍵字、語意、人臉） |
| **Jobs** | 背景任務調度（縮圖生成、ML 處理） |
| **Libraries** | 外部資料夾掛載（唯讀索引） |

**技術細節**：

```
Node.js 20 LTS
├── NestJS (後端框架)
├── TypeORM (ORM)
├── Bull (任務佇列)
└── Sharp (圖片處理)
```

### 3.2 Immich Machine Learning

專責 AI/ML 推論的 Python 服務。

| 功能 | 模型 | 說明 |
|------|------|------|
| **人臉偵測** | buffalo_l | 偵測圖片中的人臉位置 |
| **人臉辨識** | buffalo_l | 人臉特徵向量，用於分群 |
| **CLIP Embedding** | OpenAI CLIP | 圖片語意向量（768/512 維） |
| **物件偵測** | 可選 | 偵測圖片中的物件 |

**技術細節**：

```
Python 3.11
├── FastAPI (API 框架)
├── TensorFlow / ONNX Runtime
├── OpenCLIP (語意嵌入)
├── InsightFace (人臉辨識)
└── DBScan (人臉分群)
```

**配置選項**：

```bash
# 環境變數
MACHINE_LEARNING_WORKERS=4        # Worker 數量
MACHINE_LEARNING_MODEL_TTL=300    # 模型快取時間
MACHINE_LEARNING_CACHE_FOLDER=/cache
```

### 3.3 PostgreSQL + pgvector

資料庫使用 PostgreSQL，搭配 pgvector 擴展支援向量搜尋。

**儲存內容**：

| 資料表 | 說明 |
|--------|------|
| users | 使用者帳號 |
| assets | 圖片/影片資產 |
| albums | 相簿 |
| album_assets | 相簿與資產關聯 |
| asset_faces | 人臉位置與特徵向量 |
| smart_search | CLIP 語意向量 |
| exif | EXIF 元資料 |

**向量搜尋範例**：

```sql
-- 語意搜尋（使用 pgvector）
SELECT asset_id, embedding <=> $1 AS distance
FROM smart_search
ORDER BY distance
LIMIT 20;
```

### 3.4 Redis

用於快取和任務佇列。

| 用途 | 說明 |
|------|------|
| **Session** | 使用者 Session 快取 |
| **Job Queue** | Bull 任務佇列（縮圖、ML、轉檔） |
| **Rate Limit** | API 限流 |

---

## 4. 資料庫設計

### 4.1 核心資料表

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   users     │────<│   assets    │>────│   albums    │
└─────────────┘     └──────┬──────┘     └─────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ asset_faces │   │ smart_search│   │    exif     │
│ (人臉向量)   │   │ (CLIP向量)  │   │ (元資料)    │
└─────────────┘   └─────────────┘   └─────────────┘
```

### 4.2 Assets 表結構（簡化）

```sql
CREATE TABLE assets (
    id UUID PRIMARY KEY,
    device_asset_id VARCHAR(255),
    owner_id UUID REFERENCES users(id),

    -- 檔案資訊
    type VARCHAR(50),           -- 'IMAGE' | 'VIDEO'
    original_path TEXT,         -- 原始檔路徑
    preview_path TEXT,          -- 預覽圖路徑
    thumbnail_path TEXT,        -- 縮圖路徑
    checksum BYTEA,

    -- 時間戳
    file_created_at TIMESTAMP,
    local_date_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP,

    -- 狀態
    is_visible BOOLEAN DEFAULT TRUE,
    is_archived BOOLEAN DEFAULT FALSE,
    is_favorite BOOLEAN DEFAULT FALSE,

    -- 關聯
    library_id UUID,
    stack_id UUID
);
```

### 4.3 向量索引

```sql
-- CLIP 語意向量 (768 維)
CREATE TABLE smart_search (
    asset_id UUID PRIMARY KEY REFERENCES assets(id),
    embedding vector(768)
);

-- 建立 HNSW 索引（高效近似搜尋）
CREATE INDEX ON smart_search
USING hnsw (embedding vector_cosine_ops);

-- 人臉特徵向量 (512 維)
CREATE TABLE asset_faces (
    id UUID PRIMARY KEY,
    asset_id UUID REFERENCES assets(id),
    person_id UUID,
    embedding vector(512),
    image_width INT,
    image_height INT,
    bounding_box_x1 INT,
    bounding_box_y1 INT,
    bounding_box_x2 INT,
    bounding_box_y2 INT
);
```

---

## 5. API 認證機制

### 5.1 認證方式

Immich 支援多種認證方式：

| 方式 | 用途 | 說明 |
|------|------|------|
| **Session Cookie** | Web UI | 登入後瀏覽器 Cookie |
| **API Key** | 外部整合 | 長期有效的 API Key |
| **OAuth** | SSO | 支援 Google、GitHub 等 |
| **Bearer Token** | API 呼叫 | 短期 JWT Token |

### 5.2 API Key 認證（推薦用於海報系統）

```bash
# 使用 x-api-key header
curl -H "x-api-key: YOUR_API_KEY" \
     https://immich.example.com/api/assets
```

**API Key 特性**：

| 特性 | 說明 |
|------|------|
| **永不過期** | 除非手動刪除 |
| **權限繼承** | 繼承建立者的權限 |
| **可多個** | 一個使用者可建立多個 Key |
| **可命名** | 方便識別用途 |

### 5.3 建立 API Key

1. 登入 Immich Web UI
2. 進入 **Account Settings** → **API Keys**
3. 點擊 **New API Key**
4. 命名（如：`poster-system-readonly`）
5. 複製並保存 API Key

### 5.4 安全考量

| 風險 | 對策 |
|------|------|
| **API Key 外洩** | 使用 Image Proxy 隱藏 Key |
| **跨域存取** | 設定 CORS 白名單 |
| **權限過大** | 建立專用帳號，限制存取範圍 |

---

## 6. 圖片存取流程

### 6.1 縮圖類型

Immich 自動生成多種縮圖：

| 類型 | 尺寸 | 用途 | API 端點 |
|------|------|------|----------|
| **thumbnail** | 250x250 | 列表縮圖 | `/api/assets/{id}/thumbnail` |
| **preview** | 1440px | 預覽圖 | `/api/assets/{id}/thumbnail?size=preview` |
| **original** | 原尺寸 | 下載原檔 | `/api/assets/{id}/original` |

### 6.2 API 端點

**取得縮圖**：

```bash
# 小縮圖 (250x250)
GET /api/assets/{assetId}/thumbnail
Header: x-api-key: YOUR_API_KEY

# 預覽圖 (1440px)
GET /api/assets/{assetId}/thumbnail?size=preview
Header: x-api-key: YOUR_API_KEY

# 原始檔案
GET /api/assets/{assetId}/original
Header: x-api-key: YOUR_API_KEY
```

**回應**：

```
Content-Type: image/jpeg (或 image/webp)
Content-Length: ...
Cache-Control: private, max-age=86400
```

### 6.3 相簿 API

**取得相簿列表**：

```bash
GET /api/albums
Header: x-api-key: YOUR_API_KEY

# Response
[
  {
    "id": "album-uuid",
    "albumName": "海報主題策展",
    "assetCount": 42,
    "albumThumbnailAssetId": "asset-uuid",
    "createdAt": "2026-01-15T10:00:00.000Z"
  }
]
```

**取得相簿內容**：

```bash
GET /api/albums/{albumId}
Header: x-api-key: YOUR_API_KEY

# Response
{
  "id": "album-uuid",
  "albumName": "海報主題策展",
  "assets": [
    {
      "id": "asset-uuid",
      "type": "IMAGE",
      "originalFileName": "poster-001.jpg",
      "exifInfo": { ... }
    }
  ]
}
```

### 6.4 搜尋 API

**語意搜尋**（需 ML 服務啟用）：

```bash
POST /api/search/smart
Header: x-api-key: YOUR_API_KEY
Content-Type: application/json

{
  "query": "環保海報"
}

# Response
{
  "assets": {
    "items": [
      { "id": "asset-uuid", "score": 0.89 }
    ]
  }
}
```

---

## 7. 與海報系統整合

### 7.1 整合架構

```
┌─────────────────────────────────────────────────────────────┐
│                       海報系統整合架構                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐                      ┌──────────────────┐ │
│  │  海報前台     │                      │    Immich        │ │
│  │  (React)     │                      │   (圖片儲存)      │ │
│  └──────┬───────┘                      └────────▲─────────┘ │
│         │                                       │            │
│         │ /api/image/{assetId}                  │            │
│         ▼                                       │            │
│  ┌──────────────────────────────────────────────┴─────────┐ │
│  │                   Image Proxy                           │ │
│  │            (Cloudflare Workers + TypeScript)            │ │
│  │                                                         │ │
│  │  • 隱藏 Immich API Key                                  │ │
│  │  • 加入快取 Header                                      │ │
│  │  • 轉發請求到 Immich                                    │ │
│  └─────────────────────────────────────────────────────────┘ │
│                              │                               │
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                      Supabase                            │ │
│  │                 (海報後設資料、申請單)                    │ │
│  │                                                          │ │
│  │  posters.immich_asset_id → 關聯 Immich Asset             │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 資料關聯

**Supabase 海報表與 Immich 關聯**：

```sql
-- Supabase: poster_files 表
CREATE TABLE poster_files (
    id UUID PRIMARY KEY,
    poster_id UUID REFERENCES posters(id),
    immich_asset_id UUID,        -- 關聯 Immich Asset ID
    original_filename TEXT,
    file_type TEXT,
    file_size BIGINT,
    -- ...
);
```

### 7.3 前端圖片載入

```tsx
// React 元件
const PosterImage: React.FC<{ assetId: string }> = ({ assetId }) => {
  // 透過 Image Proxy 載入，不暴露 Immich API Key
  const imageUrl = `/api/image/${assetId}`;

  return (
    <img
      src={imageUrl}
      loading="lazy"
      alt="海報縮圖"
    />
  );
};
```

### 7.4 Image Proxy 實作（方案 A）

```typescript
// Cloudflare Workers (TypeScript)
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // 解析 /api/image/{assetId}
    const match = path.match(/^\/api\/image\/([a-f0-9-]+)$/);
    if (!match) {
      return new Response('Not Found', { status: 404 });
    }

    const assetId = match[1];
    const size = url.searchParams.get('size') || 'thumbnail';

    // 轉發到 Immich
    const immichUrl = `${env.IMMICH_URL}/api/assets/${assetId}/thumbnail?size=${size}`;

    const response = await fetch(immichUrl, {
      headers: {
        'x-api-key': env.IMMICH_API_KEY,
      },
    });

    // 加入快取 Header
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.delete('x-api-key');

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  },
};
```

### 7.5 主題策展整合

使用 Immich Album 作為主題策展來源：

| Immich | 海報系統 |
|--------|----------|
| Album | 主題策展 |
| Album Name | 主題名稱 |
| Album Description | 主題描述 |
| Album Assets | 該主題下的海報 |
| Album Thumbnail | 主題封面圖 |

**同步策略**：

1. **Supabase 為主**：主題資料存在 Supabase，Immich Album 僅作為圖片容器
2. **Immich Album ID 關聯**：`themes.immich_album_id` 欄位關聯 Immich Album

---

## 8. 效能與擴展考量

### 8.1 效能數據

根據社群回報（2025年）：

| 指標 | 數據 |
|------|------|
| 縮圖載入 | < 100ms（本地網路） |
| 語意搜尋 | < 500ms（10萬張圖） |
| 人臉辨識 | ~2-5 秒/張（GPU） |
| 縮圖生成 | ~1 秒/張（GPU） |

### 8.2 資源需求

| 規模 | CPU | RAM | Storage | GPU |
|------|-----|-----|---------|-----|
| 小型 (< 1萬張) | 2 核 | 4 GB | 依圖片量 | 選用 |
| 中型 (1-10萬張) | 4 核 | 8 GB | 依圖片量 | 建議 |
| 大型 (> 10萬張) | 8+ 核 | 16+ GB | 依圖片量 | 必要 |

### 8.3 擴展選項

| 需求 | 解決方案 |
|------|----------|
| 更快縮圖載入 | Cloudflare CDN 快取 |
| 更多並發 | Immich 水平擴展（多 Server 實例） |
| 更大儲存 | S3 相容儲存（MinIO、Cloudflare R2） |
| 更快 ML | GPU 加速（NVIDIA CUDA） |

### 8.4 海報系統規模預估

| 預估 | 數量 |
|------|------|
| 海報總數 | ~3,000 張 |
| 檔案總數 | ~10,000 檔案（含多尺寸） |
| 儲存空間 | ~100 GB（預估） |
| 日訪問量 | ~1,000 次 |

**結論**：小型規模，現有 Immich 配置足夠。

---

## 附錄 A：常用 API 端點

| 端點 | 方法 | 說明 |
|------|------|------|
| `/api/assets` | GET | 取得資產列表 |
| `/api/assets/{id}` | GET | 取得資產詳情 |
| `/api/assets/{id}/thumbnail` | GET | 取得縮圖 |
| `/api/assets/{id}/original` | GET | 下載原檔 |
| `/api/albums` | GET | 取得相簿列表 |
| `/api/albums/{id}` | GET | 取得相簿詳情 |
| `/api/search/smart` | POST | 語意搜尋 |
| `/api/search/metadata` | POST | 元資料搜尋 |
| `/api/server-info/ping` | GET | 健康檢查 |

## 附錄 B：環境變數參考

```bash
# Immich Server
DB_URL=postgres://user:pass@postgres:5432/immich
REDIS_URL=redis://redis:6379
IMMICH_MACHINE_LEARNING_URL=http://immich-machine-learning:3003

# Immich ML
MACHINE_LEARNING_WORKERS=4
MACHINE_LEARNING_MODEL_TTL=300

# 儲存
UPLOAD_LOCATION=/path/to/photos
THUMBS_LOCATION=/path/to/thumbs

# 外部存取
IMMICH_API_URL=https://immich.example.com
```

## 附錄 C：參考資源

- [Immich 官方文件](https://immich.app/docs)
- [Immich GitHub](https://github.com/immich-app/immich)
- [Immich API 文件](https://immich.app/docs/api/)
- [pgvector 文件](https://github.com/pgvector/pgvector)

---

**文檔版本**: v1.0
**最後更新**: 2026-01-15
**作者**: Claude Code
