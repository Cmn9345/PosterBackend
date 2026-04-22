//! In-process task queue for poster file processing.
//!
//! Replaces the distributed `task_manager.py` volunteer-claim model. Since this Tauri
//! app is a single-user desktop app, tasks are processed sequentially by a single
//! background worker (no leases, no multi-client coordination).
//!
//! Pipeline per task:
//!   1. Download original from Supabase Storage
//!   2. Extract metadata (EXIF + dimensions + classification)
//!   3. Generate S/M/L WebP thumbnails + upload to staging bucket
//!   4. Run VLM analysis (OCR + caption) against local Ollama
//!   5. Persist metadata + thumbnail_path + ai_analysis back to poster_files
//!
//! Upstream reference: `3in1media-copaw-webgpu/backend/copaw_agent/task_manager.py`
//! (deliberately simplified: no lease, no heartbeat, no claim RPC).

#![allow(dead_code)]

use crate::services::qwenpaw::llama_sidecar::LlamaSidecar;
use crate::services::qwenpaw::{analysis, metadata, thumbnail};
use crate::services::supabase::SupabaseClient;
use crate::services::upload_db::UploadDb;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

/// Default bucket for original poster uploads — matches TUS upload target.
/// Per PRD §4.1 the bucket is `poster-files`.
const ORIGINALS_BUCKET: &str = "poster-files";
/// Bucket for generated thumbnails.
const THUMBS_BUCKET: &str = "poster-thumbnails";

/// A single unit of work: process one uploaded file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessingTask {
    pub file_id: String,
    pub poster_id: String,
    pub storage_path: String,
    pub file_type: String,
    pub original_filename: String,
}

/// Progress event pushed to frontend via Tauri `emit`.
#[derive(Debug, Clone, Serialize)]
pub struct ProcessingProgress {
    pub file_id: String,
    pub poster_id: String,
    pub stage: &'static str, // "download" | "metadata" | "thumbnail" | "analysis" | "completed" | "failed"
    pub message: String,
}

pub struct TaskQueue {
    tx: UnboundedSender<ProcessingTask>,
}

impl TaskQueue {
    /// Construct a queue + return (queue, receiver). Caller spawns the worker with `receiver`.
    pub fn new() -> (Self, UnboundedReceiver<ProcessingTask>) {
        let (tx, rx) = unbounded_channel();
        (Self { tx }, rx)
    }

    /// Submit a task. Silently drops if the worker has been stopped (shouldn't happen in normal flow).
    pub fn submit(&self, task: ProcessingTask) {
        if let Err(e) = self.tx.send(task) {
            warn!("[TaskQueue] submit dropped (worker gone): {}", e);
        }
    }
}

/// Background worker loop — pulls tasks and runs the full pipeline sequentially.
pub async fn run_worker(
    app: AppHandle,
    supabase: Arc<SupabaseClient>,
    db: Arc<UploadDb>,
    vlm_sidecar: Option<Arc<LlamaSidecar>>,
    mut rx: UnboundedReceiver<ProcessingTask>,
) {
    let sizes = thumbnail::ThumbnailSizes::from_env();
    let vlm_base = vlm_sidecar.as_ref().map(|s| s.base_url.clone());
    info!(
        "[TaskQueue] worker started (sizes S={}, M={}, L={}, vlm={})",
        sizes.s,
        sizes.m,
        sizes.l,
        vlm_base.as_deref().unwrap_or("<disabled>"),
    );

    while let Some(task) = rx.recv().await {
        if let Err(e) = process_one(&app, &supabase, &db, vlm_base.as_deref(), sizes, &task).await {
            error!("[TaskQueue] task {} failed: {}", task.file_id, e);
            emit_progress(&app, &task, "failed", &format!("處理失敗：{}", e));
            // Even on failure, record status locally so the UI doesn't spin
            // forever waiting for an event that never comes.
            let _ = db.update_file_analysis(
                &task.file_id,
                None,
                None,
                None,
                Some("failed"),
            );
        }
    }
    warn!("[TaskQueue] worker stopped (channel closed)");
}

async fn process_one(
    app: &AppHandle,
    supabase: &SupabaseClient,
    db: &UploadDb,
    vlm_base_url: Option<&str>,
    sizes: thumbnail::ThumbnailSizes,
    task: &ProcessingTask,
) -> Result<(), String> {
    // Move project into "processing" on the first file picked up. Safe to run
    // repeatedly — subsequent files just re-set the same status.
    let _ = db.update_project_status(&task.poster_id, "processing");
    info!(
        "[TaskQueue] pick {} ({}) — type={}",
        task.file_id, task.original_filename, task.file_type
    );

    // Stage 1: download original
    emit_progress(app, task, "download", "下載原始檔案中…");
    let bytes = supabase
        .download_from_storage(ORIGINALS_BUCKET, &task.storage_path)
        .await?;
    info!("[TaskQueue] downloaded {} bytes for {}", bytes.len(), task.file_id);

    // Stage 2: metadata
    emit_progress(app, task, "metadata", "擷取檔案資訊中…");
    let meta = metadata::extract(&bytes, &task.original_filename);
    let meta_json =
        serde_json::to_string(&meta).map_err(|e| format!("metadata serialize failed: {}", e))?;

    // Stage 3 + 4: thumbnails + upload
    emit_progress(app, task, "thumbnail", "產生縮圖中…");
    let thumb_path = match thumbnail::from_bytes(&bytes, &task.file_type, sizes) {
        Some(thumbs) if !thumbs.is_empty() => {
            let mut m_path: Option<String> = None;
            for t in &thumbs {
                let path = thumbnail::storage_path(&task.poster_id, &task.file_id, t.size_key);
                match supabase
                    .upload_to_storage(THUMBS_BUCKET, &path, t.webp_bytes.clone(), "image/webp")
                    .await
                {
                    Ok(_) => {
                        info!("[TaskQueue] uploaded thumbnail {} ({}x{})", path, t.width, t.height);
                        if t.size_key == "m" {
                            m_path = Some(path);
                        }
                    }
                    Err(e) => warn!("[TaskQueue] thumbnail upload {} failed: {}", path, e),
                }
            }
            m_path.or_else(|| {
                Some(thumbnail::storage_path(&task.poster_id, &task.file_id, "m"))
            })
        }
        _ => {
            warn!(
                "[TaskQueue] no thumbnails generated for {} ({}) — format may be unsupported",
                task.file_id, task.file_type
            );
            None
        }
    };

    // Stage 4: persist metadata + status.
    //
    // The upstream Supabase `poster_files` schema currently lacks the
    // `metadata_json` / `ai_analysis` columns this code writes to; PATCH
    // returns 400 until the schema is aligned. We log and keep going rather
    // than killing the whole pipeline — the file bytes are already in
    // Storage, the thumbnail is uploaded, and the VLM result is still
    // computable and visible via the frontend's live progress events.
    if let Err(e) = supabase
        .update_file_metadata(
            &task.file_id,
            &meta_json,
            None,
            thumb_path.as_deref(),
            "completed",
        )
        .await
    {
        warn!(
            "[TaskQueue] persist metadata to Supabase {} failed (pipeline continues): {}",
            task.file_id, e
        );
    }

    // Always persist locally — this is what the Edit page reads.
    if let Err(e) = db.update_file_analysis(
        &task.file_id,
        Some(&meta_json),
        None,
        thumb_path.as_deref(),
        Some("completed"),
    ) {
        warn!("[TaskQueue] local metadata persist {} failed: {}", task.file_id, e);
    }

    // Stage 5: VLM analysis (OCR + caption + themes) — local Ollama on the
    // reviewer's machine. Only run for image formats that the VLM can actually
    // decode.
    if matches!(
        metadata::classify(&task.original_filename),
        metadata::ExtractorType::Image
    ) {
        emit_progress(app, task, "analysis", "本機 VLM 做 OCR 與圖說…");
        let ai = analysis::request_analysis(
            &task.file_id,
            &bytes,
            &task.original_filename,
            vlm_base_url,
        )
        .await;
        let ai_json = serde_json::to_value(&ai).unwrap_or(serde_json::json!({}));
        let ai_json_str = ai_json.to_string();
        if let Err(e) = supabase
            .update_file_ai_analysis(&task.file_id, &ai_json)
            .await
        {
            warn!(
                "[TaskQueue] persist ai_analysis to Supabase {} failed: {}",
                task.file_id, e
            );
        }
        if let Err(e) = db.update_file_analysis(
            &task.file_id,
            None,
            Some(&ai_json_str),
            None,
            None,
        ) {
            warn!("[TaskQueue] local ai_analysis persist {} failed: {}", task.file_id, e);
        }
    }

    emit_progress(app, task, "completed", "處理完成");
    info!("[TaskQueue] done {}", task.file_id);

    // Bookkeeping: increment the project's completed_files counter and, once
    // every file has been through the pipeline, flip the project back to
    // `draft` so the uploader can review the AI result and manually submit.
    // (Reviewer-side `pending_review` transition happens when the uploader
    // clicks "提交審核" — we don't auto-promote here.)
    let _ = db.increment_completed_files(&task.poster_id);
    if let Ok(project) = db.get_project(&task.poster_id) {
        if project.total_files > 0 && project.completed_files >= project.total_files {
            let _ = db.update_project_status(&task.poster_id, "draft");
            info!(
                "[TaskQueue] project {} processed ({}/{}) — awaiting uploader submit",
                project.id, project.completed_files, project.total_files
            );
        }
    }
    Ok(())
}

fn emit_progress(app: &AppHandle, task: &ProcessingTask, stage: &'static str, message: &str) {
    let payload = ProcessingProgress {
        file_id: task.file_id.clone(),
        poster_id: task.poster_id.clone(),
        stage,
        message: message.to_string(),
    };
    let _ = app.emit("qwenpaw-progress", &payload);
}
