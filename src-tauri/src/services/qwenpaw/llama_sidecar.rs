//! Manages the bundled `llama-server` subprocess for local VLM inference.
//!
//! On app startup this module:
//!   1. Locates the llama-server binary (bundled in `resources/llama-server/`)
//!   2. Locates the Qwen2-VL GGUF weights + mmproj (user's app data dir)
//!   3. Spawns `llama-server` on 127.0.0.1:<PORT> with Metal acceleration
//!   4. Waits for `/health` to return ok
//!
//! The subprocess is killed automatically when the app exits (child handle is
//! kept in state; Drop terminates it).

use log::{error, info, warn};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const DEFAULT_PORT: u16 = 18755;
const HEALTH_TIMEOUT_SECS: u64 = 120;
const HEALTH_POLL_INTERVAL_MS: u64 = 500;

/// Handles for the running llama-server. Dropping kills the subprocess.
pub struct LlamaSidecar {
    pub port: u16,
    pub base_url: String,
    child: Mutex<Option<Child>>,
}

impl LlamaSidecar {
    pub fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for LlamaSidecar {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut c) = guard.take() {
                info!("[LlamaSidecar] terminating llama-server pid={}", c.id());
                let _ = c.kill();
                let _ = c.wait();
            }
        }
    }
}

/// Resolve the llama-server binary path.
///
/// Order:
///   1. `LLAMA_SERVER_PATH` env var (explicit override for dev / debugging)
///   2. `<resource_dir>/resources/llama-server/llama-server` (packaged app)
///   3. `<CARGO_MANIFEST_DIR>/resources/llama-server/llama-server` (cargo dev)
fn resolve_binary(resource_dir: Option<&Path>) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("LLAMA_SERVER_PATH") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }

    if let Some(res) = resource_dir {
        let candidate = res.join("resources/llama-server/llama-server");
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let manifest = option_env!("CARGO_MANIFEST_DIR")?;
    let candidate = PathBuf::from(manifest).join("resources/llama-server/llama-server");
    if candidate.exists() {
        Some(candidate)
    } else {
        None
    }
}

/// Resolve the Qwen2-VL GGUF + mmproj paths.
///
/// Both files must live in `<app_local_data_dir>/models/`. First-run download
/// is the caller's responsibility; this module only checks and spawns.
fn resolve_model(app_local_data: &Path) -> Option<(PathBuf, PathBuf)> {
    let model_dir = app_local_data.join("models");
    let model = model_dir.join("qwen2-vl-2b-instruct-q4_k_m.gguf");
    let mmproj = model_dir.join("mmproj-Qwen2-VL-2B-Instruct-f16.gguf");
    if model.exists() && mmproj.exists() {
        Some((model, mmproj))
    } else {
        None
    }
}

/// Pick the port for llama-server, honouring `POSTER_LLAMA_PORT` env.
fn port() -> u16 {
    std::env::var("POSTER_LLAMA_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// Spawn llama-server and wait until it's healthy. Returns `None` if either
/// the binary or the model weights are missing (caller continues without VLM
/// — analysis.rs surfaces the error as an `AiAnalysis.error` field).
pub async fn start(
    resource_dir: Option<&Path>,
    app_local_data: &Path,
) -> Option<Arc<LlamaSidecar>> {
    let binary = match resolve_binary(resource_dir) {
        Some(p) => p,
        None => {
            warn!("[LlamaSidecar] llama-server binary not found — VLM disabled");
            return None;
        }
    };

    let (model, mmproj) = match resolve_model(app_local_data) {
        Some(m) => m,
        None => {
            warn!(
                "[LlamaSidecar] model files missing under {} — VLM disabled",
                app_local_data.join("models").display()
            );
            return None;
        }
    };

    let port = port();
    let base_url = format!("http://127.0.0.1:{}", port);

    info!(
        "[LlamaSidecar] starting {} --model {} --mmproj {} --port {}",
        binary.display(),
        model.display(),
        mmproj.display(),
        port
    );

    // `llama-server` flags:
    //   -m / --model       main GGUF weights
    //   --mmproj           clip/mmproj projector (multimodal)
    //   --host             bind address
    //   --port             bind port
    //   -ngl 99            offload all layers to GPU (Metal on Apple Silicon)
    //   -c 4096            context size — enough for prompt + a 448x448 image
    //   --log-disable      less noisy stdout
    let mut cmd = Command::new(&binary);
    cmd.args([
        "--model",
        &model.to_string_lossy(),
        "--mmproj",
        &mmproj.to_string_lossy(),
        "--host",
        "127.0.0.1",
        "--port",
        &port.to_string(),
        "-ngl",
        "99",
        // Context window must accommodate the image token budget — a single
        // 2-3 MB poster can produce 3k-5k vision tokens before the prompt.
        "-c",
        "16384",
        // Qwen2-VL recommends ≥1024 image tokens for grounding tasks (per the
        // sidecar's own warmup log).
        "--image-min-tokens",
        "1024",
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::piped());

    // `libllama.dylib` + friends live alongside the binary; set DYLD so the
    // loader finds them regardless of how the subprocess was invoked.
    if let Some(parent) = binary.parent() {
        cmd.env("DYLD_LIBRARY_PATH", parent);
        cmd.env("DYLD_FALLBACK_LIBRARY_PATH", parent);
    }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            error!("[LlamaSidecar] spawn failed: {}", e);
            return None;
        }
    };
    info!("[LlamaSidecar] llama-server pid={}", child.id());

    let sidecar = Arc::new(LlamaSidecar {
        port,
        base_url: base_url.clone(),
        child: Mutex::new(Some(child)),
    });

    // Health-check loop.
    let deadline = Instant::now() + Duration::from_secs(HEALTH_TIMEOUT_SECS);
    let health_url = format!("{}/health", base_url);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()?;

    loop {
        if Instant::now() >= deadline {
            error!("[LlamaSidecar] health check timed out after {} s", HEALTH_TIMEOUT_SECS);
            // Drop sidecar → kills subprocess.
            return None;
        }

        match client.get(&health_url).send().await {
            Ok(r) if r.status().is_success() => {
                info!("[LlamaSidecar] healthy on {}", base_url);
                return Some(sidecar);
            }
            Ok(_) | Err(_) => {
                tokio::time::sleep(Duration::from_millis(HEALTH_POLL_INTERVAL_MS)).await;
            }
        }
    }
}
