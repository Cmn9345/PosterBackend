//! First-run model download for the local VLM (Qwen2-VL-2B).
//!
//! `llama_sidecar::resolve_model` expects two GGUF files in
//! `<app_local_data_dir>/models/`:
//!   - qwen2-vl-2b-instruct-q4_k_m.gguf  (~940 MB, main weights)
//!   - mmproj-Qwen2-VL-2B-Instruct-f16.gguf (~1.24 GB, vision projector)
//!
//! For a freshly-installed dmg these don't exist. The frontend onboarding
//! calls `download_models_if_missing` after login, which:
//!   1. Reports whether files are present
//!   2. Streams missing files from the release CDN
//!   3. Emits `model-download-progress` events for the progress bar
//!   4. Writes to `.tmp` first then atomically renames so a half-downloaded
//!      file is never picked up by the sidecar on next launch.
//!
//! Endpoint defaults to a GitHub Release on the posterbackend repo. Override
//! via `POSTER_MODEL_BASE_URL` (compile-time or runtime) when staging.

use serde::Serialize;
use std::path::PathBuf;
use std::time::Instant;
use tauri::{command, AppHandle, Emitter, Manager};
use tokio::fs;
use tokio::io::AsyncWriteExt;

/// Release base URL — produced by `gh release create` on PosterBackend.
/// Override at build time: `POSTER_MODEL_BASE_URL=https://… npm run tauri build`.
const COMPILE_BASE_URL: Option<&str> = option_env!("POSTER_MODEL_BASE_URL");
const FALLBACK_BASE_URL: &str =
    "https://github.com/Cmn9345/PosterBackend/releases/download/models-v1";

/// The two GGUF files we need. Names must match `llama_sidecar::resolve_model`.
const MODEL_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        name: "qwen2-vl-2b-instruct-q4_k_m.gguf",
        label: "VLM 主模型",
        approx_bytes: 986_047_232,
    },
    ModelFileSpec {
        name: "mmproj-Qwen2-VL-2B-Instruct-f16.gguf",
        label: "視覺投影層",
        approx_bytes: 1_331_656_192,
    },
];

struct ModelFileSpec {
    name: &'static str,
    label: &'static str,
    /// Used to render a reasonable progress bar before the HTTP headers
    /// arrive (some self-hosted mirrors don't send Content-Length).
    approx_bytes: u64,
}

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    /// `"checking" | "downloading" | "renaming" | "complete" | "error"`
    pub stage: &'static str,
    /// Which file is being worked on (1-indexed for UI), 0 when overall.
    pub file_index: usize,
    pub file_label: String,
    pub file_name: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
    /// Bytes per second over the most recent 1 s window.
    pub speed_bps: u64,
    /// Optional human-readable error message if `stage == "error"`.
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct ModelStatus {
    pub all_present: bool,
    pub missing: Vec<String>,
    pub models_dir: String,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("resolve app_local_data_dir failed: {}", e))?
        .join("models");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("create models dir failed: {}", e))?;
    Ok(dir)
}

fn base_url() -> String {
    if let Ok(v) = std::env::var("POSTER_MODEL_BASE_URL") {
        if !v.is_empty() {
            return v;
        }
    }
    if let Some(v) = COMPILE_BASE_URL {
        if !v.is_empty() {
            return v.to_string();
        }
    }
    FALLBACK_BASE_URL.to_string()
}

/// Check whether both GGUFs are already present. UI uses this to skip the
/// download step entirely on subsequent launches.
#[command]
pub async fn check_models(app: AppHandle) -> Result<ModelStatus, String> {
    let dir = models_dir(&app)?;
    let mut missing = Vec::new();
    for spec in MODEL_FILES {
        let path = dir.join(spec.name);
        // A zero-byte file from a prior failed download counts as missing.
        let ok = fs::metadata(&path)
            .await
            .map(|m| m.len() > 0)
            .unwrap_or(false);
        if !ok {
            missing.push(spec.name.to_string());
        }
    }
    Ok(ModelStatus {
        all_present: missing.is_empty(),
        missing,
        models_dir: dir.to_string_lossy().to_string(),
    })
}

/// Download any missing GGUFs and emit `model-download-progress` events.
/// Re-entrant: already-present files are skipped, partial `.tmp` files are
/// overwritten from scratch (HTTP Range / resume not implemented in v1 —
/// keep it simple for the tester rollout).
#[command]
pub async fn download_models_if_missing(app: AppHandle) -> Result<(), String> {
    let dir = models_dir(&app)?;
    let client = reqwest::Client::builder()
        // Models are ~1 GB each; some mirrors stall mid-stream. A generous
        // connect timeout + no overall read timeout (we poll chunks instead).
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("reqwest client init: {}", e))?;

    let base = base_url();
    let total_files = MODEL_FILES.len();

    for (i, spec) in MODEL_FILES.iter().enumerate() {
        let final_path = dir.join(spec.name);
        if fs::metadata(&final_path)
            .await
            .map(|m| m.len() > 0)
            .unwrap_or(false)
        {
            // Already there — emit a synthetic complete event so the UI can
            // tick this file as done.
            emit(
                &app,
                DownloadProgress {
                    stage: "complete",
                    file_index: i + 1,
                    file_label: spec.label.to_string(),
                    file_name: spec.name.to_string(),
                    bytes_done: spec.approx_bytes,
                    bytes_total: spec.approx_bytes,
                    speed_bps: 0,
                    error: None,
                },
            );
            continue;
        }

        let url = format!("{}/{}", base.trim_end_matches('/'), spec.name);
        let tmp_path = dir.join(format!("{}.tmp", spec.name));

        if let Err(e) = download_single(&app, &client, &url, &tmp_path, spec, i, total_files).await
        {
            emit(
                &app,
                DownloadProgress {
                    stage: "error",
                    file_index: i + 1,
                    file_label: spec.label.to_string(),
                    file_name: spec.name.to_string(),
                    bytes_done: 0,
                    bytes_total: spec.approx_bytes,
                    speed_bps: 0,
                    error: Some(e.clone()),
                },
            );
            // Tmp file may be partial — wipe so the next retry starts clean.
            let _ = fs::remove_file(&tmp_path).await;
            return Err(e);
        }

        // Atomic rename so llama_sidecar never sees a half-written GGUF.
        emit(
            &app,
            DownloadProgress {
                stage: "renaming",
                file_index: i + 1,
                file_label: spec.label.to_string(),
                file_name: spec.name.to_string(),
                bytes_done: spec.approx_bytes,
                bytes_total: spec.approx_bytes,
                speed_bps: 0,
                error: None,
            },
        );
        fs::rename(&tmp_path, &final_path)
            .await
            .map_err(|e| format!("rename {} failed: {}", spec.name, e))?;

        emit(
            &app,
            DownloadProgress {
                stage: "complete",
                file_index: i + 1,
                file_label: spec.label.to_string(),
                file_name: spec.name.to_string(),
                bytes_done: spec.approx_bytes,
                bytes_total: spec.approx_bytes,
                speed_bps: 0,
                error: None,
            },
        );
    }

    Ok(())
}

async fn download_single(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    tmp_path: &PathBuf,
    spec: &ModelFileSpec,
    file_index: usize,
    _total_files: usize,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("GET {}: {}", url, e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {}", resp.status(), url));
    }
    let total = resp.content_length().unwrap_or(spec.approx_bytes);

    let mut file = fs::File::create(tmp_path)
        .await
        .map_err(|e| format!("create tmp file: {}", e))?;
    let mut stream = resp.bytes_stream();

    let mut bytes_done: u64 = 0;
    let mut last_emit = Instant::now();
    let mut bytes_since_last_window = 0u64;
    let mut window_start = Instant::now();
    let mut last_speed = 0u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("read chunk: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write chunk: {}", e))?;
        bytes_done += chunk.len() as u64;
        bytes_since_last_window += chunk.len() as u64;

        // Recompute speed every 1 s; emit at most every 250 ms otherwise.
        let now = Instant::now();
        if now.duration_since(window_start).as_millis() >= 1000 {
            let secs = now.duration_since(window_start).as_secs_f64().max(0.001);
            last_speed = (bytes_since_last_window as f64 / secs) as u64;
            bytes_since_last_window = 0;
            window_start = now;
        }

        if now.duration_since(last_emit).as_millis() >= 250 {
            emit(
                app,
                DownloadProgress {
                    stage: "downloading",
                    file_index: file_index + 1,
                    file_label: spec.label.to_string(),
                    file_name: spec.name.to_string(),
                    bytes_done,
                    bytes_total: total,
                    speed_bps: last_speed,
                    error: None,
                },
            );
            last_emit = now;
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("flush tmp file: {}", e))?;
    drop(file);
    Ok(())
}

fn emit(app: &AppHandle, payload: DownloadProgress) {
    let _ = app.emit("model-download-progress", payload);
}
