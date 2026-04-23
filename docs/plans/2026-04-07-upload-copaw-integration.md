# Upload ↔ CoPaw Integration Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge the gap between Tauri TUS upload and CoPaw processing — upload completion writes DB records, Tauri connects to CoPaw WebSocket for notifications.

**Architecture:** After TUS upload completes, Rust inserts `poster_files` record via Supabase REST API (status='uploaded'), which CoPaw's poll loop discovers. Tauri maintains a background WebSocket connection to CoPaw for receiving processing-complete notifications and triggering OS-level alerts.

**Tech Stack:** Rust (reqwest, tokio-tungstenite), Tauri notification plugin

**Depends on:**
- `docs/plans/2026-04-07-chunked-upload.md` (upload.rs, services/supabase.rs)
- `3in1media-copaw-webgpu/docs/plans/2026-04-07-poster-copaw-skills.md` (CoPaw server)

---

## Chunk 1: Upload → Supabase DB Record

### Task 1: Add poster_files INSERT to upload completion

**Files:**
- Modify: `src-tauri/src/services/supabase.rs`
- Modify: `src-tauri/src/commands/upload.rs`

- [ ] **Step 1: Add insert_poster_file method to SupabaseClient**

Append to `src-tauri/src/services/supabase.rs`:

```rust
use serde_json::json;

impl SupabaseClient {
    /// Insert a poster_files record after successful upload.
    pub async fn insert_poster_file(
        &self,
        file_id: &str,
        poster_id: &str,
        original_filename: &str,
        file_type: &str,
        file_size: u64,
        storage_path: &str,
    ) -> Result<(), String> {
        let url = format!("{}/rest/v1/poster_files", self.url);
        let key = self.service_key.as_deref().unwrap_or(&self.anon_key);

        let body = json!({
            "id": file_id,
            "poster_id": poster_id,
            "original_filename": original_filename,
            "file_type": file_type,
            "file_size": file_size,
            "storage_path": storage_path,
            "processing_status": "uploaded",
            "system_filename": format!("{}/{}", poster_id, original_filename),
        });

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Insert poster_file failed: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 201 {
            log::info!("[Supabase] Inserted poster_file: {}", file_id);
            Ok(())
        } else {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            Err(format!("Insert poster_file failed ({}): {}", status, text))
        }
    }
}
```

- [ ] **Step 2: Add SupabaseClient to UploadState**

In `src-tauri/src/commands/upload.rs`, add to `UploadState`:

```rust
pub struct UploadState {
    pub db: Arc<UploadDb>,
    pub semaphore: Arc<Semaphore>,
    pub supabase_url: String,
    pub supabase_key: String,
    pub auth_token: Arc<tokio::sync::RwLock<String>>,
    pub supabase_client: Arc<crate::services::supabase::SupabaseClient>,  // NEW
}
```

Update `lib.rs` to initialize it:
```rust
let supabase_client = crate::services::supabase::SupabaseClient::new(
    &upload_state.supabase_url,
    &upload_state.supabase_key,
);

// Add to UploadState:
supabase_client: Arc::new(supabase_client),
```

- [ ] **Step 3: Call insert_poster_file after TUS upload completes**

In `upload.rs`, in the `do_upload()` function, after `db.mark_completed()` and before the final progress emit, add:

```rust
    // Insert poster_files record to Supabase DB → triggers CoPaw processing
    let file_ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown")
        .to_lowercase();

    if let Err(e) = state_client
        .insert_poster_file(
            &record.id,
            &record.poster_id,
            file_name,
            &file_ext,
            total,
            &record.storage_path,
        )
        .await
    {
        error!("[Upload] DB insert failed (file uploaded OK): {}", e);
        // Don't fail the upload — file is in Storage, DB can be retried
    }
```

Note: `do_upload` needs access to the SupabaseClient. Pass it as a parameter:

```rust
async fn do_upload(
    app: &AppHandle,
    db: &UploadDb,
    supabase_url: &str,
    supabase_key: &str,
    auth_token: &tokio::sync::RwLock<String>,
    supabase_client: &crate::services::supabase::SupabaseClient,  // NEW
    record: &UploadRecord,
) -> Result<(), String> {
```

Update both call sites in `upload_files` and `resume_uploads` to pass it.

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/webit/Desktop/p1/海報資料庫/poster-admin-app/src-tauri && cargo check`

- [ ] **Step 5: Commit**

```bash
cd /Users/webit/Desktop/p1/海報資料庫/poster-admin-app
git add src-tauri/src/services/supabase.rs src-tauri/src/commands/upload.rs src-tauri/src/lib.rs
git commit -m "feat(upload): insert poster_files DB record after TUS upload completes"
```

---

## Chunk 2: Tauri ↔ CoPaw WebSocket Connection

### Task 2: Add tokio-tungstenite dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add WebSocket client dependency**

```toml
tokio-tungstenite = { version = "0.24", features = ["native-tls"] }
futures-util = "0.3"
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "feat(copaw): add tokio-tungstenite for WebSocket client"
```

### Task 3: CoPaw WebSocket Client (copaw.rs)

**Files:**
- Create: `src-tauri/src/commands/copaw.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Update commands/mod.rs**

```rust
// src-tauri/src/commands/mod.rs
pub mod upload;
pub mod auth;
pub mod copaw;
```

- [ ] **Step 2: Write copaw.rs**

```rust
// src-tauri/src/commands/copaw.rs
//! CoPaw WebSocket client — connects to CoPaw server for notifications.
//! Receives poster_notification messages and triggers OS-level notifications.

use futures_util::{SinkExt, StreamExt};
use log::{info, warn, error};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter};
use tokio::sync::RwLock;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const DEFAULT_COPAW_URL: &str = "ws://localhost:8775";
const RECONNECT_DELAY_SECS: u64 = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PosterNotification {
    pub title: String,
    pub body: String,
    pub action_url: Option<String>,
    pub priority: Option<String>,
    pub application_id: Option<String>,
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

pub struct CoPawState {
    pub connected: Arc<RwLock<bool>>,
    pub copaw_url: String,
    pub client_id: String,
}

/// Start the CoPaw WebSocket connection in background.
/// Called once during app startup.
pub fn start_copaw_listener(app: AppHandle, state: Arc<CoPawState>) {
    tokio::spawn(async move {
        loop {
            info!("[CoPaw] Connecting to {}...", state.copaw_url);

            match connect_async(&state.copaw_url).await {
                Ok((ws_stream, _)) => {
                    info!("[CoPaw] Connected to CoPaw server");
                    *state.connected.write().await = true;

                    let (mut write, mut read) = ws_stream.split();

                    // Send registration message
                    let register_msg = serde_json::json!({
                        "type": "register",
                        "volunteer_id": state.client_id,
                    });
                    if let Err(e) = write.send(Message::Text(register_msg.to_string())).await {
                        error!("[CoPaw] Failed to send register: {}", e);
                        *state.connected.write().await = false;
                        tokio::time::sleep(tokio::time::Duration::from_secs(RECONNECT_DELAY_SECS)).await;
                        continue;
                    }

                    // Read messages
                    while let Some(msg_result) = read.next().await {
                        match msg_result {
                            Ok(Message::Text(text)) => {
                                handle_message(&app, &text).await;
                            }
                            Ok(Message::Ping(data)) => {
                                let _ = write.send(Message::Pong(data)).await;
                            }
                            Ok(Message::Close(_)) => {
                                info!("[CoPaw] Server closed connection");
                                break;
                            }
                            Err(e) => {
                                warn!("[CoPaw] WebSocket error: {}", e);
                                break;
                            }
                            _ => {}
                        }
                    }

                    *state.connected.write().await = false;
                    info!("[CoPaw] Disconnected, reconnecting in {}s...", RECONNECT_DELAY_SECS);
                }
                Err(e) => {
                    warn!("[CoPaw] Connection failed: {}", e);
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(RECONNECT_DELAY_SECS)).await;
        }
    });
}

async fn handle_message(app: &AppHandle, text: &str) {
    let msg: CoPawMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(_) => return, // Ignore unparseable messages
    };

    match msg.msg_type.as_str() {
        "poster_notification" => {
            if let Some(notif) = msg.notification {
                info!("[CoPaw] Notification: {} - {}", notif.title, notif.body);

                // Emit to frontend
                let _ = app.emit("copaw-notification", &notif);

                // Trigger OS notification
                #[cfg(not(target_os = "linux"))]
                {
                    use tauri_plugin_notification::NotificationExt;
                    let _ = app.notification()
                        .builder()
                        .title(&notif.title)
                        .body(&notif.body)
                        .show();
                }
            }
        }
        "registered" => {
            info!("[CoPaw] Registered with server");
        }
        "pong" => {} // heartbeat response, ignore
        _ => {
            // Forward unknown messages to frontend
            let _ = app.emit("copaw-message", text);
        }
    }
}

/// Check CoPaw connection status
#[command]
pub async fn get_copaw_status(
    state: tauri::State<'_, Arc<CoPawState>>,
) -> Result<bool, String> {
    Ok(*state.connected.read().await)
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/copaw.rs src-tauri/src/commands/mod.rs
git commit -m "feat(copaw): add CoPaw WebSocket client with auto-reconnect"
```

### Task 4: Wire CoPaw into lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add CoPaw state and startup**

In `lib.rs`, add after upload_state setup:

```rust
    // CoPaw WebSocket connection
    let copaw_state = Arc::new(commands::copaw::CoPawState {
        connected: Arc::new(tokio::sync::RwLock::new(false)),
        copaw_url: std::env::var("COPAW_WS_URL")
            .unwrap_or_else(|_| "ws://localhost:8775".to_string()),
        client_id: format!("poster-admin-{}", uuid::Uuid::new_v4()),
    });
```

Add `use std::sync::Arc;` at the top.

In the Tauri builder, add:
```rust
        .manage(copaw_state.clone())
```

And add to invoke_handler:
```rust
            commands::copaw::get_copaw_status,
```

After `.run()` but we need to start the listener during setup. Use `.setup()`:

```rust
    tauri::Builder::default()
        // ... plugins ...
        .manage(upload_state)
        .manage(copaw_state.clone())
        .setup(move |app| {
            // Start CoPaw WebSocket listener in background
            commands::copaw::start_copaw_listener(app.handle().clone(), copaw_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            upload::upload_files,
            upload::get_upload_progress,
            upload::get_resumable_uploads,
            upload::resume_uploads,
            auth::google_login,
            auth::check_auth,
            auth::logout,
            copaw::get_copaw_status,
        ])
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(copaw): wire CoPaw WebSocket into Tauri app startup"
```

---

## Chunk 3: Frontend Notification Hook

### Task 5: useCoPawNotification Hook

**Files:**
- Create: `src/hooks/useCoPawNotification.ts`

- [ ] **Step 1: Write the hook**

```typescript
// src/hooks/useCoPawNotification.ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, useCallback } from "react";

export interface PosterNotification {
  title: string;
  body: string;
  action_url?: string;
  priority?: string;
  application_id?: string;
  status?: string;
}

export function useCoPawNotification() {
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState<PosterNotification[]>([]);

  // Listen for CoPaw notifications
  useEffect(() => {
    const unlisten = listen<PosterNotification>("copaw-notification", (event) => {
      setNotifications((prev) => [event.payload, ...prev].slice(0, 50));
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Poll connection status
  useEffect(() => {
    const check = async () => {
      try {
        const status = await invoke<boolean>("get_copaw_status");
        setConnected(status);
      } catch {
        setConnected(false);
      }
    };

    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    connected,
    notifications,
    latestNotification: notifications[0] ?? null,
    clearNotifications,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useCoPawNotification.ts
git commit -m "feat(copaw): add useCoPawNotification React hook"
```

### Task 6: Final Build Verification

- [ ] **Step 1: Rust build**

Run: `cd /Users/webit/Desktop/p1/海報資料庫/poster-admin-app/src-tauri && cargo build`

- [ ] **Step 2: Frontend build**

Run: `cd /Users/webit/Desktop/p1/海報資料庫/poster-admin-app && npx vite build`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: complete upload ↔ CoPaw integration"
```
