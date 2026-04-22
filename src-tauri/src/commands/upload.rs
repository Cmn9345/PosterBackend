// src-tauri/src/commands/upload.rs
//! Chunked upload commands — TUS protocol + queue management.

use crate::services::qwenpaw::task_queue::{ProcessingTask, TaskQueue};
use crate::services::tus::TusClient;
use crate::services::upload_db::{UploadDb, UploadRecord};
use chrono::Utc;
use log::{info, error, warn};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter, State};
use tokio::fs;
use tokio::io::AsyncReadExt;
use tokio::sync::Semaphore;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub auth_token: Arc<tokio::sync::RwLock<Option<String>>>,
    pub supabase_client: Arc<crate::services::supabase::SupabaseClient>,
}

/// Enqueue files for upload. Sorted by file size (small first).
#[command]
pub async fn upload_files(
    app: AppHandle,
    state: State<'_, UploadState>,
    queue: State<'_, Arc<TaskQueue>>,
    items: Vec<QueueItem>,
) -> Result<Vec<String>, String> {
    let queue = queue.inner().clone();
    let sorted = items;
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

        // Prefer the `project_files.id` already assigned by `create_project`
        // so every downstream row (uploads, Supabase poster_files, TaskQueue
        // task.file_id) shares the same UUID. Falls back to a fresh UUID
        // when the caller hasn't gone through `create_project` first (e.g.
        // legacy callers). The ID mismatch this unifies was the root cause
        // of "已完成 2/2" projects that still showed "尚未上傳" — pipeline
        // UPDATEs landed on upload_id, which didn't exist in project_files.
        let upload_id = state
            .db
            .find_project_file_id(&item.poster_id, &item.file_path)
            .ok()
            .flatten()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        // Supabase Storage keys must match ^[A-Za-z0-9!\-_\.\*'\(\)\/]+$ — no
        // CJK / spaces / most symbols. Use UUID + extension as the key and
        // keep the user-facing filename in the DB row instead.
        let ext_lower = Path::new(&item.original_filename)
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_else(|| "bin".to_string());
        let storage_path = format!("{}/{}.{}", item.poster_id, upload_id, ext_lower);

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
        let sb_client = state.supabase_client.clone();
        let app_handle = app.clone();
        let queue_for_task = queue.clone();

        tokio::spawn(async move {
            let _permit = sem.acquire().await.expect("Semaphore closed");
            if let Err(e) = do_upload(&app_handle, &db, &sb_url, &sb_key, &auth, &sb_client, &queue_for_task, &record).await {
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
    auth_token: &tokio::sync::RwLock<Option<String>>,
    supabase_client: &crate::services::supabase::SupabaseClient,
    queue: &TaskQueue,
    record: &UploadRecord,
) -> Result<(), String> {
    let token = auth_token.read().await.clone()
        .unwrap_or_default();
    // Bucket name per PRD §4.1: `poster-files`. Must match
    // `task_queue::ORIGINALS_BUCKET` and `review::sync_to_immich` so the
    // pipeline can read back what we just wrote.
    let tus = TusClient::new(supabase_url, "poster-files", supabase_key, &token);
    let file_path = &record.file_path;
    let file_name = Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    // H5: Stream file in chunks instead of reading entire file into memory
    let total = record.total_bytes;

    // Create or resume TUS session
    let tus_url = if let Some(ref url) = record.tus_url {
        info!("[Upload] Resuming {} from existing TUS session", file_name);
        // Old records may have a broken Location URL cached (internal host +
        // `/storage/v1//upload/resumable/…`). Re-normalize against the
        // current supabase_url so resume-after-upgrade works.
        tus.normalize_cached_url(url)
    } else {
        let content_type = match Path::new(file_name).extension().and_then(|e| e.to_str()) {
            Some("psd") => "image/vnd.adobe.photoshop",
            Some("ai") => "application/postscript",
            Some("eps") => "application/postscript",
            Some("indd") => "application/x-indesign",
            Some("pdf") => "application/pdf",
            Some("svg") => "image/svg+xml",
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            Some("tiff") | Some("tif") => "image/tiff",
            Some("webp") => "image/webp",
            Some("bmp") => "image/bmp",
            Some("heic") | Some("heif") => "image/heic",
            _ => "application/octet-stream",
        };
        tus.create_upload(&record.storage_path, total, content_type).await?
    };

    // Get current offset (for resume)
    let mut offset = tus.get_offset(&tus_url).await.unwrap_or(0);
    db.update_progress(&record.id, offset, Some(&tus_url))?;

    let chunk_size = CHUNK_SIZE as usize;
    let start_time = std::time::Instant::now();

    // Open file and seek to offset for streaming upload
    let mut file = fs::File::open(file_path).await
        .map_err(|e| format!("Open file failed: {}", e))?;

    // Seek to current offset (for resume)
    if offset > 0 {
        use tokio::io::AsyncSeekExt;
        file.seek(std::io::SeekFrom::Start(offset)).await
            .map_err(|e| format!("Seek failed: {}", e))?;
    }

    // Read and upload one chunk at a time (no full-file buffer)
    let mut chunk_buf = vec![0u8; chunk_size];
    while offset < total {
        let bytes_to_read = std::cmp::min(chunk_size, (total - offset) as usize);
        let buf = &mut chunk_buf[..bytes_to_read];
        let n = file.read_exact(buf).await
            .map_err(|e| format!("Read chunk failed at offset {}: {}", offset, e))?;

        let chunk = &chunk_buf[..n];
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

    // Persist storage_path back onto `project_files` so the edit page and
    // reprocess flow can find the uploaded object. `uploads` already has it
    // (by file_id) but the project-facing table starts with `storage_path =
    // NULL` — without this copy, "Reprocess this file" has no path to pass
    // to Qwenpaw.
    if let Err(e) = db.update_file_storage_path(&record.id, &record.storage_path) {
        warn!(
            "[Upload] failed to write storage_path to project_files {}: {}",
            record.id, e
        );
    }

    // Insert poster_files record to Supabase DB → then enqueue Qwenpaw processing
    let file_ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown")
        .to_lowercase();

    // Try to insert a poster_files row in Supabase. The upstream schema often
    // rejects these inserts (e.g. missing required FKs while `vocabulary_items`
    // is unseeded) — that's a production-schema alignment problem we track
    // separately. It must NOT stop the Qwenpaw pipeline: the file is already
    // in Supabase Storage, and the local SQLite has all the state the task
    // queue needs to process it (thumbnail + metadata + VLM). We log the
    // failure and keep going.
    match supabase_client
        .insert_poster_file(
            &record.id,
            &record.poster_id,
            file_name,
            &file_ext,
            total,
            &record.storage_path,
        )
        .await
    {
        Ok(_) => info!("[Upload] Supabase DB row inserted: {}", record.id),
        Err(e) => warn!(
            "[Upload] Supabase DB insert failed (file uploaded OK, pipeline continues): {}",
            e
        ),
    }

    // Always enqueue — Qwenpaw reads the file from Storage using storage_path
    // and writes metadata/thumbnail/ai_analysis back via UPDATE (no-op when
    // the row is absent, which is acceptable while schema alignment is pending).
    queue.submit(ProcessingTask {
        file_id: record.id.clone(),
        poster_id: record.poster_id.clone(),
        storage_path: record.storage_path.clone(),
        file_type: file_ext,
        original_filename: file_name.to_string(),
    });
    info!("[Upload] Enqueued for Qwenpaw processing: {}", record.id);

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
    queue: State<'_, Arc<TaskQueue>>,
) -> Result<usize, String> {
    let records = state.db.list_resumable()?;
    let count = records.len();
    let queue = queue.inner().clone();

    for record in records {
        let db = state.db.clone();
        let sem = state.semaphore.clone();
        let sb_url = state.supabase_url.clone();
        let sb_key = state.supabase_key.clone();
        let auth = state.auth_token.clone();
        let sb_client = state.supabase_client.clone();
        let app_handle = app.clone();
        let queue_for_task = queue.clone();

        tokio::spawn(async move {
            let _permit = sem.acquire().await.expect("Semaphore closed");
            if let Err(e) = do_upload(&app_handle, &db, &sb_url, &sb_key, &auth, &sb_client, &queue_for_task, &record).await {
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
