//! Poster & file status state machine.
//!
//! Ported from: `3in1media-copaw-webgpu/backend/skills/poster_status/skill.py`
//!
//! State flow:
//!   uploaded → processing → metadata_ready → completed
//!              → (reviewed) → syncing → synced → poster: published
//!              → failed / rejected (terminal)

#![allow(dead_code)]

use crate::services::supabase::SupabaseClient;
use log::info;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileStatus {
    Uploaded,
    Processing,
    MetadataReady,
    AnalysisSkipped,
    Completed,
    Syncing,
    Synced,
    SyncFailed,
    Failed,
    Rejected,
}

impl FileStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            FileStatus::Uploaded => "uploaded",
            FileStatus::Processing => "processing",
            FileStatus::MetadataReady => "metadata_ready",
            FileStatus::AnalysisSkipped => "analysis_skipped",
            FileStatus::Completed => "completed",
            FileStatus::Syncing => "syncing",
            FileStatus::Synced => "synced",
            FileStatus::SyncFailed => "sync_failed",
            FileStatus::Failed => "failed",
            FileStatus::Rejected => "rejected",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PosterStatus {
    Draft,
    Uploading,
    Processing,
    PendingReview,
    Approved,
    Rejected,
    Published,
    Archived,
}

impl PosterStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            PosterStatus::Draft => "draft",
            PosterStatus::Uploading => "uploading",
            PosterStatus::Processing => "processing",
            PosterStatus::PendingReview => "pending_review",
            PosterStatus::Approved => "approved",
            PosterStatus::Rejected => "rejected",
            PosterStatus::Published => "published",
            PosterStatus::Archived => "archived",
        }
    }
}

pub struct StatusService {
    supabase: Arc<SupabaseClient>,
}

impl StatusService {
    pub fn new(supabase: Arc<SupabaseClient>) -> Self {
        Self { supabase }
    }

    pub async fn set_file_status(&self, file_id: &str, status: FileStatus) -> Result<(), String> {
        let path = format!("poster_files?id=eq.{}", file_id);
        let body = format!(r#"{{"processing_status":"{}"}}"#, status.as_str());
        self.supabase.query(&path, &body).await?;
        info!("[Status] file {} → {}", file_id, status.as_str());
        Ok(())
    }

    pub async fn set_poster_status(
        &self,
        poster_id: &str,
        status: PosterStatus,
    ) -> Result<(), String> {
        let path = format!("posters?id=eq.{}", poster_id);
        let body = format!(r#"{{"status":"{}"}}"#, status.as_str());
        self.supabase.query(&path, &body).await?;
        info!("[Status] poster {} → {}", poster_id, status.as_str());
        Ok(())
    }

    /// Mark file completed; if every file in the poster is completed, bump poster to pending_review.
    pub async fn mark_file_completed(
        &self,
        file_id: &str,
        poster_id: &str,
    ) -> Result<(), String> {
        self.set_file_status(file_id, FileStatus::Completed).await?;
        if self.all_files_in_state(poster_id, FileStatus::Completed).await? {
            self.set_poster_status(poster_id, PosterStatus::PendingReview).await?;
        }
        Ok(())
    }

    /// Mark file synced; if every file is synced, publish poster.
    pub async fn mark_file_synced(&self, file_id: &str, poster_id: &str) -> Result<(), String> {
        self.set_file_status(file_id, FileStatus::Synced).await?;
        if self.all_files_in_state(poster_id, FileStatus::Synced).await? {
            self.set_poster_status(poster_id, PosterStatus::Published).await?;
        }
        Ok(())
    }

    async fn all_files_in_state(
        &self,
        poster_id: &str,
        target: FileStatus,
    ) -> Result<bool, String> {
        // TODO(Sprint 2): needs proper count query helper in supabase.rs.
        // Current `query()` is a generic REST passthrough; implement COUNT via
        // `poster_files?poster_id=eq.X&processing_status=neq.<target>&select=id&limit=1`.
        let path = format!(
            "poster_files?poster_id=eq.{}&processing_status=neq.{}&select=id&limit=1",
            poster_id,
            target.as_str()
        );
        let resp = self.supabase.query(&path, "").await?;
        Ok(resp.trim() == "[]" || resp.trim().is_empty())
    }
}
