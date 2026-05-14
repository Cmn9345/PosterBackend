// src-tauri/src/commands/application.rs
//! 申請單審核（applications）workflow commands.
//!
//! The frontend's poster review (`submit_review` / projects/posters) and
//! application review (this file / applications table) are deliberately
//! kept separate — they touch different tables, have different status
//! enums, and only the poster path syncs to Immich. Mixing them in
//! `review.rs` previously caused a silent no-op when the admin clicked
//! 接單處理 on an application (the PATCH hit `posters?id=eq.{appUuid}`,
//! matched 0 rows, and returned Ok). See git history for the regression.

use crate::commands::upload::UploadState;
use log::info;
use serde::{Deserialize, Serialize};
use tauri::command;

/// One-shot payload for status-only transitions. The frontend collects the
/// rejection_reason / reviewer_notes from prompts before invoking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicationStatusUpdate {
    pub application_id: String,
    /// Target status — one of: in_review, approved, rejected, awaiting_closure.
    pub status: String,
    pub reviewer_notes: Option<String>,
    pub rejection_reason: Option<String>,
}

/// PATCH applications.status (+ optional reviewer_notes / rejection_reason).
/// Returns an error if the row doesn't exist or the status string is invalid.
#[command]
pub async fn update_application_status(
    state: tauri::State<'_, UploadState>,
    payload: ApplicationStatusUpdate,
) -> Result<(), String> {
    // Accept both "closure" (frontend) and "awaiting_closure" (notify.rs / DB
     // canonical) — frontend AppStatus type uses the short form. Aligning the
     // two is tracked in known-followups but doesn't block this fix.
    const ALLOWED: &[&str] = &[
        "pending",
        "in_review",
        "approved",
        "rejected",
        "closure",
        "awaiting_closure",
    ];
    if !ALLOWED.contains(&payload.status.as_str()) {
        return Err(format!(
            "Invalid application status '{}'. Allowed: {:?}",
            payload.status, ALLOWED
        ));
    }

    info!(
        "[Application] {} → {}",
        payload.application_id, payload.status
    );

    state
        .supabase_client
        .update_application_status(
            &payload.application_id,
            &payload.status,
            payload.reviewer_notes.as_deref(),
            payload.rejection_reason.as_deref(),
        )
        .await
}
