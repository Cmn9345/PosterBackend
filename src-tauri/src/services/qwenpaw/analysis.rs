//! Poster analysis — local VLM inference via Ollama.
//!
//! Replaces the earlier frontend-WebGPU (transformers.js) dispatch path, which
//! silently killed the WKWebView WebContent process on macOS. Inference now
//! runs in a locally-installed Ollama instance (`qwen2.5vl:3b` by default),
//! keeping AI on-device while being packaging-friendly across platforms.
//!
//! The image bytes are already downloaded upstream by `task_queue`, so we
//! pass them straight into the VLM client — no URL round-trip, no signed URL
//! needed for analysis.

use image::{DynamicImage, GenericImageView};
use image::codecs::jpeg::JpegEncoder;
use log::{info, warn};
use serde::{Deserialize, Serialize};

use crate::services::qwenpaw::vlm_local;

/// Longest edge (in px) we downscale to before sending to the VLM. Qwen2-VL
/// tops out around 3.2 M pixels; 1536 keeps us comfortably inside that and
/// caps the image-token count at ~2 k, well under the `-c 16384` context
/// window even with a verbose system prompt.
const VLM_MAX_EDGE: u32 = 1536;
const VLM_JPEG_QUALITY: u8 = 88;

const THEME_LIST: &str =
    "朔源、慈善、醫療、教育、人文、環保、茹素護生、國際賑災、靜思語、大事記、法華坡道、年度主題";

pub fn build_prompt() -> String {
    format!(
        r#"你是海報資料庫的 AI 分析員，請仔細觀察這張海報圖片並產生結構化分析，以 JSON 回傳。

Schema：
{{
  "ocr_text": <string: 逐字抄錄海報上所有可見文字 — 含主標題、副標題、日期、時間、地點、主辦/協辦單位、聯絡資訊、口號、腳註。依照海報上的閱讀順序排列，用全形頓號或換行分隔>,
  "themes": <array of string: 從 [{themes}] 中選 1-3 個最相關主題>,
  "description": <string: 150-300 字的完整敘述。必須涵蓋以下面向（用自然語言整段寫，不要列點）：(1) 主視覺與核心訴求；(2) 主標題與重要文案；(3) 如果是活動海報，寫出活動名稱、時間、地點、主辦單位；(4) 人物、logo、插畫、背景等視覺元素；(5) 色彩基調與設計風格（例如「以藍綠為主調的扁平插畫風」）；(6) 推測的目標受眾與海報用途。整段文字要像專業的典藏描述，讓沒看到圖的人能清楚想像這張海報>,
  "language": <string: 海報使用的主要語言，例如「繁體中文」/「英文」/「中英雙語」/「繁體中文、英文」>,
  "has_logo": <bool: 是否含有清楚可辨識的組織標誌 / logo>,
  "has_person": <bool: 是否有人物照片或人物插圖出現在海報上>,
  "scores": {{
    "composition": <int 0-100: 構圖平衡、留白、視覺動線>,
    "clarity": <int 0-100: 文字易讀性、重點層級是否清楚>,
    "design_quality": <int 0-100: 字體 / 配色 / 插圖品質整體表現>,
    "content_completeness": <int 0-100: 活動資訊是否完整（時間、地點、聯絡方式）>,
    "typography": <int 0-100: 字體搭配、字級層次、排版節奏>
  }},
  "suggestions": <string: 80-150 字給審核員的改善或補充建議。若設計良好就寫出亮點；若有缺失就具體指出（例如「日期與地點字級偏小，建議放大 1.5 倍」「配色太跳，可將紅色降到 60% 飽和度」）>
}}

規則：
- 必須根據實際圖片內容填入真實資訊，不得照抄 schema 描述文字。
- 抓不到的欄位填空字串 "" 或空陣列 []；scores 仍須給數字（無法判斷時填 60）。
- description 至少 150 字；若資訊非常豐富可寫到 300 字。
- OCR 文字必須逐字保留，不要意譯或省略。
- scores 五個維度都要有數字，0-100。
- 只回傳 JSON，不要加任何 markdown 或註解。"#,
        themes = THEME_LIST
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiScores {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composition: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clarity: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub design_quality: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_completeness: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typography: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiAnalysis {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ocr_text: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub themes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_logo: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_person: Option<bool>,
    /// Five-dimension poster quality scores, 0–100 each.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scores: Option<AiScores>,
    /// Reviewer-facing improvement or highlight notes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggestions: Option<String>,
    /// Kept when the VLM reply could not be parsed as structured JSON.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Downscale (if needed) and re-encode an image so the VLM receives a
/// compact JPEG well inside its context budget. A 100 MB 8K PSD and a 1 MB
/// JPEG both come out looking like roughly-square 1536 px JPEGs here, which
/// keeps us far from llama.cpp's context-overflow cliff.
fn prepare_for_vlm(bytes: &[u8]) -> Option<Vec<u8>> {
    let img = image::load_from_memory(bytes).ok()?;
    let (w, h) = img.dimensions();
    let longest = w.max(h);
    let resized: DynamicImage = if longest > VLM_MAX_EDGE {
        img.resize(VLM_MAX_EDGE, VLM_MAX_EDGE, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let rgb = resized.to_rgb8();
    let mut out = Vec::with_capacity(256 * 1024);
    let mut encoder = JpegEncoder::new_with_quality(&mut out, VLM_JPEG_QUALITY);
    encoder.encode_image(&rgb).ok()?;
    Some(out)
}

/// Run local VLM inference on the given image bytes and return a parsed
/// `AiAnalysis`. Never returns an outer `Err` — transport or parse problems
/// are surfaced inside `AiAnalysis.error` so the pipeline can continue.
///
/// `vlm_base_url` is the sidecar endpoint (typically `http://127.0.0.1:18755`).
/// When `None`, the sidecar failed to start and VLM is skipped gracefully.
pub async fn request_analysis(
    file_id: &str,
    image_bytes: &[u8],
    filename: &str,
    vlm_base_url: Option<&str>,
) -> AiAnalysis {
    let Some(base_url) = vlm_base_url else {
        warn!("[Analysis] VLM sidecar not available — skipping {}", file_id);
        return AiAnalysis {
            error: Some("vlm_sidecar_unavailable".into()),
            ..Default::default()
        };
    };

    // Pre-shrink so an 80 MP poster doesn't turn into 35 k image tokens and
    // blow the context window. Falls back to the original bytes if decode
    // fails (e.g. PDF) — VLM may still handle it, or it'll error gracefully.
    let prepared = match prepare_for_vlm(image_bytes) {
        Some(b) => {
            info!(
                "[Analysis] prepared VLM input for {}: {} bytes → {} bytes (max edge {}px)",
                file_id,
                image_bytes.len(),
                b.len(),
                VLM_MAX_EDGE
            );
            b
        }
        None => {
            warn!(
                "[Analysis] image decode/resize failed for {}, sending original",
                file_id
            );
            image_bytes.to_vec()
        }
    };

    info!(
        "[Analysis] running local VLM for {} ({}, sending {} bytes)",
        file_id,
        filename,
        prepared.len()
    );

    let prompt = build_prompt();

    match vlm_local::analyze(base_url, &prepared, &prompt).await {
        Ok(value) => {
            match serde_json::from_value::<AiAnalysis>(value.clone()) {
                Ok(parsed) => parsed,
                Err(e) => {
                    warn!(
                        "[Analysis] parse AiAnalysis from VLM response failed ({}): {}",
                        file_id, e
                    );
                    AiAnalysis {
                        raw_text: Some(value.to_string()),
                        error: Some("unexpected_shape".into()),
                        ..Default::default()
                    }
                }
            }
        }
        Err(e) => {
            warn!("[Analysis] local VLM failed for {}: {}", file_id, e);
            AiAnalysis {
                error: Some(e),
                ..Default::default()
            }
        }
    }
}
