// src/lib/api.ts
// Shared API helpers for Tauri invoke calls
import { invoke } from "@tauri-apps/api/core";

/** Generic Supabase query via Rust backend */
export async function querySupabase<T = unknown>(table: string, query: string): Promise<T[]> {
  const raw = await invoke<string>("query_supabase", { table, query });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/** Query with single result */
export async function queryOne<T = unknown>(table: string, query: string): Promise<T | null> {
  const results = await querySupabase<T>(table, `${query}&limit=1`);
  return results[0] ?? null;
}
