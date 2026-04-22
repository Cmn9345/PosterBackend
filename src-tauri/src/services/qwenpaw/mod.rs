//! QwenPaw — in-process agent replacing the external CoPaw WebSocket server.
//!
//! Each submodule maps to a Python skill from `3in1media-copaw-webgpu`:
//!   - `status`   ← backend/skills/poster_status/
//!   - `notify`   ← backend/skills/poster_notify/
//!   - `thumbnail` (Sprint 2) ← backend/skills/poster_thumbnail/
//!   - `metadata`  (Sprint 2) ← backend/skills/poster_metadata/
//!   - `analysis`  (Sprint 4) ← backend/skills/poster_analysis/ (delegates to frontend WebGPU)
//!   - `task_queue` (Sprint 2) ← backend/copaw_agent/task_manager.py
//!
//! Immich/Supabase clients live in sibling modules (`services::immich`, `services::supabase`).

pub mod analysis;
pub mod llama_sidecar;
pub mod metadata;
pub mod notify;
pub mod status;
pub mod task_queue;
pub mod thumbnail;
pub mod vlm_local;
