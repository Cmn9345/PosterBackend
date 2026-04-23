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
        // Qwen2-VL 2B 即使 OCR 被 cap 到 600 字,description / suggestions
        // 仍會跑 500+ 字。實測最大 JSON 可到 ~30KB(column 27283)。拉到
        // 12288 搭配 try_close_truncated_json 幾乎能救回所有 payload。
        // -c 16384 context 放得下。
        max_tokens: 12288,
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
            // Qwen2-VL 2B 偶爾會被 max_tokens 切在 description / suggestions
            // 字串中間,導致 JSON 未閉合。試著補上遺漏的 `"` / `}` / `]` 讓
            // parser 吃下已產生的欄位,使用者至少拿到 OCR + themes 等前段。
            let patched = try_close_truncated_json(cleaned);
            if let Ok(v) = serde_json::from_str::<Value>(&patched) {
                warn!(
                    "[VLM] JSON truncated at {} bytes, salvaged partial fields",
                    cleaned.len()
                );
                return Ok(v);
            }
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

/// 把被 max_tokens 截斷的 JSON 盡量補成可解析字串:若最後還在字串裡,補一個
/// 雙引號;接著補上所有未閉合的 `}` / `]`。這樣 parser 能吃到已產生的欄位,
/// 最後幾個(通常是 suggestions / scores)欄位會缺失但其他欄位保留。
fn try_close_truncated_json(s: &str) -> String {
    let mut in_string = false;
    let mut escape = false;
    let mut stack: Vec<char> = Vec::new(); // '{' or '['

    for c in s.chars() {
        if escape {
            escape = false;
            continue;
        }
        if in_string {
            match c {
                '\\' => escape = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match c {
            '"' => in_string = true,
            '{' => stack.push('{'),
            '}' => {
                let _ = stack.pop();
            }
            '[' => stack.push('['),
            ']' => {
                let _ = stack.pop();
            }
            _ => {}
        }
    }

    let mut fixed = s.to_string();
    if in_string {
        fixed.push('"');
    }
    // 補尾隨的逗號後的空屬性:若截斷點在 key 後的逗號,可能產生 `...,` 結尾,
    // serde_json 不吃尾逗號 — 簡單處理:把結尾連續的 `,\n` 刮掉。
    while let Some(last) = fixed.chars().last() {
        if last == ',' || last.is_whitespace() {
            fixed.pop();
        } else {
            break;
        }
    }
    while let Some(open) = stack.pop() {
        fixed.push(if open == '{' { '}' } else { ']' });
    }
    fixed
}
