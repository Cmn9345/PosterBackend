//! Local VLM inference via the bundled llama-server sidecar.
//!
//! Posts an image + prompt to `llama-server`'s OpenAI-compatible chat endpoint
//! (`POST /v1/chat/completions`) and parses the structured response. The
//! subprocess is started at app boot by `llama_sidecar::start`; here we only
//! talk HTTP.
//!
//! Request shape: an image is passed as a base64 data URL in a `content`
//! array, matching OpenAI's vision API (which llama-server implements when
//! run with `--mmproj`). `response_format: {type: "json_object"}` forces the
//! model to emit valid JSON.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const INFERENCE_TIMEOUT_SECS: u64 = 180;

#[derive(Debug, Deserialize)]
struct ChatCompletion {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ChoiceMessage,
}

#[derive(Debug, Deserialize)]
struct ChoiceMessage {
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<MsgOut<'a>>,
    temperature: f32,
    max_tokens: u32,
    stream: bool,
    response_format: ResponseFormat,
}

#[derive(Debug, Serialize)]
struct MsgOut<'a> {
    role: &'a str,
    content: Vec<ContentPart>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum ContentPart {
    Text {
        #[serde(rename = "type")]
        kind: &'static str,
        text: String,
    },
    Image {
        #[serde(rename = "type")]
        kind: &'static str,
        image_url: ImageUrl,
    },
}

#[derive(Debug, Serialize)]
struct ImageUrl {
    url: String,
}

#[derive(Debug, Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    kind: &'static str,
}

/// Guess a MIME type for the image bytes. llama-server accepts standard MIME
/// types in the data URL; we default to `image/png` when uncertain — the
/// server probes the magic bytes regardless.
fn guess_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/png"
    }
}

/// Run VLM inference via the local llama-server sidecar.
///
/// `base_url` is the sidecar root (e.g. `http://127.0.0.1:18755`). Returns a
/// JSON `Value` matching the `AiAnalysis` schema when the model obeys the
/// JSON mode hint; otherwise returns a Value with `raw_text` + `error` set.
pub async fn analyze(base_url: &str, image_bytes: &[u8], prompt: &str) -> Result<Value, String> {
    let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
    let mime = guess_mime(image_bytes);
    let data_url = format!("data:{};base64,{}", mime, BASE64.encode(image_bytes));

    let req = ChatRequest {
        model: "qwen2-vl",
        messages: vec![MsgOut {
            role: "user",
            content: vec![
                ContentPart::Image {
                    kind: "image_url",
                    image_url: ImageUrl { url: data_url },
                },
                ContentPart::Text {
                    kind: "text",
                    text: prompt.to_string(),
                },
            ],
        }],
        temperature: 0.1,
        // 即使 OCR 在 prompt 層已被 cap 到 600 字,超密集海報 + schema 其他欄位
        // 還是要留夠空間。實測 GMI Cloud 宣傳頁(8KB 中文 OCR)需要 8K tokens
        // 才能吐完整 JSON;-c 16384 context 放得下。
        max_tokens: 8192,
        stream: false,
        response_format: ResponseFormat { kind: "json_object" },
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(INFERENCE_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("build client failed: {}", e))?;

    info!(
        "[VLM] POST {} mime={} image_bytes={} prompt_chars={}",
        url,
        mime,
        image_bytes.len(),
        prompt.chars().count()
    );

    let resp = client
        .post(&url)
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("llama-server request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("llama-server {}: {}", status, body));
    }

    let chat: ChatCompletion = resp
        .json()
        .await
        .map_err(|e| format!("llama-server response parse failed: {}", e))?;

    let content = chat
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| "llama-server returned no choices".to_string())?;

    // Strip accidental code fences the model may add even in JSON mode.
    let cleaned = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    match serde_json::from_str::<Value>(cleaned) {
        Ok(v) => Ok(v),
        Err(e) => {
            warn!(
                "[VLM] non-JSON response despite json_object mode: {} — raw={:?}",
                e,
                &cleaned.chars().take(200).collect::<String>()
            );
            Ok(json!({
                "raw_text": cleaned,
                "error": "parse_error",
            }))
        }
    }
}
