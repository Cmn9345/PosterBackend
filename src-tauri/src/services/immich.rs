// src-tauri/src/services/immich.rs
//! Immich API client for poster asset management.
//! Maps to architecture: Supabase ↔ 同步 ↔ Immich → 前端

use log::{info, error};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImmichAsset {
    pub id: String,
    #[serde(rename = "originalFileName")]
    pub original_file_name: Option<String>,
    #[serde(rename = "thumbhash")]
    pub thumbhash: Option<String>,
    #[serde(rename = "type")]
    pub asset_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImmichAlbum {
    pub id: String,
    #[serde(rename = "albumName")]
    pub album_name: String,
    #[serde(rename = "assetCount")]
    pub asset_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImmichSearchResult {
    pub assets: ImmichSearchAssets,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImmichSearchAssets {
    pub total: u32,
    pub items: Vec<ImmichAsset>,
}

pub struct ImmichClient {
    client: Client,
    base_url: String,
    api_key: String,
}

impl ImmichClient {
    pub fn new(base_url: &str, api_key: &str) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("Failed to create Immich HTTP client"),
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
        }
    }

    /// Upload a file to Immich. Returns the asset ID.
    pub async fn upload_asset(
        &self,
        file_data: Vec<u8>,
        filename: &str,
        content_type: &str,
    ) -> Result<String, String> {
        let url = format!("{}/api/assets", self.base_url);

        let file_part = reqwest::multipart::Part::bytes(file_data)
            .file_name(filename.to_string())
            .mime_str(content_type)
            .map_err(|e| format!("MIME parse error: {}", e))?;

        let form = reqwest::multipart::Form::new()
            .part("assetData", file_part)
            .text("deviceAssetId", format!("poster-{}", uuid::Uuid::new_v4()))
            .text("deviceId", "poster-admin-app")
            .text("fileCreatedAt", chrono::Utc::now().to_rfc3339())
            .text("fileModifiedAt", chrono::Utc::now().to_rfc3339());

        let resp = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Immich upload failed: {}", e))?;

        if resp.status().is_success() || resp.status().as_u16() == 201 {
            let body: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Parse Immich response failed: {}", e))?;
            let asset_id = body["id"]
                .as_str()
                .ok_or("No id in Immich upload response")?
                .to_string();
            info!("[Immich] Uploaded asset: {}", asset_id);
            Ok(asset_id)
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!("Immich upload failed ({}): {}", status, body))
        }
    }

    /// Update asset metadata (description, tags, etc.)
    pub async fn update_asset_metadata(
        &self,
        asset_id: &str,
        description: Option<&str>,
    ) -> Result<(), String> {
        let url = format!("{}/api/assets/{}", self.base_url, asset_id);

        let mut body = serde_json::Map::new();
        if let Some(desc) = description {
            body.insert(
                "description".to_string(),
                serde_json::Value::String(desc.to_string()),
            );
        }

        let resp = self
            .client
            .put(&url)
            .header("x-api-key", &self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Immich update metadata failed: {}", e))?;

        if resp.status().is_success() {
            info!("[Immich] Updated metadata for asset: {}", asset_id);
            Ok(())
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!(
                "Immich update metadata failed ({}): {}",
                status, body
            ))
        }
    }

    /// Create an album in Immich.
    pub async fn create_album(&self, album_name: &str) -> Result<ImmichAlbum, String> {
        let url = format!("{}/api/albums", self.base_url);

        let body = serde_json::json!({
            "albumName": album_name,
        });

        let resp = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Immich create album failed: {}", e))?;

        if resp.status().is_success() || resp.status().as_u16() == 201 {
            let album: ImmichAlbum = resp
                .json()
                .await
                .map_err(|e| format!("Parse album response: {}", e))?;
            info!("[Immich] Created album: {} ({})", album.album_name, album.id);
            Ok(album)
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!("Immich create album failed ({}): {}", status, body))
        }
    }

    /// Add assets to an album.
    pub async fn add_assets_to_album(
        &self,
        album_id: &str,
        asset_ids: &[String],
    ) -> Result<(), String> {
        let url = format!("{}/api/albums/{}/assets", self.base_url, album_id);

        let body = serde_json::json!({
            "ids": asset_ids,
        });

        let resp = self
            .client
            .put(&url)
            .header("x-api-key", &self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Immich add to album failed: {}", e))?;

        if resp.status().is_success() {
            info!(
                "[Immich] Added {} assets to album {}",
                asset_ids.len(),
                album_id
            );
            Ok(())
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!(
                "Immich add to album failed ({}): {}",
                status, body
            ))
        }
    }

    /// List all albums.
    pub async fn list_albums(&self) -> Result<Vec<ImmichAlbum>, String> {
        let url = format!("{}/api/albums", self.base_url);

        let resp = self
            .client
            .get(&url)
            .header("x-api-key", &self.api_key)
            .send()
            .await
            .map_err(|e| format!("Immich list albums failed: {}", e))?;

        if resp.status().is_success() {
            resp.json()
                .await
                .map_err(|e| format!("Parse albums response: {}", e))
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!("Immich list albums failed ({}): {}", status, body))
        }
    }

    /// Get asset info by ID.
    pub async fn get_asset(&self, asset_id: &str) -> Result<serde_json::Value, String> {
        let url = format!("{}/api/assets/{}", self.base_url, asset_id);

        let resp = self
            .client
            .get(&url)
            .header("x-api-key", &self.api_key)
            .send()
            .await
            .map_err(|e| format!("Immich get asset failed: {}", e))?;

        if resp.status().is_success() {
            resp.json()
                .await
                .map_err(|e| format!("Parse asset response: {}", e))
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!("Immich get asset failed ({}): {}", status, body))
        }
    }

    /// Get thumbnail URL for an asset.
    pub fn get_thumbnail_url(&self, asset_id: &str) -> String {
        format!(
            "{}/api/assets/{}/thumbnail",
            self.base_url, asset_id
        )
    }

    /// Download asset thumbnail bytes.
    pub async fn download_thumbnail(&self, asset_id: &str) -> Result<Vec<u8>, String> {
        let url = self.get_thumbnail_url(asset_id);

        let resp = self
            .client
            .get(&url)
            .header("x-api-key", &self.api_key)
            .send()
            .await
            .map_err(|e| format!("Immich thumbnail download failed: {}", e))?;

        if resp.status().is_success() {
            resp.bytes()
                .await
                .map(|b| b.to_vec())
                .map_err(|e| format!("Read thumbnail bytes: {}", e))
        } else {
            Err(format!("Thumbnail download failed: {}", resp.status()))
        }
    }

    /// Sync a project's approved files to Immich.
    /// 1. Upload each file as an asset
    /// 2. Find or create album by project name
    /// 3. Add all assets to album
    /// Returns list of (file_id, immich_asset_id) pairs.
    pub async fn sync_project(
        &self,
        project_name: &str,
        files: Vec<(String, Vec<u8>, String, String)>, // (file_id, data, filename, content_type)
    ) -> Result<Vec<(String, String)>, String> {
        // Find or create album
        let albums = self.list_albums().await.unwrap_or_default();
        let album = match albums.iter().find(|a| a.album_name == project_name) {
            Some(existing) => existing.clone(),
            None => self.create_album(project_name).await?,
        };

        let mut results: Vec<(String, String)> = Vec::new();
        let mut asset_ids: Vec<String> = Vec::new();

        for (file_id, data, filename, content_type) in files {
            match self.upload_asset(data, &filename, &content_type).await {
                Ok(asset_id) => {
                    asset_ids.push(asset_id.clone());
                    results.push((file_id, asset_id));
                }
                Err(e) => {
                    error!("[Immich] Failed to upload {}: {}", filename, e);
                }
            }
        }

        // Add all uploaded assets to album
        if !asset_ids.is_empty() {
            if let Err(e) = self.add_assets_to_album(&album.id, &asset_ids).await {
                error!("[Immich] Failed to add assets to album: {}", e);
            }
        }

        info!(
            "[Immich] Synced {} files to album '{}'",
            results.len(),
            project_name
        );
        Ok(results)
    }
}
