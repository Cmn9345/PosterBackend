use log::{info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Supabase client for Rust backend operations
pub struct SupabaseClient {
    client: Client,
    url: String,
    anon_key: String,
    service_key: Option<String>,
    /// Shared authenticated-user JWT. When present and populated, requests go
    /// out as the logged-in user instead of anon — critical for RLS policies
    /// that gate on `auth.uid()` (creator-owns-row, authenticated-only write
    /// on Storage buckets, etc.). Populated by `AuthState` on login; read
    /// under the RwLock per request so a fresh refresh token propagates
    /// without reconstructing the client.
    user_token: Option<Arc<RwLock<Option<String>>>>,
    /// Cached default `vocabulary_items.id` used as `posters.item_type_id`.
    /// Only a `Some(id)` result is cached — a miss (table empty / RLS block /
    /// network error) is retried on every call so that seeding `vocabulary_
    /// items` while the app is running takes effect without a restart.
    default_item_type_id: RwLock<Option<String>>,
}

impl SupabaseClient {
    pub fn new(url: &str, anon_key: &str) -> Self {
        Self {
            client: Client::new(),
            url: url.to_string(),
            anon_key: anon_key.to_string(),
            service_key: None,
            user_token: None,
            default_item_type_id: RwLock::new(None),
        }
    }

    pub fn with_service_key(mut self, key: &str) -> Self {
        self.service_key = Some(key.to_string());
        self
    }

    /// Wire a shared authenticated-user JWT store into the client. Must be
    /// called at setup before the client is put behind `Arc` — mutates self.
    /// The returned builder fits the rest of the chain pattern.
    pub fn with_user_token_store(mut self, store: Arc<RwLock<Option<String>>>) -> Self {
        self.user_token = Some(store);
        self
    }

    /// Pick the best available token for an outgoing request. Priority:
    ///   1. Authenticated user JWT (if store wired and populated) — satisfies
    ///      RLS policies keyed off `auth.uid()` / `authenticated` role.
    ///   2. Service-role key (if set) — bypasses RLS. Rarely configured.
    ///   3. Anon key — baseline read access under `anon` role.
    async fn bearer_key(&self) -> String {
        if let Some(store) = &self.user_token {
            if let Some(tok) = store.read().await.clone() {
                if !tok.is_empty() {
                    return tok;
                }
            }
        }
        self.service_key
            .clone()
            .unwrap_or_else(|| self.anon_key.clone())
    }

    /// Lazily fetch a default `vocabulary_items.id` to satisfy the
    /// `posters.item_type_id` FK. Returns `None` when the table is empty or
    /// unreachable — caller should then skip the Supabase insert.
    ///
    /// The `Some(id)` result is memoized so subsequent inserts don't re-probe.
    /// A `None` result is *not* cached: if the table was empty when the app
    /// first queried and is later seeded, the next submit will discover the
    /// fresh id without needing an app restart.
    pub async fn resolve_default_item_type_id(&self) -> Option<String> {
        if let Some(id) = self.default_item_type_id.read().await.clone() {
            return Some(id);
        }
        let url = format!(
            "{}/rest/v1/vocabulary_items?select=id&limit=1",
            self.url
        );
        let key = self.bearer_key().await;
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            warn!(
                "[Supabase] vocabulary_items probe returned {}",
                resp.status()
            );
            return None;
        }
        let rows: Vec<serde_json::Value> = resp.json().await.ok()?;
        let id = rows
            .first()
            .and_then(|r| r.get("id"))
            .and_then(|v| v.as_str())
            .map(String::from);
        match id {
            Some(v) => {
                *self.default_item_type_id.write().await = Some(v.clone());
                Some(v)
            }
            None => {
                warn!(
                    "[Supabase] vocabulary_items is empty — posters insert will retry next time"
                );
                None
            }
        }
    }

    /// Upload a file to Supabase Storage
    pub async fn upload_to_storage(
        &self,
        bucket: &str,
        path: &str,
        data: Vec<u8>,
        content_type: &str,
    ) -> Result<String, String> {
        let url = format!("{}/storage/v1/object/{}/{}", self.url, bucket, path);
        let key = self.bearer_key().await;

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", content_type)
            .body(data)
            .send()
            .await
            .map_err(|e| format!("Upload failed: {}", e))?;

        if response.status().is_success() {
            Ok(format!("{}/storage/v1/object/public/{}/{}", self.url, bucket, path))
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(format!("Upload failed ({}): {}", status, body))
        }
    }

    /// Query Supabase REST API
    pub async fn query(
        &self,
        table: &str,
        params: &str,
    ) -> Result<String, String> {
        let url = format!("{}/rest/v1/{}?{}", self.url, table, params);
        let key = self.bearer_key().await;

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("Query failed: {}", e))?;

        response
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))
    }

    /// Insert a `poster_files` row. Maps our internal `file_ext` onto the
    /// production enum `public.file_type` (one of `psd | ai | pdf | png | jpg`).
    /// Defaults `access_level = unrestricted` and `download_filename_type = original`;
    /// these are required NOT NULL enum columns in the target schema.
    pub async fn insert_poster_file(
        &self,
        file_id: &str,
        poster_id: &str,
        original_filename: &str,
        file_ext: &str,
        file_size: u64,
        storage_path: &str,
    ) -> Result<(), String> {
        let url = format!("{}/rest/v1/poster_files", self.url);
        let key = self.bearer_key().await;

        let system_filename = storage_path
            .rsplit('/')
            .next()
            .unwrap_or(storage_path)
            .to_string();

        let file_type_enum = match file_ext.to_lowercase().as_str() {
            "psd" => "psd",
            "ai" => "ai",
            "pdf" => "pdf",
            "png" => "png",
            "jpg" | "jpeg" => "jpg",
            other => {
                warn!(
                    "[Supabase] file_ext '{}' is not in the poster_files.file_type enum (psd/ai/pdf/png/jpg) — skipping Supabase insert for {}",
                    other, file_id
                );
                return Err(format!("unsupported file_type for Supabase schema: {}", other));
            }
        };

        let body = json!({
            "id": file_id,
            "poster_id": poster_id,
            "original_filename": original_filename,
            "system_filename": system_filename,
            "file_type": file_type_enum,
            "file_size": file_size,
            "storage_path": storage_path,
            "access_level": "unrestricted",
            "download_filename_type": "original",
            "processing_status": "uploaded",
        });

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Insert poster_file failed: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 201 {
            info!("[Supabase] Inserted poster_file: {}", file_id);
            Ok(())
        } else {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            Err(format!("Insert poster_file failed ({}): {}", status, text))
        }
    }

    // ── Project API ────────────────────────────────────────────

    /// Insert a new `posters` row aligned with the production schema.
    ///
    /// Required columns filled in: `poster_id` (human-readable short id),
    /// `project_name`, `exhibition_date_start` (today as a safe default when
    /// the UI hasn't collected one), `exhibition_date_mode` (`permanent` until
    /// the UI distinguishes single/range/permanent), `creator_id` (authed
    /// user's uuid), `item_type_id` (first row of `vocabulary_items`), `status`.
    ///
    /// Returns Ok(()) on 2xx. When `item_type_id` cannot be resolved — because
    /// `vocabulary_items` is empty — the insert is skipped with an Err so the
    /// caller can fall back to local-only storage.
    pub async fn insert_project(
        &self,
        project_id: &str,
        project_name: &str,
        public_note: Option<&str>,
        creator_id: Option<&str>,
        exhibition_date_start: Option<&str>,
        exhibition_date_end: Option<&str>,
        exhibition_date_mode: Option<&str>,
    ) -> Result<(), String> {
        let creator_id = match creator_id {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => return Err("insert_project skipped: creator_id (auth user) missing".into()),
        };

        let item_type_id = match self.resolve_default_item_type_id().await {
            Some(id) => id,
            None => {
                return Err(
                    "insert_project skipped: vocabulary_items empty (FK unsatisfiable)".into(),
                )
            }
        };

        // Short, human-readable identifier the reviewer sees in the UI.
        let short_suffix: String = project_id.chars().take(8).collect();
        let poster_id_human = format!(
            "P-{}-{}",
            chrono::Utc::now().format("%Y%m%d"),
            short_suffix
        );

        let start = exhibition_date_start
            .map(|s| s.to_string())
            .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());
        let mode = exhibition_date_mode.unwrap_or("permanent");

        let mut body = json!({
            "id": project_id,
            "poster_id": poster_id_human,
            "project_name": project_name,
            "exhibition_date_start": start,
            "exhibition_date_mode": mode,
            "creator_id": creator_id,
            "item_type_id": item_type_id,
            "status": "draft",
        });
        if let Some(end) = exhibition_date_end {
            body["exhibition_date_end"] = json!(end);
        }
        if let Some(note) = public_note {
            body["public_note"] = json!(note);
        }

        let url = format!("{}/rest/v1/posters", self.url);
        let key = self.bearer_key().await;
        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Insert project failed: {}", e))?;

        if resp.status().is_success() || resp.status().as_u16() == 201 {
            info!(
                "[Supabase] Inserted project {} (poster_id={})",
                project_id, poster_id_human
            );
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Insert project failed ({}): {}", status, text))
        }
    }

    /// DELETE a single object from a Storage bucket.
    pub async fn delete_from_storage(
        &self,
        bucket: &str,
        path: &str,
    ) -> Result<(), String> {
        let url = format!("{}/storage/v1/object/{}/{}", self.url, bucket, path);
        let key = self.bearer_key().await;
        let resp = self
            .client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("Storage delete failed: {}", e))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(format!(
                "Storage delete {}/{} -> {}",
                bucket,
                path,
                resp.status()
            ))
        }
    }

    /// Check whether a Storage object exists at `bucket/path`. HEAD on the
    /// public endpoint returns 200 on hit, 400/404 on miss. Used by the
    /// submit-for-review thumbnail regen step to skip already-uploaded paths.
    pub async fn row_exists_in_storage(
        &self,
        bucket: &str,
        path: &str,
    ) -> Result<bool, String> {
        let url = format!("{}/storage/v1/object/{}/{}", self.url, bucket, path);
        let key = self.bearer_key().await;
        let resp = self
            .client
            .head(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("storage HEAD failed: {}", e))?;
        Ok(resp.status().is_success())
    }

    /// Check whether a row with the given id exists in `table`. Used by the
    /// submit-for-review flow to decide whether we need to re-insert a
    /// `posters` / `poster_files` row that earlier calls logged-and-dropped
    /// (vocab seed missing, RLS block, transient error, etc.).
    ///
    /// Returns `Ok(true)` on 200 with at least one row, `Ok(false)` on 200
    /// with zero rows, `Err` on transport / auth failure so the caller can
    /// surface a real message to the user.
    pub async fn row_exists(&self, table: &str, id: &str) -> Result<bool, String> {
        let url = format!(
            "{}/rest/v1/{}?id=eq.{}&select=id&limit=1",
            self.url, table, id
        );
        let key = self.bearer_key().await;
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("row_exists probe failed: {}", e))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!(
                "row_exists {}/{} probe -> {}: {}",
                table, id, status, text
            ));
        }
        let rows: Vec<serde_json::Value> =
            resp.json().await.map_err(|e| format!("row_exists parse: {}", e))?;
        Ok(!rows.is_empty())
    }

    /// DELETE a `posters` row by id. FK cascade is expected to drop the
    /// matching `poster_files` rows server-side.
    pub async fn delete_project(&self, project_id: &str) -> Result<(), String> {
        let url = format!("{}/rest/v1/posters?id=eq.{}", self.url, project_id);
        let key = self.bearer_key().await;
        let resp = self
            .client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Prefer", "return=minimal")
            .send()
            .await
            .map_err(|e| format!("Delete project failed: {}", e))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Delete project failed ({}): {}", status, text))
        }
    }

    /// Update project status.
    pub async fn update_project_status(
        &self,
        project_id: &str,
        status: &str,
    ) -> Result<(), String> {
        let url = format!(
            "{}/rest/v1/posters?id=eq.{}",
            self.url, project_id
        );
        let key = self.bearer_key().await;

        let body = json!({
            "status": status,
            "updated_at": chrono::Utc::now().to_rfc3339(),
        });

        let resp = self.client
            .patch(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Update project status failed: {}", e))?;

        if resp.status().is_success() {
            info!("[Supabase] Updated project {} → {}", project_id, status);
            Ok(())
        } else {
            let status_code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Update project status failed ({}): {}", status_code, text))
        }
    }

    /// Update `poster_files` processing status (+ optionally Immich asset id).
    ///
    /// The production schema does not expose `metadata_json` / `thumbnail_path`
    /// columns — technical metadata (EXIF / DPI / dimensions) and local
    /// thumbnail path live only in our SQLite mirror. This method is pared
    /// down to the columns that actually exist upstream.
    pub async fn update_file_metadata(
        &self,
        file_id: &str,
        _unused_metadata_json: &str,
        immich_asset_id: Option<&str>,
        _unused_thumbnail_path: Option<&str>,
        processing_status: &str,
    ) -> Result<(), String> {
        let url = format!(
            "{}/rest/v1/poster_files?id=eq.{}",
            self.url, file_id
        );
        let key = self.bearer_key().await;

        let mut body = json!({
            "processing_status": processing_status,
            "updated_at": chrono::Utc::now().to_rfc3339(),
        });
        if let Some(asset_id) = immich_asset_id {
            body["immich_asset_id"] = json!(asset_id);
        }

        let resp = self.client
            .patch(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Update file metadata failed: {}", e))?;

        if resp.status().is_success() {
            info!("[Supabase] Updated file metadata: {}", file_id);
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Update file metadata failed ({}): {}", status, text))
        }
    }

    // ── Review API ────────────────────────────────────────────

    /// Submit a review decision to Supabase.
    pub async fn submit_review(
        &self,
        project_id: &str,
        decision: &str,
        reviewer_notes: Option<&str>,
        rejection_reason: Option<&str>,
    ) -> Result<(), String> {
        let url = format!("{}/rest/v1/poster_reviews", self.url);
        let key = self.bearer_key().await;

        let body = json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "project_id": project_id,
            "decision": decision,
            "reviewer_notes": reviewer_notes,
            "rejection_reason": rejection_reason,
            "created_at": chrono::Utc::now().to_rfc3339(),
        });

        let resp = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Submit review failed: {}", e))?;

        if resp.status().is_success() || resp.status().as_u16() == 201 {
            info!("[Supabase] Review submitted: {} → {}", project_id, decision);
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Submit review failed ({}): {}", status, text))
        }
    }

    /// Upload thumbnail to Supabase Storage.
    pub async fn upload_thumbnail(
        &self,
        project_id: &str,
        filename: &str,
        data: Vec<u8>,
    ) -> Result<String, String> {
        let path = format!("{}/{}_thumb.jpg", project_id, filename);
        self.upload_to_storage("poster-thumbnails", &path, data, "image/jpeg")
            .await
    }

    /// Write a new `app_role` value onto `public.users.{user_id}`. Used by
    /// the Permission Management modal. Requires the currently-authenticated
    /// user to satisfy the `users_admin_update` RLS policy (i.e. they must
    /// already have `app_role = '系統管理員'`).
    pub async fn update_user_role(
        &self,
        user_id: &str,
        role: &str,
    ) -> Result<(), String> {
        let url = format!("{}/rest/v1/users?id=eq.{}", self.url, user_id);
        let key = self.bearer_key().await;
        let body = serde_json::json!({
            "app_role": role,
            "updated_at": chrono::Utc::now().to_rfc3339(),
        });
        let resp = self
            .client
            .patch(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("update_user_role failed: {}", e))?;
        if resp.status().is_success() {
            info!("[Supabase] user {} app_role → {}", user_id, role);
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("更新 app_role 失敗（{}）：{}", status, text))
        }
    }

    /// Generic PATCH for a single `poster_files` row. Used by the submit-for-
    /// review flow to reconcile Supabase with locally-computed pipeline
    /// results (description / people_summary / poster_size) after the row is
    /// ensured to exist — PATCHes that ran earlier during the pipeline ran
    /// against a non-existent row and were silently 0-rows-affected.
    pub async fn patch_poster_file(
        &self,
        file_id: &str,
        body: serde_json::Value,
    ) -> Result<(), String> {
        if !body.is_object() || body.as_object().map(|m| m.is_empty()).unwrap_or(true) {
            return Ok(());
        }
        let url = format!("{}/rest/v1/poster_files?id=eq.{}", self.url, file_id);
        let key = self.bearer_key().await;
        let resp = self
            .client
            .patch(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("patch_poster_file failed: {}", e))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("patch_poster_file {}: {}", status, text))
        }
    }

    /// Persist the VLM result onto the columns the production `poster_files`
    /// schema actually exposes:
    ///   - `description`      ← AI caption (the reviewer's "圖說")
    ///   - `people_summary`   ← one-liner when `has_person` is true
    ///   - `themes`           ← text[] of theme strings for dashboard Top 10
    /// The full structured JSON (OCR, scores, suggestions, etc.) is kept in
    /// the local DB so the Edit page can still render it.
    pub async fn update_file_ai_analysis(
        &self,
        file_id: &str,
        analysis: &serde_json::Value,
    ) -> Result<(), String> {
        let url = format!("{}/rest/v1/poster_files?id=eq.{}", self.url, file_id);
        let key = self.bearer_key().await;

        let mut body = json!({
            "updated_at": chrono::Utc::now().to_rfc3339(),
        });
        if let Some(desc) = analysis.get("description").and_then(|v| v.as_str()) {
            body["description"] = json!(desc);
        }
        let has_person = analysis
            .get("has_person")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if has_person {
            body["people_summary"] = json!("海報含人物（由 AI 偵測）");
        }
        // Themes: store as Postgres text[] so the dashboard can aggregate
        // TOP-N across all users without re-parsing local JSON. Filters out
        // empty / null entries before serialising.
        if let Some(themes) = analysis.get("themes").and_then(|v| v.as_array()) {
            let clean: Vec<String> = themes
                .iter()
                .filter_map(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().to_string())
                .collect();
            if !clean.is_empty() {
                body["themes"] = json!(clean);
            }
        }

        let resp = self
            .client
            .patch(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Update ai_analysis failed: {}", e))?;

        if resp.status().is_success() {
            info!("[Supabase] Updated description/people_summary: {}", file_id);
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Update ai_analysis failed ({}): {}", status, text))
        }
    }

    /// Request a signed URL the frontend can fetch directly (needed for WebGPU
    /// VLM inference on the uploaded image).
    pub async fn create_signed_url(
        &self,
        bucket: &str,
        path: &str,
        expires_in_secs: u64,
    ) -> Result<String, String> {
        let url = format!(
            "{}/storage/v1/object/sign/{}/{}",
            self.url, bucket, path
        );
        let key = self.bearer_key().await;

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .body(json!({ "expiresIn": expires_in_secs }).to_string())
            .send()
            .await
            .map_err(|e| format!("Sign URL failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Sign URL failed ({}): {}", status, body));
        }

        let v: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Sign URL parse: {}", e))?;
        let signed = v
            .get("signedURL")
            .or_else(|| v.get("signedUrl"))
            .and_then(|s| s.as_str())
            .ok_or_else(|| "Sign URL response missing signedURL".to_string())?;

        // Supabase returns a relative path — prepend storage base.
        let full = if signed.starts_with("http") {
            signed.to_string()
        } else {
            format!("{}/storage/v1{}", self.url, signed)
        };
        Ok(full)
    }

    // ── Exhibitions API ────────────────────────────────────────────

    /// Insert a new `exhibitions` row. Aligns with the production schema:
    ///   - status enum: planning | ongoing | finished
    ///   - cover_image_path: text/URL pointing at the cover image
    ///   - sort_order: int, smaller = earlier in the frontend list
    ///   - start_date / end_date: ISO date strings (YYYY-MM-DD); end_date NULL = 常設
    ///   - location: 展出地點純文字
    /// Returns the created row (with server-generated id / timestamps) so the
    /// frontend can splice it into its list without a re-fetch round trip.
    pub async fn insert_exhibition(
        &self,
        name: &str,
        description: Option<&str>,
        cover_image_path: Option<&str>,
        sort_order: Option<i32>,
        status: &str,
        start_date: Option<&str>,
        end_date: Option<&str>,
        location: Option<&str>,
    ) -> Result<String, String> {
        let url = format!("{}/rest/v1/exhibitions", self.url);
        let key = self.bearer_key().await;

        let mut body = json!({
            "name": name,
            "status": status,
        });
        if let Some(d) = description.filter(|s| !s.is_empty()) {
            body["description"] = json!(d);
        }
        if let Some(p) = cover_image_path.filter(|s| !s.is_empty()) {
            body["cover_image_path"] = json!(p);
        }
        if let Some(o) = sort_order {
            body["sort_order"] = json!(o);
        }
        if let Some(s) = start_date.filter(|s| !s.is_empty()) {
            body["start_date"] = json!(s);
        }
        if let Some(e) = end_date.filter(|s| !s.is_empty()) {
            body["end_date"] = json!(e);
        }
        if let Some(l) = location.filter(|s| !s.is_empty()) {
            body["location"] = json!(l);
        }

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            // Return the inserted row so the frontend can update its list.
            .header("Prefer", "return=representation")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Insert exhibition failed: {}", e))?;

        if resp.status().is_success() || resp.status().as_u16() == 201 {
            let text = resp.text().await.unwrap_or_default();
            info!("[Supabase] Inserted exhibition: {}", name);
            Ok(text)
        } else {
            let status_code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Insert exhibition failed ({}): {}", status_code, text))
        }
    }

    /// PATCH a single `exhibitions` row. Only the fields actually passed are
    /// updated — `None` means "leave as-is". Empty strings clear the column
    /// (sent as JSON null). `updated_at` is maintained by the table trigger so
    /// we don't need to send it.
    pub async fn update_exhibition(
        &self,
        exhibition_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        cover_image_path: Option<&str>,
        sort_order: Option<i32>,
        status: Option<&str>,
        start_date: Option<&str>,
        end_date: Option<&str>,
        location: Option<&str>,
    ) -> Result<(), String> {
        let mut body = serde_json::Map::new();
        if let Some(n) = name {
            body.insert("name".into(), json!(n));
        }
        if let Some(d) = description {
            body.insert("description".into(), if d.is_empty() { json!(null) } else { json!(d) });
        }
        if let Some(p) = cover_image_path {
            body.insert("cover_image_path".into(), if p.is_empty() { json!(null) } else { json!(p) });
        }
        if let Some(o) = sort_order {
            body.insert("sort_order".into(), json!(o));
        }
        if let Some(s) = status {
            body.insert("status".into(), json!(s));
        }
        if let Some(s) = start_date {
            body.insert("start_date".into(), if s.is_empty() { json!(null) } else { json!(s) });
        }
        if let Some(e) = end_date {
            body.insert("end_date".into(), if e.is_empty() { json!(null) } else { json!(e) });
        }
        if let Some(l) = location {
            body.insert("location".into(), if l.is_empty() { json!(null) } else { json!(l) });
        }
        if body.is_empty() {
            return Ok(());
        }

        let url = format!("{}/rest/v1/exhibitions?id=eq.{}", self.url, exhibition_id);
        let key = self.bearer_key().await;
        let resp = self
            .client
            .patch(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .body(serde_json::Value::Object(body).to_string())
            .send()
            .await
            .map_err(|e| format!("Update exhibition failed: {}", e))?;

        if resp.status().is_success() {
            info!("[Supabase] Updated exhibition: {}", exhibition_id);
            Ok(())
        } else {
            let status_code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Update exhibition failed ({}): {}", status_code, text))
        }
    }

    /// DELETE an `exhibitions` row by id.
    pub async fn delete_exhibition(&self, exhibition_id: &str) -> Result<(), String> {
        let url = format!("{}/rest/v1/exhibitions?id=eq.{}", self.url, exhibition_id);
        let key = self.bearer_key().await;
        let resp = self
            .client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Prefer", "return=minimal")
            .send()
            .await
            .map_err(|e| format!("Delete exhibition failed: {}", e))?;
        if resp.status().is_success() {
            info!("[Supabase] Deleted exhibition: {}", exhibition_id);
            Ok(())
        } else {
            let status_code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Delete exhibition failed ({}): {}", status_code, text))
        }
    }

    /// List posters attached to an exhibition with sort_order, joined with
    /// `posters.project_name/status` and the first `poster_files.id` for
    /// client-side thumbnail path construction (production schema has no
    /// `thumbnail_path` column — see comment at `update_file_metadata`; the
    /// canonical Rust naming convention `{poster_id}/{file_id}_m.webp` is
    /// rebuilt on the frontend and signed via `sign_thumbnail_url`).
    /// Returns raw JSON text so the Tauri command can pipe it through unchanged.
    ///
    /// PostgREST request:
    ///   GET /rest/v1/exhibition_posters
    ///     ?exhibition_id=eq.{id}
    ///     &select=poster_id,sort_order,posters(id,project_name,status,poster_files(id))
    ///     &order=sort_order.asc
    pub async fn list_exhibition_posters(
        &self,
        exhibition_id: &str,
    ) -> Result<String, String> {
        let url = format!(
            "{}/rest/v1/exhibition_posters?exhibition_id=eq.{}\
             &select=poster_id,sort_order,posters(id,project_name,status,poster_files(id))\
             &order=sort_order.asc",
            self.url, exhibition_id
        );
        let key = self.bearer_key().await;
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("List exhibition_posters failed: {}", e))?;

        if resp.status().is_success() {
            info!("[Supabase] Listed exhibition_posters: {}", exhibition_id);
            resp.text()
                .await
                .map_err(|e| format!("Read list_exhibition_posters body failed: {}", e))
        } else {
            let status_code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("List exhibition_posters failed ({}): {}", status_code, text))
        }
    }

    /// List posters available for attaching to an exhibition. Filtered by
    /// status (typically `published`). Optionally narrowed by
    /// project_name substring search. Returns at most 200 rows.
    ///
    /// The select fetches the first `poster_files.id` for client-side
    /// thumbnail path construction (production schema has no
    /// `thumbnail_path` column — see comment at `update_file_metadata`;
    /// frontend rebuilds `{poster_id}/{file_id}_m.webp` and signs via
    /// `sign_thumbnail_url`).
    ///
    /// PostgREST request:
    ///   GET /rest/v1/posters
    ///     ?status=in.(published)
    ///     &select=id,project_name,status,poster_files(id)
    ///     &order=updated_at.desc
    ///     &limit=200
    ///   (+ project_name=ilike.*search* when search provided)
    pub async fn list_posters_for_picker(
        &self,
        status_filter: &[String],
        search: Option<&str>,
    ) -> Result<String, String> {
        let statuses = if status_filter.is_empty() {
            // poster_status enum has no `approved` — `published` is the only "live"
            // state (see commands/review.rs APPROVED_STATUS for context).
            "published".to_string()
        } else {
            status_filter.join(",")
        };
        let mut url = format!(
            "{}/rest/v1/posters?status=in.({})\
             &select=id,project_name,status,poster_files(id)\
             &order=updated_at.desc&limit=200",
            self.url, statuses
        );
        if let Some(q) = search.filter(|s| !s.is_empty()) {
            // PostgREST `ilike` operator with `*` wildcards. URL-encode user input.
            url.push_str(&format!(
                "&project_name=ilike.*{}*",
                urlencoding::encode(q)
            ));
        }
        let key = self.bearer_key().await;
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("List posters for picker failed: {}", e))?;

        if resp.status().is_success() {
            info!("[Supabase] Listed posters for picker (statuses={})", statuses);
            resp.text()
                .await
                .map_err(|e| format!("Read picker body failed: {}", e))
        } else {
            let status_code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("List posters for picker failed ({}): {}", status_code, text))
        }
    }

    /// Bulk-attach posters to an exhibition. `sort_order` for new rows starts
    /// from `MAX(existing sort_order) + 1` so they land at the end.
    /// Returns the count of rows actually inserted (already-attached posters
    /// are silently skipped via `Prefer: resolution=ignore-duplicates`).
    pub async fn attach_posters_to_exhibition(
        &self,
        exhibition_id: &str,
        poster_ids: &[String],
    ) -> Result<usize, String> {
        if poster_ids.is_empty() {
            return Ok(0);
        }

        // Step 1: discover current max sort_order for this exhibition.
        let probe_url = format!(
            "{}/rest/v1/exhibition_posters?exhibition_id=eq.{}\
             &select=sort_order&order=sort_order.desc&limit=1",
            self.url, exhibition_id
        );
        let key = self.bearer_key().await;
        let probe = self
            .client
            .get(&probe_url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("Probe sort_order failed: {}", e))?;
        let probe_body = probe.text().await.unwrap_or_default();
        let probe_json: serde_json::Value =
            serde_json::from_str(&probe_body).unwrap_or(json!([]));
        let base: i64 = probe_json
            .as_array()
            .and_then(|a| a.first())
            .and_then(|o| o.get("sort_order"))
            .and_then(|v| v.as_i64())
            .unwrap_or(-1);

        // Step 2: build rows.
        let rows: Vec<serde_json::Value> = poster_ids
            .iter()
            .enumerate()
            .map(|(i, pid)| {
                json!({
                    "exhibition_id": exhibition_id,
                    "poster_id": pid,
                    "sort_order": base + (i as i64) + 1,
                })
            })
            .collect();

        // Step 3: bulk insert with ignore-duplicates so PK conflicts are silent.
        let insert_url = format!("{}/rest/v1/exhibition_posters", self.url);
        let resp = self
            .client
            .post(&insert_url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=ignore-duplicates,return=representation")
            .body(serde_json::Value::Array(rows).to_string())
            .send()
            .await
            .map_err(|e| format!("Attach posters failed: {}", e))?;

        if resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            let arr: serde_json::Value = serde_json::from_str(&text).unwrap_or(json!([]));
            let inserted = arr.as_array().map(|a| a.len()).unwrap_or(0);
            info!(
                "[Supabase] Attached {} posters to exhibition {} ({} skipped as duplicates)",
                inserted,
                exhibition_id,
                poster_ids.len() - inserted
            );
            Ok(inserted)
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Attach posters failed ({}): {}", status, text))
        }
    }

    /// Remove a single poster from an exhibition. Idempotent — deleting a
    /// non-existent (exhibition_id, poster_id) pair returns Ok(()), not an error.
    pub async fn detach_poster_from_exhibition(
        &self,
        exhibition_id: &str,
        poster_id: &str,
    ) -> Result<(), String> {
        let url = format!(
            "{}/rest/v1/exhibition_posters?exhibition_id=eq.{}&poster_id=eq.{}",
            self.url, exhibition_id, poster_id
        );
        let key = self.bearer_key().await;
        let resp = self
            .client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Prefer", "return=minimal")
            .send()
            .await
            .map_err(|e| format!("Detach poster failed: {}", e))?;
        if resp.status().is_success() {
            info!(
                "[Supabase] Detached poster {} from exhibition {}",
                poster_id, exhibition_id
            );
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Detach poster failed ({}): {}", status, text))
        }
    }

    /// Rewrite the sort_order of every poster attached to an exhibition.
    /// The input array's index becomes the new sort_order (0-based).
    ///
    /// Validates that the input ids match exactly the currently-attached set —
    /// adding or dropping posters here is rejected with 400 to keep semantics
    /// clean (use attach/detach for that).
    ///
    /// PostgREST UPSERT: POST with `Prefer: resolution=merge-duplicates` on the
    /// composite PK (exhibition_id, poster_id) → existing rows get sort_order
    /// updated, no-op for unchanged rows.
    pub async fn reorder_exhibition_posters(
        &self,
        exhibition_id: &str,
        ordered_poster_ids: &[String],
    ) -> Result<(), String> {
        if ordered_poster_ids.is_empty() {
            return Ok(());
        }

        // Validate: input ids must equal currently-attached set.
        let probe_url = format!(
            "{}/rest/v1/exhibition_posters?exhibition_id=eq.{}&select=poster_id",
            self.url, exhibition_id
        );
        let key = self.bearer_key().await;
        let probe = self
            .client
            .get(&probe_url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("Probe reorder set failed: {}", e))?;
        let probe_text = probe.text().await.unwrap_or_default();
        let existing: Vec<String> = serde_json::from_str::<serde_json::Value>(&probe_text)
            .ok()
            .and_then(|v| v.as_array().cloned())
            .map(|arr| {
                arr.into_iter()
                    .filter_map(|o| o.get("poster_id").and_then(|s| s.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let mut input_sorted: Vec<&String> = ordered_poster_ids.iter().collect();
        input_sorted.sort();
        let mut existing_sorted: Vec<&String> = existing.iter().collect();
        existing_sorted.sort();
        if input_sorted != existing_sorted {
            return Err(format!(
                "Reorder mismatch: input has {} ids, exhibition has {} attached",
                ordered_poster_ids.len(),
                existing.len()
            ));
        }

        // Build upsert payload.
        let rows: Vec<serde_json::Value> = ordered_poster_ids
            .iter()
            .enumerate()
            .map(|(i, pid)| {
                json!({
                    "exhibition_id": exhibition_id,
                    "poster_id": pid,
                    "sort_order": i as i32,
                })
            })
            .collect();

        let url = format!("{}/rest/v1/exhibition_posters", self.url);
        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates,return=minimal")
            .body(serde_json::Value::Array(rows).to_string())
            .send()
            .await
            .map_err(|e| format!("Reorder failed: {}", e))?;

        if resp.status().is_success() {
            info!(
                "[Supabase] Reordered {} posters for exhibition {}",
                ordered_poster_ids.len(),
                exhibition_id
            );
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("Reorder failed ({}): {}", status, text))
        }
    }

    /// Fetch the active theme names (ordered by `sort_order`) for VLM prompt
    /// injection. Returns `Err` on any HTTP / parsing failure so the caller can
    /// fall back to a hardcoded list.
    pub async fn list_active_theme_names(&self) -> Result<Vec<String>, String> {
        let url = format!(
            "{}/rest/v1/vocabulary_themes?is_active=eq.true&select=name&order=sort_order.asc",
            self.url
        );
        let key = self.bearer_key().await;
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("list_active_theme_names HTTP failed: {}", e))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("list_active_theme_names ({}): {}", status, text));
        }
        let body = resp
            .text()
            .await
            .map_err(|e| format!("read body failed: {}", e))?;
        #[derive(serde::Deserialize)]
        struct Row {
            name: String,
        }
        let rows: Vec<Row> = serde_json::from_str(&body)
            .map_err(|e| format!("parse failed: {}", e))?;
        Ok(rows.into_iter().map(|r| r.name).collect())
    }

    /// List all vocabulary_themes including inactive ones — for the admin
    /// management page. Returns raw JSON to keep the Tauri command thin.
    pub async fn list_vocabulary_themes_admin(&self) -> Result<String, String> {
        let url = format!(
            "{}/rest/v1/vocabulary_themes?select=*&order=sort_order.asc",
            self.url
        );
        let key = self.bearer_key().await;
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("list_vocabulary_themes_admin failed: {}", e))?;
        if resp.status().is_success() {
            resp.text()
                .await
                .map_err(|e| format!("read body failed: {}", e))
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("list_vocabulary_themes_admin ({}): {}", status, text))
        }
    }

    /// Download raw bytes from Supabase Storage — needed by qwenpaw worker
    /// to pull the uploaded original before running metadata/thumbnail pipeline.
    pub async fn download_from_storage(
        &self,
        bucket: &str,
        path: &str,
    ) -> Result<Vec<u8>, String> {
        let url = format!("{}/storage/v1/object/{}/{}", self.url, bucket, path);
        let key = self.bearer_key().await;

        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .send()
            .await
            .map_err(|e| format!("Download failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Download failed ({}): {}", status, body));
        }

        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| format!("Read body failed: {}", e))
    }
}
