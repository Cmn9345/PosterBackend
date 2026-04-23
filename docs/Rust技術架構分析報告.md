# Rust 技術架構分析報告

**版本**: v1.0
**日期**: 2026-01-15
**用途**: 海報系統圖片代理技術決策參考

---

## 目錄

1. [Rust 語言概覽](#1-rust-語言概覽)
2. [效能比較](#2-效能比較)
3. [Web 框架比較](#3-web-框架比較)
4. [部署方案比較](#4-部署方案比較)
5. [企業採用案例](#5-企業採用案例)
6. [學習曲線與團隊考量](#6-學習曲線與團隊考量)
7. [與現有架構整合](#7-與現有架構整合)
8. [圖片代理場景分析](#8-圖片代理場景分析)
9. [建議方案](#9-建議方案)
10. [決策矩陣](#10-決策矩陣)

---

## 1. Rust 語言概覽

### 1.1 核心特性

| 特性 | 說明 |
|------|------|
| **記憶體安全** | 編譯時檢查，無 GC、無資料競爭 |
| **零成本抽象** | 高階語法編譯成最佳化機器碼 |
| **所有權系統** | Ownership + Borrowing + Lifetimes |
| **並發安全** | 編譯時防止資料競爭 |
| **無 GC** | 無垃圾回收暫停，延遲可預測 |

### 1.2 2025 年生態成熟度

| 領域 | 成熟度 | 說明 |
|------|--------|------|
| Web 框架 | ████████████ 成熟 | Actix, Axum, Rocket |
| 資料庫整合 | ████████████ 成熟 | SQLx, Diesel |
| 非同步執行時 | ████████████ 成熟 | Tokio |
| WASM 支援 | ███████████░ 成熟 | wasm-bindgen |
| 圖片處理 | ██████████░░ 良好 | image crate |
| 安全關鍵系統 | ██████░░░░░░ 發展中 | 認證標準制定中 |
| GUI 框架 | ████░░░░░░░░ 早期 | egui, Tauri |

---

## 2. 效能比較

### 2.1 Rust vs Node.js vs Go

| 指標 | Rust | Go | Node.js |
|------|------|-----|---------|
| **RPS (10萬請求)** | ~60,000 | ~40,000 | ~25,000 |
| **記憶體使用** | 最低 | 中等 (比 Rust 多 30-50%) | 中等 |
| **延遲 p99** | 穩定 (無 GC 暫停) | 有 GC 峰值 (2-15ms) | 較高 |
| **CPU 效率** | 最高 | 良好 | 最低 (CPU 密集任務) |
| **冷啟動** | 極快 | 快 | 中等 |

### 2.2 適用場景

| 語言 | 最佳場景 |
|------|----------|
| **Rust** | CPU 密集、低延遲 SLA、記憶體效率、安全關鍵 |
| **Go** | 並發服務、微服務、快速開發 |
| **Node.js** | I/O 密集、即時應用、快速原型 |

### 2.3 圖片代理場景分析

圖片代理是 **I/O 密集型** 任務：

```
請求 → 轉發到 Immich → 回傳圖片
        ↑
     瓶頸在網路，不在 CPU
```

| 語言 | 圖片代理效能 | 說明 |
|------|-------------|------|
| **Rust** | 極好 | 但優勢有限（I/O 瓶頸） |
| **TypeScript** | 好 | 足夠應付，開發快 |
| **差異** | ~10-20% | 不顯著 |

**結論**：純圖片代理場景，Rust 效能優勢不明顯。但如果需要 **圖片處理**（縮圖、壓縮），Rust 優勢顯著。

---

## 3. Web 框架比較

### 3.1 主要框架

| 框架 | 效能排名 | 生態成熟度 | 易用性 | GitHub Stars |
|------|----------|------------|--------|--------------|
| **Actix Web** | #1 (最快) | 最成熟 | 中等 (Actor 模型) | 25k+ |
| **Axum** | 頂級 | 快速成長 | 高 (直覺路由) | 21k+ |
| **Rocket** | 良好 | 穩定成長 | 最高 (初學友好) | 25k+ |

### 3.2 選擇建議

| 需求 | 建議框架 |
|------|----------|
| 最高效能、高並發 | **Actix Web** |
| 現代化、模組化、易維護 | **Axum** |
| 快速原型、簡單 API | **Rocket** |

### 3.3 程式碼比較

**Actix Web**:
```rust
use actix_web::{web, App, HttpServer, HttpResponse};

async fn proxy_image(path: web::Path<String>) -> HttpResponse {
    // 圖片代理邏輯
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new()
            .route("/api/image/{id}", web::get().to(proxy_image))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await
}
```

**Axum**:
```rust
use axum::{Router, routing::get, extract::Path};

async fn proxy_image(Path(id): Path<String>) -> impl IntoResponse {
    // 圖片代理邏輯
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/api/image/:id", get(proxy_image));

    axum::Server::bind(&"0.0.0.0:8080".parse().unwrap())
        .serve(app.into_make_service())
        .await
        .unwrap();
}
```

---

## 4. 部署方案比較

### 4.1 方案總覽

| 方案 | 類型 | 優點 | 缺點 |
|------|------|------|------|
| **Cloudflare Workers + WASM** | Serverless | 全球 CDN、零維護 | WASM 限制、128MB 記憶體 |
| **Docker 獨立服務** | 容器 | 完整控制、無限制 | 需維護伺服器 |
| **AWS Lambda + Rust** | Serverless | AWS 整合 | 冷啟動、成本 |

### 4.2 Cloudflare Workers 限制

| 項目 | 免費方案 | 付費方案 |
|------|----------|----------|
| **記憶體** | 128 MB | 128 MB |
| **CPU 時間** | 10 ms/請求 | 5 分鐘/請求 |
| **Bundle 大小** | 3 MB (壓縮) | 10 MB (壓縮) |
| **請求數** | 10萬/天 | 無限 |
| **子請求** | 50/請求 | 1,000/請求 |

### 4.3 Docker 容器優化

**多階段建構 (Multi-stage Build)**:
```dockerfile
# Build stage
FROM rust:1.80-slim as builder
WORKDIR /app
RUN apt-get update && apt-get install -y musl-tools
COPY . .
RUN cargo build --release --target x86_64-unknown-linux-musl

# Runtime stage (極小映像)
FROM scratch
COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/app /app
ENTRYPOINT ["/app"]
```

| 映像類型 | 大小 |
|----------|------|
| 原始 Rust 映像 | ~1.6 GB |
| 優化後 | ~10-80 MB |

---

## 5. 企業採用案例

### 5.1 主要企業

| 公司 | Rust 用途 | 成果 |
|------|----------|------|
| **Discord** | 訊息同步服務 (Read States) | 延遲峰值消除、CPU/記憶體改善 |
| **Cloudflare** | Pingora 代理伺服器 | CPU -70%、記憶體 -67% |
| **Dropbox** | 檔案同步、壓縮 | CPU -75% |
| **AWS** | Firecracker、Lambda | 微秒級冷啟動 |
| **Google** | Android 系統 (150萬行) | 記憶體漏洞 -1000x |

### 5.2 Discord 案例深入

**問題**：Go 的 GC 每 2 分鐘造成 10-50ms 延遲峰值

**解決**：改用 Rust（無 GC）

**結果**：
- 延遲峰值消除
- CPU、記憶體全面改善
- LRU 快取從 300 萬擴充到 800 萬
- PagerDuty 警報減少 60%

### 5.3 Cloudflare Pingora 案例

Pingora (Rust 代理伺服器，取代 NGINX)：

| 指標 | 改善 |
|------|------|
| CPU 使用 | -70% |
| 記憶體使用 | -67% |
| 安全事件 | 大幅減少 |
| 年度成本 | 節省數千萬美元 |

---

## 6. 學習曲線與團隊考量

### 6.1 學習曲線

| 階段 | 難度 | 時間 | 內容 |
|------|------|------|------|
| 基礎語法 | 低 | 數天 | 變數、函數、Cargo |
| 所有權系統 | 高 | 2-4 週 | Ownership、Borrowing、Lifetimes |
| 非同步程式 | 中 | 1-2 週 | async/await、Tokio |
| 生產開發 | 中 | 持續 | 錯誤處理、測試、效能調優 |

### 6.2 時間預估

| 背景 | 基本熟練 | 生產力 |
|------|----------|--------|
| C/C++ 開發者 | 2 週 | 1 個月 |
| Go/Java 開發者 | 3-4 週 | 1-2 個月 |
| JS/Python 開發者 | 4-6 週 | 2-3 個月 |

### 6.3 團隊考量

| 考量 | 說明 |
|------|------|
| **優點** | 編譯時錯誤 → 減少生產問題、程式碼品質高 |
| **缺點** | 初期開發速度慢、招聘困難 |
| **適合** | 長期維護的核心服務 |
| **不適合** | 快速原型、一次性專案 |

---

## 7. 與現有架構整合

### 7.1 現有架構

```
┌─────────────────────────────────────────────────────────────┐
│                      現有架構                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  前台: Vite + React + TypeScript                            │
│  後台: Supabase (+ 夥伴的 NestJS，有問題)                    │
│  圖片: Immich (需認證)                                       │
│  部署: Cloudflare Pages                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 整合方案

**方案 A：Cloudflare Workers (TypeScript)**
```
React → Cloudflare Workers (TS) → Immich
         (圖片代理)
```

**方案 B：Cloudflare Workers (Rust/WASM)**
```
React → Cloudflare Workers (Rust) → Immich
         (圖片代理)
```

**方案 C：Docker 獨立服務 (Rust)**
```
React → Rust 服務 (Docker) → Immich
         (同主機內網)
```

### 7.3 Monorepo 整合

如果選擇 Rust，可以建立混合 Monorepo：

```
poster-system/
├── apps/
│   └── frontend/          # React (TypeScript)
├── packages/
│   └── shared-types/      # 共用型別 (TypeScript)
├── crates/
│   └── image-proxy/       # Rust 圖片代理
├── pnpm-workspace.yaml
├── Cargo.toml             # Rust workspace
└── turbo.json             # 建構編排
```

---

## 8. 圖片代理場景分析

### 8.1 功能需求

| 功能 | 必要性 | 說明 |
|------|--------|------|
| API Key 隱藏 | 必要 | 前端不能暴露 |
| 縮圖轉發 | 必要 | `/api/image/{id}` |
| 快取 | 建議 | 減少 Immich 負載 |
| 圖片處理 | 可選 | 縮圖生成、格式轉換 |

### 8.2 純轉發 vs 圖片處理

| 場景 | TypeScript | Rust | 建議 |
|------|------------|------|------|
| **純轉發** | 足夠 | 過度設計 | TypeScript |
| **加快取** | 足夠 | 略優 | 皆可 |
| **圖片處理** | 慢 | 快 10-100x | Rust |
| **大量並發** | 可能瓶頸 | 優勢明顯 | Rust |

### 8.3 圖片處理 Crates

如果需要圖片處理，Rust 生態：

| Crate | 功能 | 狀態 |
|-------|------|------|
| **image** | 基本處理、縮圖、格式轉換 | 成熟 |
| **imageproc** | 進階處理、濾鏡 | 成熟 |
| **rayon** | 平行批次處理 | 成熟 |

```rust
use image::{imageops::FilterType, GenericImageView};
use std::io::Cursor;

fn resize_thumbnail(input: &[u8], width: u32, height: u32) -> Vec<u8> {
    let img = image::load_from_memory(input).unwrap();
    let thumb = img.resize(width, height, FilterType::Lanczos3);
    let mut buf = Vec::new();
    thumb.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Jpeg).unwrap();
    buf
}
```

---

## 9. 建議方案

### 9.1 方案比較

| 方案 | 開發時間 | 效能 | 維護 | 學習 | 適合情境 |
|------|----------|------|------|------|----------|
| **A. Workers (TS)** | 1-2 天 | 好 | 零 | 無 | 快速上線 |
| **B. Workers (Rust)** | 1-2 週 | 好 | 零 | 中 | 想練 Rust |
| **C. Docker (Rust)** | 2-3 週 | 極好 | 需維護 | 高 | 需圖片處理 |

### 9.2 決策樹

```
需要圖片處理（縮圖生成、格式轉換）？
  │
  ├─ 是 → Rust Docker 獨立服務 (方案 C)
  │        • 與 Immich 同主機，內網通訊
  │        • 效能最佳
  │
  └─ 否 → 想學習/練習 Rust？
           │
           ├─ 是 → Cloudflare Workers + Rust (方案 B)
           │        • Serverless，無維護
           │        • WASM 有限制但足夠
           │
           └─ 否 → Cloudflare Workers + TypeScript (方案 A)
                    • 最快上線
                    • 與前台技術棧一致
```

### 9.3 建議

**短期 (快速上線)**：方案 A - Workers + TypeScript
- 1-2 天完成
- 與前台技術棧一致
- 先讓系統可用

**中期 (如果想學 Rust)**：方案 B - Workers + Rust
- 2-3 週
- 學習 Rust 基礎
- WASM 經驗

**長期 (如果需要圖片處理)**：方案 C - Docker Rust 服務
- 完整 Rust 後端經驗
- 可擴展功能（縮圖、浮水印、壓縮）
- 與 Immich 同主機效能最佳

---

## 10. 決策矩陣

請根據你的優先級評分 (1-5)：

| 因素 | 權重 | 方案 A (TS) | 方案 B (Rust Workers) | 方案 C (Rust Docker) |
|------|------|-------------|----------------------|---------------------|
| 開發速度 | ___ | 5 | 2 | 1 |
| 效能 | ___ | 3 | 4 | 5 |
| 學習價值 | ___ | 1 | 4 | 5 |
| 維護成本 | ___ | 5 | 5 | 2 |
| 擴展性 | ___ | 2 | 3 | 5 |
| **總分** | | ___ | ___ | ___ |

---

## 附錄 A：Cloudflare Workers Rust 範例

```rust
// src/lib.rs
use worker::*;

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let url = req.url()?;
    let path = url.path();

    // 解析 /api/image/{assetId}
    if path.starts_with("/api/image/") {
        let asset_id = path.trim_start_matches("/api/image/");
        let immich_url = env.var("IMMICH_URL")?.to_string();
        let api_key = env.secret("IMMICH_API_KEY")?.to_string();

        // 轉發到 Immich
        let target = format!("{}/api/assets/{}/thumbnail", immich_url, asset_id);
        let mut headers = Headers::new();
        headers.set("x-api-key", &api_key)?;

        let mut init = RequestInit::new();
        init.with_headers(headers);

        let immich_req = Request::new_with_init(&target, &init)?;
        let resp = Fetch::Request(immich_req).send().await?;

        // 加快取 header
        let mut final_headers = resp.headers().clone();
        final_headers.set("cache-control", "public, max-age=86400")?;

        return Ok(resp.with_headers(final_headers));
    }

    Response::error("Not Found", 404)
}
```

---

## 附錄 B：Docker Rust 服務範例

```rust
// src/main.rs
use actix_web::{web, App, HttpServer, HttpResponse, http::header};
use reqwest::Client;

struct AppState {
    immich_url: String,
    api_key: String,
    client: Client,
}

async fn proxy_image(
    path: web::Path<String>,
    data: web::Data<AppState>,
) -> HttpResponse {
    let asset_id = path.into_inner();
    let url = format!("{}/api/assets/{}/thumbnail", data.immich_url, asset_id);

    let resp = data.client
        .get(&url)
        .header("x-api-key", &data.api_key)
        .send()
        .await;

    match resp {
        Ok(r) => {
            let bytes = r.bytes().await.unwrap_or_default();
            HttpResponse::Ok()
                .insert_header((header::CACHE_CONTROL, "public, max-age=86400"))
                .insert_header((header::CONTENT_TYPE, "image/jpeg"))
                .body(bytes)
        }
        Err(_) => HttpResponse::InternalServerError().finish()
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let state = web::Data::new(AppState {
        immich_url: std::env::var("IMMICH_URL").unwrap(),
        api_key: std::env::var("IMMICH_API_KEY").unwrap(),
        client: Client::new(),
    });

    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/api/image/{asset_id}", web::get().to(proxy_image))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await
}
```

**Dockerfile**:
```dockerfile
FROM rust:1.80-slim as builder
WORKDIR /app
RUN apt-get update && apt-get install -y musl-tools && rm -rf /var/lib/apt/lists/*
COPY . .
RUN cargo build --release --target x86_64-unknown-linux-musl

FROM scratch
COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/image-proxy /app
EXPOSE 8080
ENTRYPOINT ["/app"]
```

---

## 附錄 C：參考資源

### 學習資源
- [The Rust Programming Language](https://doc.rust-lang.org/book/) - 官方書籍
- [Rust by Example](https://doc.rust-lang.org/rust-by-example/) - 範例學習
- [Cloudflare Workers Rust](https://developers.cloudflare.com/workers/languages/rust/) - Workers 文件

### 框架文件
- [Axum](https://github.com/tokio-rs/axum) - 推薦框架
- [Actix Web](https://actix.rs/) - 最高效能框架

### 圖片處理
- [image crate](https://github.com/image-rs/image) - Rust 圖片處理

### 企業案例
- [Discord: Why Discord is switching from Go to Rust](https://discord.com/blog/why-discord-is-switching-from-go-to-rust)
- [Cloudflare: Building Pingora](https://blog.cloudflare.com/how-we-built-pingora-the-proxy-that-connects-cloudflare-to-the-internet/)
- [Dropbox: Optimizing Storage with Rust](https://dropbox.tech/infrastructure/rewriting-the-heart-of-our-sync-engine)

---

**文檔版本**: v1.0
**最後更新**: 2026-01-15
**作者**: Claude Code
