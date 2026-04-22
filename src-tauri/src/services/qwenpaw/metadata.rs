//! Technical metadata extraction — dimensions, DPI, EXIF, format.
//!
//! Ported from: `3in1media-copaw-webgpu/backend/skills/poster_metadata/skill.py`
//!
//! PSD/PDF metadata extraction deferred (needs psd_tools / pymupdf equivalent).

#![allow(dead_code)]

use exif::{In, Reader, Tag};
use image::GenericImageView;
use log::warn;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::io::Cursor;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PosterMetadata {
    pub format: Option<String>,
    pub mode: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub dpi_x: Option<u32>,
    pub dpi_y: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exif: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Default for PosterMetadata {
    fn default() -> Self {
        Self {
            format: None,
            mode: None,
            width: None,
            height: None,
            dpi_x: None,
            dpi_y: None,
            exif: None,
            note: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtractorType {
    Image,
    Psd,
    Pdf,
    Ai,
    Unknown,
}

pub fn classify(filename: &str) -> ExtractorType {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tiff" | "tif" => ExtractorType::Image,
        "psd" => ExtractorType::Psd,
        "pdf" => ExtractorType::Pdf,
        "ai" => ExtractorType::Ai,
        _ => ExtractorType::Unknown,
    }
}

pub fn extract(bytes: &[u8], filename: &str) -> PosterMetadata {
    match classify(filename) {
        ExtractorType::Image => extract_image(bytes),
        ExtractorType::Psd => PosterMetadata {
            format: Some("PSD".to_string()),
            error: Some("PSD extraction not implemented (Sprint 4)".to_string()),
            ..Default::default()
        },
        ExtractorType::Pdf => PosterMetadata {
            format: Some("PDF".to_string()),
            error: Some("PDF extraction not implemented (Sprint 4)".to_string()),
            ..Default::default()
        },
        ExtractorType::Ai => PosterMetadata {
            format: Some("Adobe Illustrator".to_string()),
            note: Some("AI metadata limited without Illustrator".to_string()),
            ..Default::default()
        },
        ExtractorType::Unknown => PosterMetadata {
            error: Some(format!("Unknown format: {}", filename)),
            ..Default::default()
        },
    }
}

fn extract_image(bytes: &[u8]) -> PosterMetadata {
    let mut meta = PosterMetadata::default();

    match image::load_from_memory(bytes) {
        Ok(img) => {
            let (w, h) = img.dimensions();
            meta.width = Some(w);
            meta.height = Some(h);
            meta.mode = Some(color_mode_name(&img));
        }
        Err(e) => {
            warn!("[Metadata] image decode failed: {}", e);
            meta.error = Some(format!("image decode failed: {}", e));
        }
    }

    if let Ok(format) = image::guess_format(bytes) {
        meta.format = Some(format!("{:?}", format).to_uppercase());
    }

    // EXIF: extracted separately; not every image (e.g. PNG) carries EXIF but JPG/TIFF do.
    if let Some((exif_json, dpi_x, dpi_y)) = extract_exif(bytes) {
        if meta.dpi_x.is_none() {
            meta.dpi_x = dpi_x;
        }
        if meta.dpi_y.is_none() {
            meta.dpi_y = dpi_y;
        }
        if !exif_json.is_empty() {
            meta.exif = Some(Value::Object(exif_json));
        }
    }

    meta
}

fn color_mode_name(img: &image::DynamicImage) -> String {
    use image::DynamicImage::*;
    match img {
        ImageLuma8(_) => "L".into(),
        ImageLumaA8(_) => "LA".into(),
        ImageRgb8(_) => "RGB".into(),
        ImageRgba8(_) => "RGBA".into(),
        ImageLuma16(_) => "L16".into(),
        ImageLumaA16(_) => "LA16".into(),
        ImageRgb16(_) => "RGB16".into(),
        ImageRgba16(_) => "RGBA16".into(),
        ImageRgb32F(_) => "RGB32F".into(),
        ImageRgba32F(_) => "RGBA32F".into(),
        _ => "UNKNOWN".into(),
    }
}

/// Returns (exif_json_object, dpi_x, dpi_y) if EXIF present.
fn extract_exif(bytes: &[u8]) -> Option<(Map<String, Value>, Option<u32>, Option<u32>)> {
    let exif_reader = Reader::new();
    let mut cursor = Cursor::new(bytes);
    let exif = exif_reader.read_from_container(&mut cursor).ok()?;

    let mut obj = Map::new();
    let mut dpi_x: Option<u32> = None;
    let mut dpi_y: Option<u32> = None;

    for f in exif.fields() {
        if f.ifd_num != In::PRIMARY {
            continue;
        }
        let name = format!("{}", f.tag);
        let display = f.display_value().with_unit(&exif).to_string();

        if f.tag == Tag::XResolution {
            dpi_x = display.split_whitespace().next().and_then(|s| s.parse::<f64>().ok()).map(|v| v as u32);
        } else if f.tag == Tag::YResolution {
            dpi_y = display.split_whitespace().next().and_then(|s| s.parse::<f64>().ok()).map(|v| v as u32);
        }

        // Keep entries small — skip ones longer than 256 chars.
        if display.len() < 256 {
            obj.insert(name, Value::String(display));
        }
    }

    Some((obj, dpi_x, dpi_y))
}
