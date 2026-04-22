// src-tauri/src/services/upload_db.rs
//! SQLite-based upload state persistence.
//! Tracks chunk progress for cross-session resume.

use chrono::Utc;
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
            );

            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'draft',
                total_files INTEGER NOT NULL DEFAULT 0,
                completed_files INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_files (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_ext TEXT NOT NULL,
                file_size INTEGER NOT NULL DEFAULT 0,
                file_type TEXT NOT NULL DEFAULT 'unknown',
                processing_status TEXT NOT NULL DEFAULT 'pending',
                storage_path TEXT,
                thumbnail_path TEXT,
                immich_asset_id TEXT,
                metadata_json TEXT,
                ai_analysis TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );"
        ).map_err(|e| format!("Failed to create tables: {}", e))?;

        // Best-effort migrations for DBs created before ai_analysis column existed.
        // SQLite returns "duplicate column" when the column is already there; ignore.
        let _ = conn.execute(
            "ALTER TABLE project_files ADD COLUMN ai_analysis TEXT",
            [],
        );

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

    /// Look up the `storage_path` of an upload by id. `uploads` always has
    /// this set the moment TUS starts, so it's a reliable fallback for older
    /// rows where `project_files.storage_path` is still NULL (legacy data
    /// from before upload.rs started back-filling `project_files`).
    pub fn get_upload_storage_path(&self, file_id: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT storage_path FROM uploads WHERE id = ?1",
            params![file_id],
            |row| row.get::<_, String>(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(format!("Lookup upload storage_path failed: {}", other)),
        })
    }

    /// Legacy-data rescue: for a given project + local file path, look up the
    /// completed upload record. Used by `repair_orphan_project_files` to
    /// reconcile the two UUID spaces that existed before upload.rs was taught
    /// to share ids with `project_files`.
    pub fn find_completed_upload_by_path(
        &self,
        project_id: &str,
        file_path: &str,
    ) -> Result<Option<(String, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, storage_path FROM uploads
             WHERE poster_id = ?1 AND file_path = ?2 AND status = 'completed'
             ORDER BY updated_at DESC LIMIT 1",
            params![project_id, file_path],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(format!("find_completed_upload_by_path failed: {}", other)),
        })
    }

    /// Bulk one-off repair: finds every `project_files` row that is stuck with
    /// `storage_path IS NULL`, reconciles it against the `uploads` table by
    /// (project_id, file_path), and back-fills the `storage_path` column so
    /// the Edit page stops showing "尚未上傳" on already-uploaded files.
    ///
    /// Runs at app startup — cheap, idempotent, bounded by the number of
    /// orphan rows (a few at most in practice).
    ///
    /// Returns the number of rows repaired.
    pub fn repair_orphan_project_files(&self) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Collect orphans first so we don't hold a prepared statement across
        // the UPDATE calls.
        let orphans: Vec<(String, String, String)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT pf.id, pf.project_id, pf.file_path
                     FROM project_files pf
                     WHERE pf.storage_path IS NULL",
                )
                .map_err(|e| format!("prepare repair: {}", e))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map_err(|e| format!("query repair: {}", e))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("collect repair: {}", e))?
        };

        let mut fixed = 0usize;
        let now = Utc::now().to_rfc3339();
        for (file_id, project_id, file_path) in orphans {
            let found: Option<String> = conn
                .query_row(
                    "SELECT storage_path FROM uploads
                     WHERE poster_id = ?1 AND file_path = ?2 AND status = 'completed'
                     ORDER BY updated_at DESC LIMIT 1",
                    params![project_id, file_path],
                    |row| row.get::<_, String>(0),
                )
                .ok();
            if let Some(storage_path) = found {
                conn.execute(
                    "UPDATE project_files SET storage_path = ?1, updated_at = ?2 WHERE id = ?3",
                    params![storage_path, now, file_id],
                )
                .map_err(|e| format!("repair update failed for {}: {}", file_id, e))?;
                fixed += 1;
            }
        }
        Ok(fixed)
    }

    /// Find the `project_files.id` for a given (project_id, file_path) pair.
    /// Used by upload.rs so the upload record can adopt the project_files
    /// UUID instead of minting a fresh one — keeping `uploads.id`,
    /// `project_files.id`, and the Supabase `poster_files.id` unified across
    /// the whole pipeline.
    pub fn find_project_file_id(
        &self,
        project_id: &str,
        file_path: &str,
    ) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id FROM project_files
             WHERE project_id = ?1 AND file_path = ?2
             ORDER BY created_at DESC LIMIT 1",
            params![project_id, file_path],
            |row| row.get::<_, String>(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(format!("find_project_file_id failed: {}", other)),
        })
    }

    // ── Project methods ────────────────────────────────────────

    pub fn insert_project(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        total_files: u32,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO projects
             (id, name, description, status, total_files, completed_files, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'draft', ?4, 0, ?5, ?6)",
            params![id, name, description, total_files, now, now],
        ).map_err(|e| format!("Insert project failed: {}", e))?;
        Ok(())
    }

    pub fn list_projects(&self) -> Result<Vec<crate::commands::project::Project>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, status, total_files, completed_files, created_at, updated_at
             FROM projects ORDER BY updated_at DESC"
        ).map_err(|e| format!("Prepare failed: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok(crate::commands::project::Project {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                total_files: row.get(4)?,
                completed_files: row.get(5)?,
                created_by: None,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        }).map_err(|e| format!("Query failed: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Collect failed: {}", e))
    }

    pub fn get_project(&self, project_id: &str) -> Result<crate::commands::project::Project, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, name, description, status, total_files, completed_files, created_at, updated_at
             FROM projects WHERE id = ?1",
            params![project_id],
            |row| {
                Ok(crate::commands::project::Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    status: row.get(3)?,
                    total_files: row.get(4)?,
                    completed_files: row.get(5)?,
                    created_by: None,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        ).map_err(|e| format!("Get project failed: {}", e))
    }

    pub fn update_project_status(&self, project_id: &str, status: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE projects SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now, project_id],
        ).map_err(|e| format!("Update project status failed: {}", e))?;
        Ok(())
    }

    /// Hard-delete a project plus its `project_files` rows and any matching
    /// `uploads` records. Used by the "批次刪除" batch action.
    pub fn delete_project_cascade(&self, project_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Gather file ids so we can also wipe their matching `uploads` rows
        // (those share the same UUID as the primary key).
        let file_ids: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT id FROM project_files WHERE project_id = ?1")
                .map_err(|e| format!("Prepare failed: {}", e))?;
            let rows = stmt
                .query_map(params![project_id], |row| row.get::<_, String>(0))
                .map_err(|e| format!("Query failed: {}", e))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Collect failed: {}", e))?
        };
        for file_id in &file_ids {
            let _ = conn.execute("DELETE FROM uploads WHERE id = ?1", params![file_id]);
        }
        conn.execute(
            "DELETE FROM project_files WHERE project_id = ?1",
            params![project_id],
        )
        .map_err(|e| format!("Delete project_files failed: {}", e))?;
        conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])
            .map_err(|e| format!("Delete project failed: {}", e))?;
        Ok(())
    }

    pub fn increment_completed_files(&self, project_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE projects SET completed_files = completed_files + 1, updated_at = ?1 WHERE id = ?2",
            params![now, project_id],
        ).map_err(|e| format!("Increment completed failed: {}", e))?;
        Ok(())
    }

    // ── Project File methods ────────────────────────────────────

    pub fn insert_project_file(
        &self,
        pf: &crate::commands::project::ProjectFile,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO project_files
             (id, project_id, file_path, file_name, file_ext, file_size, file_type,
              processing_status, storage_path, thumbnail_path, immich_asset_id, metadata_json,
              ai_analysis, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                pf.id, pf.project_id, pf.file_path, pf.file_name, pf.file_ext,
                pf.file_size, pf.file_type, pf.processing_status,
                pf.storage_path, pf.thumbnail_path, pf.immich_asset_id, pf.metadata_json,
                pf.ai_analysis, now, now,
            ],
        ).map_err(|e| format!("Insert project_file failed: {}", e))?;
        Ok(())
    }

    pub fn list_project_files(
        &self,
        project_id: &str,
    ) -> Result<Vec<crate::commands::project::ProjectFile>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, project_id, file_path, file_name, file_ext, file_size, file_type,
                    processing_status, storage_path, thumbnail_path, immich_asset_id, metadata_json,
                    ai_analysis
             FROM project_files WHERE project_id = ?1 ORDER BY file_type, file_name"
        ).map_err(|e| format!("Prepare failed: {}", e))?;

        let rows = stmt.query_map(params![project_id], |row| {
            Ok(crate::commands::project::ProjectFile {
                id: row.get(0)?,
                project_id: row.get(1)?,
                file_path: row.get(2)?,
                file_name: row.get(3)?,
                file_ext: row.get(4)?,
                file_size: row.get(5)?,
                file_type: row.get(6)?,
                processing_status: row.get(7)?,
                storage_path: row.get(8)?,
                thumbnail_path: row.get(9)?,
                immich_asset_id: row.get(10)?,
                metadata_json: row.get(11)?,
                ai_analysis: row.get(12)?,
            })
        }).map_err(|e| format!("Query failed: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Collect failed: {}", e))
    }

    /// Persist the full VLM / metadata result for a processed file in one go.
    /// Called by `task_queue` once the Rust pipeline finishes the analysis
    /// stage. All fields are optional: pass `None` to leave that column
    /// untouched.
    pub fn update_file_analysis(
        &self,
        file_id: &str,
        metadata_json: Option<&str>,
        ai_analysis: Option<&str>,
        thumbnail_path: Option<&str>,
        processing_status: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE project_files
             SET metadata_json = COALESCE(?1, metadata_json),
                 ai_analysis   = COALESCE(?2, ai_analysis),
                 thumbnail_path = COALESCE(?3, thumbnail_path),
                 processing_status = COALESCE(?4, processing_status),
                 updated_at = ?5
             WHERE id = ?6",
            params![metadata_json, ai_analysis, thumbnail_path, processing_status, now, file_id],
        )
        .map_err(|e| format!("Update file analysis failed: {}", e))?;
        Ok(())
    }

    pub fn update_file_status(
        &self,
        file_id: &str,
        status: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE project_files SET processing_status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now, file_id],
        ).map_err(|e| format!("Update file status failed: {}", e))?;
        Ok(())
    }

    pub fn update_file_metadata(
        &self,
        file_id: &str,
        metadata_json: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE project_files SET metadata_json = ?1, updated_at = ?2 WHERE id = ?3",
            params![metadata_json, now, file_id],
        ).map_err(|e| format!("Update file metadata failed: {}", e))?;
        Ok(())
    }

    /// Read back the raw `metadata_json` blob for a file — used by the review
    /// edit flow to merge review fields (title / description / keywords /
    /// category) into the existing tech info (format / mode / width / dpi…)
    /// instead of replacing the blob wholesale.
    pub fn get_file_metadata_json(&self, file_id: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT metadata_json FROM project_files WHERE id = ?1",
            params![file_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => format!("file {} not found", file_id),
            other => format!("Read metadata_json failed: {}", other),
        })
    }

    pub fn update_file_immich(
        &self,
        file_id: &str,
        immich_asset_id: &str,
        thumbnail_path: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE project_files SET immich_asset_id = ?1, thumbnail_path = ?2, updated_at = ?3 WHERE id = ?4",
            params![immich_asset_id, thumbnail_path, now, file_id],
        ).map_err(|e| format!("Update file immich failed: {}", e))?;
        Ok(())
    }

    pub fn update_file_storage_path(
        &self,
        file_id: &str,
        storage_path: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE project_files SET storage_path = ?1, updated_at = ?2 WHERE id = ?3",
            params![storage_path, now, file_id],
        ).map_err(|e| format!("Update file storage_path failed: {}", e))?;
        Ok(())
    }
}
