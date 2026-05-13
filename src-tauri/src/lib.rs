mod commands;
mod services;

use commands::{auth, upload, copaw, project, review, profile};
use services::qwenpaw::task_queue::{ProcessingTask, TaskQueue};
use services::upload_db::UploadDb;
use std::sync::Arc;
use tauri::Manager;

/// Frontend-facing command: enqueue a poster file for metadata/thumbnail processing.
#[tauri::command]
async fn qwenpaw_enqueue(
    queue: tauri::State<'_, Arc<TaskQueue>>,
    task: ProcessingTask,
) -> Result<(), String> {
    queue.submit(task);
    Ok(())
}

/// Generic Supabase query command — allows frontend to read any table.
#[tauri::command]
async fn query_supabase(
    state: tauri::State<'_, upload::UploadState>,
    table: String,
    query: String,
) -> Result<String, String> {
    state.supabase_client.query(&table, &query).await
}

/// Update a user's `app_role` in `public.users`. Backs the Permission
/// Management modal. RLS ensures only `app_role = '系統管理員'` callers can
/// actually mutate — the Rust side is a thin passthrough so the same policy
/// that governs the Supabase UPDATE governs this command.
#[tauri::command]
async fn patch_user_role(
    state: tauri::State<'_, upload::UploadState>,
    user_id: String,
    role: String,
) -> Result<(), String> {
    state
        .supabase_client
        .update_user_role(&user_id, &role)
        .await
}

/// Create a new `exhibitions` row. Aligned with production schema:
///   status enum: planning | ongoing | finished
///   cover_image_path: URL/path to cover image
///   sort_order: int, smaller = earlier in frontend list
///   start_date / end_date: ISO date "YYYY-MM-DD"; end_date None/"" = 常設
///   location: 展出地點純文字
/// RLS gates writes to `app_role='系統管理員'`, so this is a thin passthrough —
/// the same policy that governs Supabase INSERT governs this command. Returns
/// the created row as JSON so the frontend can splice it in without re-fetch.
#[tauri::command]
async fn create_exhibition(
    state: tauri::State<'_, upload::UploadState>,
    name: String,
    description: Option<String>,
    cover_image_path: Option<String>,
    sort_order: Option<i32>,
    status: String,
    start_date: Option<String>,
    end_date: Option<String>,
    location: Option<String>,
) -> Result<String, String> {
    if name.trim().is_empty() {
        return Err("展覽名稱不可為空".into());
    }
    let allowed = ["planning", "ongoing", "finished"];
    if !allowed.contains(&status.as_str()) {
        return Err(format!(
            "status 必須是 planning / ongoing / finished 其中一個（收到：{}）",
            status
        ));
    }
    // Light sanity check on dates — Postgres will reject malformed strings
    // anyway, but a clearer message here saves a network roundtrip.
    if let (Some(s), Some(e)) = (start_date.as_deref(), end_date.as_deref()) {
        if !s.is_empty() && !e.is_empty() && s > e {
            return Err("展期結束日不能早於起始日".into());
        }
    }
    state
        .supabase_client
        .insert_exhibition(
            name.trim(),
            description.as_deref(),
            cover_image_path.as_deref(),
            sort_order,
            &status,
            start_date.as_deref(),
            end_date.as_deref(),
            location.as_deref(),
        )
        .await
}

/// PATCH an `exhibitions` row. `None` fields are skipped; empty strings clear
/// the column. Same RLS gate as `create_exhibition`.
#[tauri::command]
async fn patch_exhibition(
    state: tauri::State<'_, upload::UploadState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    cover_image_path: Option<String>,
    sort_order: Option<i32>,
    status: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    location: Option<String>,
) -> Result<(), String> {
    if let Some(n) = &name {
        if n.trim().is_empty() {
            return Err("展覽名稱不可為空".into());
        }
    }
    if let Some(s) = &status {
        let allowed = ["planning", "ongoing", "finished"];
        if !allowed.contains(&s.as_str()) {
            return Err(format!(
                "status 必須是 planning / ongoing / finished 其中一個（收到：{}）",
                s
            ));
        }
    }
    if let (Some(s), Some(e)) = (start_date.as_deref(), end_date.as_deref()) {
        if !s.is_empty() && !e.is_empty() && s > e {
            return Err("展期結束日不能早於起始日".into());
        }
    }
    state
        .supabase_client
        .update_exhibition(
            &id,
            name.as_deref().map(str::trim),
            description.as_deref(),
            cover_image_path.as_deref(),
            sort_order,
            status.as_deref(),
            start_date.as_deref(),
            end_date.as_deref(),
            location.as_deref(),
        )
        .await
}

/// DELETE an `exhibitions` row. Same RLS gate as `create_exhibition`.
#[tauri::command]
async fn delete_exhibition(
    state: tauri::State<'_, upload::UploadState>,
    id: String,
) -> Result<(), String> {
    state.supabase_client.delete_exhibition(&id).await
}

/// List posters attached to an exhibition, sorted by sort_order ascending.
/// Returns raw JSON string of `[{poster_id, sort_order, posters: {...}}, ...]`.
#[tauri::command]
async fn list_exhibition_posters(
    state: tauri::State<'_, upload::UploadState>,
    exhibition_id: String,
) -> Result<String, String> {
    state
        .supabase_client
        .list_exhibition_posters(&exhibition_id)
        .await
}

/// List posters available for attaching to an exhibition.
/// `status_filter` empty → defaults to published+approved on the backend.
#[tauri::command]
async fn list_posters_for_picker(
    state: tauri::State<'_, upload::UploadState>,
    status_filter: Vec<String>,
    search: Option<String>,
) -> Result<String, String> {
    state
        .supabase_client
        .list_posters_for_picker(&status_filter, search.as_deref())
        .await
}

/// Attach posters to an exhibition. Already-attached posters are silently
/// skipped. Returns the number of newly-attached rows.
#[tauri::command]
async fn attach_posters_to_exhibition(
    state: tauri::State<'_, upload::UploadState>,
    exhibition_id: String,
    poster_ids: Vec<String>,
) -> Result<usize, String> {
    if exhibition_id.trim().is_empty() {
        return Err("exhibition_id 不可為空".into());
    }
    state
        .supabase_client
        .attach_posters_to_exhibition(&exhibition_id, &poster_ids)
        .await
}

/// Remove a poster from an exhibition. Idempotent.
#[tauri::command]
async fn detach_poster_from_exhibition(
    state: tauri::State<'_, upload::UploadState>,
    exhibition_id: String,
    poster_id: String,
) -> Result<(), String> {
    state
        .supabase_client
        .detach_poster_from_exhibition(&exhibition_id, &poster_id)
        .await
}

/// Rewrite sort_order for all posters attached to an exhibition. Input order
/// = new order (0-based). Rejects if input ids differ from currently attached.
#[tauri::command]
async fn reorder_exhibition_posters(
    state: tauri::State<'_, upload::UploadState>,
    exhibition_id: String,
    ordered_poster_ids: Vec<String>,
) -> Result<(), String> {
    state
        .supabase_client
        .reorder_exhibition_posters(&exhibition_id, &ordered_poster_ids)
        .await
}

/// List all vocabulary_themes including inactive ones.
#[tauri::command]
async fn list_vocabulary_themes_admin(
    state: tauri::State<'_, upload::UploadState>,
) -> Result<String, String> {
    state.supabase_client.list_vocabulary_themes_admin().await
}

/// Create a vocabulary_themes row.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn create_vocabulary_theme(
    state: tauri::State<'_, upload::UploadState>,
    name: String,
    code: Option<String>,
    icon: Option<String>,
    color: Option<String>,
    bg_color: Option<String>,
    description: Option<String>,
    cover_image: Option<String>,
    sort_order: Option<i32>,
    is_active: Option<bool>,
) -> Result<String, String> {
    if name.trim().is_empty() {
        return Err("主題名稱不可為空".into());
    }
    state
        .supabase_client
        .insert_vocabulary_theme(
            name.trim(),
            code.as_deref(),
            icon.as_deref(),
            color.as_deref(),
            bg_color.as_deref(),
            description.as_deref(),
            cover_image.as_deref(),
            sort_order,
            is_active.unwrap_or(true),
        )
        .await
}

/// Update a vocabulary_themes row via admin_rename_theme RPC. The RPC
/// transactionally cascades into poster_files.themes when name changes.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn update_vocabulary_theme(
    state: tauri::State<'_, upload::UploadState>,
    id: String,
    new_name: String,
    code: Option<String>,
    icon: Option<String>,
    color: Option<String>,
    bg_color: Option<String>,
    description: Option<String>,
    cover_image: Option<String>,
    sort_order: Option<i32>,
    is_active: Option<bool>,
) -> Result<(), String> {
    if new_name.trim().is_empty() {
        return Err("主題名稱不可為空".into());
    }
    state
        .supabase_client
        .rpc_admin_rename_theme(
            &id,
            new_name.trim(),
            code.as_deref(),
            icon.as_deref(),
            color.as_deref(),
            bg_color.as_deref(),
            description.as_deref(),
            cover_image.as_deref(),
            sort_order,
            is_active,
        )
        .await
}

/// Delete a vocabulary_themes row via admin_delete_theme RPC.
#[tauri::command]
async fn delete_vocabulary_theme(
    state: tauri::State<'_, upload::UploadState>,
    id: String,
) -> Result<(), String> {
    state.supabase_client.rpc_admin_delete_theme(&id).await
}

/// Return a short-lived signed URL for a thumbnail stored in the
/// `poster-thumbnails` bucket. Used by the review page to render previews.
#[tauri::command]
async fn sign_thumbnail_url(
    state: tauri::State<'_, upload::UploadState>,
    path: String,
) -> Result<String, String> {
    state
        .supabase_client
        .create_signed_url("poster-thumbnails", &path, 600)
        .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env file (if present) so GOOGLE_CLIENT_ID etc. are available
    dotenvy::dotenv().ok();
    // Initialize upload database
    let app_data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("org.tzuchi.poster-admin");
    std::fs::create_dir_all(&app_data_dir).ok();
    let db_path = app_data_dir.join("uploads.db");
    let db = Arc::new(UploadDb::open(&db_path).expect("Failed to open upload database"));

    // One-off migration: reconcile pre-existing `project_files` rows whose
    // `storage_path` is NULL against the matching `uploads` row (by
    // project_id + file_path). Fixes projects from before upload.rs learned
    // to share UUIDs with `create_project`, where the Edit page would show
    // "尚未上傳" despite the file having been successfully uploaded.
    match db.repair_orphan_project_files() {
        Ok(0) => {}
        Ok(n) => log::info!(
            "[Migration] repaired {} orphan project_files (back-filled storage_path)",
            n
        ),
        Err(e) => log::warn!("[Migration] repair_orphan_project_files failed: {}", e),
    }

    let supabase_url = std::env::var("POSTER_SUPABASE_URL")
        .unwrap_or_else(|_| "https://ptsupabase.tzuchi-org.tw".to_string());
    let supabase_key = std::env::var("POSTER_SUPABASE_ANON_KEY")
        .unwrap_or_default();

    // Auth state — shares Supabase config, token shared with upload.
    // `with_persistence` restores any session written to disk by a previous
    // run so the user doesn't see a redirect to /login after every Tauri dev
    // rebuild or app restart. Built first so SupabaseClient can wire the JWT
    // store in as its authentication source (RLS policies keyed off
    // `auth.uid()` won't apply to requests made with the anon key alone).
    let session_path = app_data_dir.join("session.json");
    let auth_state_inner = auth::AuthState::new(&supabase_url, &supabase_key);
    let auth_state = Arc::new(
        tauri::async_runtime::block_on(auth_state_inner.with_persistence(session_path)),
    );

    let supabase_arc = Arc::new(
        services::supabase::SupabaseClient::new(&supabase_url, &supabase_key)
            .with_user_token_store(auth_state.access_token.clone()),
    );

    // Initialize Immich client
    let immich_url = std::env::var("IMMICH_URL")
        .unwrap_or_else(|_| "http://localhost:2283".to_string());
    let immich_key = std::env::var("IMMICH_API_KEY")
        .unwrap_or_default();
    let immich_client = Arc::new(services::immich::ImmichClient::new(&immich_url, &immich_key));

    // Share auth token with upload state so TUS uploads use real OAuth token
    let upload_state = upload::UploadState {
        db: db.clone(),
        semaphore: Arc::new(tokio::sync::Semaphore::new(2)),
        supabase_url: supabase_url.clone(),
        supabase_key: supabase_key.clone(),
        auth_token: auth_state.access_token.clone(),
        supabase_client: supabase_arc.clone(),
    };
    let worker_db = db.clone();

    // Qwenpaw task queue — background worker processes uploaded files
    let (queue, queue_rx) = TaskQueue::new();
    let queue_arc = Arc::new(queue);
    let worker_supabase = supabase_arc.clone();
    let worker_app_data = app_data_dir.clone();

    let copaw_state = Arc::new(copaw::CoPawState {
        connected: Arc::new(tokio::sync::RwLock::new(false)),
        copaw_url: std::env::var("COPAW_WS_URL")
            .unwrap_or_else(|_| "ws://localhost:8775".to_string()),
        client_id: format!("poster-admin-{}", uuid::Uuid::new_v4()),
        tx: Arc::new(tokio::sync::RwLock::new(None)),
        auth_token: auth_state.access_token.clone(),
        server_config: Arc::new(tokio::sync::RwLock::new(None)),
    });

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
        .manage(copaw_state.clone())
        .manage(auth_state)
        .manage(queue_arc.clone())
        .manage(immich_client.clone())
        .setup(move |app| {
            // CoPaw WebSocket listener disabled — migrating to in-process QwenPaw agent.
            let _ = copaw_state;

            let handle = app.handle().clone();
            let resource_dir = app.path().resource_dir().ok();

            // Start the bundled llama-server sidecar (for local VLM) and then
            // the Qwenpaw task worker. Sidecar startup can take up to 2 min
            // while the model warms on Metal; we don't block app launch on it.
            tauri::async_runtime::spawn(async move {
                let sidecar = services::qwenpaw::llama_sidecar::start(
                    resource_dir.as_deref(),
                    &worker_app_data,
                )
                .await;
                services::qwenpaw::task_queue::run_worker(
                    handle,
                    worker_supabase,
                    worker_db,
                    sidecar,
                    queue_rx,
                )
                .await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Upload
            upload::upload_files,
            upload::get_upload_progress,
            upload::get_resumable_uploads,
            upload::resume_uploads,
            // Auth
            auth::google_login,
            auth::check_auth,
            auth::refresh_session,
            auth::logout,
            // Profile / Onboarding
            profile::check_onboarding_status,
            profile::submit_onboarding,
            // CoPaw
            copaw::get_copaw_status,
            copaw::send_copaw_message,
            copaw::send_copaw_auth,
            // Project
            project::create_project,
            project::list_projects,
            project::get_project,
            project::update_project_status,
            project::classify_file,
            project::reprocess_file,
            project::delete_project,
            // Review
            review::submit_project_for_review,
            review::submit_review,
            review::update_file_review,
            review::get_review_history,
            review::trigger_processing,
            // Qwenpaw
            qwenpaw_enqueue,
            sign_thumbnail_url,
            // Permission management
            patch_user_role,
            // Exhibitions (主題展覽 CRUD)
            create_exhibition,
            patch_exhibition,
            delete_exhibition,
            // Exhibition posters join table (Phase 2)
            list_exhibition_posters,
            list_posters_for_picker,
            attach_posters_to_exhibition,
            detach_poster_from_exhibition,
            reorder_exhibition_posters,
            // Vocabulary themes (PR-B)
            list_vocabulary_themes_admin,
            create_vocabulary_theme,
            update_vocabulary_theme,
            delete_vocabulary_theme,
            // Generic Supabase query
            query_supabase,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
