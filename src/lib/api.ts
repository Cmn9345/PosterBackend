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

// ── Exhibitions (展覽 CRUD) ──────────────────────────────────────────
// 對應 production schema:
//   public.exhibitions (id, name, cover_image_path, description, status,
//                       sort_order, created_at, updated_at)
//   status enum: planning | ongoing | finished

export type ExhibitionStatus = "planning" | "ongoing" | "finished";

export interface ExhibitionInput {
  name: string;
  description?: string;
  coverImagePath?: string;
  sortOrder?: number;
  status: ExhibitionStatus;
}

/** Create a new exhibition. Returns the created row's JSON (single-element array). */
export async function createExhibition(input: ExhibitionInput): Promise<string> {
  return invoke<string>("create_exhibition", {
    name: input.name,
    description: input.description ?? null,
    coverImagePath: input.coverImagePath ?? null,
    sortOrder: input.sortOrder ?? null,
    status: input.status,
  });
}

/** Update an existing exhibition. Pass only the fields you want changed. */
export async function patchExhibition(
  id: string,
  patch: Partial<ExhibitionInput>,
): Promise<void> {
  return invoke<void>("patch_exhibition", {
    id,
    name: patch.name ?? null,
    description: patch.description ?? null,
    coverImagePath: patch.coverImagePath ?? null,
    sortOrder: patch.sortOrder ?? null,
    status: patch.status ?? null,
  });
}

/** Delete an exhibition by id. */
export async function deleteExhibition(id: string): Promise<void> {
  return invoke<void>("delete_exhibition", { id });
}
