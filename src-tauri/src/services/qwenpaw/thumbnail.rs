//! Thumbnail generation — S/M/L WebP renders from original image bytes.
//!
//! Ported from: `3in1media-copaw-webgpu/backend/skills/poster_thumbnail/skill.py`
//!
//! PSD/AI/PDF support deferred (original Python uses psd_tools / PyMuPDF — no clean
//! Rust equivalents yet). For those types, the worker should skip gracefully.

#![allow(dead_code)]

use image::{imageops::FilterType, DynamicImage, ImageFormat};
use log::{info, warn};

#[derive(Debug, Clone, Copy)]
pub struct ThumbnailSizes {
    pub s: u32,
    pub m: u32,
    pub l: u32,
}

impl ThumbnailSizes {
    pub fn from_env() -> Self {
        let raw = std::env::var("POSTER_THUMBNAIL_SIZES")
            .unwrap_or_else(|_| "200,600,1200".to_string());
        let parts: Vec<u32> = raw.split(',').filter_map(|s| s.trim().parse().ok()).collect();
        if parts.len() == 3 {
            Self { s: parts[0], m: parts[1], l: parts[2] }
        } else {
            Self::default()
        }
    }
}

impl Default for ThumbnailSizes {
    fn default() -> Self {
        Self { s: 200, m: 600, l: 1200 }
    }
}

pub struct Thumbnail {
    pub size_key: &'static str,
    pub webp_bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Decode arbitrary image bytes into a DynamicImage. Returns `None` for unsupported
/// formats (PSD/AI/PDF) — caller should log + skip.
pub fn decode(bytes: &[u8], file_type: &str) -> Option<DynamicImage> {
    let ext = file_type.trim_start_matches('.').to_ascii_lowercase();
    let fmt = match ext.as_str() {
        "png" => Some(ImageFormat::Png),
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "webp" => Some(ImageFormat::WebP),
        "gif" => Some(ImageFormat::Gif),
        "bmp" => Some(ImageFormat::Bmp),
        "tif" | "tiff" => Some(ImageFormat::Tiff),
        "psd" | "ai" | "pdf" => {
            warn!("[Thumbnail] Format {} not supported yet (requires psd/pdf decoder)", ext);
            return None;
        }
        _ => None,
    };

    let result = match fmt {
        Some(f) => image::load_from_memory_with_format(bytes, f),
        None => image::load_from_memory(bytes),
    };

    match result {
        Ok(img) => Some(img),
        Err(e) => {
            warn!("[Thumbnail] Decode failed: {}", e);
            None
        }
    }
}

/// Scale image so the longer edge == `max_px`. Uses Lanczos3 for quality.
pub fn resize_longest_edge(img: &DynamicImage, max_px: u32) -> DynamicImage {
    let (w, h) = (img.width(), img.height());
    let (new_w, new_h) = if w >= h {
        (max_px, (h as f32 * max_px as f32 / w as f32).round() as u32)
    } else {
        ((w as f32 * max_px as f32 / h as f32).round() as u32, max_px)
    };
    img.resize(new_w.max(1), new_h.max(1), FilterType::Lanczos3)
}

/// Encode image to WebP bytes at the given quality (0–100).
pub fn encode_webp(img: &DynamicImage, quality: f32) -> Result<Vec<u8>, String> {
    let rgba = img.to_rgba8();
    let encoder = webp::Encoder::from_rgba(&rgba, rgba.width(), rgba.height());
    let memory = encoder.encode(quality);
    Ok(memory.to_vec())
}

/// Generate S/M/L thumbnails in one pass.
pub fn generate_all(img: &DynamicImage, sizes: ThumbnailSizes, quality: f32) -> Vec<Thumbnail> {
    let plan = [("s", sizes.s), ("m", sizes.m), ("l", sizes.l)];
    plan.iter()
        .filter_map(|(key, px)| {
            let thumb = resize_longest_edge(img, *px);
            let w = thumb.width();
            let h = thumb.height();
            match encode_webp(&thumb, quality) {
                Ok(bytes) => {
                    info!("[Thumbnail] {} → {}x{} ({} KB)", key, w, h, bytes.len() / 1024);
                    Some(Thumbnail { size_key: key, webp_bytes: bytes, width: w, height: h })
                }
                Err(e) => {
                    warn!("[Thumbnail] encode {} failed: {}", key, e);
                    None
                }
            }
        })
        .collect()
}

/// Convenience: decode + generate all thumbnails in one step.
pub fn from_bytes(bytes: &[u8], file_type: &str, sizes: ThumbnailSizes) -> Option<Vec<Thumbnail>> {
    let img = decode(bytes, file_type)?;
    Some(generate_all(&img, sizes, 85.0))
}

/// Storage path convention matches the Python version: `{poster_id}/{file_id}_{size}.webp`.
pub fn storage_path(poster_id: &str, file_id: &str, size_key: &str) -> String {
    format!("{}/{}_{}.webp", poster_id, file_id, size_key)
}
