// src-tauri/src/commands/copaw.rs
//! CoPaw WebSocket client — connects to CoPaw server (v0.29.0+).
//!
//! Protocol:
//!   1. Connect → send { type: "register", volunteer_id, client_type }
//!   2. Server replies { type: "registered", config, server_time }
//!   3. Optionally send { type: "auth", access_token, refresh_token }
//!   4. Periodic heartbeat { type: "heartbeat" }
//!   5. Bidirectional message exchange

use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter};
use tokio::sync::RwLock;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const RECONNECT_DELAY_SECS: u64 = 10;
const HEARTBEAT_INTERVAL_SECS: u64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PosterNotification {
    pub title: String,
    pub body: String,
    pub action_url: Option<String>,
    pub priority: Option<String>,
    pub application_id: Option<String>,
    pub poster_id: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CoPawMessage {
    #[serde(rename = "type")]
    msg_type: String,
    notification: Option<PosterNotification>,
    #[serde(flatten)]
    extra: serde_json::Value,
}

/// Server config returned in "registered" response
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ServerConfig {
    pub sbegather_url: Option<String>,
    pub sbegather_anon_key: Option<String>,
    pub sbemcp_url: Option<String>,
    pub sbemcp_anon_key: Option<String>,
    pub edge_function_url: Option<String>,
}

pub struct CoPawState {
    pub connected: Arc<RwLock<bool>>,
    pub copaw_url: String,
    pub client_id: String,
    /// Channel to send messages to CoPaw server
    pub tx: Arc<RwLock<Option<tokio::sync::mpsc::UnboundedSender<String>>>>,
    /// Auth token from login — sent to CoPaw after registration
    pub auth_token: Arc<RwLock<Option<String>>>,
    /// Server config received on registration
    pub server_config: Arc<RwLock<Option<ServerConfig>>>,
}

/// Send a message to CoPaw server via the WebSocket channel.
/// Used by review.rs to trigger AI processing / Immich sync / notifications.
pub async fn send_to_copaw(state: &Arc<CoPawState>, message: &str) {
    let tx_guard = state.tx.read().await;
    if let Some(tx) = tx_guard.as_ref() {
        if let Err(e) = tx.send(message.to_string()) {
            warn!("[CoPaw] Failed to send message: {}", e);
        } else {
            info!("[CoPaw] Sent: {}", &message[..message.len().min(120)]);
        }
    } else {
        warn!("[CoPaw] Not connected, message dropped");
    }
}

/// Start the CoPaw WebSocket connection in background.
pub fn start_copaw_listener(app: AppHandle, state: Arc<CoPawState>) {
    tauri::async_runtime::spawn(async move {
        loop {
            info!("[CoPaw] Connecting to {}...", state.copaw_url);

            match connect_async(&state.copaw_url).await {
                Ok((ws_stream, _)) => {
                    info!("[CoPaw] Connected to CoPaw server");
                    *state.connected.write().await = true;

                    let (mut write, mut read) = ws_stream.split();

                    // Set up outbound message channel
                    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
                    *state.tx.write().await = Some(tx);

                    // Step 1: Register with CoPaw (v0.29.0 protocol)
                    let register_msg = serde_json::json!({
                        "type": "register",
                        "volunteer_id": state.client_id,
                        "client_type": "tauri_admin_app",
                    });
                    if let Err(e) = write.send(Message::Text(register_msg.to_string())).await {
                        error!("[CoPaw] Failed to send register: {}", e);
                        *state.connected.write().await = false;
                        *state.tx.write().await = None;
                        tokio::time::sleep(tokio::time::Duration::from_secs(RECONNECT_DELAY_SECS))
                            .await;
                        continue;
                    }

                    // Step 2: Send auth token if available
                    if let Some(token) = state.auth_token.read().await.as_ref() {
                        let auth_msg = serde_json::json!({
                            "type": "auth",
                            "access_token": token,
                        });
                        if let Err(e) = write.send(Message::Text(auth_msg.to_string())).await {
                            warn!("[CoPaw] Failed to send auth: {}", e);
                        } else {
                            info!("[CoPaw] Auth token sent to CoPaw server");
                        }
                    }

                    // Step 3: Start heartbeat timer
                    let heartbeat_interval =
                        tokio::time::Duration::from_secs(HEARTBEAT_INTERVAL_SECS);
                    let mut heartbeat_tick = tokio::time::interval(heartbeat_interval);
                    heartbeat_tick.tick().await; // skip first immediate tick

                    // Bidirectional message loop with heartbeat
                    loop {
                        tokio::select! {
                            // Inbound: messages from CoPaw server
                            msg_result = read.next() => {
                                match msg_result {
                                    Some(Ok(Message::Text(text))) => {
                                        handle_message(&app, &state, &text).await;
                                    }
                                    Some(Ok(Message::Ping(data))) => {
                                        let _ = write.send(Message::Pong(data)).await;
                                    }
                                    Some(Ok(Message::Close(_))) => {
                                        info!("[CoPaw] Server closed connection");
                                        break;
                                    }
                                    Some(Err(e)) => {
                                        warn!("[CoPaw] WebSocket error: {}", e);
                                        break;
                                    }
                                    None => {
                                        info!("[CoPaw] Stream ended");
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                            // Outbound: messages from our app to CoPaw
                            Some(outbound) = rx.recv() => {
                                if let Err(e) = write.send(Message::Text(outbound)).await {
                                    error!("[CoPaw] Failed to send outbound message: {}", e);
                                    break;
                                }
                            }
                            // Heartbeat: keep connection alive
                            _ = heartbeat_tick.tick() => {
                                let hb = serde_json::json!({ "type": "heartbeat" });
                                if let Err(e) = write.send(Message::Text(hb.to_string())).await {
                                    warn!("[CoPaw] Heartbeat failed: {}", e);
                                    break;
                                }
                            }
                        }
                    }

                    *state.connected.write().await = false;
                    *state.tx.write().await = None;
                    info!(
                        "[CoPaw] Disconnected, reconnecting in {}s...",
                        RECONNECT_DELAY_SECS
                    );
                }
                Err(e) => {
                    warn!("[CoPaw] Connection failed: {}", e);
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(RECONNECT_DELAY_SECS)).await;
        }
    });
}

async fn handle_message(app: &AppHandle, state: &Arc<CoPawState>, text: &str) {
    let msg: CoPawMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(_) => return,
    };

    match msg.msg_type.as_str() {
        // ── Registration ack ──
        "registered" => {
            info!("[CoPaw] Registered with server");
            // Parse server config if present
            if let Ok(config) = serde_json::from_value::<ServerConfig>(
                msg.extra.get("config").cloned().unwrap_or_default(),
            ) {
                *state.server_config.write().await = Some(config);
                info!("[CoPaw] Server config received");
            }
            let _ = app.emit(
                "copaw-connected",
                serde_json::json!({"connected": true}),
            );
        }

        "auth_response" => {
            let status = msg.extra.get("status").and_then(|v| v.as_str()).unwrap_or("unknown");
            info!("[CoPaw] Auth response: {}", status);
            let _ = app.emit("copaw-auth-response", text);
        }

        // ── Notifications ──
        "poster_notification" => {
            if let Some(notif) = msg.notification {
                info!("[CoPaw] Notification: {} - {}", notif.title, notif.body);
                let _ = app.emit("copaw-notification", &notif);

                use tauri_plugin_notification::NotificationExt;
                let _ = app
                    .notification()
                    .builder()
                    .title(&notif.title)
                    .body(&notif.body)
                    .show();
            }
        }

        // ── Review pipeline ──
        "review_ack" => {
            info!("[CoPaw] Review acknowledged: {}", text);
            let _ = app.emit("copaw-review-ack", text);
        }

        // ── Processing pipeline ──
        "processing_status" => {
            info!("[CoPaw] Processing status update: {}", text);
            let _ = app.emit("copaw-processing-status", text);
        }

        // ── Project batch processing (v0.24+) ──
        "project_processing_started" => {
            info!("[CoPaw] Project processing started: {}", text);
            let _ = app.emit("copaw-project-started", text);
        }
        "project_progress" => {
            info!("[CoPaw] Project progress: {}", text);
            let _ = app.emit("copaw-project-progress", text);
        }
        "project_complete" => {
            info!("[CoPaw] Project complete: {}", text);
            let _ = app.emit("copaw-project-complete", text);
        }

        // ── Immich sync ──
        "immich_sync_status" => {
            info!("[CoPaw] Immich sync status: {}", text);
            let _ = app.emit("copaw-immich-status", text);
        }

        // ── New tasks broadcast ──
        "new_tasks_available" => {
            info!("[CoPaw] New tasks available");
            let _ = app.emit("copaw-new-tasks", text);
        }

        // ── Keepalive ──
        "pong" => {}

        // ── Error from server ──
        "error" => {
            let message = msg.extra.get("message").and_then(|v| v.as_str()).unwrap_or("unknown");
            error!("[CoPaw] Server error: {}", message);
            let _ = app.emit("copaw-error", text);
        }

        _ => {
            info!("[CoPaw] Unhandled message type: {}", msg.msg_type);
            let _ = app.emit("copaw-message", text);
        }
    }
}

#[command]
pub async fn get_copaw_status(
    state: tauri::State<'_, Arc<CoPawState>>,
) -> Result<bool, String> {
    Ok(*state.connected.read().await)
}

/// Send a message to CoPaw from frontend (e.g. trigger processing).
#[command]
pub async fn send_copaw_message(
    state: tauri::State<'_, Arc<CoPawState>>,
    message: String,
) -> Result<(), String> {
    send_to_copaw(&state, &message).await;
    Ok(())
}

/// Send auth token to CoPaw after login (so CoPaw can act on behalf of user).
#[command]
pub async fn send_copaw_auth(
    state: tauri::State<'_, Arc<CoPawState>>,
    access_token: String,
) -> Result<(), String> {
    // Update stored token
    *state.auth_token.write().await = Some(access_token.clone());

    // Send to CoPaw if connected
    let msg = serde_json::json!({
        "type": "auth",
        "access_token": access_token,
    });
    send_to_copaw(&state, &msg.to_string()).await;
    Ok(())
}
