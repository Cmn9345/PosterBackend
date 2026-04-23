# Chunked Upload (分片上傳) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement TUS-protocol chunked upload from Tauri Rust backend to Supabase Storage, with SQLite resume records, queue management, and real-time progress to React frontend via IPC events.

**Architecture:** Rust reads files from disk, splits into 6MB chunks, uploads via TUS to Supabase Storage. Progress is emitted per-chunk as Tauri events. SQLite tracks upload state for cross-session resume. A queue manager prioritizes small files and limits concurrency.

**Tech Stack:** Rust (reqwest + tokio), SQLite (rusqlite), Tauri IPC events, TypeScript React hooks

---

## File Structure

```
src-tauri/src/
├── commands/
│   ├── mod.rs              # Add upload_queue, resume_uploads
│   └── upload.rs           # REWRITE: TUS chunked upload + queue
├── services/
│   ├── mod.rs              # Add tus, upload_db
│   ├── supabase.rs         # Existing (unchanged)
│   ├── tus.rs              # NEW: TUS protocol client
│   └── upload_db.rs        # NEW: SQLite upload state
└── lib.rs                  # Register new commands + manage state

src/
├── hooks/
│   └── useTauriUpload.ts   # NEW: Tauri IPC upload hook
└── routes/posters/
    └── upload.tsx           # MODIFY: Wire real upload logic
```

---

## Chunk 1: TUS Client + SQLite State

### Task 1: Add Rust Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add rusqlite and related deps to Cargo.toml**

After `chrono` line, add:
```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/webit/Desktop/p1/海報資料庫/poster-admin-app/src-tauri && cargo check`
Expected: Compiles successfully

- [ ] **Step 3: Commit**

```bash
cd /Users/webit/Desktop/p1/海報資料庫/poster-admin-app
git add src-tauri/Cargo.toml
git commit -m "feat(upload): add rusqlite dependency for upload state"
```

### Task 2: SQLite Upload State (upload_db.rs)

**Files:**
- Create: `src-tauri/src/services/upload_db.rs`
- Modify: `src-tauri/src/services/mod.rs`

- [ ] **Step 1: Update services/mod.rs**

```rust
// src-tauri/src/services/mod.rs
pub mod supabase;
pub mod tus;
pub mod upload_db;
```

- [ ] **Step 2: Write upload_db.rs**

```rust
// src-tauri/src/services/upload_db.rs
//! SQLite-based upload state persistence.
//! Tracks chunk progress for cross-session resume.

use chrono::{DateTime, Utc};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadRecord {
    pub id: String,
    pub file_path: String,
    pub poster_id: String,
    pub storage_path: String,
    pub total_bytes: u64,
    pub uploaded_bytes: u64,
    pub chunk_size: u64,
    pub tus_url: Option<String>,
    pub status: String, // "pending", "uploading", "paused", "completed", "failed"
    pub created_at: String,
    pub updated_at: String,
}

pub struct UploadDb {
    conn: Mutex<Connection>,
}

impl UploadDb {
    pub fn open(db_path: &Path) -> Result<Self, String> {
        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to open upload DB: {}", e))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS uploads (
                id TEXT PRIMARY KEY,
                file_path TEXT NOT NULL,
                poster_id TEXT NOT NULL,
                storage_path TEXT NOT NULL,
                total_bytes INTEGER NOT NULL,
                uploaded_bytes INTEGER NOT NULL DEFAULT 0,
                chunk_size INTEGER NOT NULL DEFAULT 6291456,
                tus_url TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );"
        ).map_err(|e| format!("Failed to create uploads table: {}", e))?;

        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn insert(&self, record: &UploadRecord) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO uploads
             (id, file_path, poster_id, storage_path, total_bytes, uploaded_bytes,
              chunk_size, tus_url, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                record.id, record.file_path, record.poster_id, record.storage_path,
                record.total_bytes, record.uploaded_bytes, record.chunk_size,
                record.tus_url, record.status, record.created_at, record.updated_at,
            ],
        ).map_err(|e| format!("Insert failed: {}", e))?;
        Ok(())
    }

    pub fn update_progress(&self, id: &str, uploaded_bytes: u64, tus_url: Option<&str>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE uploads SET uploaded_bytes = ?1, tus_url = ?2, status = 'uploading', updated_at = ?3
             WHERE id = ?4",
            params![uploaded_bytes, tus_url, now, id],
        ).map_err(|e| format!("Update progress failed: {}", e))?;
        Ok(())
    }

    pub fn mark_completed(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE uploads SET status = 'completed', updated_at = ?1 WHERE id = ?2",
            params![now, id],
        ).map_err(|e| format!("Mark completed failed: {}", e))?;
        Ok(())
    }

    pub fn mark_failed(&self, id: &str, status: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE uploads SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now, id],
        ).map_err(|e| format!("Mark failed: {}", e))?;
        Ok(())
    }

    pub fn list_resumable(&self) -> Result<Vec<UploadRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, file_path, poster_id, storage_path, total_bytes, uploaded_bytes,
                    chunk_size, tus_url, status, created_at, updated_at
             FROM uploads WHERE status IN ('uploading', 'paused', 'pending')
             ORDER BY total_bytes ASC"
        ).map_err(|e| format!("Prepare failed: {}", e))?;

        let records = stmt.query_map([], |row| {
            Ok(UploadRecord {
                id: row.get(0)?,
                file_path: row.get(1)?,
                poster_id: row.get(2)?,
                storage_path: row.get(3)?,
                total_bytes: row.get(4)?,
                uploaded_bytes: row.get(5)?,
                chunk_size: row.get(6)?,
                tus_url: row.get(7)?,
                status: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        }).map_err(|e| format!("Query failed: {}", e))?;

        records.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Collect failed: {}", e))
    }

    pub fn delete_completed(&self) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM uploads WHERE status = 'completed'", [])
            .map_err(|e| format!("Delete failed: {}", e))
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/webit/Desktop/p1/海報資料庫/poster-admin-app/src-tauri && cargo check`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/services/upload_db.rs src-tauri/src/services/mod.rs
git commit -m "feat(upload): add SQLite upload state persistence"
```

### Task 3: TUS Protocol Client (tus.rs)

**Files:**
- Create: `src-tauri/src/services/tus.rs`

- [ ] **Step 1: Write tus.rs**

```rust
// src-tauri/src/services/tus.rs
//! TUS (resumable upload) protocol client for Supabase Storage.
//! Implements: POST (create) + PATCH (upload chunk) + HEAD (check offset).
//! Reference: https://tus.io/protocols/resumable-upload

use log::{info, warn, error};
use reqwest::Client;
use std::time::Duration;

const CHUNK_SIZE: u64 = 6 * 1024 * 1024; // 6MB
const MAX_RETRIES: u32 = 3;
const RETRY_DELAYS: [u64; 3] = [3, 6, 12]; // exponential backoff

pub struct TusClient {
    client: Client,
    supabase_url: String,
    bucket: String,
    api_key: String,
    auth_token: String,
}

#[derive(Debug)]
pub struct TusUploadResult {
    pub storage_path: String,
    pub tus_url: String,
}

impl TusClient {
    pub fn new(supabase_url: &str, bucket: &str, api_key: &str, auth_token: &str) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("Failed to create HTTP client"),
            supabase_url: supabase_url.to_string(),
            bucket: bucket.to_string(),
            api_key: api_key.to_string(),
            auth_token: auth_token.to_string(),
        }
    }

    /// Create a TUS upload session. Returns the TUS upload URL.
    pub async fn create_upload(
        &self,
        storage_path: &str,
        total_bytes: u64,
        content_type: &str,
    ) -> Result<String, String> {
        let url = format!(
            "{}/storage/v1/upload/resumable",
            self.supabase_url
        );

        let resp = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.auth_token))
            .header("apikey", &self.api_key)
            .header("Tus-Resumable", "1.0.0")
            .header("Upload-Length", total_bytes.to_string())
            .header("Upload-Metadata", format!(
                "bucketName {},objectName {},contentType {}",
                base64_encode(&self.bucket),
                base64_encode(storage_path),
                base64_encode(content_type),
            ))
            .send()
            .await
            .map_err(|e| format!("TUS create failed: {}", e))?;

        if resp.status().is_success() || resp.status().as_u16() == 201 {
            let location = resp
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
                .ok_or("No Location header in TUS response")?;
            info!("[TUS] Created upload: {}", location);
            Ok(location)
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!("TUS create failed ({}): {}", status, body))
        }
    }

    /// Check current offset via HEAD request. Used for resume.
    pub async fn get_offset(&self, tus_url: &str) -> Result<u64, String> {
        let resp = self.client
            .head(tus_url)
            .header("Authorization", format!("Bearer {}", self.auth_token))
            .header("apikey", &self.api_key)
            .header("Tus-Resumable", "1.0.0")
            .send()
            .await
            .map_err(|e| format!("TUS HEAD failed: {}", e))?;

        if resp.status().is_success() {
            let offset = resp
                .headers()
                .get("upload-offset")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            Ok(offset)
        } else {
            Err(format!("TUS HEAD failed: {}", resp.status()))
        }
    }

    /// Upload a single chunk via PATCH. Returns new offset.
    pub async fn upload_chunk(
        &self,
        tus_url: &str,
        data: &[u8],
        offset: u64,
    ) -> Result<u64, String> {
        let mut last_err = String::new();

        for attempt in 0..MAX_RETRIES {
            let result = self.client
                .patch(tus_url)
                .header("Authorization", format!("Bearer {}", self.auth_token))
                .header("apikey", &self.api_key)
                .header("Tus-Resumable", "1.0.0")
                .header("Upload-Offset", offset.to_string())
                .header("Content-Type", "application/offset+octet-stream")
                .body(data.to_vec())
                .send()
                .await;

            match result {
                Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 204 => {
                    let new_offset = resp
                        .headers()
                        .get("upload-offset")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| s.parse::<u64>().ok())
                        .unwrap_or(offset + data.len() as u64);
                    return Ok(new_offset);
                }
                Ok(resp) => {
                    last_err = format!("HTTP {}", resp.status());
                }
                Err(e) => {
                    last_err = e.to_string();
                }
            }

            if attempt < MAX_RETRIES - 1 {
                let delay = RETRY_DELAYS[attempt as usize];
                warn!("[TUS] Chunk retry {}/{} in {}s: {}", attempt + 1, MAX_RETRIES, delay, last_err);
                tokio::time::sleep(Duration::from_secs(delay)).await;
            }
        }

        Err(format!("TUS chunk failed after {} retries: {}", MAX_RETRIES, last_err))
    }

    pub fn chunk_size(&self) -> u64 {
        CHUNK_SIZE
    }
}

fn base64_encode(s: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
}
```

- [ ] **Step 2: Add base64 to Cargo.toml**

```toml
base64 = "0.22"
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/webit/Desktop/p1/海報資料庫/poster-admin-app/src-tauri && cargo check`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/services/tus.rs src-tauri/Cargo.toml
git commit -m "feat(upload): add TUS protocol client with retry logic"
```

---

## Chunk 2: Upload Commands + Queue Manager

### Task 4: Rewrite upload.rs with Real TUS Upload

**Files:**
- Rewrite: `src-tauri/src/commands/upload.rs`

- [ ] **Step 1: Rewrite upload.rs**

```rust
// src-tauri/src/commands/upload.rs
//! Chunked upload commands — TUS protocol + queue management.

use crate::services::tus::TusClient;
use crate::services::upload_db::{UploadDb, UploadRecord};
use chrono::Utc;
use log::{info, error};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter, State};
use tokio::fs;
use tokio::sync::Semaphore;

const DEFAULT_CONCURRENCY: usize = 2;
const CHUNK_SIZE: u64 = 6 * 1024 * 1024; // 6MB

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadProgress {
    pub upload_id: String,
    pub file_name: String,
    pub bytes_sent: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub status: String,
    pub speed_bps: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadResult {
    pub success: bool,
    pub upload_id: String,
    pub storage_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueueItem {
    pub file_path: String,
    pub poster_id: String,
    pub original_filename: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResumeInfo {
    pub uploads: Vec<UploadRecord>,
}

pub struct UploadState {
    pub db: Arc<UploadDb>,
    pub semaphore: Arc<Semaphore>,
    pub supabase_url: String,
    pub supabase_key: String,
    pub auth_token: Arc<tokio::sync::RwLock<String>>,
}

/// Enqueue files for upload. Sorted by file size (small first).
#[command]
pub async fn upload_files(
    app: AppHandle,
    state: State<'_, UploadState>,
    items: Vec<QueueItem>,
) -> Result<Vec<String>, String> {
    let mut sorted = items;
    // Sort by file size ascending (small files first)
    let mut sizes: Vec<(usize, u64)> = Vec::new();
    for (i, item) in sorted.iter().enumerate() {
        let meta = fs::metadata(&item.file_path).await
            .map_err(|e| format!("Cannot read {}: {}", item.file_path, e))?;
        sizes.push((i, meta.len()));
    }
    sizes.sort_by_key(|&(_, size)| size);
    let reordered: Vec<QueueItem> = sizes.iter().map(|&(i, _)| sorted[i].clone()).collect();

    let mut upload_ids = Vec::new();

    for item in &reordered {
        let meta = fs::metadata(&item.file_path).await
            .map_err(|e| format!("Cannot read {}: {}", item.file_path, e))?;

        let upload_id = uuid::Uuid::new_v4().to_string();
        let storage_path = format!(
            "posters/{}/{}",
            item.poster_id,
            item.original_filename
        );

        let record = UploadRecord {
            id: upload_id.clone(),
            file_path: item.file_path.clone(),
            poster_id: item.poster_id.clone(),
            storage_path: storage_path.clone(),
            total_bytes: meta.len(),
            uploaded_bytes: 0,
            chunk_size: CHUNK_SIZE,
            tus_url: None,
            status: "pending".to_string(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        };

        state.db.insert(&record)?;
        upload_ids.push(upload_id.clone());

        // Spawn upload task with concurrency limit
        let db = state.db.clone();
        let sem = state.semaphore.clone();
        let sb_url = state.supabase_url.clone();
        let sb_key = state.supabase_key.clone();
        let auth = state.auth_token.clone();
        let app_handle = app.clone();

        tokio::spawn(async move {
            let _permit = sem.acquire().await.expect("Semaphore closed");
            if let Err(e) = do_upload(&app_handle, &db, &sb_url, &sb_key, &auth, &record).await {
                error!("[Upload] Failed {}: {}", upload_id, e);
                let _ = db.mark_failed(&upload_id, "failed");
                let _ = app_handle.emit("upload-progress", UploadProgress {
                    upload_id,
                    file_name: record.file_path.clone(),
                    bytes_sent: record.uploaded_bytes,
                    total_bytes: record.total_bytes,
                    percentage: 0.0,
                    status: "failed".to_string(),
                    speed_bps: None,
                });
            }
        });
    }

    Ok(upload_ids)
}

async fn do_upload(
    app: &AppHandle,
    db: &UploadDb,
    supabase_url: &str,
    supabase_key: &str,
    auth_token: &tokio::sync::RwLock<String>,
    record: &UploadRecord,
) -> Result<(), String> {
    let token = auth_token.read().await.clone();
    let tus = TusClient::new(supabase_url, "poster-files", supabase_key, &token);
    let file_path = &record.file_path;
    let file_name = Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    // Read file
    let file_data = fs::read(file_path).await
        .map_err(|e| format!("Read file failed: {}", e))?;
    let total = file_data.len() as u64;

    // Create or resume TUS session
    let tus_url = if let Some(ref url) = record.tus_url {
        // Resume: check offset
        info!("[Upload] Resuming {} from existing TUS session", file_name);
        url.clone()
    } else {
        // New upload
        let content_type = match Path::new(file_name).extension().and_then(|e| e.to_str()) {
            Some("psd") => "image/vnd.adobe.photoshop",
            Some("ai") => "application/postscript",
            Some("pdf") => "application/pdf",
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            _ => "application/octet-stream",
        };
        tus.create_upload(&record.storage_path, total, content_type).await?
    };

    // Get current offset (for resume)
    let mut offset = tus.get_offset(&tus_url).await.unwrap_or(0);
    db.update_progress(&record.id, offset, Some(&tus_url))?;

    let chunk_size = CHUNK_SIZE as usize;
    let start_time = std::time::Instant::now();

    // Upload chunks
    while (offset as usize) < file_data.len() {
        let start = offset as usize;
        let end = std::cmp::min(start + chunk_size, file_data.len());
        let chunk = &file_data[start..end];

        let new_offset = tus.upload_chunk(&tus_url, chunk, offset).await?;
        offset = new_offset;

        // Update DB
        db.update_progress(&record.id, offset, Some(&tus_url))?;

        // Calculate speed
        let elapsed = start_time.elapsed().as_secs_f64();
        let speed = if elapsed > 0.0 { (offset as f64 / elapsed) as u64 } else { 0 };
        let percentage = (offset as f64 / total as f64) * 100.0;

        // Emit progress to frontend
        let _ = app.emit("upload-progress", UploadProgress {
            upload_id: record.id.clone(),
            file_name: file_name.to_string(),
            bytes_sent: offset,
            total_bytes: total,
            percentage,
            status: "uploading".to_string(),
            speed_bps: Some(speed),
        });
    }

    // Mark completed
    db.mark_completed(&record.id)?;
    let _ = app.emit("upload-progress", UploadProgress {
        upload_id: record.id.clone(),
        file_name: file_name.to_string(),
        bytes_sent: total,
        total_bytes: total,
        percentage: 100.0,
        status: "completed".to_string(),
        speed_bps: None,
    });

    info!("[Upload] Completed: {} ({} bytes)", file_name, total);
    Ok(())
}

/// Get list of resumable uploads (for cross-session recovery).
#[command]
pub async fn get_resumable_uploads(
    state: State<'_, UploadState>,
) -> Result<Vec<UploadRecord>, String> {
    state.db.list_resumable()
}

/// Resume all pending/paused uploads.
#[command]
pub async fn resume_uploads(
    app: AppHandle,
    state: State<'_, UploadState>,
) -> Result<usize, String> {
    let records = state.db.list_resumable()?;
    let count = records.len();

    for record in records {
        let db = state.db.clone();
        let sem = state.semaphore.clone();
        let sb_url = state.supabase_url.clone();
        let sb_key = state.supabase_key.clone();
        let auth = state.auth_token.clone();
        let app_handle = app.clone();

        tokio::spawn(async move {
            let _permit = sem.acquire().await.expect("Semaphore closed");
            if let Err(e) = do_upload(&app_handle, &db, &sb_url, &sb_key, &auth, &record).await {
                error!("[Upload] Resume failed {}: {}", record.id, e);
                let _ = db.mark_failed(&record.id, "failed");
            }
        });
    }

    Ok(count)
}

/// Get current progress for all active uploads.
#[command]
pub async fn get_upload_progress(
    state: State<'_, UploadState>,
) -> Result<Vec<UploadRecord>, String> {
    state.db.list_resumable()
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/webit/Desktop/p1/海報資料庫/poster-admin-app/src-tauri && cargo check`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/upload.rs
git commit -m "feat(upload): rewrite upload commands with TUS chunked upload"
```

### Task 5: Wire UploadState into lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Rewrite lib.rs**

```rust
// src-tauri/src/lib.rs
mod commands;
mod services;

use commands::{auth, upload};
use services::upload_db::UploadDb;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize upload database
    let app_data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("org.tzuchi.poster-admin");
    std::fs::create_dir_all(&app_data_dir).ok();
    let db_path = app_data_dir.join("uploads.db");
    let db = UploadDb::open(&db_path).expect("Failed to open upload database");

    let upload_state = upload::UploadState {
        db: Arc::new(db),
        semaphore: Arc::new(tokio::sync::Semaphore::new(2)), // max 2 concurrent
        supabase_url: std::env::var("POSTER_SUPABASE_URL")
            .unwrap_or_else(|_| "https://ptsupabase.tzuchi-org.tw".to_string()),
        supabase_key: std::env::var("POSTER_SUPABASE_ANON_KEY")
            .unwrap_or_default(),
        auth_token: Arc::new(tokio::sync::RwLock::new(String::new())),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .manage(upload_state)
        .invoke_handler(tauri::generate_handler![
            upload::upload_files,
            upload::get_upload_progress,
            upload::get_resumable_uploads,
            upload::resume_uploads,
            auth::google_login,
            auth::check_auth,
            auth::logout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Add dirs dependency to Cargo.toml**

```toml
dirs = "6"
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/webit/Desktop/p1/海報資料庫/poster-admin-app/src-tauri && cargo check`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(upload): wire UploadState into Tauri app with managed state"
```

---

## Chunk 3: Frontend Integration

### Task 6: useTauriUpload Hook

**Files:**
- Create: `src/hooks/useTauriUpload.ts`

- [ ] **Step 1: Write the hook**

```typescript
// src/hooks/useTauriUpload.ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, useCallback } from "react";

export interface UploadProgress {
  upload_id: string;
  file_name: string;
  bytes_sent: number;
  total_bytes: number;
  percentage: number;
  status: "pending" | "uploading" | "paused" | "completed" | "failed";
  speed_bps: number | null;
}

export interface UploadRecord {
  id: string;
  file_path: string;
  poster_id: string;
  storage_path: string;
  total_bytes: number;
  uploaded_bytes: number;
  status: string;
}

export function useTauriUpload() {
  const [progress, setProgress] = useState<Map<string, UploadProgress>>(new Map());
  const [resumable, setResumable] = useState<UploadRecord[]>([]);

  // Listen for progress events from Rust
  useEffect(() => {
    const unlisten = listen<UploadProgress>("upload-progress", (event) => {
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(event.payload.upload_id, event.payload);
        return next;
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Check for resumable uploads on mount
  useEffect(() => {
    invoke<UploadRecord[]>("get_resumable_uploads")
      .then(setResumable)
      .catch(console.error);
  }, []);

  const uploadFiles = useCallback(
    async (items: { file_path: string; poster_id: string; original_filename: string }[]) => {
      const ids = await invoke<string[]>("upload_files", { items });
      return ids;
    },
    []
  );

  const resumeUploads = useCallback(async () => {
    const count = await invoke<number>("resume_uploads");
    return count;
  }, []);

  const allProgress = Array.from(progress.values());
  const activeCount = allProgress.filter((p) => p.status === "uploading").length;
  const completedCount = allProgress.filter((p) => p.status === "completed").length;
  const totalFiles = allProgress.length;

  const overallPercentage =
    totalFiles > 0
      ? allProgress.reduce((sum, p) => sum + p.percentage, 0) / totalFiles
      : 0;

  return {
    progress,
    allProgress,
    resumable,
    activeCount,
    completedCount,
    totalFiles,
    overallPercentage,
    uploadFiles,
    resumeUploads,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useTauriUpload.ts
git commit -m "feat(upload): add useTauriUpload React hook for Tauri IPC"
```

### Task 7: Build Verification

- [ ] **Step 1: Verify Rust builds**

Run: `cd /Users/webit/Desktop/p1/海報資料庫/poster-admin-app/src-tauri && cargo build`

- [ ] **Step 2: Verify frontend builds**

Run: `cd /Users/webit/Desktop/p1/海報資料庫/poster-admin-app && npx vite build`

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(upload): complete TUS chunked upload implementation"
```
