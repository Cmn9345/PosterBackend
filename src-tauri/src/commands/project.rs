// src-tauri/src/commands/project.rs
//! Project (專案) management commands.
//! Maps to architecture: metadata → OCR → 專案 → 分類檔型

use crate::commands::upload::UploadState;
use log::info;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::command;

/// File type classification for poster files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PosterFileType {
    /// Raster images: JPG, PNG, TIFF, WebP, BMP
    Raster,
    /// Design source files: PSD, AI, EPS, INDD
    Design,
    /// Vector / document: SVG, PDF
    Vector,
    /// Text documents: DOCX, TXT
    Document,
    /// Unknown format
    Unknown,
}

impl PosterFileType {
    pub fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().as_str() {
            "jpg" | "jpeg" | "png" | "tiff" | "tif" | "webp" | "bmp"
            | "heic" | "heif" => Self::Raster,
            "psd" | "ai" | "eps" | "indd" => Self::Design,
            "svg" | "pdf" => Self::Vector,
            "docx" | "doc" | "txt" | "md" => Self::Document,
            _ => Self::Unknown,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Raster => "raster",
            Self::Design => "design",
            Self::Vector => "vector",
            Self::Document => "document",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFile {
    pub id: String,
    pub project_id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_ext: String,
    pub file_size: u64,
    pub file_type: String,         // raster, design, vector, document
    pub processing_status: String, // pending, uploading, processing, completed, failed
    pub storage_path: Option<String>,
    pub thumbnail_path: Option<String>,
    pub immich_asset_id: Option<String>,
    pub metadata_json: Option<String>,
    /// JSON-serialized `AiAnalysis` (description / OCR / themes / language / logo / person).
    pub ai_analysis: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub status: String, // draft, uploading, processing, pending_review, approved, rejected, archived
    pub total_files: u32,
    pub completed_files: u32,
    pub created_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub description: Option<String>,
    pub files: Vec<CreateProjectFileInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectFileInput {
    pub file_path: String,
    pub file_name: String,
}

/// Create a new poster project with file list.
/// Classifies files by type and stores in local DB + Supabase.
#[command]
pub async fn create_project(
    state: tauri::State<'_, UploadState>,
    auth: tauri::State<'_, Arc<crate::commands::auth::AuthState>>,
    input: CreateProjectInput,
) -> Result<Project, String> {
    let project_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Classify each file
    let mut project_files: Vec<ProjectFile> = Vec::new();
    for file_input in &input.files {
        let ext = std::path::Path::new(&file_input.file_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let file_size = tokio::fs::metadata(&file_input.file_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);

        let file_type = PosterFileType::from_extension(&ext);
        let file_id = uuid::Uuid::new_v4().to_string();

        project_files.push(ProjectFile {
            id: file_id,
            project_id: project_id.clone(),
            file_path: file_input.file_path.clone(),
            file_name: file_input.file_name.clone(),
            file_ext: ext,
            file_size,
            file_type: file_type.as_str().to_string(),
            processing_status: "pending".to_string(),
            storage_path: None,
            thumbnail_path: None,
            immich_asset_id: None,
            metadata_json: None,
            ai_analysis: None,
        });
    }

    // Insert project into local DB
    state.db.insert_project(&project_id, &input.name, input.description.as_deref(), project_files.len() as u32)?;

    // Insert files into local DB
    for pf in &project_files {
        state.db.insert_project_file(pf)?;
    }

    // Insert project into Supabase, mapping our `CreateProjectInput` onto the
    // production `posters` schema. When the target schema can't accept the
    // row (missing `vocabulary_items` seed, unauthenticated, etc.) the local
    // DB remains the source of truth and the pipeline continues.
    let creator_id = auth
        .user
        .read()
        .await
        .as_ref()
        .map(|u| u.id.clone());
    if let Err(e) = state
        .supabase_client
        .insert_project(
            &project_id,
            &input.name,
            input.description.as_deref(),
            creator_id.as_deref(),
            None,
            None,
            None,
        )
        .await
    {
        log::warn!("[Project] Supabase insert failed (local OK): {}", e);
    }

    info!("[Project] Created: {} with {} files", input.name, project_files.len());

    let project = Project {
        id: project_id,
        name: input.name,
        description: input.description,
        status: "draft".to_string(),
        total_files: project_files.len() as u32,
        completed_files: 0,
        // M10: Wire created_by from authenticated user
        created_by: auth.user.read().await.as_ref().map(|u| u.email.clone()),
        created_at: now.clone(),
        updated_at: now,
    };

    Ok(project)
}

/// List all projects from local DB.
#[command]
pub async fn list_projects(
    state: tauri::State<'_, UploadState>,
) -> Result<Vec<Project>, String> {
    state.db.list_projects()
}

/// Get a single project with its files.
#[command]
pub async fn get_project(
    state: tauri::State<'_, UploadState>,
    project_id: String,
) -> Result<(Project, Vec<ProjectFile>), String> {
    let project = state.db.get_project(&project_id)?;
    let files = state.db.list_project_files(&project_id)?;
    Ok((project, files))
}

/// Re-enqueue a file through the Qwenpaw pipeline.
///
/// Reads the file's storage/path info from local SQLite and submits a fresh
/// `ProcessingTask` to the background worker. Useful for back-filling
/// pre-existing files whose pipeline run happened before local persistence
/// landed (so their `ai_analysis` column is still NULL).
#[command]
pub async fn reprocess_file(
    state: tauri::State<'_, UploadState>,
    queue: tauri::State<'_, std::sync::Arc<crate::services::qwenpaw::task_queue::TaskQueue>>,
    project_id: String,
    file_id: String,
) -> Result<(), String> {
    let files = state.db.list_project_files(&project_id)?;
    let file = files
        .into_iter()
        .find(|f| f.id == file_id)
        .ok_or_else(|| format!("file {} not found under project {}", file_id, project_id))?;

    // Primary source is `project_files.storage_path`, which upload.rs now
    // back-fills. For older rows written before that back-fill landed, fall
    // back to the `uploads` table — both use the same file UUID as PK, so
    // we can map one to the other directly. Persist the resolved path back
    // onto `project_files` so future lookups don't need the fallback.
    let storage_path = if let Some(p) = file.storage_path.clone() {
        p
    } else {
        match state.db.get_upload_storage_path(&file_id)? {
            Some(p) => {
                let _ = state.db.update_file_storage_path(&file_id, &p);
                log::info!(
                    "[Reprocess] back-filled storage_path for legacy file {}",
                    file_id
                );
                p
            }
            None => {
                return Err(format!(
                    "file {} has no storage_path — not uploaded yet",
                    file_id
                ))
            }
        }
    };

    queue.submit(crate::services::qwenpaw::task_queue::ProcessingTask {
        file_id: file.id,
        poster_id: file.project_id,
        storage_path,
        file_type: file.file_ext,
        original_filename: file.file_name,
    });
    log::info!("[Reprocess] enqueued {} of project {}", file_id, project_id);
    Ok(())
}

/// Hard-delete a project and all traces of it.
///
/// Best-effort across three stores (any of them may fail independently — e.g.
/// Supabase RLS can block deletes, Storage may refuse unauthenticated
/// removal — but local DB cleanup always runs so the UI stops showing the
/// row). Order: Storage → Supabase DB → local DB.
#[command]
pub async fn delete_project(
    state: tauri::State<'_, UploadState>,
    project_id: String,
) -> Result<(), String> {
    log::info!("[Project] delete_project start: {}", project_id);

    // Collect the storage paths we need to wipe before we drop the local rows.
    let files = state.db.list_project_files(&project_id).unwrap_or_default();

    // 1. Supabase Storage — originals + thumbnails. Failures are logged,
    //    never fatal: the bytes leak server-side but the local UI still
    //    reflects the delete.
    for f in &files {
        if let Some(ref path) = f.storage_path {
            if let Err(e) = state
                .supabase_client
                .delete_from_storage("poster-files", path)
                .await
            {
                log::warn!("[Project] delete storage poster-files/{} failed: {}", path, e);
            }
        }
        for size in ["s", "m", "l"] {
            let thumb_path = format!("{}/{}_{}.webp", project_id, f.id, size);
            if let Err(e) = state
                .supabase_client
                .delete_from_storage("poster-thumbnails", &thumb_path)
                .await
            {
                log::debug!(
                    "[Project] delete storage poster-thumbnails/{} failed (often harmless if missing): {}",
                    thumb_path,
                    e
                );
            }
        }
    }

    // 2. Supabase posters row (poster_files cascades via FK if configured).
    if let Err(e) = state
        .supabase_client
        .delete_project(&project_id)
        .await
    {
        log::warn!("[Project] Supabase delete failed (local will still proceed): {}", e);
    }

    // 3. Local SQLite — authoritative for the UI.
    state.db.delete_project_cascade(&project_id)?;
    log::info!("[Project] delete_project done: {}", project_id);
    Ok(())
}

/// Update project status.
#[command]
pub async fn update_project_status(
    state: tauri::State<'_, UploadState>,
    project_id: String,
    status: String,
) -> Result<(), String> {
    state.db.update_project_status(&project_id, &status)?;

    // Sync to Supabase
    if let Err(e) = state.supabase_client.update_project_status(&project_id, &status).await {
        log::warn!("[Project] Supabase status update failed: {}", e);
    }

    Ok(())
}

/// Classify a file by extension (utility command for frontend).
#[command]
pub fn classify_file(filename: String) -> String {
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    PosterFileType::from_extension(ext).as_str().to_string()
}
