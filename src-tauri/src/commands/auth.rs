// src-tauri/src/commands/auth.rs
//! Supabase Auth (Google OAuth via PKCE) for Tzu Chi poster admin app.
//! Flow: Open browser → Supabase Auth → Google consent → Supabase callback →
//!       redirect to localhost → exchange PKCE code → get Supabase JWT session

use base64::Engine;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::command;
use tokio::sync::RwLock;

const CALLBACK_PORT: u16 = 19823;
const REDIRECT_URI: &str = "http://localhost:19823/callback";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: String,
    pub email: String,
    pub name: String,
    pub role: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResult {
    pub success: bool,
    pub user: Option<AuthUser>,
    pub token: Option<String>,
    pub error: Option<String>,
}

/// Supabase token exchange response
#[derive(Debug, Deserialize)]
struct SupabaseTokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    user: SupabaseUser,
}

#[derive(Debug, Deserialize)]
struct SupabaseUser {
    id: String,
    email: Option<String>,
    user_metadata: Option<SupabaseUserMeta>,
}

#[derive(Debug, Deserialize)]
struct SupabaseUserMeta {
    full_name: Option<String>,
    name: Option<String>,
    avatar_url: Option<String>,
    picture: Option<String>,
}

/// Session snapshot persisted to disk so the user stays logged in across
/// app restarts (and across `cargo run` rebuilds during dev).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PersistedSession {
    user: Option<AuthUser>,
    access_token: Option<String>,
    refresh_token: Option<String>,
}

/// Shared authentication state
pub struct AuthState {
    pub user: Arc<RwLock<Option<AuthUser>>>,
    pub access_token: Arc<RwLock<Option<String>>>,
    pub refresh_token: Arc<RwLock<Option<String>>>,
    pub supabase_url: String,
    pub supabase_anon_key: String,
    /// Path to the session JSON on disk. Writable on login/refresh, removed
    /// on logout. Kept as `Option` so tests / CLI usage can skip persistence.
    session_path: Option<std::path::PathBuf>,
}

impl AuthState {
    pub fn new(supabase_url: &str, supabase_anon_key: &str) -> Self {
        Self {
            user: Arc::new(RwLock::new(None)),
            access_token: Arc::new(RwLock::new(None)),
            refresh_token: Arc::new(RwLock::new(None)),
            supabase_url: supabase_url.to_string(),
            supabase_anon_key: supabase_anon_key.to_string(),
            session_path: None,
        }
    }

    /// Point the auth state at a file to restore/persist session state.
    /// Call once at startup (after `::new`).
    pub async fn with_persistence(self, path: std::path::PathBuf) -> Self {
        if let Ok(bytes) = std::fs::read(&path) {
            match serde_json::from_slice::<PersistedSession>(&bytes) {
                Ok(snap) => {
                    if let Some(u) = snap.user.clone() {
                        info!("[Auth] restored persisted session for {}", u.email);
                    }
                    *self.user.write().await = snap.user;
                    *self.access_token.write().await = snap.access_token;
                    *self.refresh_token.write().await = snap.refresh_token;
                }
                Err(e) => {
                    error!("[Auth] session file corrupt, ignoring: {}", e);
                }
            }
        }
        Self {
            session_path: Some(path),
            ..self
        }
    }

    /// Snapshot current in-memory session to disk. No-op when persistence
    /// wasn't configured. Errors are logged, not returned — a session we
    /// can't persist is still usable in memory.
    pub async fn persist(&self) {
        let Some(ref path) = self.session_path else {
            return;
        };
        let snap = PersistedSession {
            user: self.user.read().await.clone(),
            access_token: self.access_token.read().await.clone(),
            refresh_token: self.refresh_token.read().await.clone(),
        };
        match serde_json::to_vec_pretty(&snap) {
            Ok(bytes) => {
                if let Err(e) = std::fs::write(path, bytes) {
                    error!("[Auth] session write failed: {}", e);
                }
            }
            Err(e) => error!("[Auth] session serialize failed: {}", e),
        }
    }

    /// Remove the session file. Called on logout.
    pub fn clear_persisted(&self) {
        if let Some(ref path) = self.session_path {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Generate PKCE code_verifier and code_challenge
fn generate_pkce() -> (String, String) {
    let verifier_bytes: Vec<u8> = (0..32).map(|_| rand_byte()).collect();
    let verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&verifier_bytes);

    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hasher.finalize());

    (verifier, challenge)
}

fn rand_byte() -> u8 {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let s = RandomState::new();
    let mut h = s.build_hasher();
    h.write_u8(0);
    (h.finish() & 0xFF) as u8
}

/// Initiate Google login via Supabase Auth PKCE flow
/// 1. Generate PKCE code verifier + challenge
/// 2. Open browser to Supabase /auth/v1/authorize?provider=google
/// 3. Supabase handles Google OAuth, redirects back to localhost
/// 4. Exchange PKCE code for Supabase session (JWT)
#[command]
pub async fn google_login(
    auth: tauri::State<'_, Arc<AuthState>>,
) -> Result<AuthResult, String> {
    info!("[Auth] Starting Supabase Auth + Google OAuth PKCE flow");

    if auth.supabase_url.is_empty() || auth.supabase_anon_key.is_empty() {
        return Err("POSTER_SUPABASE_URL and POSTER_SUPABASE_ANON_KEY must be set".to_string());
    }

    // Generate PKCE pair
    let (code_verifier, code_challenge) = generate_pkce();

    // Build Supabase OAuth URL
    let auth_url = format!(
        "{}/auth/v1/authorize?provider=google&redirect_to={}&code_challenge={}&code_challenge_method=S256",
        auth.supabase_url,
        urlencoding::encode(REDIRECT_URI),
        urlencoding::encode(&code_challenge),
    );

    // Start local HTTP server to receive callback
    let (code_tx, code_rx) = tokio::sync::oneshot::channel::<String>();

    let server_handle = tokio::spawn(async move {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpSocket;

        // Use TcpSocket + SO_REUSEADDR so we can rebind while the last
        // callback connection is still in TIME_WAIT (common on fast re-login).
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", CALLBACK_PORT)
            .parse()
            .map_err(|e: std::net::AddrParseError| e.to_string())?;
        let socket = TcpSocket::new_v4()
            .map_err(|e| format!("Failed to create callback socket: {}", e))?;
        socket
            .set_reuseaddr(true)
            .map_err(|e| format!("set_reuseaddr failed: {}", e))?;
        #[cfg(unix)]
        let _ = socket.set_reuseport(true);
        socket
            .bind(addr)
            .map_err(|e| format!("Failed to bind callback server on port {}: {}", CALLBACK_PORT, e))?;
        let listener = socket
            .listen(1)
            .map_err(|e| format!("Failed to listen on port {}: {}", CALLBACK_PORT, e))?;

        info!("[Auth] Callback server listening on port {}", CALLBACK_PORT);

        // Wait for one connection (120s timeout)
        let result = tokio::time::timeout(
            tokio::time::Duration::from_secs(120),
            listener.accept(),
        )
        .await;

        match result {
            Ok(Ok((mut stream, _))) => {
                let mut buf = vec![0u8; 8192];
                let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
                let request = String::from_utf8_lossy(&buf[..n]).to_string();

                // Parse authorization code from query parameters
                if let Some(path_line) = request.lines().next() {
                    if let Some(query_start) = path_line.find('?') {
                        let query_end = path_line.find(" HTTP").unwrap_or(path_line.len());
                        let query = &path_line[query_start + 1..query_end];

                        let params: std::collections::HashMap<&str, &str> = query
                            .split('&')
                            .filter_map(|p| {
                                let mut parts = p.splitn(2, '=');
                                Some((parts.next()?, parts.next()?))
                            })
                            .collect();

                        if let Some(&code) = params.get("code") {
                            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
                                <html><body style='font-family:\"Noto Sans TC\",sans-serif;text-align:center;padding:60px;background:#F8F9FA'>\
                                <div style='background:white;max-width:400px;margin:0 auto;padding:40px;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.08)'>\
                                <h1 style='color:#003366'>登入成功</h1>\
                                <p style='color:#666'>您可以關閉此視窗，回到應用程式。</p>\
                                </div></body></html>";
                            let _ = stream.write_all(response.as_bytes()).await;
                            let _ = code_tx.send(code.to_string());
                            return Ok(());
                        }

                        if let Some(&error) = params.get("error") {
                            let desc = params.get("error_description").unwrap_or(&"");
                            let response = format!(
                                "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
                                <html><body style='font-family:sans-serif;text-align:center;padding:60px'>\
                                <h1>登入失敗</h1><p>{}: {}</p></body></html>",
                                error, desc
                            );
                            let _ = stream.write_all(response.as_bytes()).await;
                            return Err(format!("OAuth error: {}: {}", error, desc));
                        }
                    }
                }

                let response = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<h1>登入失敗</h1>";
                let _ = stream.write_all(response.as_bytes()).await;
                Err("No authorization code received".to_string())
            }
            Ok(Err(e)) => Err(format!("Accept failed: {}", e)),
            Err(_) => Err("Login timeout (120s)".to_string()),
        }
    });

    // Open browser
    if let Err(e) = open::that(&auth_url) {
        error!("[Auth] Failed to open browser: {}", e);
        return Err(format!("Failed to open browser: {}", e));
    }
    info!("[Auth] Opened browser for Supabase Google login");

    // Wait for authorization code
    let code = match code_rx.await {
        Ok(code) => code,
        Err(_) => {
            if let Ok(Err(e)) = server_handle.await {
                return Err(e);
            }
            return Err("Failed to receive authorization code".to_string());
        }
    };

    info!("[Auth] Received auth code, exchanging via PKCE...");

    // Exchange PKCE code for Supabase session
    let client = reqwest::Client::new();
    let token_url = format!("{}/auth/v1/token?grant_type=pkce", auth.supabase_url);

    let token_resp = client
        .post(&token_url)
        .header("apikey", &auth.supabase_anon_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "auth_code": code,
            "code_verifier": code_verifier,
        }))
        .send()
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?;

    if !token_resp.status().is_success() {
        let status = token_resp.status();
        let err_text = token_resp.text().await.unwrap_or_default();
        error!("[Auth] PKCE token exchange failed ({}): {}", status, err_text);
        return Err(format!("Token exchange failed ({}): {}", status, err_text));
    }

    let session: SupabaseTokenResponse = token_resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse session: {}", e))?;

    // Extract user info
    let meta = session.user.user_metadata.as_ref();
    let email = session.user.email.clone().unwrap_or_default();
    let name = meta
        .and_then(|m| m.full_name.clone().or_else(|| m.name.clone()))
        .unwrap_or_else(|| email.clone());
    let avatar = meta.and_then(|m| m.avatar_url.clone().or_else(|| m.picture.clone()));

    // Determine role based on email domain
    let role = if email.ends_with("@tzuchi.org.tw") {
        "creator"
    } else {
        "viewer"
    };

    let auth_user = AuthUser {
        id: session.user.id,
        email: email.clone(),
        name: name.clone(),
        role: role.to_string(),
        avatar_url: avatar,
    };

    // Store session
    *auth.access_token.write().await = Some(session.access_token.clone());
    *auth.refresh_token.write().await = Some(session.refresh_token);
    *auth.user.write().await = Some(auth_user.clone());
    auth.persist().await;

    info!("[Auth] Login successful: {} ({})", name, email);

    // Record login session to Supabase (desktop_app)
    let session_url = format!("{}/rest/v1/user_sessions", auth.supabase_url);
    let record_resp = client
        .post(&session_url)
        .header("Authorization", format!("Bearer {}", session.access_token))
        .header("apikey", &auth.supabase_anon_key)
        .header("Content-Type", "application/json")
        .header("Prefer", "return=minimal")
        .json(&serde_json::json!({
            "user_id": auth_user.id,
            "client_type": "desktop_app",
            "client_version": env!("CARGO_PKG_VERSION"),
        }))
        .send()
        .await;

    match record_resp {
        Ok(r) if r.status().is_success() || r.status().as_u16() == 201 => {
            info!("[Auth] Login session recorded: desktop_app v{}", env!("CARGO_PKG_VERSION"));
        }
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            error!("[Auth] Failed to record login session ({}): {}", status, body);
        }
        Err(e) => {
            error!("[Auth] Failed to record login session: {}", e);
        }
    }

    // Ensure the mirrored `public.users` row exists (PostgREST upsert on id).
    // This replaces what a Supabase `auth.users -> public.users` trigger would
    // normally do — the Studio SQL editor has been unable to parse the
    // trigger body reliably, so we do it client-side right after login.
    //
    // Placeholder rows that were seeded with a pre-auth id and wait to be
    // "claimed" by a matching Chinese name are reconciled separately via a
    // one-off UPDATE SQL in the Supabase Studio; login only guarantees the
    // minimum invariant "a row keyed on the current auth user's id exists".
    ensure_public_user_row(&client, &auth, &auth_user, &session.access_token).await;

    Ok(AuthResult {
        success: true,
        user: Some(auth_user),
        token: Some(session.access_token),
        error: None,
    })
}

/// Reconcile `public.users` against the logged-in Supabase auth user.
///
/// Precedence when deciding which existing row (if any) should be claimed:
///   1. `id == auth.id` — already linked, just refresh email / name.
///   2. `lower(email) == lower(auth.email)` — previously seeded with real
///      email, bind id.
///   3. `name == auth.full_name` — placeholder seeded by admin under a
///      Chinese name; bind both id and real email.
///   4. No match → insert a fresh row.
///
/// Swallows errors (login is not blocked by mirroring) but surfaces them via
/// `warn!` so RLS / schema issues stay debuggable from the log.
async fn ensure_public_user_row(
    client: &reqwest::Client,
    auth: &AuthState,
    user: &AuthUser,
    access_token: &str,
) {
    let key = &auth.supabase_anon_key;

    // Probe: find at most one existing row by id OR email OR name. The `or=`
    // PostgREST param lets us check all three without 3 round-trips.
    let name_escaped = user.name.replace(',', "\\,");
    let email_escaped = user.email.replace(',', "\\,");
    let probe_url = format!(
        "{}/rest/v1/users?or=(id.eq.{},email.ilike.{},name.eq.{})&select=id,email,name&limit=5",
        auth.supabase_url, user.id, email_escaped, name_escaped,
    );
    let probe = client
        .get(&probe_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("apikey", key)
        .send()
        .await;
    let existing: Vec<serde_json::Value> = match probe {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
        Ok(r) => {
            let status = r.status();
            let text = r.text().await.unwrap_or_default();
            warn!("[Auth] public.users probe failed ({}): {}", status, text);
            return;
        }
        Err(e) => {
            warn!("[Auth] public.users probe request failed: {}", e);
            return;
        }
    };

    // Pick the highest-priority match.
    let pick = existing
        .iter()
        .find(|r| r.get("id").and_then(|v| v.as_str()) == Some(&user.id))
        .or_else(|| {
            existing.iter().find(|r| {
                r.get("email")
                    .and_then(|v| v.as_str())
                    .map(|s| s.eq_ignore_ascii_case(&user.email))
                    .unwrap_or(false)
            })
        })
        .or_else(|| {
            existing
                .iter()
                .find(|r| r.get("name").and_then(|v| v.as_str()) == Some(user.name.as_str()))
        });

    match pick {
        Some(row) => {
            let target_id = row.get("id").and_then(|v| v.as_str()).unwrap_or(&user.id);
            let url = format!(
                "{}/rest/v1/users?id=eq.{}",
                auth.supabase_url, target_id
            );
            let body = serde_json::json!({
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "updated_at": chrono::Utc::now().to_rfc3339(),
            });
            let resp = client
                .patch(&url)
                .header("Authorization", format!("Bearer {}", access_token))
                .header("apikey", key)
                .header("Content-Type", "application/json")
                .header("Prefer", "return=minimal")
                .json(&body)
                .send()
                .await;
            match resp {
                Ok(r) if r.status().is_success() => info!(
                    "[Auth] public.users linked for {} ({}) → id={}",
                    user.name, user.email, user.id
                ),
                Ok(r) => {
                    let status = r.status();
                    let text = r.text().await.unwrap_or_default();
                    warn!("[Auth] public.users link failed ({}): {}", status, text);
                }
                Err(e) => warn!("[Auth] public.users link request failed: {}", e),
            }
        }
        None => {
            let url = format!("{}/rest/v1/users", auth.supabase_url);
            let body = serde_json::json!({
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "account": user.email,
                "status": "active",
            });
            let resp = client
                .post(&url)
                .header("Authorization", format!("Bearer {}", access_token))
                .header("apikey", key)
                .header("Content-Type", "application/json")
                .header("Prefer", "return=minimal")
                .json(&body)
                .send()
                .await;
            match resp {
                Ok(r) if r.status().is_success() || r.status().as_u16() == 201 => info!(
                    "[Auth] public.users inserted for {} ({})",
                    user.name, user.email
                ),
                Ok(r) => {
                    let status = r.status();
                    let text = r.text().await.unwrap_or_default();
                    warn!("[Auth] public.users insert failed ({}): {}", status, text);
                }
                Err(e) => warn!("[Auth] public.users insert request failed: {}", e),
            }
        }
    }
}

/// Decode the `exp` claim from a JWT without verifying its signature.
/// Returns `None` for tokens we can't parse — callers treat that the same as
/// an expired token (force re-auth) rather than risk handing a stale JWT to
/// Supabase Storage / PostgREST and getting a 401 mid-upload.
fn jwt_exp_seconds(token: &str) -> Option<i64> {
    let payload_b64 = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)
        .ok()?;
    serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()?
        .get("exp")?
        .as_i64()
}

fn jwt_is_expiring(token: &str, leeway_secs: i64) -> bool {
    match jwt_exp_seconds(token) {
        Some(exp) => chrono::Utc::now().timestamp() + leeway_secs >= exp,
        None => true,
    }
}

/// Refresh body factored out so `check_auth` can reuse it without going
/// through the Tauri command machinery (which would deadlock the State guard).
async fn perform_refresh_inner(auth: &Arc<AuthState>) -> Result<AuthResult, String> {
    let refresh_token = auth.refresh_token.read().await.clone();
    let refresh_token = refresh_token.ok_or("No refresh token available")?;

    let client = reqwest::Client::new();
    let token_url = format!(
        "{}/auth/v1/token?grant_type=refresh_token",
        auth.supabase_url
    );

    let resp = client
        .post(&token_url)
        .header("apikey", &auth.supabase_anon_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "refresh_token": refresh_token,
        }))
        .send()
        .await
        .map_err(|e| format!("Refresh failed: {}", e))?;

    if !resp.status().is_success() {
        // Refresh token expired — force re-login
        *auth.user.write().await = None;
        *auth.access_token.write().await = None;
        *auth.refresh_token.write().await = None;
        auth.clear_persisted();
        return Err("Session expired, please login again".to_string());
    }

    let session: SupabaseTokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    let meta = session.user.user_metadata.as_ref();
    let email = session.user.email.clone().unwrap_or_default();
    let name = meta
        .and_then(|m| m.full_name.clone().or_else(|| m.name.clone()))
        .unwrap_or_else(|| email.clone());
    let avatar = meta.and_then(|m| m.avatar_url.clone().or_else(|| m.picture.clone()));
    let role = if email.ends_with("@tzuchi.org.tw") {
        "creator"
    } else {
        "viewer"
    };

    let auth_user = AuthUser {
        id: session.user.id,
        email,
        name,
        role: role.to_string(),
        avatar_url: avatar,
    };

    *auth.access_token.write().await = Some(session.access_token.clone());
    *auth.refresh_token.write().await = Some(session.refresh_token);
    *auth.user.write().await = Some(auth_user.clone());
    auth.persist().await;

    info!("[Auth] Session refreshed successfully");

    Ok(AuthResult {
        success: true,
        user: Some(auth_user),
        token: Some(session.access_token),
        error: None,
    })
}

/// Refresh the Supabase session using refresh_token
#[command]
pub async fn refresh_session(
    auth: tauri::State<'_, Arc<AuthState>>,
) -> Result<AuthResult, String> {
    perform_refresh_inner(auth.inner()).await
}

/// Check if user is authenticated. If the cached access token is expired (or
/// will be within 60s), proactively refresh before answering — otherwise the
/// frontend treats us as logged-in but every Supabase call returns 401
/// (`"exp" claim timestamp check failed`), which the user sees as "卡住".
#[command]
pub async fn check_auth(
    auth: tauri::State<'_, Arc<AuthState>>,
) -> Result<AuthResult, String> {
    let user = auth.user.read().await.clone();
    let token = auth.access_token.read().await.clone();
    let has_refresh = auth.refresh_token.read().await.is_some();

    match (user, token) {
        (Some(u), Some(t)) => {
            if jwt_is_expiring(&t, 60) && has_refresh {
                info!("[Auth] check_auth: access token expired/expiring, refreshing");
                return match perform_refresh_inner(auth.inner()).await {
                    Ok(res) => Ok(res),
                    Err(e) => {
                        warn!("[Auth] auto-refresh failed: {}", e);
                        Ok(AuthResult {
                            success: false,
                            user: None,
                            token: None,
                            error: Some(e),
                        })
                    }
                };
            }
            Ok(AuthResult {
                success: true,
                user: Some(u),
                token: Some(t),
                error: None,
            })
        }
        _ => Ok(AuthResult {
            success: false,
            user: None,
            token: None,
            error: Some("Not authenticated".to_string()),
        }),
    }
}

/// Logout and clear stored tokens
#[command]
pub async fn logout(
    auth: tauri::State<'_, Arc<AuthState>>,
) -> Result<(), String> {
    // Revoke session on Supabase side
    if let Some(token) = auth.access_token.read().await.as_ref() {
        let client = reqwest::Client::new();
        let _ = client
            .post(format!("{}/auth/v1/logout", auth.supabase_url))
            .header("apikey", &auth.supabase_anon_key)
            .bearer_auth(token)
            .send()
            .await;
    }

    *auth.user.write().await = None;
    *auth.access_token.write().await = None;
    *auth.refresh_token.write().await = None;
    auth.clear_persisted();
    info!("[Auth] User logged out, session cleared");
    Ok(())
}
