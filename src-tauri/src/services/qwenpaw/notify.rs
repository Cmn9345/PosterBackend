//! Notification router — OS notification + frontend event emit.
//!
//! Ported from: `3in1media-copaw-webgpu/backend/skills/poster_notify/skill.py`
//!
//! Replaces the original WebSocket `broadcast`/`send_to` with:
//!   - `tauri::AppHandle::emit("qwenpaw-notification", ...)` → React listeners
//!   - `tauri_plugin_notification` → OS-native notification
//!
//! Since the admin app is single-user, `target_user_id` routing is collapsed to a
//! single emit (the currently logged-in user is always the audience).

#![allow(dead_code)]

use log::info;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PosterNotification {
    pub title: String,
    pub body: String,
    pub action_url: Option<String>,
    pub priority: Option<String>,
    pub application_id: Option<String>,
    pub poster_id: Option<String>,
    pub status: Option<String>,
}

/// application_status → (title, body template)
fn app_status_copy(status: &str) -> (&'static str, &'static str) {
    match status {
        "pending" => ("新申請單", "等待您的審核"),
        "in_review" => ("申請已接單", "審核中"),
        "approved" => ("申請已核可", "可前往下載檔案"),
        "rejected" => ("申請已駁回", "請查看駁回原因"),
        "awaiting_closure" => ("待結案", "請完成結案流程"),
        _ => ("狀態更新", "申請單狀態已變更"),
    }
}

/// poster_status → (title, body template)
fn poster_status_copy(status: &str) -> (&'static str, &'static str) {
    match status {
        "pending_review" => ("新海報待審核", "請前往審核"),
        "approved" => ("海報已核可", "正在同步至 Immich"),
        "rejected" => ("海報已駁回", "請修改後重新提交"),
        "published" => ("海報已上架", "前台已可瀏覽"),
        _ => ("海報狀態更新", "海報狀態已變更"),
    }
}

pub struct NotifyService<'a> {
    app: &'a AppHandle,
}

impl<'a> NotifyService<'a> {
    pub fn new(app: &'a AppHandle) -> Self {
        Self { app }
    }

    /// Emit to frontend + show OS notification.
    pub fn push(&self, notif: PosterNotification) {
        let _ = self.app.emit("qwenpaw-notification", &notif);
        let _ = self
            .app
            .notification()
            .builder()
            .title(&notif.title)
            .body(&notif.body)
            .show();
        info!("[Notify] {} — {}", notif.title, notif.body);
    }

    /// Application status change (e.g. "pending" → review queue).
    pub fn notify_app_status(
        &self,
        application_id: &str,
        application_number: &str,
        status: &str,
    ) {
        let (title, body_tmpl) = app_status_copy(status);
        self.push(PosterNotification {
            title: title.to_string(),
            body: format!("{} {}", application_number, body_tmpl),
            action_url: Some(format!("/applications/{}", application_number)),
            application_id: Some(application_id.to_string()),
            status: Some(status.to_string()),
            priority: Some(
                if matches!(status, "pending" | "rejected") {
                    "high"
                } else {
                    "normal"
                }
                .to_string(),
            ),
            poster_id: None,
        });
    }

    /// Poster status change (e.g. approved/rejected/published).
    pub fn notify_poster_status(&self, poster_id: &str, status: &str, reason: Option<&str>) {
        let (title, body_tmpl) = poster_status_copy(status);
        let body = match reason {
            Some(r) if !r.is_empty() => format!("{}：{}", body_tmpl, r),
            _ => body_tmpl.to_string(),
        };
        self.push(PosterNotification {
            title: title.to_string(),
            body,
            action_url: Some(format!("/posters/{}", poster_id)),
            poster_id: Some(poster_id.to_string()),
            status: Some(status.to_string()),
            priority: Some(if status == "rejected" { "high" } else { "normal" }.to_string()),
            application_id: None,
        });
    }

    /// Processing-complete notification for the uploader.
    pub fn notify_processing_complete(&self, poster_id: &str, filename: &str) {
        self.push(PosterNotification {
            title: "海報處理完成".to_string(),
            body: format!("{} 縮圖與分析已完成，請確認 metadata", filename),
            action_url: Some(format!("/posters/{}", poster_id)),
            poster_id: Some(poster_id.to_string()),
            status: None,
            priority: Some("normal".to_string()),
            application_id: None,
        });
    }
}
