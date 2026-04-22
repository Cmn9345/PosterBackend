// src-tauri/src/commands/review.rs
//! Review workflow commands.
//! Maps to architecture: 審核 OK → 上傳縮圖 / NO → 返還建檔者

use crate::commands::upload::UploadState;
use crate::services::immich::ImmichClient;
use crate::services::qwenpaw::notify::NotifyService;
use crate::services::qwenpaw::thumbnail;
use crate::services::supabase::SupabaseClient;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewDecision {
    pub project_id: String,
    pub decision: String,           // "approved" or "rejected"
    pub reviewer_notes: Option<String>,
    pub rejection_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewResult {
    pub success: bool,
    pub project_id: String,
    pub decision: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileReviewEdit {
    pub file_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub keywords: Option<Vec<String>>,
    pub category: Option<String>,
}

/// Flip a project from "draft" to "pending_review" and make sure Supabase
/// actually has the row the reviewer list queries.
///
/// The uploader's previous `create_project` / upload.rs calls try their best
/// to insert `posters` + `poster_files` rows, but they're allowed to fail
/// silently (missing vocab seed, RLS on the service role, transient network
/// blip…) so the local pipeline can keep going. That means by the time the
/// uploader clicks "提交審核" the Supabase row might not exist — and a blind
/// PATCH of a non-existent row succeeds with 0 rows affected, so the review
/// list stays empty.
///
/// This command closes that gap: for the project and each of its files it
/// probes Supabase, re-inserts anything missing, then PATCHes status to
/// `pending_review`. Any failure that would leave the review list blind is
/// surfaced to the frontend so the uploader sees a real error instead of a
/// false "submitted" toast.
#[command]
pub async fn submit_project_for_review(
    state: tauri::State<'_, UploadState>,
    auth: tauri::State<'_, Arc<crate::commands::auth::AuthState>>,
    project_id: String,
) -> Result<(), String> {
    info!("[Review] submit_project_for_review start: {}", project_id);

    // Load local snapshot of project + files — this is the source of truth
    // for anything we need to re-insert upstream. Do this *before* touching
    // status so that a missing project id returns a real error instead of a
    // silently no-op UPDATE.
    let project = state.db.get_project(&project_id)?;
    let files = state.db.list_project_files(&project_id)?;

    let creator_id = auth
        .user
        .read()
        .await
        .as_ref()
        .map(|u| u.id.clone())
        .ok_or_else(|| "尚未登入，無法提交審核".to_string())?;

    // 3. Ensure `posters` row exists. If Supabase currently has no row for
    //    this project (insert_project failed earlier), re-attempt the insert
    //    now that the user is definitely authed and has explicitly opted in
    //    to publishing. Any failure here is fatal for submit — otherwise the
    //    PATCH in step 4 would be a no-op and the reviewer would never see it.
    let exists = state
        .supabase_client
        .row_exists("posters", &project_id)
        .await
        .map_err(|e| format!("檢查雲端專案狀態失敗：{}", e))?;
    if !exists {
        state
            .supabase_client
            .insert_project(
                &project_id,
                &project.name,
                project.description.as_deref(),
                Some(&creator_id),
                None,
                None,
                None,
            )
            .await
            .map_err(|e| format!("補建雲端專案失敗：{}", e))?;
    }

    // 4. Flip status → pending_review on the just-ensured posters row.
    state
        .supabase_client
        .update_project_status(&project_id, "pending_review")
        .await
        .map_err(|e| format!("更新雲端專案狀態失敗：{}", e))?;

    // 5. Ensure every file has a `poster_files` row upstream so the reviewer's
    //    modal can render the file list. Files that never got a storage_path
    //    aren't uploaded yet — the reviewer can't do anything with them, so
    //    we return Err rather than silently hide the problem from the
    //    uploader.
    let mut missing_upload: Vec<String> = Vec::new();
    let mut ensure_errors: Vec<String> = Vec::new();
    for f in &files {
        let Some(storage_path) = f.storage_path.clone() else {
            missing_upload.push(f.file_name.clone());
            continue;
        };
        let file_exists = match state
            .supabase_client
            .row_exists("poster_files", &f.id)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                ensure_errors.push(format!("{}（檢查失敗：{}）", f.file_name, e));
                continue;
            }
        };
        if !file_exists {
            if let Err(e) = state
                .supabase_client
                .insert_poster_file(
                    &f.id,
                    &project_id,
                    &f.file_name,
                    &f.file_ext,
                    f.file_size,
                    &storage_path,
                )
                .await
            {
                ensure_errors.push(format!("{}（{}）", f.file_name, e));
            }
        }
    }

    if !missing_upload.is_empty() {
        return Err(format!(
            "以下檔案尚未完成上傳，請先回到上傳頁補完：{}",
            missing_upload.join("、")
        ));
    }
    if !ensure_errors.is_empty() {
        return Err(format!(
            "部分檔案無法同步到雲端審核列表：{}",
            ensure_errors.join("；")
        ));
    }

    // 6. Sync local pipeline results → Supabase. The Rust worker writes
    //    description / people_summary / poster_size back to Supabase as part
    //    of `process_one`, but if the row didn't exist upstream at the time
    //    (common for legacy projects where upload_id ≠ project_files.id)
    //    those PATCHes landed on nothing. Now that the row is ensured to
    //    exist, replay the latest local state so the review modal shows the
    //    AI caption + tech info without requiring another reprocess.
    for f in &files {
        let ai: Option<serde_json::Value> = f
            .ai_analysis
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok());
        let meta: Option<serde_json::Value> = f
            .metadata_json
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok());

        let description = ai
            .as_ref()
            .and_then(|v| v.get("description"))
            .and_then(|v| v.as_str());
        let has_person = ai
            .as_ref()
            .and_then(|v| v.get("has_person"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let poster_size = meta
            .as_ref()
            .and_then(|v| {
                let w = v.get("width").and_then(|x| x.as_u64())?;
                let h = v.get("height").and_then(|x| x.as_u64())?;
                Some(format!("{}×{}", w, h))
            });

        let themes: Vec<String> = ai
            .as_ref()
            .and_then(|v| v.get("themes"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.trim().to_string())
                    .collect()
            })
            .unwrap_or_default();

        let mut body = serde_json::json!({});
        let bm = body.as_object_mut().unwrap();
        if let Some(d) = description {
            bm.insert("description".into(), serde_json::json!(d));
        }
        if has_person {
            bm.insert(
                "people_summary".into(),
                serde_json::json!("海報含人物（由 AI 偵測）"),
            );
        }
        if let Some(sz) = poster_size {
            bm.insert("poster_size".into(), serde_json::json!(sz));
        }
        if !themes.is_empty() {
            bm.insert("themes".into(), serde_json::json!(themes));
        }
        if !bm.is_empty() {
            bm.insert(
                "updated_at".into(),
                serde_json::json!(chrono::Utc::now().to_rfc3339()),
            );
            if let Err(e) = state.supabase_client.patch_poster_file(&f.id, body).await {
                log::warn!(
                    "[Review] sync local → Supabase for {} failed: {}",
                    f.id,
                    e
                );
            }
        }
    }

    // 7. Ensure each file has a thumbnail in `poster-thumbnails`. The
    //    pipeline tries to upload on first run, but early runs happened
    //    before Storage RLS was opened to authenticated users and the
    //    bucket ended up empty. Re-attempt now from the Storage original
    //    so the review modal can render previews.
    let sizes = thumbnail::ThumbnailSizes::from_env();
    for f in &files {
        let Some(storage_path) = f.storage_path.clone() else { continue };
        // HEAD the `m` thumbnail first — skip work if it already exists.
        let m_path = thumbnail::storage_path(&project_id, &f.id, "m");
        if state
            .supabase_client
            .row_exists_in_storage("poster-thumbnails", &m_path)
            .await
            .unwrap_or(false)
        {
            continue;
        }
        // Pull the original from Storage, regenerate S/M/L, upload each.
        let bytes = match state
            .supabase_client
            .download_from_storage("poster-files", &storage_path)
            .await
        {
            Ok(b) => b,
            Err(e) => {
                log::warn!(
                    "[Review] thumb regen: download original {} failed: {}",
                    storage_path,
                    e
                );
                continue;
            }
        };
        let Some(thumbs) = thumbnail::from_bytes(&bytes, &f.file_ext, sizes) else {
            log::warn!(
                "[Review] thumb regen: could not decode {} for {}",
                f.file_ext,
                f.id
            );
            continue;
        };
        for t in &thumbs {
            let path = thumbnail::storage_path(&project_id, &f.id, t.size_key);
            if let Err(e) = state
                .supabase_client
                .upload_to_storage(
                    "poster-thumbnails",
                    &path,
                    t.webp_bytes.clone(),
                    "image/webp",
                )
                .await
            {
                log::warn!(
                    "[Review] thumb upload {} failed (often Storage RLS): {}",
                    path,
                    e
                );
            } else {
                log::info!("[Review] thumb uploaded {} ({}x{})", path, t.width, t.height);
            }
        }
    }

    // 8. All cloud ensure steps succeeded → safe to flip local status last,
    //    so if Supabase failed halfway the uploader can retry without their
    //    local row being stuck in `pending_review` (which hides the submit
    //    button on the Edit page).
    state
        .db
        .update_project_status(&project_id, "pending_review")?;

    info!(
        "[Review] submit_project_for_review done: {} ({} files)",
        project_id,
        files.len()
    );
    Ok(())
}

/// Submit review decision for a project.
/// OK → upload thumbnails to Supabase + trigger Immich sync
/// NO → mark rejected + return to creator with reason
#[command]
pub async fn submit_review(
    app: AppHandle,
    state: tauri::State<'_, UploadState>,
    immich: tauri::State<'_, Arc<ImmichClient>>,
    decision: ReviewDecision,
) -> Result<ReviewResult, String> {
    info!(
        "[Review] Project {} → {}",
        decision.project_id, decision.decision
    );

    match decision.decision.as_str() {
        "approved" => handle_approve(&app, &state, immich.inner().clone(), &decision).await,
        "rejected" => handle_reject(&app, &state, &decision).await,
        _ => Err(format!("Invalid decision: {}", decision.decision)),
    }
}

async fn handle_approve(
    app: &AppHandle,
    state: &UploadState,
    immich: Arc<ImmichClient>,
    decision: &ReviewDecision,
) -> Result<ReviewResult, String> {
    // The Supabase `poster_status` enum uses `published` (not `approved`) for
    // the "live on the public frontend" state. Keeping local SQLite aligned
    // so downstream filters + the Edit page badges stay consistent.
    const APPROVED_STATUS: &str = "published";

    // 1. Update project status → published (locally first).
    state
        .db
        .update_project_status(&decision.project_id, APPROVED_STATUS)?;

    // 2. Update Supabase project status. If this fails the reviewer still sees
    //    the row in the pending queue on refresh, so surface the error.
    state
        .supabase_client
        .update_project_status(&decision.project_id, APPROVED_STATUS)
        .await
        .map_err(|e| format!("雲端狀態更新失敗：{}", e))?;

    // 3. Submit review result to Supabase
    if let Err(e) = state
        .supabase_client
        .submit_review(
            &decision.project_id,
            APPROVED_STATUS,
            decision.reviewer_notes.as_deref(),
            None,
        )
        .await
    {
        log::warn!("[Review] Supabase review submit failed: {}", e);
    }

    // 4. OS + UI notification
    NotifyService::new(app).notify_poster_status(&decision.project_id, APPROVED_STATUS, None);

    // 5. Spawn Immich sync in background (download originals + upload to Immich + write asset_id)
    let sb = state.supabase_client.clone();
    let app_handle = app.clone();
    let project_id = decision.project_id.clone();
    tokio::spawn(async move {
        if let Err(e) = sync_to_immich(&app_handle, sb, immich, &project_id).await {
            error!("[Review] Immich sync failed for {}: {}", project_id, e);
            let _ = app_handle.emit(
                "immich-sync-progress",
                serde_json::json!({
                    "project_id": project_id,
                    "stage": "failed",
                    "message": format!("{}", e),
                }),
            );
        }
    });

    // 6. Emit event to frontend
    let _ = app.emit("review-completed", serde_json::json!({
        "project_id": decision.project_id,
        "decision": APPROVED_STATUS,
    }));

    info!("[Review] Published: {}", decision.project_id);

    Ok(ReviewResult {
        success: true,
        project_id: decision.project_id.clone(),
        decision: APPROVED_STATUS.to_string(),
        message: "已核可上架，正在同步至公開庫與 Immich。".to_string(),
    })
}

async fn handle_reject(
    app: &AppHandle,
    state: &UploadState,
    decision: &ReviewDecision,
) -> Result<ReviewResult, String> {
    let reason = decision
        .rejection_reason
        .as_deref()
        .unwrap_or("No reason provided");

    // 1. Update project status → rejected
    state
        .db
        .update_project_status(&decision.project_id, "rejected")?;

    // 2. Update Supabase
    if let Err(e) = state
        .supabase_client
        .update_project_status(&decision.project_id, "rejected")
        .await
    {
        log::warn!("[Review] Supabase status update failed: {}", e);
    }

    // 3. Submit rejection to Supabase
    if let Err(e) = state
        .supabase_client
        .submit_review(
            &decision.project_id,
            "rejected",
            decision.reviewer_notes.as_deref(),
            Some(reason),
        )
        .await
    {
        log::warn!("[Review] Supabase review submit failed: {}", e);
    }

    // 4. OS + UI notification (carries the rejection reason)
    NotifyService::new(app).notify_poster_status(&decision.project_id, "rejected", Some(reason));

    // 5. Emit event to frontend
    let _ = app.emit("review-completed", serde_json::json!({
        "project_id": decision.project_id,
        "decision": "rejected",
        "reason": reason,
    }));

    info!("[Review] Rejected: {} — {}", decision.project_id, reason);

    Ok(ReviewResult {
        success: true,
        project_id: decision.project_id.clone(),
        decision: "rejected".to_string(),
        message: format!("Project rejected. Creator notified. Reason: {}", reason),
    })
}

/// Update metadata edits for individual files before review submission.
///
/// `metadata_json` is shared between the Rust pipeline's tech info
/// (format / mode / width / dpi / exif) and the reviewer-edit fields
/// (title / description / keywords / category). Merging preserves tech
/// info — an earlier implementation blew it away on every save, which
/// emptied the "檔案資訊" card after the first "儲存變更" click.
#[command]
pub async fn update_file_review(
    state: tauri::State<'_, UploadState>,
    edits: Vec<FileReviewEdit>,
) -> Result<(), String> {
    for edit in &edits {
        let existing = state.db.get_file_metadata_json(&edit.file_id).ok().flatten();
        let mut merged: serde_json::Value = existing
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        if let serde_json::Value::Object(ref mut map) = merged {
            if let Some(t) = &edit.title {
                map.insert("title".into(), serde_json::json!(t));
            }
            if let Some(d) = &edit.description {
                map.insert("description".into(), serde_json::json!(d));
            }
            if let Some(kws) = &edit.keywords {
                map.insert("keywords".into(), serde_json::json!(kws));
            }
            if let Some(c) = &edit.category {
                map.insert("category".into(), serde_json::json!(c));
            }
        }
        state
            .db
            .update_file_metadata(&edit.file_id, &merged.to_string())?;
    }
    info!("[Review] Updated metadata for {} files", edits.len());
    Ok(())
}

/// Get review history for a project from Supabase.
#[command]
pub async fn get_review_history(
    state: tauri::State<'_, UploadState>,
    project_id: String,
) -> Result<String, String> {
    state
        .supabase_client
        .query(
            "poster_reviews",
            &format!("project_id=eq.{}&order=created_at.desc", project_id),
        )
        .await
}

/// Deprecated: Processing is now auto-enqueued on upload complete.
/// Kept as no-op to preserve the frontend `invoke` contract.
#[command]
pub async fn trigger_processing(project_id: String) -> Result<(), String> {
    info!(
        "[Review] trigger_processing is a no-op — files auto-enqueue on upload (project={})",
        project_id
    );
    Ok(())
}

// ── Immich sync helpers ────────────────────────────────────────────

fn emit_immich_progress(app: &AppHandle, project_id: &str, stage: &str, message: &str) {
    let _ = app.emit(
        "immich-sync-progress",
        serde_json::json!({
            "project_id": project_id,
            "stage": stage,
            "message": message,
        }),
    );
}

fn guess_content_type(filename: &str) -> &'static str {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "pdf" => "application/pdf",
        "psd" => "image/vnd.adobe.photoshop",
        "ai" => "application/postscript",
        _ => "application/octet-stream",
    }
}

/// Pull all completed files for a project, upload them to Immich, and write the
/// returned `immich_asset_id` back into `poster_files`. Marks them `synced` on success.
async fn sync_to_immich(
    app: &AppHandle,
    supabase: Arc<SupabaseClient>,
    immich: Arc<ImmichClient>,
    project_id: &str,
) -> Result<(), String> {
    emit_immich_progress(app, project_id, "query", "查詢待同步檔案中…");

    // 1. Query poster_files for this project that finished local processing.
    let rows_json = supabase
        .query(
            "poster_files",
            &format!(
                "poster_id=eq.{}&processing_status=eq.completed&select=id,original_filename,storage_path",
                project_id
            ),
        )
        .await?;

    let rows: Vec<serde_json::Value> = serde_json::from_str(&rows_json)
        .map_err(|e| format!("parse poster_files rows failed: {}", e))?;

    if rows.is_empty() {
        warn!("[ImmichSync] no completed files for project {}", project_id);
        emit_immich_progress(app, project_id, "completed", "沒有需要同步的檔案");
        return Ok(());
    }

    // 2. Download each file from Supabase Storage.
    emit_immich_progress(app, project_id, "download", &format!("下載 {} 個原始檔…", rows.len()));
    let mut bundle: Vec<(String, Vec<u8>, String, String)> = Vec::new();
    for row in &rows {
        let file_id = row.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let filename = row.get("original_filename").and_then(|v| v.as_str()).unwrap_or("");
        let storage_path = row.get("storage_path").and_then(|v| v.as_str()).unwrap_or("");
        if file_id.is_empty() || storage_path.is_empty() {
            continue;
        }
        match supabase.download_from_storage("poster-files", storage_path).await {
            Ok(bytes) => {
                let ct = guess_content_type(filename);
                bundle.push((file_id.to_string(), bytes, filename.to_string(), ct.to_string()));
            }
            Err(e) => warn!("[ImmichSync] download {} failed: {}", file_id, e),
        }
    }

    if bundle.is_empty() {
        return Err("All downloads failed — nothing to sync".into());
    }

    // 3. Upload to Immich (+ create album + add assets).
    emit_immich_progress(app, project_id, "upload", &format!("上傳至 Immich ({} 個)…", bundle.len()));
    let synced = immich.sync_project(project_id, bundle).await?;

    // 4. Write asset_id back + mark synced.
    emit_immich_progress(app, project_id, "persist", "寫回 asset_id…");
    for (file_id, asset_id) in &synced {
        if let Err(e) = supabase
            .update_file_metadata(file_id, "{}", Some(asset_id), None, "synced")
            .await
        {
            warn!("[ImmichSync] persist {} → {} failed: {}", file_id, asset_id, e);
        }
    }

    info!("[ImmichSync] project {} → {} assets synced", project_id, synced.len());
    emit_immich_progress(app, project_id, "completed", &format!("同步完成（{} 個）", synced.len()));
    NotifyService::new(app).notify_poster_status(project_id, "published", None);
    Ok(())
}
