// src-tauri/src/services/tus.rs
//! TUS (resumable upload) protocol client for Supabase Storage.
//! Implements: POST (create) + PATCH (upload chunk) + HEAD (check offset).
//! Reference: https://tus.io/protocols/resumable-upload

use log::{info, warn};
use reqwest::Client;
use std::time::Duration;

const CHUNK_SIZE: u64 = 6 * 1024 * 1024; // 6MB
const MAX_RETRIES: u32 = 3;
const RETRY_DELAYS: [u64; 3] = [3, 6, 12]; // exponential backoff

pub struct TusClient {
    client: Client,
    supabase_url: String,
    bucket: String,
    api_key: String,
    auth_token: String,
}

#[derive(Debug)]
pub struct TusUploadResult {
    pub storage_path: String,
    pub tus_url: String,
}

impl TusClient {
    pub fn new(supabase_url: &str, bucket: &str, api_key: &str, auth_token: &str) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("Failed to create HTTP client"),
            supabase_url: supabase_url.to_string(),
            bucket: bucket.to_string(),
            api_key: api_key.to_string(),
            auth_token: auth_token.to_string(),
        }
    }

    /// Create a TUS upload session. Returns the TUS upload URL.
    pub async fn create_upload(
        &self,
        storage_path: &str,
        total_bytes: u64,
        content_type: &str,
    ) -> Result<String, String> {
        let url = format!(
            "{}/storage/v1/upload/resumable",
            self.supabase_url
        );

        let resp = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.auth_token))
            .header("apikey", &self.api_key)
            .header("Tus-Resumable", "1.0.0")
            .header("Upload-Length", total_bytes.to_string())
            .header("Upload-Metadata", format!(
                "bucketName {},objectName {},contentType {}",
                base64_encode(&self.bucket),
                base64_encode(storage_path),
                base64_encode(content_type),
            ))
            .send()
            .await
            .map_err(|e| format!("TUS create failed: {}", e))?;

        if resp.status().is_success() || resp.status().as_u16() == 201 {
            let location = resp
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
                .ok_or("No Location header in TUS response")?;
            let normalized = normalize_tus_location(&self.supabase_url, &location);
            if normalized != location {
                info!("[TUS] Created upload: {} (normalized from {})", normalized, location);
            } else {
                info!("[TUS] Created upload: {}", normalized);
            }
            Ok(normalized)
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!("TUS create failed ({}): {}", status, body))
        }
    }

    /// Check current offset via HEAD request. Used for resume.
    pub async fn get_offset(&self, tus_url: &str) -> Result<u64, String> {
        let resp = self.client
            .head(tus_url)
            .header("Authorization", format!("Bearer {}", self.auth_token))
            .header("apikey", &self.api_key)
            .header("Tus-Resumable", "1.0.0")
            .send()
            .await
            .map_err(|e| format!("TUS HEAD failed: {}", e))?;

        if resp.status().is_success() {
            let offset = resp
                .headers()
                .get("upload-offset")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            Ok(offset)
        } else {
            Err(format!("TUS HEAD failed: {}", resp.status()))
        }
    }

    /// Upload a single chunk via PATCH. Returns new offset.
    pub async fn upload_chunk(
        &self,
        tus_url: &str,
        data: &[u8],
        offset: u64,
    ) -> Result<u64, String> {
        let mut last_err = String::new();

        for attempt in 0..MAX_RETRIES {
            let result = self.client
                .patch(tus_url)
                .header("Authorization", format!("Bearer {}", self.auth_token))
                .header("apikey", &self.api_key)
                .header("Tus-Resumable", "1.0.0")
                .header("Upload-Offset", offset.to_string())
                .header("Content-Type", "application/offset+octet-stream")
                .body(data.to_vec())
                .send()
                .await;

            match result {
                Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 204 => {
                    let new_offset = resp
                        .headers()
                        .get("upload-offset")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| s.parse::<u64>().ok())
                        .unwrap_or(offset + data.len() as u64);
                    return Ok(new_offset);
                }
                Ok(resp) => {
                    last_err = format!("HTTP {}", resp.status());
                }
                Err(e) => {
                    last_err = e.to_string();
                }
            }

            if attempt < MAX_RETRIES - 1 {
                let delay = RETRY_DELAYS[attempt as usize];
                warn!("[TUS] Chunk retry {}/{} in {}s: {}", attempt + 1, MAX_RETRIES, delay, last_err);
                tokio::time::sleep(Duration::from_secs(delay)).await;
            }
        }

        Err(format!("TUS chunk failed after {} retries: {}", MAX_RETRIES, last_err))
    }

    pub fn chunk_size(&self) -> u64 {
        CHUNK_SIZE
    }

    /// Apply the same URL normalization we do on freshly-created sessions to
    /// a cached `tus_url`. Useful when resuming an upload whose URL was saved
    /// before this fix landed.
    pub fn normalize_cached_url(&self, tus_url: &str) -> String {
        normalize_tus_location(&self.supabase_url, tus_url)
    }
}

fn base64_encode(s: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
}

/// Fix up the `Location` header returned by Supabase Storage's TUS endpoint.
///
/// Self-hosted Supabase Storage commonly returns an internal URL with a
/// concatenation glitch like:
///
/// ```text
/// http://ptsupabase.tzuchi-org.tw:8000/storage/v1//upload/resumable/<id>
/// ```
///
/// Two issues there:
///   1. Host/scheme points at the internal Storage service (port 8000, HTTP)
///      instead of the public reverse-proxy URL we originally POSTed to.
///   2. `/storage/v1/` + `/upload/resumable/...` collide into `//`.
///
/// Rewriting strategy: pull the `/upload/resumable/<id>` tail out of whatever
/// host we got, and rebuild against the caller's own `supabase_url` (the URL
/// we've already proved works because we just POSTed to it).
fn normalize_tus_location(supabase_url: &str, location: &str) -> String {
    let base = supabase_url.trim_end_matches('/');
    if let Some(idx) = location.find("/upload/resumable/") {
        let tail = &location[idx..];
        return format!("{}/storage/v1{}", base, tail);
    }
    // Fallback: collapse the `//` only, keep the original host (unlikely path).
    location.replacen("/storage/v1//upload", "/storage/v1/upload", 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_rewrites_internal_host_and_double_slash() {
        let out = normalize_tus_location(
            "https://ptsupabase.tzuchi-org.tw",
            "http://ptsupabase.tzuchi-org.tw:8000/storage/v1//upload/resumable/abc123",
        );
        assert_eq!(
            out,
            "https://ptsupabase.tzuchi-org.tw/storage/v1/upload/resumable/abc123"
        );
    }

    #[test]
    fn normalize_preserves_well_formed_url() {
        let out = normalize_tus_location(
            "https://ptsupabase.tzuchi-org.tw",
            "https://ptsupabase.tzuchi-org.tw/storage/v1/upload/resumable/xyz",
        );
        assert_eq!(
            out,
            "https://ptsupabase.tzuchi-org.tw/storage/v1/upload/resumable/xyz"
        );
    }

    #[test]
    fn normalize_trims_trailing_slash_on_supabase_url() {
        let out = normalize_tus_location(
            "https://ptsupabase.tzuchi-org.tw/",
            "http://internal:8000/storage/v1//upload/resumable/abc",
        );
        assert_eq!(
            out,
            "https://ptsupabase.tzuchi-org.tw/storage/v1/upload/resumable/abc"
        );
    }
}
