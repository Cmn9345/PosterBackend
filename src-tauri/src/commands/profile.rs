// src-tauri/src/commands/profile.rs
//! User profile / onboarding commands.
//! check_onboarding_status: does the current user have a completed profile?
//! submit_onboarding:       upsert profile after filling all 3 onboarding steps.

use crate::commands::auth::AuthState;
use log::{error, info};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub user_id: String,
    pub last_name: String,
    pub first_name: String,
    pub birth_year: i16,
    pub birth_month: i16,
    pub birth_day: i16,
    pub gender: String,
    pub phone: String,
    pub phone_country_code: String,
    pub phone_verified_at: Option<String>,
    pub role_type: String,
    pub continent: Option<String>,
    pub country: Option<String>,
    pub hexin_area: Option<String>,
    pub heqi_area: Option<String>,
    pub copyright_agreed_at: String,
    pub onboarded_at: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingStatus {
    pub onboarded: bool,
    pub profile: Option<UserProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingInput {
    pub last_name: String,
    pub first_name: String,
    pub birth_year: i16,
    pub birth_month: i16,
    pub birth_day: i16,
    pub gender: String,
    pub phone: String,
    pub phone_country_code: Option<String>,
    pub role_type: String,
    pub continent: Option<String>,
    pub country: Option<String>,
    pub hexin_area: Option<String>,
    pub heqi_area: Option<String>,
}

/// Check whether the current user has completed onboarding.
/// Returns the existing profile if found, otherwise onboarded=false.
#[command]
pub async fn check_onboarding_status(
    auth: tauri::State<'_, Arc<AuthState>>,
) -> Result<OnboardingStatus, String> {
    let token = auth
        .access_token
        .read()
        .await
        .clone()
        .ok_or("Not authenticated")?;
    let user = auth
        .user
        .read()
        .await
        .clone()
        .ok_or("No user in session")?;

    let client = reqwest::Client::new();
    let url = format!(
        "{}/rest/v1/user_profiles?user_id=eq.{}&select=*",
        auth.supabase_url, user.id
    );

    let resp = client
        .get(&url)
        .header("apikey", &auth.supabase_anon_key)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        error!("[Profile] check_onboarding_status failed ({}): {}", status, body);
        return Err(format!("Query failed ({}): {}", status, body));
    }

    let profiles: Vec<UserProfile> = resp
        .json()
        .await
        .map_err(|e| format!("Parse failed: {}", e))?;

    match profiles.into_iter().next() {
        Some(profile) => {
            info!("[Profile] {} already onboarded", user.email);
            Ok(OnboardingStatus {
                onboarded: true,
                profile: Some(profile),
            })
        }
        None => {
            info!("[Profile] {} needs onboarding", user.email);
            Ok(OnboardingStatus {
                onboarded: false,
                profile: None,
            })
        }
    }
}

/// Upsert the user_profiles row with data collected during onboarding.
/// Uses PostgREST upsert via Prefer: resolution=merge-duplicates on the PK user_id.
#[command]
pub async fn submit_onboarding(
    auth: tauri::State<'_, Arc<AuthState>>,
    input: OnboardingInput,
) -> Result<UserProfile, String> {
    let token = auth
        .access_token
        .read()
        .await
        .clone()
        .ok_or("Not authenticated")?;
    let user = auth
        .user
        .read()
        .await
        .clone()
        .ok_or("No user in session")?;

    // Basic validation
    if input.last_name.trim().is_empty() || input.first_name.trim().is_empty() {
        return Err("姓名不能為空".to_string());
    }
    if input.phone.trim().is_empty() {
        return Err("手機號碼不能為空".to_string());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let body = serde_json::json!({
        "user_id": user.id,
        "last_name": input.last_name.trim(),
        "first_name": input.first_name.trim(),
        "birth_year": input.birth_year,
        "birth_month": input.birth_month,
        "birth_day": input.birth_day,
        "gender": input.gender,
        "phone": input.phone.trim(),
        "phone_country_code": input.phone_country_code
            .unwrap_or_else(|| "+886".to_string()),
        "role_type": input.role_type,
        "continent": input.continent,
        "country": input.country,
        "hexin_area": input.hexin_area,
        "heqi_area": input.heqi_area,
        "copyright_agreed_at": now,
        "onboarded_at": now,
    });

    let client = reqwest::Client::new();
    let url = format!(
        "{}/rest/v1/user_profiles?on_conflict=user_id",
        auth.supabase_url
    );

    let resp = client
        .post(&url)
        .header("apikey", &auth.supabase_anon_key)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates,return=representation")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        error!("[Profile] submit_onboarding failed ({}): {}", status, body);
        return Err(format!("Upsert failed ({}): {}", status, body));
    }

    let mut profiles: Vec<UserProfile> = resp
        .json()
        .await
        .map_err(|e| format!("Parse failed: {}", e))?;

    let profile = profiles
        .pop()
        .ok_or("Upsert succeeded but no row returned")?;

    info!("[Profile] Onboarding completed for {}", user.email);
    Ok(profile)
}
