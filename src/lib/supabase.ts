// src/lib/supabase.ts
// Supabase client for poster-admin-app
// Note: Most data ops go through Tauri IPC → Rust backend.
// This client is for direct queries (e.g. realtime subscriptions, read-only queries).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  import.meta.env.VITE_POSTER_SUPABASE_URL || "https://ptsupabase.tzuchi-org.tw";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_POSTER_SUPABASE_ANON_KEY || "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default supabase;
